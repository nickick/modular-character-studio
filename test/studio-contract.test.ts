/**
 * The studios' rendered contract.
 *
 * The old suite asserted `id="..."` against the checked-in `index.html`, which
 * proved the file contained a string and nothing about what the studio does
 * with it. These render the real components and assert on their output, so a
 * control that is renamed, reordered, or dropped fails here — and a file that
 * is merely reformatted does not.
 *
 * The components are loaded through Vite's SSR loader rather than imported
 * directly, because Node strips types but does not transform JSX. That also
 * means aliases resolve exactly as they do in the browser, so this exercises
 * the real module graph.
 *
 * They are rendered into a Happy DOM rather than to a markup string, because
 * `renderToStaticMarkup` asks `useSyncExternalStore` for its *server* snapshot
 * and zustand answers that with the store's initial state — a studio would
 * always render its empty loading shell. A client render reads the live store,
 * which is what an author actually sees.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { createElement, act, type ComponentType, type ReactElement } from "react"
import { Window } from "happy-dom"
// Imported directly rather than through Vite: it is CommonJS, and Vite
// externalizes React for SSR anyway, so this is the same React the components
// loaded below are using.
import { createRoot } from "react-dom/client"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { createServer, type ViteDevServer } from "vite"

// React needs the DOM globals in place before `react-dom/client` is loaded.
const window = new Window({ url: "http://localhost/" })
// Radix reaches for a good deal of the DOM (getComputedStyle, HTMLFormElement,
// ResizeObserver, and so on), so the whole window is installed rather than a
// hand-picked few globals that need extending every time a primitive is added.
const skip = new Set(["undefined", "globalThis", "eval", "constructor"])
for (const name of Object.getOwnPropertyNames(window)) {
  if (skip.has(name) || name in globalThis) continue
  const descriptor = Object.getOwnPropertyDescriptor(window, name)
  if (descriptor) Object.defineProperty(globalThis, name, descriptor)
}
// Node defines `Event` and friends itself, so the loop above leaves them alone
// -- and then Happy DOM's `dispatchEvent` rejects them as foreign, which is
// what a Radix dialog trips over the moment it opens. The DOM's own event
// classes have to win here.
for (const name of ["Event", "CustomEvent", "EventTarget", "UIEvent", "MouseEvent",
  "PointerEvent", "KeyboardEvent", "FocusEvent", "InputEvent"]) {
  const descriptor = Object.getOwnPropertyDescriptor(window, name)
  if (descriptor) Object.defineProperty(globalThis, name, descriptor)
}
for (const [name, value] of [
  ["window", window],
  ["document", window.document],
  // Nothing here inspects pixels or lays out; the calls only have to succeed.
  ["requestAnimationFrame", () => 0],
  ["cancelAnimationFrame", () => undefined],
  ["fetch", () => Promise.reject(new Error("no network in these tests"))],
] as const) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, writable: true })

const toolRoot = fileURLToPath(new URL("..", import.meta.url))
// A plain server rather than the project config: TanStack Start and Nitro
// reconfigure the SSR environment for their own runtime, and all these tests
// need is the React transform and the `@` alias.
const vite: ViteDevServer = await createServer({
  configFile: false,
  root: toolRoot,
  resolve: { alias: { "@": resolve(toolRoot, "src") } },
  plugins: [react()],
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
})
test.after(async () => {
  await vite.close()
  await window.happyDOM.close()
})

const load = async (path: string): Promise<Record<string, unknown>> =>
  (await vite.ssrLoadModule(path)) as Record<string, unknown>

const rigModule = await load("/src/components/rig-studio/RigStudio.tsx")
const timelineModule = await load("/src/components/rig-studio/Timeline.tsx")
const equipmentModule = await load("/src/components/equipment-studio/EquipmentStudio.tsx")
const numericModule = await load("/src/components/NumericField.tsx")
const navModule = await load("/src/components/StudioNav.tsx")
const itemMatrixModule = await load("/src/components/shared/ItemMatrixDialog.tsx")
const rigStoreModule = await load("/src/stores/rig-editor.ts")
const equipmentStoreModule = await load("/src/stores/equipment-editor.ts")
const schemaModule = await load("/src/rig/schema.ts")
const clipsModule = await load("/src/rig/clips.ts")

const RigStudio = rigModule.RigStudio as ComponentType
const Timeline = timelineModule.Timeline as ComponentType<Record<string, unknown>>
const EquipmentStudio = equipmentModule.EquipmentStudio as ComponentType
const NumericField = numericModule.NumericField as ComponentType<Record<string, unknown>>
const ItemMatrixDialog = itemMatrixModule.ItemMatrixDialog as ComponentType<Record<string, unknown>>
const pickerModule = await load("/src/components/rig-studio/AnimationPicker.tsx")
const AnimationPicker = pickerModule.AnimationPicker as ComponentType<Record<string, unknown>>
/** The picker only needs a resolver that answers; nothing here inspects pixels. */
const noImages = () => null
const STUDIOS = navModule.STUDIOS as ReadonlyArray<{ to: string }>
/** The store API these tests seed. */
interface SeedableStore {
  setState: (patch: object) => void
}

