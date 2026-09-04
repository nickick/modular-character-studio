/**
 * Stage interaction, checked by behaviour.
 *
 * These replace source-text assertions in `editor-static.test.mjs` that grepped
 * `editor.js` for calls like `solveTwoBoneIK(` and `constrainForearmRotation(`.
 * Grepping proved the call was written; it could not prove the elbow bends
 * forward, that a dragged hand stays reachable, or that a drag delta does not
 * double-count the clip's own motion. These check that.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import {
  BONE_GRAB_RADIUS,
  STAGE_OVERSCAN,
  STAGE_SIZE,
  STAGE_VIEW_SIZE,
  beginLayerDrag,
  boneDragKind,
  hitBone,
  parentInverse,
  sideOf,
  solveArmIKDrag,
  solveBoneDrag,
  solveElbowDrag,
  solveLayerDrag,
  stagePoint,
  withDragDelta,
} from "../src/editor/stage.ts"
import { resolveProfile, worldMatrices } from "../src/rig/skeleton.ts"
import { RigTracks } from "../src/rig/tracks.ts"
import { transformPoint } from "../src/rig/matrix.ts"
import { mergePoses } from "../src/rig/clip-poses.ts"
import type { Pose, ResolvedBone, Side } from "../src/rig/types.ts"

const scenePath = fileURLToPath(
  new URL("../project/scene.json", import.meta.url),
)
const scene = JSON.parse(await readFile(scenePath, "utf8"))
const tracks = RigTracks.fromScene(scene)
const rig = resolveProfile(scene, "maleV1")

const bonesByID: Record<string, ResolvedBone> = Object.fromEntries(
  rig.bones.map((bone) => [bone.id, bone]),
)

/** Where `handL` ends up once a manual delta is layered onto a clip. */
function handAt(animation: string, phase: number, manual: Pose) {
  const pose = mergePoses(tracks.pose(animation, phase), manual)
  return transformPoint(worldMatrices(rig.bones, pose).handL, { x: 0, y: 0 })
}

function contextAt(animation: string, phase: number, manual: Pose = {}) {
  const authored = tracks.pose(animation, phase)
  const pose = { ...authored, ...manual }
  return { bones: rig.bones, pose, authored, currentWorld: worldMatrices(rig.bones, pose) }
}

test("stage coordinates put the artboard origin inside the overscan margin", () => {
  const bounds = { left: 40, top: 12, width: STAGE_VIEW_SIZE, height: STAGE_VIEW_SIZE } as DOMRect
  // A click on the very top-left of the element is overscan above and left of
  // the artboard, which is what gives a swung weapon room to stay visible.
  const corner = stagePoint({ clientX: 40, clientY: 12 }, bounds)
  assert.deepEqual(corner, { x: -STAGE_OVERSCAN, y: -STAGE_OVERSCAN })
  const origin = stagePoint({ clientX: 40 + STAGE_OVERSCAN, clientY: 12 + STAGE_OVERSCAN }, bounds)
  assert.deepEqual(origin, { x: 0, y: 0 })
  assert.equal(STAGE_VIEW_SIZE, STAGE_SIZE + STAGE_OVERSCAN * 2)
})

test("stage coordinates are independent of how large the canvas is displayed", () => {
  const big = { left: 0, top: 0, width: STAGE_VIEW_SIZE, height: STAGE_VIEW_SIZE } as DOMRect
  const small = { left: 0, top: 0, width: STAGE_VIEW_SIZE / 4, height: STAGE_VIEW_SIZE / 4 } as DOMRect
  const fromBig = stagePoint({ clientX: 800, clientY: 600 }, big)
  const fromSmall = stagePoint({ clientX: 200, clientY: 150 }, small)
  assert.deepEqual(fromSmall, fromBig)
})

test("a bone is grabbed only within the grab radius of its drawn origin", () => {
  const { currentWorld } = contextAt("idle", 0)
  const chest = currentWorld.chest
  const origin = { x: chest.e, y: chest.f }
  assert.equal(hitBone(origin, rig.bones, currentWorld)?.id, "chest")
  const justInside = { x: origin.x + BONE_GRAB_RADIUS - 1, y: origin.y }
  assert.ok(hitBone(justInside, rig.bones, currentWorld), "a near miss still grabs a bone")
  // Far outside the character entirely: nothing is close enough to grab.
  const nowhere = { x: origin.x + 4000, y: origin.y + 4000 }
  assert.equal(hitBone(nowhere, rig.bones, currentWorld), null)
})

test("hands drag through IK, forearms through the elbow hinge, everything else moves", () => {
  assert.equal(boneDragKind("handL"), "armIK")
  assert.equal(boneDragKind("handR"), "armIK")
  assert.equal(boneDragKind("lowerArmL"), "armElbow")
  assert.equal(boneDragKind("lowerArmR"), "armElbow")
  assert.equal(boneDragKind("chest"), "bone")
  // `lowerLegL` ends in L but is not an arm, so it must not be hinged as one.
  assert.equal(boneDragKind("lowerLegL"), "bone")
  assert.equal(sideOf("handR"), "R")
  assert.equal(sideOf("handL"), "L")
})

for (const side of ["L", "R"] as Side[]) {
  test(`the ${side} elbow only ever bends forward, wherever it is dragged`, () => {
    const context = contextAt("idle", 0)
    const bone = bonesByID[`lowerArm${side}`]
    // Sweep the pointer all the way around the shoulder. Every solve must land
    // inside the one-way hinge, because this character faces three-quarter
    // toward screen-left and both forearms flex that way.
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const radians = (degrees * Math.PI) / 180
      const point = { x: 600 + Math.cos(radians) * 300, y: 500 + Math.sin(radians) * 300 }
      const delta = solveElbowDrag(point, side, context)
      const total =
        bone.rotation +
        (context.authored[`lowerArm${side}`]?.rotation ?? 0) +
        (delta[`lowerArm${side}`]?.rotation ?? 0)
      assert.ok(total >= -1e-9 && total <= 155 + 1e-9, `${degrees}deg solved to ${total}`)
    }
  })
}

