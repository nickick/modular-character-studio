/**
 * State for the Rig Studio.
 *
 * The studio used to be one 2,900-line closure over a mutable `state` object,
 * where every function could reach every field and the render loop re-synced
 * the whole DOM each frame. The document, the presentation, the authoring
 * selection, and the transport are separate concerns here, and everything
 * derivable -- the resolved rig, the sampled tracks, the current pose -- is
 * derived rather than stored, so it cannot fall out of step with the scene.
 */
import { create } from "zustand"
import { RigTracks } from "@/rig/tracks.ts"
import { resolveProfile } from "@/rig/skeleton.ts"
import { animationHandPose, type AnimationName } from "@/rig/clips.ts"
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
import { commitPoseToBoneKeys } from "@/editor/keyframes.ts"
import type {
  HeldSelection,
  Pose,
  ProfileID,
  ResolvedRig,
  RigScene,
  Side,
} from "@/rig/types.ts"

/** The four finger copies that make up the closed left grip. */
export const GRIP_FINGER_LAYER_IDS = [
  "handClosedLIndex",
  "handClosedLMiddle",
  "handClosedLRing",
  "handClosedLPinky",
] as const

/** The one helmet slot every headgear design resolves through. */
export const HEADGEAR_LAYER_ID = "headgear"

/** A held slot: the layer it dresses, its catalogue, and its scene key. */
export interface HeldSlot {
  layer: keyof HeldSelection
  catalogue: "weaponOptions" | "staffOptions" | "bowOptions" | "shieldOptions" | "quiverOptions"
  active: "activeWeapon" | "activeStaff" | "activeBow" | "activeShield" | "activeQuiver"
}

export const HELD_SLOTS: readonly HeldSlot[] = [
  { layer: "weapon", catalogue: "weaponOptions", active: "activeWeapon" },
  { layer: "staff", catalogue: "staffOptions", active: "activeStaff" },
  { layer: "bow", catalogue: "bowOptions", active: "activeBow" },
  { layer: "shield", catalogue: "shieldOptions", active: "activeShield" },
  { layer: "quiver", catalogue: "quiverOptions", active: "activeQuiver" },
]

export type EditorMode = "layer" | "bone"

/** Per-finger placement in the held item's shaft space. */
export type FingerOffsets = Record<string, { along: number; across: number }>

/**
 * The unsaved hand-control values a wrist drag is previewing. They are an
 * authoring aid, never a replacement for the saved curve during playback: a
 * stale `wristAngle` URL parameter must not make a refreshed page appear to
 * play an older animation.
 */
export interface WristPreview {
  active: boolean
  side: Side
  angle: number
  gripRotation: number
  knuckleAxis: number
  fingerAngles: Record<string, number>
  fingerOffsets: FingerOffsets
}

const zeroFingerAngles = (): Record<string, number> =>
  Object.fromEntries(GRIP_FINGER_LAYER_IDS.map((id) => [id, 0]))

const zeroFingerOffsets = (): FingerOffsets =>
  Object.fromEntries(GRIP_FINGER_LAYER_IDS.map((id) => [id, { along: 0, across: 0 }]))

/** What the outfit and equipment menus are currently wearing. */
export interface Presentation {
  profile: ProfileID
  chest: string
  armSet: string
  bootSet: string
  headgear: string
  necklace: string | null
  /**
   * Weapons and staffs share one hand. Both catalogues keep their last
   * selection, but only one of the two layers is exposed and drawn.
   */
  mainHand: "weapon" | "staff"
  held: HeldSelection
}

/** Everything an undo step restores. */
export interface RigSnapshot {
  scene: RigScene
  manualPose: Pose
  clipScopedEdits: boolean
  wrist: WristPreview
}

export interface RigEditorState {
  // ---- document -----------------------------------------------------------
  scene: RigScene | null
  savedScene: RigScene | null
  revision: string | null
  dirty: boolean
  status: string

  // ---- presentation -------------------------------------------------------
  presentation: Presentation

  // ---- authoring ----------------------------------------------------------
  mode: EditorMode
  selectedBone: string | null
  selectedLayer: string | null
  /**
   * Bone moves land on the clip being looked at rather than on the skeleton
   * every clip shares. On by default: a correction is nearly always a
   * correction to one animation.
   */
  clipScopedEdits: boolean
  manualPose: Pose
  wrist: WristPreview
  selectedGripFinger: "all" | string

  // ---- transport ----------------------------------------------------------
  animation: AnimationName
  handPose: string
  phase: number
  playing: boolean
  speed: number

  // ---- history ------------------------------------------------------------
  history: HistoryState<RigSnapshot>