interface EquipmentStore extends SeedableStore {
  getState: () => {
    scene: RigSceneLike | null
    dirty: boolean
    item: string | null
    selectItem: (item: string | null) => void
    selectSlot: (slotID: string) => void
  }
}

const useRigEditor = rigStoreModule.useRigEditor as SeedableStore
const useEquipmentEditor = equipmentStoreModule.useEquipmentEditor as EquipmentStore
const EQUIPMENT_SLOTS = equipmentStoreModule.EQUIPMENT_SLOTS as ReadonlyArray<object>

const seed = (store: SeedableStore, patch: object): void => store.setState(patch)

/** Render a component into a detached DOM and hand the tree to an inspector. */
function inspect<T>(element: ReactElement, read: (container: HTMLElement) => T): T {
  const container = window.document.createElement("div")
  window.document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  const result = read(container as unknown as HTMLElement)
  act(() => root.unmount())
  container.remove()
  return result
}

/** The markup a component produced, for assertions about structure and order. */
const render = (element: ReactElement): string =>
  inspect(element, (container) => container.innerHTML)

/**
 * The same, but reading the whole document. Radix portals overlays and dialogs
 * to `document.body`, so they are never inside the container they were rendered
 * from.
 */
const renderPortalled = (element: ReactElement): string =>
  inspect(element, () => window.document.body.innerHTML)
const validateThreeQuarterRigScene = schemaModule.validateThreeQuarterRigScene as (value: unknown) => RigSceneLike
const animationNames = clipsModule.animationNames as readonly string[]

/** Only the fields these assertions read; the real type lives in the core. */
interface RigSceneLike {
  activeChest: string
  activeArmSet: string
  activeBootSet: string
  activeHeadgear: string
  activeNecklace?: string
  activeWeapon?: string
  activeShield?: string
  weaponOptions?: Array<{ id: string; label: string; itemID?: string }>
}

const scenePath = fileURLToPath(
  new URL("../project/scene.json", import.meta.url),
)
const source = JSON.parse(await readFile(scenePath, "utf8"))
const scene = validateThreeQuarterRigScene(structuredClone(source))

/** Render a studio with a scene already loaded, as an author always sees it. */
function renderRigStudio(): string {
  seed(useRigEditor, {
    scene,
    savedScene: scene,
    revision: '"test"',
    status: "ready",
    presentation: {
      profile: "maleV1",
      chest: scene.activeChest,
      armSet: scene.activeArmSet,
      bootSet: scene.activeBootSet,
      headgear: scene.activeHeadgear,
      necklace: scene.activeNecklace ?? null,
      mainHand: "weapon",
      held: { weapon: scene.activeWeapon ?? null, shield: scene.activeShield ?? null },
    },
  })
  return render(createElement(RigStudio))
}

function renderEquipmentStudio(): string {
  seed(useEquipmentEditor, {
    scene,
    savedScene: scene,
    revision: '"test"',
    status: "ready",
    item: scene.activeWeapon ?? null,
  })
  return render(createElement(EquipmentStudio))
}

const rigMarkup = renderRigStudio()
const equipmentMarkup = renderEquipmentStudio()

