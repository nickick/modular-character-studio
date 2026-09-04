/**
 * State for the Equipment Studio.
 *
 * The studio fits one piece of gear at a time over the rig, on one or both
 * bodies at once. Both bodies stay resolved so switching the view is a redraw
 * rather than a reload.
 */
import { create } from "zustand"
import { resolveProfile } from "@/rig/skeleton.ts"
import { RigTracks } from "@/rig/tracks.ts"
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commit as commitHistory,
  emptyHistory,
  redo as redoHistory,
  undo as undoHistory,
  type HistoryState,
} from "@/editor/history.ts"
import { loadScene, saveScene } from "@/editor/scene-client.ts"
import { EQUIPMENT_SLOTS, activeLayerID, type EquipmentSlot } from "@/editor/equipment-slots.ts"
import { profileIDs, type ProfileID, type ResolvedRig, type RigScene, type SceneOption } from "@/rig/types.ts"

/** Both bodies, or one of them on its own. */
export type StageView = "both" | ProfileID

export interface EquipmentSnapshot {
  scene: RigScene
  slotID: string
  item: string | null
  piece: string | null
}

export interface EquipmentEditorState {
  scene: RigScene | null
  savedScene: RigScene | null
  revision: string | null
  dirty: boolean
  status: string

  view: StageView
  slot: EquipmentSlot
  item: string | null
  piece: string | null
  /** The item last chosen to copy from; it outlives the list itself. */
  copySource: string | null
  /** Which digit the grip fields adjust, or every one of them together. */
  selectedGripFinger: "all" | string

  animation: string
  phase: number
  playing: boolean
  zoom: number
  showOthers: boolean

  history: HistoryState<EquipmentSnapshot>

  load: () => Promise<void>
  save: () => Promise<void>
  setStatus: (status: string) => void
  setView: (view: StageView) => void
  selectSlot: (slotID: string) => void
  selectItem: (item: string | null) => void
  selectPiece: (piece: string) => void
  setCopySource: (id: string | null) => void
  setSelectedGripFinger: (finger: "all" | string) => void
  setAnimation: (animation: string) => void
  setPhase: (phase: number) => void
  setPlaying: (playing: boolean) => void
  setZoom: (zoom: number) => void
  setShowOthers: (showOthers: boolean) => void
  editScene: (mutate: (scene: RigScene) => void) => void
  editSceneSilently: (mutate: (scene: RigScene) => void) => void
  snapshot: () => EquipmentSnapshot
  commit: (before: EquipmentSnapshot | null) => void
  undo: () => void
  redo: () => void
  revertItem: () => void
}

const clone = <T,>(value: T): T => structuredClone(value)
const same = (left: RigScene | null, right: RigScene | null): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const slotByID = (id: string): EquipmentSlot =>
  EQUIPMENT_SLOTS.find((slot) => slot.id === id) ?? EQUIPMENT_SLOTS[0]