  // ---- actions ------------------------------------------------------------
  load: () => Promise<void>
  save: () => Promise<void>
  setStatus: (status: string) => void
  setPresentation: (patch: Partial<Presentation>) => void
  setMode: (mode: EditorMode) => void
  selectBone: (id: string | null) => void
  selectLayer: (id: string | null) => void
  setClipScopedEdits: (value: boolean) => void
  setManualPose: (pose: Pose) => void
  setAnimation: (name: AnimationName) => void
  setHandPose: (pose: string) => void
  setPhase: (phase: number) => void
  setPlaying: (playing: boolean) => void
  setSpeed: (speed: number) => void
  setWrist: (patch: Partial<WristPreview>) => void
  setSelectedGripFinger: (finger: "all" | string) => void
  /** Replace the scene, recording one undo step for the edit that produced it. */
  editScene: (mutate: (scene: RigScene) => void) => void
  /**
   * Replace the scene without recording a step. Used mid-drag, where the
   * snapshot was taken on pointer-down and the step is recorded on release —
   * one transaction per drag rather than one per animation frame.
   */
  editSceneSilently: (mutate: (scene: RigScene) => void) => void
  /** Fold a drag's manual pose into the clip's bone keys, if clip-scoped. */
  commitManualPoseToBoneKeys: () => void
  snapshot: () => RigSnapshot
  commit: (before: RigSnapshot | null) => void
  undo: () => void
  redo: () => void
}

const clone = <T,>(value: T): T => structuredClone(value)

const defaultPresentation = (): Presentation => ({
  profile: "femaleV1",
  chest: "scout_leathers",
  armSet: "leather_bracers",
  bootSet: "leather_boots",
  headgear: "cutthroat_hood",
  necklace: null,
  mainHand: "weapon",
  held: {},
})

const defaultWrist = (): WristPreview => ({
  active: false,
  side: "L",
  angle: 0,
  gripRotation: 0,
  knuckleAxis: 0,
  fingerAngles: zeroFingerAngles(),
  fingerOffsets: zeroFingerOffsets(),
})

/** Which presentation a freshly loaded scene implies. */
function presentationFromScene(scene: RigScene, previous: Presentation): Presentation {
  const held: HeldSelection = {}
  for (const slot of HELD_SLOTS) held[slot.layer] = scene[slot.active] ?? null
  return {
    ...previous,
    profile: scene.activeProfile,
    chest: scene.activeChest,
    armSet: scene.activeArmSet,
    bootSet: scene.activeBootSet,
    headgear: scene.activeHeadgear,
    necklace: scene.activeNecklace ?? null,
    held,
  }
}

/** Fold the studio's current selections back onto the scene before saving. */
function applyPresentation(scene: RigScene, presentation: Presentation): void {
  scene.activeProfile = presentation.profile
  scene.activeChest = presentation.chest
  scene.activeArmSet = presentation.armSet
  scene.activeBootSet = presentation.bootSet
  scene.activeHeadgear = presentation.headgear
  if (scene.necklaceOptions && presentation.necklace) {
    scene.activeNecklace = presentation.necklace
  }
  for (const slot of HELD_SLOTS) {
    const worn = presentation.held[slot.layer]
    if (scene[slot.catalogue] && worn) scene[slot.active] = worn
  }
}