const hasID = (markup: string, id: string): boolean => markup.includes(`id="${id}"`)

test("the rig studio renders its rig, transport, and authoring controls", () => {
  for (const id of [
    "status",
    "layerSearch",
    "layerGroups",
    "layerCount",
    "modeLayer",
    "modeBone",
    "rigCanvas",
    "zoom",
    "equipMenuButton",
    "equipMenu",
    "equipment-weapon",
    "equipment-staff",
    "animationPickerButton",
    "playPause",
    "timelineTrackSelect",
    "timeline",
    "timeReadout",
    "selectedTrackKeyMarkers",
    "expressionEyes",
    "expressionMouth",
    "setExpressionKey",
    "deleteExpressionKey",
    "previousExpressionKey",
    "nextExpressionKey",
    "setWristKey",
    "deleteWristKey",
    // The active track is stepped from the transport, beside the playhead.
    "previousTrackKey",
    "nextTrackKey",
    "deleteTrackKey",
    // Bone keys are stepped from the bone inspector, which owns them.
    "setBoneKey",
    "deleteBoneKey",
    "previousBoneKey",
    "nextBoneKey",
    "profileTitle",
    // The two canvas sub-editors.
    "jointMeshLab",
    "meshJointSelect",
    "showJointMeshesOnStage",
    "jointMeshEditor",
    "meshLayerName",
    "resetJointMesh",
    "fingerPathEditor",
    "fingerPenTool",
    "fingerEditTool",
    "newFingerPath",
    "closeFingerPath",
    "deleteFingerNode",
    "undoFingerPoint",
    "resetFingerPath",
    "fingerPathStatus",
    // Document actions.
    "resetPose",
    "undoEdit",
    "redoEdit",
    "saveScene",
    "reloadScene",
    "exportPng",
  ]) {
    assert.ok(hasID(rigMarkup, id), `the rig studio renders #${id}`)
  }
})

test("reset pose shares the pose and edit-history island", () => {
  const start = rigMarkup.indexOf('aria-label="Pose and edit history"')
  const end = rigMarkup.indexOf("</div>", start)
  assert.ok(start >= 0)
  assert.ok(end > start)

  const island = rigMarkup.slice(start, end)
  const reset = island.indexOf('id="resetPose"')
  const undo = island.indexOf('id="undoEdit"')
  const redo = island.indexOf('id="redoEdit"')
  assert.ok(reset >= 0)
  assert.ok(reset < undo)
  assert.ok(undo < redo)
})

test("the Hands label sits immediately left of its dropdown", () => {
  const start = rigMarkup.indexOf('class="hand-pose-control"')
  const end = rigMarkup.indexOf("</div>", start)
  assert.ok(start >= 0)
  assert.ok(end > start)

  const control = rigMarkup.slice(start, end)
  const label = control.indexOf('for="handPoseSelect"')
  const dropdown = control.indexOf('id="handPoseSelect"')
  assert.ok(label >= 0)
  assert.ok(label < dropdown)
})

test("whole-animation bone editing is a toggle beside Hands in the top bar", () => {
  const hands = rigMarkup.indexOf('class="hand-pose-control"')
  const toggle = rigMarkup.indexOf('id="wholeAnimationBoneEdits"')
  const spacer = rigMarkup.indexOf('class="toolbar-spacer"', hands)
  assert.ok(hands >= 0)
  assert.ok(toggle > hands)
  assert.ok(toggle < spacer, "the toggle stays with Hands rather than drifting into document actions")
  assert.ok(rigMarkup.includes("Whole animation"))
})

test("whole-animation mode explains that it preserves timeline keys", () => {
  seed(useRigEditor, { wholeAnimationEdits: true, clipScopedEdits: true })
  const markup = render(createElement(RigStudio))
  assert.ok(markup.includes('id="wholeAnimationBoneEditHint"'))
  assert.ok(markup.includes("Adds the same offset on every frame. Timeline keys stay unchanged."))
  seed(useRigEditor, { wholeAnimationEdits: false })
})