test("dragging a hand carries it toward the pointer from any direction", () => {
  // `solveTwoBoneIK` models the arm as two segments lying along +Y. The real
  // arm does not: `lowerArmL` sits 15 units lateral of its parent and both
  // bones carry a bind rotation, so the hand approaches the pointer rather than
  // landing exactly on it. That approximation predates the port and is what
  // authors have been dragging against; this pins the property it does have.
  const context = contextAt("idle", 0)
  const start = transformPoint(context.currentWorld.handL, { x: 0, y: 0 })
  for (const [dx, dy] of [[40, 30], [-40, 30], [40, -30], [-60, 0], [0, 60]]) {
    const target = { x: start.x + dx, y: start.y + dy }
    // Manual edits are additive to the clip, so the studio draws
    // mergePoses(authored, manual) rather than replacing the authored values.
    const landed = handAt("idle", 0, solveArmIKDrag(target, "L", context))
    const before = Math.hypot(start.x - target.x, start.y - target.y)
    const after = Math.hypot(landed.x - target.x, landed.y - target.y)
    assert.ok(after < before, `dragging by (${dx}, ${dy}) closed the gap: ${before} -> ${after}`)
  }
})

test("an unreachable target extends the arm instead of flipping the elbow", () => {
  const context = contextAt("idle", 0)
  const far = { x: -3000, y: -3000 }
  const delta = solveArmIKDrag(far, "L", context)
  const elbow =
    bonesByID.lowerArmL.rotation +
    (context.authored.lowerArmL?.rotation ?? 0) +
    (delta.lowerArmL?.rotation ?? 0)
  assert.ok(Number.isFinite(elbow), "an out-of-reach target still solves")
  assert.ok(elbow >= -1e-9, "the elbow stays on its forward side")
})

test("a drag delta is relative to the clip, so it does not double-count the motion", () => {
  // Drag toward the same screen point at two moments of a clip that moves the
  // arm. Both drags carry the hand toward it, and the stored deltas differ --
  // each cancels that moment's own authored rotation. Storing the solved angle
  // directly would make the correction fight the animation.
  const target = { x: 700, y: 520 }
  const early = solveArmIKDrag(target, "L", contextAt("swordSwing", 0.2))
  const late = solveArmIKDrag(target, "L", contextAt("swordSwing", 0.6))
  for (const [phase, delta] of [[0.2, early], [0.6, late]] as const) {
    const before = transformPoint(
      worldMatrices(rig.bones, tracks.pose("swordSwing", phase)).handL,
      { x: 0, y: 0 },
    )
    const landed = handAt("swordSwing", phase, delta)
    assert.ok(
      Math.hypot(landed.x - target.x, landed.y - target.y) <
        Math.hypot(before.x - target.x, before.y - target.y),
      `at phase ${phase} the drag carried the hand toward the pointer`,
    )
  }
  assert.ok(
    Math.abs((early.upperArmL?.rotation ?? 0) - (late.upperArmL?.rotation ?? 0)) > 1e-6,
    "the deltas differ, cancelling each moment's own authored rotation",
  )
})

test("dragging a plain bone puts its origin under the pointer", () => {
  const context = contextAt("idle", 0)
  const bone = bonesByID.chest
  const target = { x: 640, y: 470 }
  const delta = solveBoneDrag(target, bone, parentInverse(bone, context.currentWorld), context.authored)
  const posed = withDragDelta(context.authored, delta)
  const landed = transformPoint(worldMatrices(rig.bones, posed).chest, { x: 0, y: 0 })
  assert.ok(Math.hypot(landed.x - target.x, landed.y - target.y) < 1e-6)
})

test("a layer drag moves the sprite by exactly the pointer travel, in bone space", () => {
  const context = contextAt("idle", 0)
  const layer = rig.layers.find((candidate) => candidate.id === "tunicBody")
  assert.ok(layer, "the torso layer exists")
  const grab = { x: 600, y: 700 }
  const anchor = beginLayerDrag(grab, layer, context.currentWorld)
  // Releasing without moving must not nudge the layer.
  const held = solveLayerDrag(grab, anchor)
  assert.equal(held.x, Number(layer.x.toFixed(2)))
  assert.equal(held.y, Number(layer.y.toFixed(2)))
  // Moving in world space moves the layer by the same amount in bone space.
  const moved = solveLayerDrag({ x: grab.x + 25, y: grab.y - 10 }, anchor)
  const expected = transformPoint(anchor.boneInverse, { x: grab.x + 25, y: grab.y - 10 })
  assert.ok(Math.abs(moved.x - (anchor.startX + expected.x - anchor.grab.x)) < 0.01)
  assert.ok(Math.abs(moved.y - (anchor.startY + expected.y - anchor.grab.y)) < 0.01)
})

test("a drag delta merges into the manual pose without discarding other fields", () => {
  const existing: Pose = { chest: { x: 4, y: 5, rotation: 9 }, head: { rotation: 2 } }
  const merged = withDragDelta(existing, { chest: { rotation: -3 } })
  assert.deepEqual(merged.chest, { x: 4, y: 5, rotation: -3 }, "only the dragged field changes")
  assert.deepEqual(merged.head, { rotation: 2 }, "other bones are untouched")
  assert.deepEqual(existing.chest, { x: 4, y: 5, rotation: 9 }, "the input is not mutated")
})
