/**
 * The studios' shared editing logic, checked by behaviour.
 *
 * These replace source-text assertions in the old `editor-static.test.mjs` that
 * grepped `editor.js` for calls and field names. Grepping proved a line was
 * written; it could not prove that undo restores what it should, that a key
 * lands at the playhead, or that an edit in the combined view reaches both
 * bodies. Each of those is now exercised against the module that does it.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { canRedo, canUndo, commit, emptyHistory, redo, undo } from "../src/editor/history.ts"
import {
  activeGripKind,
  adjacentKey,
  adjacentPhase,
  boneKeys,
  commitPoseToBoneKeys,
  deleteBoneKey,
  deleteExpressionKey,
  ensureBoneKey,
  ensureExpressionKey,
  ensureWristKey,
  expressionKeys,
  gripTrackName,
  gripUsesAnimationOverride,
  handKeyPhases,
  normalizePhase,
  setExpressionChannel,
  wristKeys,
  writeHandChannel,
  type HandControlValues,
} from "../src/editor/keyframes.ts"
import { writeBoneBind, writeLayerBind } from "../src/editor/binds.ts"
import { handleShortcut } from "../src/editor/shortcuts.ts"
import { optionsByCell, unmadeByCell, cellKey } from "../src/editor/equipment-catalog.ts"
import { UNALIGNED, lineFor } from "../src/rig/equipment-lines.ts"
import {
  EQUIPMENT_SLOTS,
  activeLayerID,
  layerMatchesMainHandPreview,
  REVIEW_PHASE,
} from "../src/editor/equipment-slots.ts"
import { RigTracks } from "../src/rig/tracks.ts"
import { reviewAnimations, animationEquipment } from "../src/rig/clips.ts"
import { layerBindOwner } from "../src/rig/skeleton.ts"
import { validateThreeQuarterRigScene } from "../src/rig/schema.ts"
import type { RigScene } from "../src/rig/types.ts"

const scenePath = fileURLToPath(
  new URL("../project/scene.json", import.meta.url),
)
const source = JSON.parse(await readFile(scenePath, "utf8"))
const freshScene = (): RigScene => validateThreeQuarterRigScene(structuredClone(source))

test("unrelated equipment previews use a weapon rather than stacking both main-hand families", () => {
  assert.equal(layerMatchesMainHandPreview("weapon", "necklace"), true)
  assert.equal(layerMatchesMainHandPreview("staff", "necklace"), false)
  assert.equal(layerMatchesMainHandPreview("staff", "staff"), true)
  assert.equal(layerMatchesMainHandPreview("weapon", "staff"), false)
  assert.equal(layerMatchesMainHandPreview("shield", "necklace"), true)
})

// ---------------------------------------------------------------------------
// Undo and redo
// ---------------------------------------------------------------------------

test("undo and redo walk the same edits back and forward", () => {
  let history = emptyHistory<string>()
  assert.equal(canUndo(history), false)
  assert.equal(canRedo(history), false)

  history = commit(history, "a", "b")
  history = commit(history, "b", "c")
  assert.equal(canUndo(history), true)

  const back = undo(history, "c")
  assert.ok(back)
  assert.equal(back.snapshot, "b", "undo restores the state before the last edit")
  const further = undo(back.history, back.snapshot)
  assert.ok(further)
  assert.equal(further.snapshot, "a")
  assert.equal(undo(further.history, further.snapshot), null, "there is nothing before the first edit")

  const forward = redo(further.history, further.snapshot)
  assert.ok(forward)
  assert.equal(forward.snapshot, "b", "redo replays the edit undo took back")
})

test("an edit that changed nothing is not an undo step", () => {
  // A drag that ended where it started, or a field retyped to the same value,
  // must not make undo appear to do nothing.
  const history = commit(emptyHistory<{ x: number }>(), { x: 1 }, { x: 1 })
  assert.equal(canUndo(history), false)
  const real = commit(emptyHistory<{ x: number }>(), { x: 1 }, { x: 2 })
  assert.equal(canUndo(real), true)
})

test("a new edit clears the redo stack", () => {
  let history = commit(emptyHistory<string>(), "a", "b")
  const back = undo(history, "b")
  assert.ok(back)
  assert.equal(canRedo(back.history), true)
  history = commit(back.history, "a", "z")
  assert.equal(canRedo(history), false, "branching discards the future that was undone")
})

test("history forgets its oldest steps rather than growing without bound", () => {
  let history = emptyHistory<number>()
  for (let step = 0; step < 12; step += 1) history = commit(history, step, step + 1, 5)
  assert.equal(history.undo.length, 5)
  assert.deepEqual([...history.undo], [7, 8, 9, 10, 11], "the five most recent steps survive")
})

// ---------------------------------------------------------------------------
// Bone keys
// ---------------------------------------------------------------------------

test("a new bone track gets neutral boundary keys so one correction stays local", () => {
  const scene = freshScene()
  const tracks = RigTracks.fromScene(scene)
  ensureBoneKey(scene, "run", "chest", 0.5, tracks)
  const keys = boneKeys(scene, "run", "chest")
  const phases = keys.map((key) => key.phase)
  assert.deepEqual(phases, [0, 0.5, 1], "keys are sorted, and the clip ends where it started")
  assert.deepEqual(
    keys.filter((key) => key.phase === 0 || key.phase === 1).map((key) => key.rotation),
    [0, 0],
    "the boundaries are neutral, so the correction does not hold across the clip",
  )
})

test("a bone key at the playhead is reused rather than duplicated", () => {
  const scene = freshScene()
  const tracks = RigTracks.fromScene(scene)
  const first = ensureBoneKey(scene, "run", "chest", 0.5, tracks)
  const again = ensureBoneKey(scene, "run", "chest", 0.5, tracks)
  assert.equal(first, again)
  // Within the epsilon the playhead cannot resolve, it is the same key.
  const near = ensureBoneKey(scene, "run", "chest", 0.5009, tracks)
  assert.equal(near, first)
  assert.equal(boneKeys(scene, "run", "chest").length, 3)
})

test("a drag's manual pose is added to the correction already keyed there", () => {
  const scene = freshScene()
  const tracks = RigTracks.fromScene(scene)
  ensureBoneKey(scene, "run", "chest", 0.5, tracks)
  commitPoseToBoneKeys(scene, "run", 0.5, { chest: { rotation: 4 } })
  const first = boneKeys(scene, "run", "chest").find((key) => key.phase === 0.5)
  assert.equal(first?.rotation, 4)
  // A second drag layers onto the first rather than replacing it.
  commitPoseToBoneKeys(scene, "run", 0.5, { chest: { rotation: 3 } })
  const second = boneKeys(scene, "run", "chest").find((key) => key.phase === 0.5)
  assert.equal(second?.rotation, 7, "the key holds the total correction, not the last delta")
})

test("deleting a bone key prunes the track and then the clip", () => {
  const scene = freshScene()
  const tracks = RigTracks.fromScene(scene)
  ensureBoneKey(scene, "blocked", "chest", 0.5, tracks)
  assert.ok(scene.boneKeyframes.blocked?.chest)
  for (const phase of [0, 0.5, 1]) deleteBoneKey(scene, "blocked", "chest", phase)
  assert.equal(scene.boneKeyframes.blocked, undefined, "an empty clip does not linger in the scene")
})

test("phases are normalized to what the timeline can actually address", () => {
  assert.equal(normalizePhase(0.123456789), 0.1235)
  assert.equal(normalizePhase(-1), 0, "the playhead cannot go before the clip")
  assert.equal(normalizePhase(4), 1, "or past its end")
})

// ---------------------------------------------------------------------------
// Expression keys
// ---------------------------------------------------------------------------

test("setting a face channel keys it at the playhead and leaves the other alone", () => {
  const scene = freshScene()
  const tracks = RigTracks.fromScene(scene)
  const before = tracks.expressionAt("run", 0.4)
  setExpressionChannel(scene, "run", 0.4, "mouth", "shout", tracks)
  const key = expressionKeys(scene, "run").find((entry) => entry.phase === 0.4)
  assert.equal(key?.mouth, "shout")
  assert.equal(key?.eyes, before.eyes, "the eyes keep whatever the track already said")
})

test("face keys are a stepped track: a key holds until the next one", () => {
  const scene = freshScene()
  // Author on a clip of its own so the assertion is about the sampler rather
  // than about whichever keys the live scene happens to carry.
  scene.expressionKeyframes.testClip = []
  const tracks = RigTracks.fromScene(scene)
  setExpressionChannel(scene, "testClip", 0.2, "eyes", "wince", tracks)
  setExpressionChannel(scene, "testClip", 0.6, "eyes", "wide", tracks)
  const updated = RigTracks.fromScene(scene)
  assert.equal(updated.expressionAt("testClip", 0.2).eyes, "wince")
  assert.equal(updated.expressionAt("testClip", 0.55).eyes, "wince", "it holds until the next key")
  assert.equal(updated.expressionAt("testClip", 0.6).eyes, "wide", "and then swaps, rather than blending")
  // Before the first key the clip shows that key's face rather than snapping to
  // neutral, so a clip that opens mid-expression does not flicker on frame one.
  assert.equal(updated.expressionAt("testClip", 0.1).eyes, "wince")
  assert.deepEqual(
    updated.expressionAt("noKeysAtAll", 0.5),
    { eyes: "neutral", mouth: "neutral" },
    "a clip with no face keys is neutral throughout",
  )
})

test("deleting the last face key removes the clip's track entirely", () => {
  const scene = freshScene()
  scene.expressionKeyframes.testClip = []
  const tracks = RigTracks.fromScene(scene)
  ensureExpressionKey(scene, "testClip", 0.3, tracks)
  assert.equal(expressionKeys(scene, "testClip").length, 1)
  deleteExpressionKey(scene, "testClip", 0.3)
  assert.equal(scene.expressionKeyframes.testClip, undefined)
})

// ---------------------------------------------------------------------------
// Hand controls
// ---------------------------------------------------------------------------

const handValues = (patch: Partial<HandControlValues> = {}): HandControlValues => ({
  angle: 0,
  gripRotation: 0,
  knuckleAxis: 0,
  fingerAngles: {},
  fingerOffsets: {},
  ...patch,
})

test("which grip a clip authors depends on what is actually equipped", () => {
  // The body clip is named `swordSwing`, but while a staff is equipped its hand
  // controls stay in the staff family rather than borrowing the weapon channel.
  assert.equal(activeGripKind("swordSwing", "weapon"), "weapon")
  assert.equal(activeGripKind("swordSwing", "staff"), "staff")
  assert.equal(activeGripKind("bowDraw", "weapon"), "bow", "a bow clip is always a bow grip")
  assert.equal(activeGripKind("staffIdle", "weapon"), "staff")
})

test("ordinary clips share one grip curve per held class; attacks may override", () => {
  assert.equal(gripUsesAnimationOverride("idle"), false)
  assert.equal(gripUsesAnimationOverride("swordSwing"), true)
  assert.equal(gripUsesAnimationOverride("sneakAttack"), true)
  assert.equal(gripTrackName("idle", "weapon"), "__grip_weapon", "idle reads the shared weapon grip")
  assert.equal(gripTrackName("staffIdle", "staff"), "__grip_staff")
  assert.equal(gripTrackName("swordSwing", "weapon"), "swordSwing", "the attack owns its own curve")
})

test("an override clip scopes a non-natural held class so it cannot leak", () => {
  const key = { phase: 0.5, angle: 0 }
  // A staff correction authored on the sword swing must not move the sword.
  writeHandChannel(key, "swordSwing", "staff", "gripRotation", handValues({ gripRotation: 12 }), [])
  assert.equal(key.grips?.staff?.gripRotation, 12)
  assert.equal("gripRotation" in key, false, "the weapon's own channel is untouched")
  // The clip's natural class writes inline, which is where older scenes put it.
  const natural = { phase: 0.5, angle: 0 }
  writeHandChannel(natural, "swordSwing", "weapon", "gripRotation", handValues({ gripRotation: 9 }), [])
  assert.equal(natural.gripRotation, 9)
})

test("writing one hand channel leaves every other channel alone", () => {
  const key = { phase: 0.5, angle: 3, gripRotation: 7, knuckleAxis: -4 }
  writeHandChannel(key, "idle", "weapon", "knuckleAxis", handValues({ knuckleAxis: 11 }), [])
  assert.equal(key.knuckleAxis, 11)
  assert.equal(key.gripRotation, 7, "an authored grip rotation survives a knuckle edit")
  assert.equal(key.angle, 3, "and so does the wrist angle")
})

test("a finger channel writes only the fingers that were selected", () => {
  const key = { phase: 0.5, angle: 0 }
  const values = handValues({ fingerAngles: { handClosedLIndex: 20, handClosedLPinky: 30 } })
  writeHandChannel(key, "idle", "weapon", "fingerAngle", values, ["handClosedLIndex"])
  assert.deepEqual(key.fingerAngles, { handClosedLIndex: 20 }, "the pinky was not selected")
})

test("a hand key is created at the playhead and reused thereafter", () => {
  const scene = freshScene()
  const first = ensureWristKey(scene, "blocked", "L", 0.4, () => ({ angle: 0 }))
  const again = ensureWristKey(scene, "blocked", "L", 0.4, () => ({ angle: 99 }))
  assert.equal(first, again, "the seed is not applied to a key that already exists")
  assert.equal(again.angle, 0)
  const keys = wristKeys(scene, "blocked", "L")
  ensureWristKey(scene, "blocked", "L", 0.1, () => ({ angle: 0 }))
  assert.deepEqual(
    wristKeys(scene, "blocked", "L").map((key) => key.phase),
    [0.1, 0.4],
    "keys stay sorted by phase however they are inserted",
  )
  assert.equal(keys.length, 2)
})

test("the transport's arrows step hand keys from both tracks at once", () => {
  // The wrist angle is authored on the clip; grip, knuckle and finger channels
  // usually live on the shared per-held-class curve. Stepping one track alone
  // would silently skip half the keys an author can see on the timeline.
  const scene = freshScene()
  const track = gripTrackName("idle", "weapon")
  const clipOnly = wristKeys(scene, "idle", "L").map((key) => key.phase)
  const sharedOnly = wristKeys(scene, track, "L").map((key) => key.phase)
  const union = handKeyPhases(scene, "idle", track, "L")
  assert.ok(clipOnly.length > 0 && sharedOnly.length > 0, "both tracks carry keys for idle")
  assert.ok(union.length > clipOnly.length, "the shared grip curve contributes keys of its own")
  for (const phase of [...clipOnly, ...sharedOnly]) {
    assert.ok(union.includes(phase), `${phase} is reachable`)
  }
  assert.deepEqual(union, [...union].sort((left, right) => left - right), "sorted")
  assert.equal(new Set(union).size, union.length, "a phase both tracks key is offered once")
})

test("stepping stops at the ends rather than wrapping", () => {
  const phases = [0, 0.25, 0.75]
  assert.equal(adjacentPhase(phases, 0, 1), 0.25)
  assert.equal(adjacentPhase(phases, 0.25, 1), 0.75)
  assert.equal(adjacentPhase(phases, 0.75, 1), null, "nothing after the last key")
  assert.equal(adjacentPhase(phases, 0, -1), null, "nothing before the first")
  // Landing exactly on a key must not count as passing it, or a step would
  // stick rather than move on.
  assert.equal(adjacentPhase(phases, 0.2500001, 1), 0.75)
  assert.equal(adjacentPhase([], 0.5, 1), null)
})

test("previous and next step over the keys on a track, never onto the playhead", () => {
  const keys = [{ phase: 0 }, { phase: 0.25 }, { phase: 0.75 }]
  assert.equal(adjacentKey(keys, 0.25, 1)?.phase, 0.75)
  assert.equal(adjacentKey(keys, 0.25, -1)?.phase, 0)
  assert.equal(adjacentKey(keys, 0.75, 1), null, "there is nothing after the last key")
  assert.equal(adjacentKey(keys, 0, -1), null, "or before the first")
})

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

test("an edit is written to whichever record owns the placement", () => {
  const scene = freshScene()
  const layer = scene.layers.find((candidate) => candidate.id === "tunicBody")
  assert.ok(layer)
  // The worn chest option carries its own bind, so the edit belongs to it and
  // not to the layer underneath -- otherwise the option keeps winning and the
  // edit looks like it never saved.
  const option = scene.chestOptions.find((candidate) => candidate.id === scene.activeChest)
  assert.ok(option?.bindByProfile, "the chest option owns its placement")
  writeLayerBind(scene, scene, "tunicBody", "maleV1", "x", 12.5)
  assert.equal(option.bindByProfile.maleV1.x, 12.5)
  assert.equal(layerBindOwner(scene, layer, "maleV1")?.x, 12.5)
})

test("moving the palm carries the finger stack with it", () => {
  const scene = freshScene()
  const fingerBefore = scene.layers.find((candidate) => candidate.id === "handClosedLIndex")
  assert.ok(fingerBefore)
  writeLayerBind(scene, scene, "handClosedL", "maleV1", "x", 42)
  for (const id of ["handClosedLIndex", "handClosedLThumb"]) {
    const finger = scene.layers.find((candidate) => candidate.id === id)
    assert.equal(finger?.bindByProfile.maleV1.x, 42, `${id} follows the palm`)
  }
})

test("resizing the palm scales its fingers proportionally, not to the same number", () => {
  const scene = freshScene()
  const palm = scene.layers.find((candidate) => candidate.id === "handClosedL")
  const finger = scene.layers.find((candidate) => candidate.id === "handClosedLPinky")
  assert.ok(palm && finger)
  const palmBefore = palm.bindByProfile.maleV1.scaleX
  const fingerBefore = finger.bindByProfile.maleV1.scaleX
  writeLayerBind(scene, scene, "handClosedL", "maleV1", "scaleX", palmBefore * 2)
  assert.ok(
    Math.abs(finger.bindByProfile.maleV1.scaleX - fingerBefore * 2) < 1e-9,
    "the smaller pinky stays proportionally smaller",
  )
})

test("a bone bind edit drops the manual pose delta it replaces", () => {
  const scene = freshScene()
  const manualPose = { chest: { x: 5, rotation: 9 } }
  writeBoneBind(scene, "chest", "maleV1", "x", 40, manualPose)
  assert.equal(scene.bones.find((bone) => bone.id === "chest")?.bindByProfile.maleV1.x, 40)
  assert.deepEqual(manualPose.chest, { rotation: 9 }, "only the field that was baked is cleared")
  writeBoneBind(scene, "chest", "maleV1", "rotation", 2, manualPose)
  assert.equal(manualPose.chest, undefined, "an emptied delta is removed entirely")
})

// ---------------------------------------------------------------------------
// The equipment ladder
// ---------------------------------------------------------------------------

const emptyCatalog = { items: new Map() }

test("the picker files every option onto the line-and-tier grid", () => {
  const scene = freshScene()
  const cells = optionsByCell(scene.weaponOptions ?? [], emptyCatalog)
  const placed = [...cells.values()].flat()
  assert.equal(placed.length, scene.weaponOptions?.length, "no option is dropped from the grid")
  for (const key of cells.keys()) {
    assert.match(key, /^[a-z]+\/[a-z_]+$/, "every cell names a line and a tier")
  }
})

test("an item's own build line wins over what its name looks like", async () => {
  // Gear that predates the naming scheme is assigned a line rather than
  // renamed, because its name is the one players already know. Most of the
  // catalogue is in that position, so losing the field files nearly everything
  // as unaligned -- which reads as the grid having shuffled itself.
  const catalogue = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL("../project/equipment-catalog.json", import.meta.url),
      ),
      "utf8",
    ),
  )
  const assigned = catalogue.items.filter((item: { line?: string }) => item.line)
  assert.equal(assigned.length, catalogue.items.length, "the demo catalogue assigns every line explicitly")
  for (const item of assigned) {
    // `unaligned` is the one line that means "no line", so it reads back null.
    const expected = item.line === UNALIGNED.id ? null : item.line
    assert.equal(lineFor(item), expected, `${item.name} belongs to ${item.line}`)
  }
  // A name that matches no prefix at all still lands where it was assigned.
  assert.equal(lineFor({ name: "Moonsteel Rapier", line: "utility" }), "utility")
  assert.equal(lineFor({ name: "Moonsteel Rapier" }), null, "and the name alone says nothing")
})

test("the picker reads an item's line straight from the catalogue", async () => {
  // The grid can only file an option where the parsed catalogue puts it, so the
  // parser has to keep the field the ladder is built from.
  const { loadEquipmentCatalog } = await import("../src/editor/equipment-catalog.ts")
  assert.equal(typeof loadEquipmentCatalog, "function")
  const scene = freshScene()
  const catalog = {
    items: new Map([
      ["a_rapier", { id: "a_rapier", name: "Moonsteel Rapier", line: "sneak", rarity: "rare" }],
    ]),
    applicability: new Map<string, ReadonlySet<string>>(),
  }
  const cells = optionsByCell([{ id: "opt", label: "Moonsteel Rapier", itemID: "a_rapier" }], catalog)
  assert.ok(cells.has(cellKey("sneak", "rare")), "it files under its own line and rarity")
  assert.equal(scene.format, "modular-character-studio-scene-v1")
})

test("gear with no inventory item files as a look rather than as missing data", () => {
  // The bare arms and the default tunic are what the hunter starts in.
  const options = [{ id: "clothBoundV1", label: "Cloth Bound" }]
  const cells = optionsByCell(options, emptyCatalog)
  assert.ok(cells.has(cellKey("unaligned", "common")), "it lands on the ladder, not under Unrated")
})

test("an item is only in the backlog when nothing anywhere has drawn it", () => {
  const catalog = {
    items: new Map([
      ["drawn_axe", { id: "drawn_axe", name: "Drawn Axe", slot: "mainHand", category: "axe" }],
      ["undrawn_axe", { id: "undrawn_axe", name: "Undrawn Axe", slot: "mainHand", category: "axe" }],
    ]),
  }
  // "Dressed" is asked of every catalogue, not just this slot's: an item only
  // needs art once, and a staff picker measuring against staff options alone
  // would report every axe in the game as needing art.
  const everyOption = [{ id: "a", label: "A", itemID: "drawn_axe" }]
  const missing = [...unmadeByCell("weapon", catalog, everyOption).values()].flat()
  assert.deepEqual(missing.map((item) => item.id), ["undrawn_axe"])
})

test("a slot's backlog only lists the weapon categories it actually holds", () => {
  const catalog = {
    items: new Map([
      ["an_axe", { id: "an_axe", name: "Axe", slot: "mainHand", category: "axe" }],
      ["a_staff", { id: "a_staff", name: "Staff", slot: "mainHand", category: "staff" }],
    ]),
  }
  const weapons = [...unmadeByCell("weapon", catalog, []).values()].flat().map((item) => item.id)
  const staffs = [...unmadeByCell("staff", catalog, []).values()].flat().map((item) => item.id)
  assert.deepEqual(weapons, ["an_axe"], "the blade picker does not list staffs")
  assert.deepEqual(staffs, ["a_staff"], "and the staff picker does not list axes")
})

// ---------------------------------------------------------------------------
// Review poses
// ---------------------------------------------------------------------------

test("a held piece is reviewed in the clips that show it, plus its attack", () => {
  const bow = reviewAnimations("bow")
  assert.ok(bow.includes("bowDraw"))
  for (const clip of bow) {
    assert.ok(
      (animationEquipment[clip] as readonly string[]).includes("bow"),
      `${clip} actually draws the bow`,
    )
  }
  // A staff or spear reads fine carried and still be wrong once the body lunges,
  // so its review set deliberately includes the attack poses.
  const staff = reviewAnimations("staff")
  assert.ok(staff.includes("swordSwing") && staff.includes("sneakAttack"))
})

test("gear no clip singles out is reviewed standing, moving, and swinging", () => {
  assert.deepEqual([...reviewAnimations("necklace")], ["idle", "run", "swordSwing", "bowDraw"])
  assert.deepEqual([...reviewAnimations("lowerLegL")], ["idle", "run", "swordSwing", "bowDraw"])
})

test("every review pose names a moment inside its clip, or falls back to its start", () => {
  // `blocked` is the one review clip with no authored review phase, so it opens
  // at the start of the recoil rather than at the moment of impact. That is
  // pre-existing behaviour, pinned here so it is a decision rather than a
  // surprise; adding an entry to REVIEW_PHASE is all it would take to change.
  const unphased = new Set<string>()
  for (const slot of EQUIPMENT_SLOTS) {
    const layerID = activeLayerID(slot, slot.pieces?.[0]?.id ?? null)
    for (const clip of reviewAnimations(layerID)) {
      const phase = REVIEW_PHASE[clip]
      if (phase === undefined) {
        unphased.add(clip)
        continue
      }
      assert.ok(phase >= 0 && phase <= 1, `${clip}'s review phase is inside the clip`)
    }
  }
  assert.deepEqual([...unphased], ["blocked"], "only the blocked recoil falls back to phase 0")
})

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

/** A key press, carrying just the fields the handler reads. */
function press(
  key: string,
  options: { meta?: boolean; shift?: boolean; code?: string; inField?: boolean } = {},
) {
  const claimed = { prevented: false }
  const event = {
    key,
    code: options.code ?? "",
    metaKey: options.meta ?? false,
    ctrlKey: false,
    shiftKey: options.shift ?? false,
    // The handler only asks a target for its tag name and editability.
    target: { tagName: options.inField ? "INPUT" : "DIV" },
    preventDefault: () => {
      claimed.prevented = true
    },
  } as unknown as KeyboardEvent
  return { event, claimed }
}