test("joint deformation is the first editor in the inspector and exposes its stage overlay", () => {
  const deformation = rigMarkup.indexOf('id="jointMeshLab"')
  const expressions = rigMarkup.indexOf('id="expressionEyes"')
  const wrists = rigMarkup.indexOf('id="setWristKey"')
  assert.ok(deformation >= 0)
  assert.ok(deformation < expressions)
  assert.ok(deformation < wrists)
  assert.match(rigMarkup, /id="showJointMeshesOnStage"[^>]*aria-pressed="false"/)
  for (const label of ["Parent handle X", "Parent handle Y", "Child handle X", "Child handle Y"]) {
    assert.ok(rigMarkup.includes(label), `${label} is directly editable`)
  }
})

test("the cutout pen opens on the pen tool, with editing actions off until they apply", () => {
  const penButton = rigMarkup.slice(rigMarkup.indexOf('id="fingerPenTool"'))
  assert.match(penButton.slice(0, 120), /aria-pressed="true"/, "the pen is the opening tool")
  const editButton = rigMarkup.slice(rigMarkup.indexOf('id="fingerEditTool"'))
  assert.match(editButton.slice(0, 120), /aria-pressed="false"/)
  // Nothing is selected on load, so deleting a node cannot apply yet.
  const deleteButton = rigMarkup.slice(rigMarkup.indexOf('id="deleteFingerNode"'))
  assert.match(deleteButton.slice(0, 140), /disabled/)
  // The live scene already carries a closed cutout, so closing it again cannot.
  const closeButton = rigMarkup.slice(rigMarkup.indexOf('id="closeFingerPath"'))
  assert.match(closeButton.slice(0, 140), /disabled/)
  assert.match(rigMarkup, /id="fingerPathStatus"[^>]*>[^<]*closed cutout/)
})

test("the rig studio's transport reads left to right", () => {
  const order = ["animationPickerButton", "playPause", "timelineTrackSelect", "timeReadout", "timeline"]
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(
      rigMarkup.indexOf(`id="${order[index - 1]}"`) < rigMarkup.indexOf(`id="${order[index]}"`),
      `${order[index]} follows ${order[index - 1]} in the transport bar`,
    )
  }
})

test("timeline groups editing actions separately from animation and track controls", () => {
  const layout = inspect(
    createElement(Timeline, { onOpenAnimationPicker: () => undefined }),
    (container) => {
      const primary = container.querySelector(".timeline-authoring-primary")
      const secondary = container.querySelector(".timeline-authoring-secondary")
      assert.ok(primary)
      assert.ok(secondary)
      return {
        primaryIDs: [...primary.querySelectorAll("[id]")].map((element) => element.id),
        secondaryIDs: [...secondary.querySelectorAll("[id]")].map((element) => element.id),
        deleteText: secondary.querySelector("#deleteTrackKey")?.textContent?.trim(),
        deleteIcon: secondary.querySelector("#deleteTrackKey svg"),
      }
    },
  )

  assert.ok(layout.primaryIDs.includes("timelineTrackSelect"))
  assert.deepEqual(
    layout.secondaryIDs.filter((id) => ["previousTrackKey", "nextTrackKey", "deleteTrackKey", "speedSelect"].includes(id)),
    ["previousTrackKey", "nextTrackKey", "deleteTrackKey", "speedSelect"],
  )
  assert.equal(layout.deleteText, "")
  assert.ok(layout.deleteIcon)
})

test("the timeline selector switches bones, hands, and facial-expression tracks", () => {
  const store = useRigEditor as unknown as {
    getState: () => {
      timelineTrack: string
      selectedBone: string | null
      wrist: { side: string }
      setTimelineTrack: (track: string) => void
    }
  }

  store.getState().setTimelineTrack("hand:R")
  assert.equal(store.getState().wrist.side, "R")
  let markup = render(createElement(Timeline, { onOpenAnimationPicker: () => undefined }))
  assert.match(markup, /Hands · Screen-right/)
  assert.match(markup, /data-track-kind="wrist"/)

  store.getState().setTimelineTrack("expression")
  markup = render(createElement(Timeline, { onOpenAnimationPicker: () => undefined }))
  assert.match(markup, /Face · Expressions/)
  assert.match(markup, /data-track-kind="expression"/)

  const bone = scene.bones?.find((candidate: { id: string }) => candidate.id !== "chest")
  assert.ok(bone)
  store.getState().setTimelineTrack(`bone:${bone.id}`)
  assert.equal(store.getState().selectedBone, bone.id)
  markup = render(createElement(Timeline, { onOpenAnimationPicker: () => undefined }))
  assert.match(markup, /data-track-kind="bone"/)

  store.getState().setTimelineTrack("bone:chest")
})

