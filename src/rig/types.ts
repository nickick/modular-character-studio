/**
 * Scene and pose types for the angled modular character rig.
 *
 * These describe `project/scene.json`. The browser studios, validators, and
 * project tooling share these definitions rather than re-deriving the shape.
 */

/** The two body profiles share one skeleton but not one set of bind offsets. */
export type ProfileID = "maleV1" | "femaleV1"

export const profileIDs: readonly ProfileID[] = ["maleV1", "femaleV1"]

/** Anatomical side. Screen-left is `L` throughout, matching the bone names. */
export type Side = "L" | "R"

export interface Point {
  x: number
  y: number
}

/** A 2D affine transform in the same `a..f` order every canvas API uses. */
export interface Matrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/** Per-profile values keyed by body profile. */
export type ByProfile<T> = Record<ProfileID, T>

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/** A bone's registration within one profile. */
export interface BoneBind {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

export interface SceneBone {
  id: string
  label: string
  parent: string | null
  bindByProfile: ByProfile<BoneBind>
  /**
   * Seats this bone with the same best-fit transform that seats a `fitBones`
   * layer rather than through its parent's posed matrix. `neck` uses it so the
   * head follows wherever the fitted torso art actually landed.
   */
  fitBones?: string[]
}

/** A bone with one profile's bind flattened onto it, ready to pose. */
export interface ResolvedBone extends BoneBind {
  id: string
  label: string
  parent: string | null
  fitBones?: string[]
}

/** Fields a pose may drive on a bone. Absent fields mean "leave at bind". */
export interface PoseDelta {
  x?: number
  y?: number
  rotation?: number
  scaleX?: number
  scaleY?: number
}

/** Additive bone deltas for one moment, keyed by bone id. */
export type Pose = Record<string, PoseDelta>

/** The bone fields a pose delta may address, in write order. */
export const bonePoseKeys = ["x", "y", "rotation"] as const
export type BonePoseKey = (typeof bonePoseKeys)[number]

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** An attachment's registration within one profile. */
export interface LayerBind {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
  pivotX: number
  pivotY: number
  /** Yaw of the sprite's plane about its vertical axis, in degrees. */
  planeYaw?: number
}

export const layerBindKeys = [
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "pivotX",
  "pivotY",
  "planeYaw",
] as const
export type LayerBindKey = (typeof layerBindKeys)[number]

/**
 * A two-bone, thickness-preserving cage over a flexible joint bridge. The
 * universal hands use it at the wrist. Swappable boot shafts and the narrow
 * raised overlap on boot feet use coordinated cages at the ankle; rigid
 * artwork on either side of the bridge keeps its shape.
 */
export interface WeightedStripMeshV2 {
  type: "weightedStripV2"
  parentBone: string
  childBone: string
  /** Normalized positions of the cross-sections between the two handles. */
  bendStops: number[]
  /** Parent-side handle, in normalized sprite space. */
  bendStart: Point
  /** Child-side handle, in normalized sprite space. */
  bendEnd: Point
}

/** Placement of one finger copy in the held item's shaft space. */
export interface GripFinger {
  along: number
  across: number
  angleOffset: number
  /** The point inside the PNG that lands on the root, normalized. */
  basePivot: Point
}

/** One anchor of a pen-tool path, with optional mirrored cubic handles. */
export interface BezierNode extends Point {
  in?: Point
  out?: Point
}

/** A normalized cutout mask shared by the four finger copies. */
export interface BezierPathV1 {
  type: "bezierPathV1"
  closed: boolean
  nodes: BezierNode[]
}

export interface SceneLayer {
  id: string
  group: string
  bone: string
  assetByProfile: ByProfile<string>
  bindByProfile: ByProfile<LayerBind>
  drawOrder: number
  visible: boolean
  handState?: HandPoseID
  mesh?: WeightedStripMeshV2
  gripFinger?: GripFinger
  clipPath?: BezierPathV1
  /** Seats the sprite across several bones at once, as the torso does. */
  fitBones?: string[]
}

/**
 * A layer with one profile's asset and bind flattened onto it. This is what
 * every renderer draws; nothing downstream looks at `bindByProfile` again.
 */
export interface ResolvedLayer extends SceneLayer, LayerBind {
  asset: string
}

/** Held-slot overrides used to preview equipment the scene is not wearing. */
export type HeldSelection = Partial<
  Record<"quiver" | "weapon" | "staff" | "bow" | "shield", string | null>
>

/** A pose sampled together with the world transforms it produced. */
export interface PosedRig {
  bindWorld: Record<string, Matrix2D>
  currentWorld: Record<string, Matrix2D>
}

/** The whole rig for one profile, ready to pose and paint. */
export interface ResolvedRig {
  bones: ResolvedBone[]
  layers: ResolvedLayer[]
}

// ---------------------------------------------------------------------------
// Equipment and outfit options
// ---------------------------------------------------------------------------

/**
 * One entry in an equipment or outfit catalogue.
 *
 * An option always carries art. It may also carry its own bind, because items
 * in a slot are not always registered to a common anchor — the six necklaces
 * put the cord's collar point anywhere from x=243 to x=684 on their shared
 * canvas, so one placement cannot serve them all. Art authored against a
 * slot's registration leaves the bind out and inherits the layer's.
 */
export interface SceneOption {
  id: string
  label: string
  /** Set by options that dress one layer per body profile. */
  assetByProfile?: ByProfile<string>
  bindByProfile?: ByProfile<LayerBind>
  /** Set by options that dress several named layers at once, as arm sets do. */
  assetByLayer?: Record<string, string>
  bindByLayer?: Record<string, ByProfile<LayerBind>>
  /** True once the placement has been tuned against this specific artwork. */
  fitted?: boolean
  /** Where the option sits on the gear ladder when no inventory item says. */
  line?: string
  tier?: string
  /** Links the option back to a catalogue item in the game's inventory. */
  itemID?: string
}

/** Scene keys naming the worn option for each slot. */
export type ActiveSlotKey =
  | "activeNecklace"
  | "activeQuiver"
  | "activeWeapon"
  | "activeStaff"
  | "activeBow"
  | "activeShield"
  | "activeRing"
  | "activeChest"
  | "activeHeadgear"
  | "activeArmSet"
  | "activeBootSet"

/** Scene keys naming each slot's catalogue. */
export type CatalogueKey =
  | "necklaceOptions"
  | "quiverOptions"
  | "weaponOptions"
  | "staffOptions"
  | "bowOptions"
  | "shieldOptions"
  | "ringOptions"
  | "chestOptions"
  | "headgearOptions"
  | "armOptions"
  | "bootOptions"

/**
 * A slot names the scene key holding the active id, the catalogue it indexes,
 * and which layers it dresses.
 */
export interface OptionSlot {
  active: ActiveSlotKey
  catalogue: CatalogueKey
  /** Matches the single layer this slot dresses. Absent for `byLayer` slots. */
  dresses?: (layer: SceneLayer) => boolean
  /** True when the option's `assetByLayer` names every layer it dresses. */
  byLayer?: boolean
}

/** What a slot dresses a layer in: its art, and its placement when it owns one. */
export interface DressedLayer {
  option: SceneOption
  asset: string | ByProfile<string>
  bind?: ByProfile<LayerBind>
}

// ---------------------------------------------------------------------------
// Animation tracks
// ---------------------------------------------------------------------------

export type ClipName = string

/** Additive bone correction authored against one clip at one moment. */
export interface BoneKey extends PoseDelta {
  phase: number
}

/** Hand-control channels scoped to one held class within a wrist key. */
export interface GripChannels {
  gripRotation?: number
  knuckleAxis?: number
  fingerAngles?: Record<string, number>
  fingerOffsets?: Record<string, { along?: number; across?: number }>
}

/** Which family of held item a set of grip channels was authored for. */
export type GripKind = "weapon" | "staff" | "bow"

export const gripKinds: readonly GripKind[] = ["weapon", "staff", "bow"]

/**
 * One side's authored hand controls at one moment. A missing channel means
 * "this key does not address that channel", not "key that channel to zero".
 */
export interface WristKey extends GripChannels {
  phase: number
  angle?: number
  /** Per-held-class channels. Newer scenes author here instead of inline. */
  grips?: Partial<Record<GripKind, GripChannels>>
}

export type EyeExpression = "neutral" | "blink" | "wide" | "focused" | "wince"
export type MouthExpression =
  | "neutral"
  | "smile"
  | "smirk"
  | "shout"
  | "surprised"
  | "frown"
  | "pain"
  | "grit"
  | "talk"

/** Face artwork is a stepped track: the drawings are swapped, not blended. */
export interface ExpressionKey {
  phase: number
  eyes: EyeExpression
  mouth: MouthExpression
}

export type BoneKeyframes = Record<ClipName, Record<string, BoneKey[]>>
export type WristKeyframes = Record<ClipName, Partial<Record<Side, WristKey[]>>>
export type ExpressionKeyframes = Record<ClipName, ExpressionKey[]>
export type ClipPoseOffsets = Record<ClipName, Pose>

// ---------------------------------------------------------------------------
// Hand poses
// ---------------------------------------------------------------------------

/** Which of the two universal hand drawings a side shows. */
export type HandPoseID = "open" | "closed"

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface SceneCanvas {
  width: number
  height: number
}

/**
 * Reference metadata the builder records alongside the rig: where the landmarks
 * came from, the sizing rule both profiles were cut to, and the canonical pixel
 * targets everything was solved against. The studios read `baseline` to draw
 * the floor line, while external project tooling may use the tunic regions.
 */
export interface ProfileReference {
  originalLandmarks: string
  sizingRule: string
  torsoRatioRule?: string
  tunicRegionsByProfile?: ByProfile<Record<string, number>>
  canonicalTargetPixels?: Record<string, number>
}

/**
 * The complete authored scene, as stored on disk.
 *
 * The outfit slots are required — the character always wears a chest, arms,
 * boots, and headgear catalogue. The single-layer slots are optional, and a
 * scene that omits one must round-trip without gaining the key, or the
 * validator stops being a fixed point and every save rewrites the file.
 */
export interface RigScene {
  format: string
  canvas: SceneCanvas
  activeProfile: ProfileID
  profileReference: ProfileReference
  referenceByProfile: ByProfile<string>
  bones: SceneBone[]
  layers: SceneLayer[]

  chestOptions: SceneOption[]
  activeChest: string
  armOptions: SceneOption[]
  activeArmSet: string
  bootOptions: SceneOption[]
  activeBootSet: string
  headgearOptions: SceneOption[]
  activeHeadgear: string

  weaponOptions?: SceneOption[]
  activeWeapon?: string
  staffOptions?: SceneOption[]
  activeStaff?: string
  bowOptions?: SceneOption[]
  activeBow?: string
  shieldOptions?: SceneOption[]
  activeShield?: string
  ringOptions?: SceneOption[]
  activeRing?: string
  quiverOptions?: SceneOption[]
  activeQuiver?: string
  necklaceOptions?: SceneOption[]
  activeNecklace?: string

  wristKeyframes: WristKeyframes
  boneKeyframes: BoneKeyframes
  expressionKeyframes: ExpressionKeyframes
  /** Legacy clip-wide corrections, still additive under the keyed tracks. */
  clipPoseOffsets?: ClipPoseOffsets
}