const noHandlers = () => {
  const fired: string[] = []
  return {
    fired,
    handlers: {
      undo: () => fired.push("undo"),
      redo: () => fired.push("redo"),
      save: () => fired.push("save"),
      togglePlayback: () => fired.push("playback"),
      setMode: (mode: "bone" | "layer") => fired.push(mode),
      onEscape: () => fired.push("escape"),
    },
  }
}

test("undo and redo reach the studio even while a field has focus", () => {
  // An author is usually mid-edit in a numeric field when they reach for
  // Cmd-Z. Deferring to the field there is the same as having no shortcut.
  const { fired, handlers } = noHandlers()
  handleShortcut(press("z", { meta: true, inField: true }).event, handlers)
  handleShortcut(press("z", { meta: true, shift: true, inField: true }).event, handlers)
  handleShortcut(press("y", { meta: true, inField: true }).event, handlers)
  assert.deepEqual(fired, ["undo", "redo", "redo"], "Cmd-Y redoes as well as Cmd-Shift-Z")
})

test("a bare letter belongs to the field that has focus", () => {
  const { fired, handlers } = noHandlers()
  handleShortcut(press("l", { inField: true }).event, handlers)
  handleShortcut(press("b", { inField: true }).event, handlers)
  handleShortcut(press(" ", { code: "Space", inField: true }).event, handlers)
  assert.deepEqual(fired, [], "typing in a search box cannot switch stage mode")
  handleShortcut(press("l").event, handlers)
  handleShortcut(press("b").event, handlers)
  handleShortcut(press(" ", { code: "Space" }).event, handlers)
  assert.deepEqual(fired, ["layer", "bone", "playback"])
})