test("the timeline track menu offers both hands, expressions, and every bone", () => {
  const labels = inspect(
    createElement(Timeline, { onOpenAnimationPicker: () => undefined }),
    (container) => {
      const trigger = container.querySelector("#timelineTrackSelect") as HTMLButtonElement | null
      assert.ok(trigger)
      act(() => trigger.click())
      return [...window.document.querySelectorAll('[data-slot="select-item"]')]
        .map((item) => item.textContent?.trim())
    },
  )
  assert.ok(labels.includes("Hands · Screen-left"))
  assert.ok(labels.includes("Hands · Screen-right"))
  assert.ok(labels.includes("Face · Expressions"))
  for (const bone of scene.bones ?? []) assert.ok(labels.includes(`Bone · ${bone.label}`))
})

test("the timeline delete control removes the playhead key from the selected track", () => {
  const store = useRigEditor as unknown as {
    getState: () => { scene: typeof source; wrist: { side: string } }
  }
  const clickDelete = () => inspect(
    createElement(Timeline, { onOpenAnimationPicker: () => undefined }),
    (container) => {
      const button = container.querySelector("#deleteTrackKey") as HTMLButtonElement | null
      assert.ok(button)
      assert.equal(button.disabled, false)
      act(() => button.click())
    },
  )
  const at = 0.321
  const editable = structuredClone(source)

  editable.boneKeyframes.idle = { ...(editable.boneKeyframes.idle ?? {}), chest: [{ phase: at, x: 4 }] }
  seed(useRigEditor, { scene: editable, animation: "idle", phase: at, timelineTrack: "bone:chest" })
  clickDelete()
  assert.equal(store.getState().scene.boneKeyframes.idle?.chest, undefined)

  editable.expressionKeyframes.idle = [{ phase: at, eyes: "wide", mouth: "smile" }]
  seed(useRigEditor, { scene: editable, phase: at, timelineTrack: "expression" })
  clickDelete()
  assert.equal(store.getState().scene.expressionKeyframes.idle, undefined)

  editable.wristKeyframes.idle = { L: [{ phase: at, angle: 8 }] }
  editable.wristKeyframes.__grip_weapon = { L: [{ phase: at, gripRotation: 5 }] }
  seed(useRigEditor, {
    scene: editable,
    phase: at,
    timelineTrack: "hand:L",
    wrist: { ...store.getState().wrist, side: "L" },
  })
  clickDelete()
  assert.equal(store.getState().scene.wristKeyframes.idle, undefined)
  assert.equal(store.getState().scene.wristKeyframes.__grip_weapon, undefined)

  seed(useRigEditor, {
    scene,
    savedScene: scene,
    animation: "idle",
    phase: 0,
    timelineTrack: "bone:chest",
  })
})

test("every equipment slot is a thumbnail entry inside the Equip menu", () => {
  const menu = inspect(createElement(RigStudio), (container) =>
    container.querySelector("#equipMenu"),
  )
  assert.ok(menu, "the Equip menu is rendered")
  assert.ok(rigMarkup.indexOf('id="equipMenuButton"') < rigMarkup.indexOf('id="equipMenu"'))
  for (const id of ["tunicBody", "arms", "boots", "headgear", "necklace", "weapon", "staff", "bow", "shield", "quiver"]) {
    const entry = menu.querySelector(`#equipment-${id}`)
    assert.ok(entry, `${id} lives inside the Equip menu`)
    assert.ok(entry.querySelector(".inventory-thumbnail"), `${id} carries a thumbnail preview`)
  }
})

