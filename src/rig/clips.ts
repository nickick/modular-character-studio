/**
 * The authored clip catalogue: which clips exist, how long they run, what they
 * loop, which hands they use, and what equipment they show.
 *
 * Every table is keyed by `AnimationName`, so adding a clip to `animationNames`
 * makes the compiler name every table that still has to answer for it. That is
 * deliberate: a clip that is missing a duration or a loadout used to fail
 * silently at runtime as an `undefined` lookup.
 */
import type { HandPoseID, ResolvedLayer, Side } from "./types.ts"

export const animationNames = [
  "idle",
  "staffIdle",
  "staffMoveForward",
  "staffMoveBackward",
  "run",
  "shieldUp",
  "staffShieldUp",
  "shieldMoveForward",
  "shieldMoveBackward",
  "staffShieldMoveForward",
  "staffShieldMoveBackward",
  "dodgeForward",
  "dodgeBackward",
  "swordSwing",
  "blocked",
  "sneakAttack",
  "spellCast",
  "spellMoveForward",
  "spellMoveBackward",
  "bowDraw",
  "bowMoveForward",
  "bowMoveBackward",
] as const

/** One of the authored clips. Track keys stay plain strings; these do not. */
export type AnimationName = (typeof animationNames)[number]

const animationNameSet: ReadonlySet<string> = new Set<string>(animationNames)

/** Narrow an arbitrary track key to an authored clip. */
export function isAnimationName(value: string): value is AnimationName {
  return animationNameSet.has(value)
}

/**
 * Hand attachments swap per side, not per character: the character grips a hilt with
 * one hand while the other stays open on a shield, a spell, or nothing. A hand
 * pose therefore names a state for each side rather than one for the pair.
 *
 * The keys are the bone suffixes, which on this rig fall on the screen-left and
 * screen-right hands respectively.
 */
export const handPoses = {
  open: { L: "open", R: "open" },
  closed: { L: "closed", R: "closed" },
  closedLOpenR: { L: "closed", R: "open" },
  openLClosedR: { L: "open", R: "closed" },
} as const satisfies Record<string, Record<Side, HandPoseID>>

export type HandPoseName = keyof typeof handPoses

export const handPoseNames = Object.keys(handPoses) as HandPoseName[]

const isHandPoseName = (value: string): value is HandPoseName =>
  Object.prototype.hasOwnProperty.call(handPoses, value)

/** The state one side is in under a named hand pose. */
export function handStateFor(handPose: string, side: Side): HandPoseID {
  const pose = isHandPoseName(handPose) ? handPoses[handPose] : handPoses.open
  return pose[side] ?? "open"
}

/**
 * Whether a layer draws under a hand pose. Layers without a `handState` are not
 * hand attachments and always draw; the rest are matched against their own
 * side, taken from the bone they hang on rather than from their id.
 */
export function layerMatchesHandPose(layer: ResolvedLayer, handPose: string): boolean {
  if (!layer.handState) return true
  const side: Side = layer.bone.endsWith("R") ? "R" : "L"
  return layer.handState === handStateFor(handPose, side)
}

/**
 * Whether a clip runs on a loop or plays once. A one-shot has a start, so it
 * cannot look backwards past it: the necklace's trailing sample clamps there
 * rather than wrapping round to the clip's end, which would kick the pendant on
 * the opening frames.
 */
export const animationLoops = {
  idle: true,
  staffIdle: true,
  staffMoveForward: true,
  staffMoveBackward: true,
  run: true,
  shieldUp: true,
  staffShieldUp: true,
  shieldMoveForward: true,
  shieldMoveBackward: true,
  staffShieldMoveForward: true,
  staffShieldMoveBackward: true,
  dodgeForward: false,
  dodgeBackward: false,
  swordSwing: false,
  blocked: false,
  sneakAttack: false,
  spellCast: false,
  spellMoveForward: true,
  spellMoveBackward: true,
  bowDraw: false,
  bowMoveForward: true,
  bowMoveBackward: true,
} as const satisfies Record<AnimationName, boolean>

/** Seconds one pass of a clip takes at 1x. */
export const animationDurations = {
  idle: 2.1,
  staffIdle: 2.1,
  staffMoveForward: 1,
  staffMoveBackward: 1,
  run: 0.82,
  shieldUp: 2.1,
  staffShieldUp: 2.1,
  shieldMoveForward: 1,
  shieldMoveBackward: 1,
  staffShieldMoveForward: 1,
  staffShieldMoveBackward: 1,
  dodgeForward: 0.56,
  dodgeBackward: 0.56,
  swordSwing: 1.05,
  blocked: 1.15,
  sneakAttack: 1.15,
  spellCast: 1.45,
  spellMoveForward: 1,
  spellMoveBackward: 1,
  bowDraw: 1.55,
  bowMoveForward: 1,
  bowMoveBackward: 1,
} as const satisfies Record<AnimationName, number>

/** The runtime input a clip bends toward, when it bends toward one at all. */
export type AimKind = "spell" | "bow"

/**
 * A cast reaches where the spell is aimed and a draw follows the arrow;
 * everything else plays as authored. This is the seam between baked motion and
 * motion that answers to the player.
 */