test("a shortcut that acts stops the browser doing its own thing with the key", () => {
  const { handlers } = noHandlers()
  for (const [key, options] of [
    ["z", { meta: true }],
    ["s", { meta: true }],
    [" ", { code: "Space" }],
  ] as const) {
    const { event, claimed } = press(key, options)
    handleShortcut(event, handlers)
    assert.equal(claimed.prevented, true, `${key} is claimed`)
  }
  // A plain letter is not, so it still reaches anything else listening.
  const plain = press("b")
  handleShortcut(plain.event, handlers)
  assert.equal(plain.claimed.prevented, false)
})

test("a studio only answers for the shortcuts it offers", () => {
  // The equipment studio has no stage modes, so `b` and `l` must do nothing
  // rather than throw on a handler it never supplied.
  const fired: string[] = []
  const handlers = { undo: () => fired.push("undo"), redo: () => fired.push("redo") }
  assert.doesNotThrow(() => {
    handleShortcut(press("b").event, handlers)
    handleShortcut(press("s", { meta: true }).event, handlers)
    handleShortcut(press(" ", { code: "Space" }).event, handlers)
  })
  assert.deepEqual(fired, [])
  handleShortcut(press("z", { meta: true }).event, handlers)
  assert.deepEqual(fired, ["undo"])
})