test("weapon and staff thumbnail entries preserve one active main hand", () => {
  const picks = inspect(createElement(RigStudio), (container) => ({
    weapon: container.querySelector("#equipment-weapon"),
    staff: container.querySelector("#equipment-staff"),
  }))
  assert.equal(picks.weapon?.getAttribute("aria-pressed"), "true")
  assert.equal(picks.staff?.getAttribute("aria-pressed"), "false")
  const worn = scene.weaponOptions?.find((option) => option.id === scene.activeWeapon)
  assert.ok(worn && picks.weapon?.textContent?.includes(worn.label), "it shows the weapon actually equipped")
})

test("an equipment thumbnail entry opens its item matrix", () => {
  const markup = inspect(createElement(RigStudio), (container) => {
    const button = container.querySelector("#equipment-bow") as HTMLButtonElement | null
    assert.ok(button)
    act(() => button.click())
    return window.document.body.innerHTML
  })
  assert.match(markup, /id="itemModal"/)
  assert.match(markup, /id="itemGrid"/)
  assert.match(markup, /Choose bow/)
})

test("the item matrix renders inventory art for its choices", () => {
  const option = scene.weaponOptions?.find((candidate) => candidate.itemID)
  assert.ok(option?.itemID, "the checked-in scene has a catalogued weapon option")
  const item = {
    id: option.itemID,
    name: "Inventory Preview Weapon",
    slot: "mainHand",
    category: "blade",
    rarity: "common",
    inventoryArt: true,
    inventoryAssetName: "InventoryPreviewWeaponItem",
    inventoryAssetFile: "inventory-preview.png",
  }
  const markup = renderPortalled(createElement(ItemMatrixDialog, {
    catalog: { items: new Map([[item.id, item]]), applicability: new Map() },
    scene,
    slot: { id: "weapon", label: "Weapon", catalogue: "weaponOptions", active: "activeWeapon", worn: false },
    selected: option.id,
    open: true,
    onClose: () => undefined,
    onPick: () => undefined,
  }))

  assert.match(markup, /<img[^>]+src="\/assets\/inventory-preview\.png"/)
  assert.match(markup, /Inventory Preview Weapon/)
})

test("the motion picker is a labelled modal offering every authored clip", () => {
  // Radix portals the panel, so it exists only while the picker is open.
  const open = renderPortalled(
    createElement(AnimationPicker, { open: true, onClose: () => undefined, images: noImages }),
  )
  assert.match(open, /role="dialog"/)
  assert.match(open, /aria-labelledby="[^"]+"/)
  for (const name of animationNames) {
    assert.ok(open.includes(`data-animation="${name}"`), `${name} is offered in the picker`)
  }
  // One preview canvas per clip, and a close control that is an icon.
  assert.equal((open.match(/<canvas/g) ?? []).length, animationNames.length)
  assert.match(open, /Close<\/span>|sr-only/, "the close control names itself for a screen reader")
  const closed = renderPortalled(
    createElement(AnimationPicker, { open: false, onClose: () => undefined, images: noImages }),
  )
  assert.doesNotMatch(closed, /data-animation=/, "a closed picker renders nothing")
})

test("playback is an icon button that says what pressing it will do", () => {
  // The button carries a transport glyph rather than a word, so its label has
  // to be spoken for.
  for (const markup of [rigMarkup, equipmentMarkup]) {
    const button = markup.slice(markup.indexOf('id="playPause"'))
    assert.ok(
      /aria-label="(Play|Pause)"/.test(button.slice(0, 200)) || />(Play|Pause)</.test(button.slice(0, 200)),
      "the play control names its action",
    )
  }
})

test("the equipment studio renders its slots, item picker, and placement fields", () => {
  for (const id of ["status", "viewTabs", "itemPicker", "itemPickerName", "itemCount", "placementBox", "editScope", "itemTitle", "zoom", "showOthers", "playPause", "animationTimeline", "animationTimeReadout"]) {
    assert.ok(hasID(equipmentMarkup, id), `the equipment studio renders #${id}`)
  }
  for (const label of ["Weapon", "Staff &amp; Spear", "Bow", "Shield", "Necklace", "Quiver", "Body", "Head", "Ring", "Boots", "Vambraces"]) {
    assert.ok(equipmentMarkup.includes(`>${label}<`), `the ${label} slot is offered`)
  }
})