export const animationAim = {
  spellCast: "spell",
  spellMoveForward: "spell",
  spellMoveBackward: "spell",
  bowDraw: "bow",
  bowMoveForward: "bow",
  bowMoveBackward: "bow",
} as const satisfies Partial<Record<AnimationName, AimKind>>

/** Which hand attachment each clip is authored against. */
export const animationHandPose = {
  idle: "closed",
  staffIdle: "closedLOpenR",
  staffMoveForward: "closedLOpenR",
  staffMoveBackward: "closedLOpenR",
  run: "closed",
  shieldUp: "closed",
  staffShieldUp: "closedLOpenR",
  shieldMoveForward: "closed",
  shieldMoveBackward: "closed",
  staffShieldMoveForward: "closedLOpenR",
  staffShieldMoveBackward: "closedLOpenR",
  dodgeForward: "closed",
  dodgeBackward: "closed",
  swordSwing: "closed",
  blocked: "closed",
  sneakAttack: "closed",
  spellCast: "open",
  spellMoveForward: "open",
  spellMoveBackward: "open",
  bowDraw: "closedLOpenR",
  bowMoveForward: "closedLOpenR",
  bowMoveBackward: "closedLOpenR",
} as const satisfies Record<AnimationName, HandPoseName>

/** Layer ids that are held equipment rather than part of the body. */
export type EquipmentLayerID = "weapon" | "staff" | "shield" | "bow"

const equipmentLayerIDs: ReadonlySet<string> = new Set<EquipmentLayerID>([
  "weapon",
  "staff",
  "shield",
  "bow",
])

const heldSet: readonly EquipmentLayerID[] = ["weapon", "staff", "shield"]

/**
 * Equipment shown by each authored clip. `weapon` and `staff` are alternative
 * render layers for the equipped main-hand item, so keeping both ids active
 * preserves swords, axes, spears, staffs, and wands through every non-ranged
 * pose. Casting clears both hands, while bow draw swaps the whole set for the
 * bow instead of drawing all three items together.
 */
export const animationEquipment = {
  idle: heldSet,
  staffIdle: heldSet,
  staffMoveForward: heldSet,
  staffMoveBackward: heldSet,
  run: heldSet,
  shieldUp: heldSet,
  staffShieldUp: heldSet,
  shieldMoveForward: heldSet,
  shieldMoveBackward: heldSet,
  staffShieldMoveForward: heldSet,
  staffShieldMoveBackward: heldSet,
  dodgeForward: heldSet,
  dodgeBackward: heldSet,
  swordSwing: heldSet,
  blocked: heldSet,
  sneakAttack: heldSet,
  spellCast: [],
  spellMoveForward: [],
  spellMoveBackward: [],
  bowDraw: ["bow"],
  bowMoveForward: ["bow"],
  bowMoveBackward: ["bow"],
} as const satisfies Record<AnimationName, readonly EquipmentLayerID[]>

/** Non-equipment layers always draw; equipment must belong to the clip loadout. */
export function layerMatchesAnimationEquipment(layer: ResolvedLayer, animation: string): boolean {
  if (!equipmentLayerIDs.has(layer.id)) return true
  if (!isAnimationName(animation)) return false
  return (animationEquipment[animation] as readonly string[]).includes(layer.id)
}

/**
 * The clips worth checking a slot's placement in: the ones that show it. A
 * sword is reviewed swinging, a bow at full draw, a staff through its own idle,
 * and everything held is reviewed standing and running as well.
 */
export const REVIEW_ANIMATIONS = [
  "idle",
  "run",
  "staffIdle",
  "shieldUp",
  "staffShieldUp",
  "shieldMoveForward",
  "shieldMoveBackward",
  "staffShieldMoveForward",
  "staffShieldMoveBackward",
  "dodgeForward",
  "dodgeBackward",
  "swordSwing",
  "blocked",
  "sneakAttack",
  "bowDraw",
] as const satisfies readonly AnimationName[]

/**
 * Poses worth judging a placement in, which is not the same question as which
 * poses the game draws a layer in.
 *
 * A staff or spear ships in its carried and guarded states, but a grip that
 * reads there can still be wrong once the body lunges. Reviewing includes that
 * attack pose too, so this can return more than a layer's runtime presentation
 * set and the studio draws the reviewed layer regardless of clip loadout.
 */
const REVIEW_OVERRIDES: Partial<Record<string, readonly AnimationName[]>> = {
  staff: [
    "staffIdle",
    "staffMoveForward",
    "staffMoveBackward",
    "staffShieldUp",
    "staffShieldMoveForward",
    "staffShieldMoveBackward",
    "swordSwing",
    "sneakAttack",
  ],
}

const DEFAULT_REVIEW: readonly AnimationName[] = ["idle", "run", "swordSwing", "bowDraw"]

export function reviewAnimations(layerID: string): readonly AnimationName[] {
  const override = REVIEW_OVERRIDES[layerID]
  if (override) return override
  const shown = REVIEW_ANIMATIONS.filter((name) =>
    (animationEquipment[name] as readonly string[]).includes(layerID),
  )
  // A layer no clip singles out -- a necklace, a boot -- is worn in all of
  // them, so it is reviewed against the standing, moving and swinging poses.
  return shown.length ? shown : DEFAULT_REVIEW
}