export const useEquipmentEditor = create<EquipmentEditorState>()((set, get) => ({
  scene: null,
  savedScene: null,
  revision: null,
  dirty: false,
  status: "Loading project scene…",

  view: "both",
  slot: EQUIPMENT_SLOTS[0],
  item: null,
  piece: null,
  copySource: null,
  selectedGripFinger: "all",

  animation: "idle",
  phase: 0,
  playing: false,
  zoom: 1,
  showOthers: true,

  history: emptyHistory<EquipmentSnapshot>(),

  async load() {
    try {
      set({ status: "Loading project scene…" })
      const { scene, revision } = await loadScene()
      const slot = get().slot
      set({
        scene,
        savedScene: clone(scene),
        revision,
        dirty: false,
        item: scene[slot.active] ?? null,
        piece: slot.pieces?.[0]?.id ?? null,
        history: emptyHistory<EquipmentSnapshot>(),
        status: "Placement matches project scene",
      })
    } catch (error) {
      set({ status: error instanceof Error ? error.message : String(error) })
    }
  },

  async save() {
    const { scene, revision } = get()
    if (!scene || !revision) return
    try {
      set({ status: "Saving placement…" })
      const saved = await saveScene(clone(scene), revision)
      set({
        scene: saved.scene,
        savedScene: clone(saved.scene),
        revision: saved.revision,
        dirty: false,
        status: "Placement matches project scene",
      })
    } catch (error) {
      set({ status: error instanceof Error ? error.message : String(error) })
    }
  },

  setStatus: (status) => set({ status }),
  setView: (view) => set({ view }),

  selectSlot(slotID) {
    const slot = slotByID(slotID)
    const scene = get().scene
    set({
      slot,
      piece: slot.pieces?.[0]?.id ?? null,
      item: scene?.[slot.active] ?? null,
      copySource: null,
    })
  },

  selectItem(item) {
    const current = get()
    if (current.item === item) return

    const before = current.scene ? current.snapshot() : null
    if (current.scene) {
      const active = current.slot.active
      get().editSceneSilently((draft) => {
        if (item === null) {
          // The chest is the one required outfit in the public scene format.
          if (active !== "activeChest") delete draft[active]
        } else {
          draft[active] = item
        }
      })
    }
    set({ item })
    get().commit(before)
  },

  selectPiece: (piece) => set({ piece }),
  setCopySource: (copySource) => set({ copySource }),
  setSelectedGripFinger: (selectedGripFinger) => set({ selectedGripFinger }),
  setAnimation: (animation) => set({ animation }),
  setPhase: (phase) => set({ phase: Math.max(0, Math.min(1, phase)) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (zoom) => set({ zoom }),
  setShowOthers: (showOthers) => set({ showOthers }),

  editScene(mutate) {
    const before = get().snapshot()
    get().editSceneSilently(mutate)
    get().commit(before)
  },

  editSceneSilently(mutate) {
    const scene = get().scene
    if (!scene) return
    const next = clone(scene)
    mutate(next)
    set({ scene: next, dirty: !same(next, get().savedScene) })
  },

  snapshot() {
    const { scene, slot, item, piece } = get()
    if (!scene) throw new Error("Cannot snapshot before the scene has loaded")
    return { scene: clone(scene), slotID: slot.id, item, piece }
  },

  commit(before) {
    if (!before) return
    const current = get()
    if (!current.scene) return
    set({
      history: commitHistory(current.history, before, {
        scene: current.scene,
        slotID: current.slot.id,
        item: current.item,
        piece: current.piece,
      }),
    })
  },

  undo() {
    const current = get()
    if (!current.scene) return
    const step = undoHistory(current.history, current.snapshot())
    if (!step) return
    set({
      scene: clone(step.snapshot.scene),
      slot: slotByID(step.snapshot.slotID),
      item: step.snapshot.item,
      piece: step.snapshot.piece,
      history: step.history,
      dirty: !same(step.snapshot.scene, current.savedScene),
    })
  },

  redo() {
    const current = get()
    if (!current.scene) return
    const step = redoHistory(current.history, current.snapshot())
    if (!step) return
    set({
      scene: clone(step.snapshot.scene),
      slot: slotByID(step.snapshot.slotID),
      item: step.snapshot.item,
      piece: step.snapshot.piece,
      history: step.history,
      dirty: !same(step.snapshot.scene, current.savedScene),
    })
  },

  /** Put this item's placement back to what is on disk, and nothing else's. */
  revertItem() {
    const { scene, savedScene, slot, item } = get()
    if (!scene || !savedScene || !item) return
    get().editScene((draft) => {
      const catalogue = draft[slot.catalogue]
      const saved = savedScene[slot.catalogue]?.find((option) => option.id === item)
      const index = catalogue?.findIndex((option) => option.id === item) ?? -1
      if (catalogue && saved && index >= 0) catalogue[index] = clone(saved)
    })
  },
}))

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

/** The scene as this studio is currently wearing it. */
export function wornScene(scene: RigScene, slot: EquipmentSlot, item: string | null): RigScene {
  if (!item) return scene
  return { ...scene, [slot.active]: item }
}

/** The bodies on screen: both of them, or the one being looked at alone. */
export const shownProfiles = (view: StageView): readonly ProfileID[] =>
  view === "both" ? profileIDs : [view]

/**
 * The profile an edit lands on. In the combined view an edit is meant for both
 * bodies, so there is no single answer — writers use `shownProfiles` and this
 * only names whose numbers the fields show.
 */
export const primaryProfile = (view: StageView): ProfileID => (view === "both" ? "maleV1" : view)

/** Both bodies resolved against what the studio is previewing. */
export function resolveBothProfiles(
  scene: RigScene | null,
  slot: EquipmentSlot,
  item: string | null,
): Record<ProfileID, ResolvedRig> {
  const empty: ResolvedRig = { bones: [], layers: [] }
  if (!scene) return { maleV1: empty, femaleV1: empty }
  // Every slot id comes from the selection, never from the scene: passing the
  // scene's own value for a slot overrides what the studio is previewing, which
  // is why picking a boot or arm set used to leave the character unchanged.
  const worn = wornScene(scene, slot, item)
  const resolve = (profile: ProfileID): ResolvedRig =>
    resolveProfile(
      worn,
      profile,
      worn.activeChest,
      worn.activeArmSet,
      worn.activeHeadgear,
      worn.activeBootSet,
      worn.activeNecklace ?? null,
      {
        weapon: worn.activeWeapon,
        staff: worn.activeStaff,
        bow: worn.activeBow,
        shield: worn.activeShield,
        quiver: worn.activeQuiver,
      },
    )
  return { maleV1: resolve("maleV1"), femaleV1: resolve("femaleV1") }
}

export const sceneTracks = (scene: RigScene | null): RigTracks =>
  scene ? RigTracks.fromScene(scene) : new RigTracks()

export const catalogueFor = (scene: RigScene | null, slot: EquipmentSlot): SceneOption[] =>
  scene?.[slot.catalogue] ?? []

export const selectedOption = (
  scene: RigScene | null,
  slot: EquipmentSlot,
  item: string | null,
): SceneOption | null => catalogueFor(scene, slot).find((option) => option.id === item) ?? null

export const equipmentCanUndo = (state: EquipmentEditorState): boolean => historyCanUndo(state.history)
export const equipmentCanRedo = (state: EquipmentEditorState): boolean => historyCanRedo(state.history)

export { EQUIPMENT_SLOTS, activeLayerID }