test("an equipment pick survives switching to another slot and back", () => {
  const working = structuredClone(scene)
  seed(useEquipmentEditor, {
    scene: working,
    savedScene: structuredClone(scene),
    slot: EQUIPMENT_SLOTS[0],
    item: working.activeWeapon ?? null,
    dirty: false,
  })

  useEquipmentEditor.getState().selectItem("raiderBeardedAxe")
  assert.equal(useEquipmentEditor.getState().scene?.activeWeapon, "raiderBeardedAxe")
  assert.equal(useEquipmentEditor.getState().dirty, true)

  useEquipmentEditor.getState().selectSlot("necklace")
  useEquipmentEditor.getState().selectSlot("weapon")
  assert.equal(useEquipmentEditor.getState().item, "raiderBeardedAxe")

  seed(useEquipmentEditor, {
    scene,
    savedScene: scene,
    slot: EQUIPMENT_SLOTS[0],
    item: scene.activeWeapon ?? null,
    dirty: false,
  })
})

test("the equipment studio says whose placement a field is about to change", () => {
  // A field change in the combined view moves a piece on a body the reader
  // cannot see, which is worth saying out loud.
  assert.match(equipmentMarkup, /id="editScope"[^>]*>Placement applies to both bodies</)
  seed(useEquipmentEditor, { view: "femaleV1" })
  const single = render(createElement(EquipmentStudio))
  assert.match(single, /id="editScope"[^>]*>Placement applies to Female V1 only</)
  seed(useEquipmentEditor, { view: "both" })
})

test("both bodies are drawn side by side in the combined view, and one alone otherwise", () => {
  assert.equal((equipmentMarkup.match(/data-profile="/g) ?? []).length, 2)
  assert.ok(equipmentMarkup.includes('data-profile="maleV1"'))
  assert.ok(equipmentMarkup.includes('data-profile="femaleV1"'))
  seed(useEquipmentEditor, { view: "maleV1" })
  const single = render(createElement(EquipmentStudio))
  assert.equal((single.match(/data-profile="/g) ?? []).length, 1)
  seed(useEquipmentEditor, { view: "both" })
})

test("every authored numeric value has both a slider and an exact-value box", () => {
  const fields = inspect(
    createElement(NumericField, { label: "Grip rotation", value: 4, onChange: () => undefined }),
    (container) => ({
      slider: container.querySelector('[role="slider"]'),
      box: container.querySelector<HTMLInputElement>('input[type="number"]'),
    }),
  )
  assert.ok(fields.slider, "the slider half is present")
  assert.equal(fields.box?.getAttribute("aria-label"), "Grip rotation exact value")
  // Both halves show the same underlying value, which is what makes changing
  // either of them one edit rather than two.
  assert.equal(fields.slider?.getAttribute("aria-valuenow"), "4")
  assert.equal(fields.box?.value, "4")
})

test("a numeric field keeps a value that has been typed past its nominal range", () => {
  // Pinning the thumb to one end would make an out-of-range value undraggable.
  const fields = inspect(
    createElement(NumericField, {
      label: "Angle", value: 140, min: -85, max: 85, onChange: () => undefined,
    }),
    (container) => ({
      slider: container.querySelector('[role="slider"]'),
      box: container.querySelector<HTMLInputElement>('input[type="number"]'),
    }),
  )
  assert.equal(fields.slider?.getAttribute("aria-valuemax"), "140", "the slider stretches to reach it")
  assert.equal(fields.slider?.getAttribute("aria-valuenow"), "140")
  assert.equal(fields.box?.max, "85", "the box still states the authored range")
})

test("both studios carry the studio menu, and it lists every studio", () => {
  for (const markup of [rigMarkup, equipmentMarkup]) {
    assert.match(markup, /class="editor-nav"/)
  }
  assert.deepEqual(
    STUDIOS.map((studio) => studio.to),
    ["/rig", "/equipment"],
  )
})

test("the retired frontal-doll studios are offered nowhere", () => {
  for (const markup of [rigMarkup, equipmentMarkup]) {
    assert.doesNotMatch(markup, /hunter-doll|doll-rig|frontal/i)
  }
})