const sameScene = (left: RigScene | null, right: RigScene | null): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export const useRigEditor = create<RigEditorState>()((set, get) => ({
  scene: null,
  savedScene: null,
  revision: null,
  dirty: false,
  status: "Loading project scene…",

  presentation: defaultPresentation(),

  mode: "bone",
  selectedBone: "chest",
  selectedLayer: null,
  clipScopedEdits: true,
  manualPose: {},
  wrist: defaultWrist(),
  selectedGripFinger: "all",

  animation: "idle",
  handPose: animationHandPose.idle,
  phase: 0,
  playing: true,
  speed: 1,

  history: emptyHistory<RigSnapshot>(),

  async load() {
    try {
      set({ status: "Loading project scene…" })
      const { scene, revision } = await loadScene()
      set((current) => ({
        scene,
        savedScene: clone(scene),
        revision,
        dirty: false,
        manualPose: {},
        wrist: defaultWrist(),
        history: emptyHistory<RigSnapshot>(),
        presentation: presentationFromScene(scene, current.presentation),
        status: "Layout matches project scene",
      }))
    } catch (error) {
      set({ status: error instanceof Error ? error.message : String(error) })
    }
  },

  async save() {
    const { scene, revision, presentation } = get()
    if (!scene || !revision) return
    try {
      set({ status: "Saving rig layout…" })
      const outgoing = clone(scene)
      applyPresentation(outgoing, presentation)
      const saved = await saveScene(outgoing, revision)
      set({
        scene: saved.scene,
        savedScene: clone(saved.scene),
        revision: saved.revision,
        manualPose: {},
        dirty: false,
        status: "Layout matches project scene",
      })
    } catch (error) {
      set({ status: error instanceof Error ? error.message : String(error) })
    }
  },

  setStatus: (status) => set({ status }),
  setPresentation: (patch) =>
    set((current) => ({ presentation: { ...current.presentation, ...patch } })),
  setMode: (mode) => set({ mode }),
  selectBone: (selectedBone) => set({ selectedBone, mode: "bone" }),
  selectLayer: (selectedLayer) => set({ selectedLayer, mode: "layer" }),
  setClipScopedEdits: (clipScopedEdits) => set({ clipScopedEdits }),
  setManualPose: (manualPose) => set({ manualPose }),
  setAnimation: (animation) =>
    set({ animation, handPose: animationHandPose[animation], phase: 0 }),
  setHandPose: (handPose) => set({ handPose }),
  setPhase: (phase) => set({ phase: Math.max(0, Math.min(1, phase)) }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setWrist: (patch) => set((current) => ({ wrist: { ...current.wrist, ...patch } })),
  setSelectedGripFinger: (selectedGripFinger) => set({ selectedGripFinger }),

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
    set({ scene: next, dirty: !sameScene(next, get().savedScene) })
  },

  commitManualPoseToBoneKeys() {
    const { scene, clipScopedEdits, manualPose, animation, phase } = get()
    if (!scene || !clipScopedEdits || Object.keys(manualPose).length === 0) return
    const next = clone(scene)
    if (!commitPoseToBoneKeys(next, animation, phase, manualPose)) return
    set({ scene: next, manualPose: {}, dirty: !sameScene(next, get().savedScene) })
  },

  snapshot() {
    const { scene, manualPose, clipScopedEdits, wrist } = get()
    if (!scene) throw new Error("Cannot snapshot before the scene has loaded")
    return {
      scene: clone(scene),
      manualPose: clone(manualPose),
      clipScopedEdits,
      wrist: clone(wrist),
    }
  },

  commit(before) {
    if (!before) return
    set((current) => ({
      history: commitHistory(current.history, before, {
        scene: current.scene ?? before.scene,
        manualPose: current.manualPose,
        clipScopedEdits: current.clipScopedEdits,
        wrist: current.wrist,
      }),
    }))
  },

  undo() {
    const current = get()
    if (!current.scene) return
    const step = undoHistory(current.history, current.snapshot())
    if (!step) return
    set({
      ...step.snapshot,
      scene: clone(step.snapshot.scene),
      history: step.history,
      dirty: !sameScene(step.snapshot.scene, current.savedScene),
    })
  },

  redo() {
    const current = get()
    if (!current.scene) return
    const step = redoHistory(current.history, current.snapshot())
    if (!step) return
    set({
      ...step.snapshot,
      scene: clone(step.snapshot.scene),
      history: step.history,
      dirty: !sameScene(step.snapshot.scene, current.savedScene),
    })
  },
}))

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

const EMPTY_RIG: ResolvedRig = { bones: [], layers: [] }

/** The scene as the studio is currently wearing it, for option lookups. */
export function sceneSelection(scene: RigScene, presentation: Presentation): RigScene {
  const worn: Partial<RigScene> = {}
  for (const slot of HELD_SLOTS) {
    const id = presentation.held[slot.layer]
    if (id) worn[slot.active] = id
  }
  return {
    ...scene,
    activeChest: presentation.chest,
    activeArmSet: presentation.armSet,
    activeBootSet: presentation.bootSet,
    activeHeadgear: presentation.headgear,
    ...(presentation.necklace ? { activeNecklace: presentation.necklace } : {}),
    ...worn,
  }
}

/** Bones and layers with the active profile's bind pose flattened on. */
export function resolveRig(scene: RigScene | null, presentation: Presentation): ResolvedRig {
  if (!scene) return EMPTY_RIG
  return resolveProfile(
    scene,
    presentation.profile,
    presentation.chest,
    presentation.armSet,
    presentation.headgear,
    presentation.bootSet,
    presentation.necklace,
    presentation.held,
  )
}

/** The scene's authored tracks. Rebuilt whenever the scene changes. */
export function sceneTracks(scene: RigScene | null): RigTracks {
  return scene ? RigTracks.fromScene(scene) : new RigTracks()
}

export const canUndo = (state: RigEditorState): boolean => historyCanUndo(state.history)
export const canRedo = (state: RigEditorState): boolean => historyCanRedo(state.history)
