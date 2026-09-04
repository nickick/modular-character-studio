/**
 * Editing the scene's keyframe tracks.
 *
 * Every operation takes the scene and returns nothing, mutating a copy the
 * caller already made. Both studios author expression and grip keys and had
 * their own near-identical copies of these; the rig studio additionally owns
 * bone and wrist keys.
 *
 * The shared rule throughout: a key exists at a phase, or it does not. Reading
 * a channel between keys interpolates, but writing one always lands on a key at
 * the playhead, creating it if needed.
 */
import { RigTracks } from "../rig/tracks.ts"
import { bonePoseKeys } from "../rig/types.ts"
import type {
  BoneKey,
  ExpressionKey,
  EyeExpression,
  GripChannels,
  GripKind,
  MouthExpression,
  RigScene,
  Side,
  WristKey,
} from "../rig/types.ts"

/** How near the playhead a key must be to count as "the key here". */
export const KEY_EPSILON = 0.0015

/** Phases are stored to four places, which is finer than the timeline can pick. */
export const normalizePhase = (phase: number): number =>
  Number(Math.max(0, Math.min(1, phase)).toFixed(4))

const round3 = (value: number): number => Number(value.toFixed(3))

const atPhase = <K extends { phase: number }>(keys: readonly K[], phase: number): K | null =>
  keys.find((key) => Math.abs(key.phase - phase) <= KEY_EPSILON) ?? null

const byPhase = <K extends { phase: number }>(keys: K[]): K[] =>
  keys.sort((left, right) => left.phase - right.phase)

/** The key before or after the playhead on a track, for Previous/Next. */
export function adjacentKey<K extends { phase: number }>(
  keys: readonly K[],
  phase: number,
  direction: number,
): K | null {
  if (direction < 0) {
    return [...keys].reverse().find((key) => key.phase < phase - KEY_EPSILON) ?? null
  }
  return keys.find((key) => key.phase > phase + KEY_EPSILON) ?? null
}

// ---------------------------------------------------------------------------
// Bone keys
// ---------------------------------------------------------------------------

export function boneKeys(scene: RigScene, clip: string, boneID: string): BoneKey[] {
  return scene.boneKeyframes[clip]?.[boneID] ?? []
}

function boneKeyTrack(scene: RigScene, clip: string, boneID: string): BoneKey[] {
  const clips = (scene.boneKeyframes ??= {})
  const bones = (clips[clip] ??= {})
  return (bones[boneID] ??= [])
}

/**
 * The key at the playhead, created if absent.
 *
 * A brand-new track gets neutral keys at phases 0 and 1 first, so correcting
 * one pose stays local to that moment instead of holding the correction across
 * the whole clip.
 */
export function ensureBoneKey(
  scene: RigScene,
  clip: string,
  boneID: string,
  phase: number,
  tracks: RigTracks,
): BoneKey {
  const sampled = tracks.bonePose(clip, phase)[boneID] ?? {}
  const keys = boneKeyTrack(scene, clip, boneID)
  if (keys.length === 0) {
    keys.push({ phase: 0, x: 0, y: 0, rotation: 0 }, { phase: 1, x: 0, y: 0, rotation: 0 })
  }
  const normalized = normalizePhase(phase)
  const existing = atPhase(keys, normalized)
  if (existing) return existing
  const key: BoneKey = {
    phase: normalized,
    x: sampled.x ?? 0,
    y: sampled.y ?? 0,
    rotation: sampled.rotation ?? 0,
  }
  keys.push(key)
  byPhase(keys)
  return key
}

/** Drop a track, and then a clip, once nothing is keyed in it. */
export function pruneBoneKeys(scene: RigScene, clip: string, boneID: string): void {
  const bones = scene.boneKeyframes[clip]
  if (!bones) return
  if ((bones[boneID]?.length ?? 0) === 0) delete bones[boneID]
  if (Object.keys(bones).length === 0) delete scene.boneKeyframes[clip]
}

export function deleteBoneKey(scene: RigScene, clip: string, boneID: string, phase: number): boolean {
  const keys = scene.boneKeyframes[clip]?.[boneID]
  const key = keys ? atPhase(keys, phase) : null
  if (!keys || !key) return false
  keys.splice(keys.indexOf(key), 1)
  pruneBoneKeys(scene, clip, boneID)
  return true
}

/**
 * Fold a drag's manual pose into the clip's bone keys.
 *
 * The manual pose is additive to whatever the track already samples at this
 * moment, so the written key is the sum -- not the delta on its own, which
 * would discard the correction already keyed there.
 */
export function commitPoseToBoneKeys(
  scene: RigScene,
  clip: string,
  phase: number,
  manualPose: Record<string, { x?: number; y?: number; rotation?: number }>,
): boolean {
  if (Object.keys(manualPose).length === 0) return false
  const tracks = RigTracks.fromScene(scene)
  for (const [boneID, delta] of Object.entries(manualPose)) {
    const sampled = tracks.bonePose(clip, phase)[boneID] ?? {}
    const key = ensureBoneKey(scene, clip, boneID, phase, tracks)
    for (const field of bonePoseKeys) {
      const value = delta[field]
      if (!Number.isFinite(value)) continue
      key[field] = round3((sampled[field] ?? 0) + (value ?? 0))
    }
  }
  return true
}

export function setBoneKeyValue(
  scene: RigScene,
  clip: string,
  boneID: string,
  phase: number,
  field: "x" | "y" | "rotation",
  value: number,
): void {
  const key = ensureBoneKey(scene, clip, boneID, phase, RigTracks.fromScene(scene))
  key[field] = round3(value)
}

// ---------------------------------------------------------------------------
// Expression keys
// ---------------------------------------------------------------------------

export function expressionKeys(scene: RigScene, clip: string): ExpressionKey[] {
  return scene.expressionKeyframes[clip] ?? []
}

export function ensureExpressionKey(
  scene: RigScene,
  clip: string,
  phase: number,
  tracks: RigTracks,
): ExpressionKey {
  const keys = (scene.expressionKeyframes[clip] ??= [])
  const normalized = normalizePhase(phase)
  const existing = atPhase(keys, normalized)
  if (existing) return existing
  const sampled = tracks.expressionAt(clip, phase)
  const key: ExpressionKey = { phase: normalized, eyes: sampled.eyes, mouth: sampled.mouth }
  keys.push(key)
  byPhase(keys)
  return key
}

export function setExpressionChannel(
  scene: RigScene,
  clip: string,
  phase: number,
  channel: "eyes" | "mouth",
  value: EyeExpression | MouthExpression,
  tracks: RigTracks,
): void {
  const key = ensureExpressionKey(scene, clip, phase, tracks)
  if (channel === "eyes") key.eyes = value as EyeExpression
  else key.mouth = value as MouthExpression
}

export function deleteExpressionKey(scene: RigScene, clip: string, phase: number): boolean {
  const keys = scene.expressionKeyframes[clip]
  const key = keys ? atPhase(keys, phase) : null
  if (!keys || !key) return false
  keys.splice(keys.indexOf(key), 1)
  if (keys.length === 0) delete scene.expressionKeyframes[clip]
  return true
}

// ---------------------------------------------------------------------------
// Wrist and grip keys
// ---------------------------------------------------------------------------

/** Which track a hand channel is authored on for a clip and held class. */
export function gripTrackFor(clip: string, kind: GripKind, scoped: boolean): string {
  return scoped ? clip : `__grip_${kind}`
}

export function wristKeys(scene: RigScene, track: string, side: Side): WristKey[] {
  return scene.wristKeyframes[track]?.[side] ?? []
}

export function ensureWristKey(
  scene: RigScene,
  track: string,
  side: Side,
  phase: number,
  seed: () => Omit<WristKey, "phase">,
): WristKey {
  const clips = (scene.wristKeyframes ??= {})
  const perSide = (clips[track] ??= {})
  const keys = (perSide[side] ??= [])
  const normalized = normalizePhase(phase)
  const existing = atPhase(keys, normalized)
  if (existing) return existing
  const key: WristKey = { phase: normalized, ...seed() }
  keys.push(key)
  byPhase(keys)
  return key
}

export function deleteWristKey(scene: RigScene, track: string, side: Side, phase: number): boolean {
  const keys = scene.wristKeyframes[track]?.[side]
  const key = keys ? atPhase(keys, phase) : null
  if (!keys || !key) return false
  keys.splice(keys.indexOf(key), 1)
  if (keys.length === 0) {
    delete scene.wristKeyframes[track]?.[side]
    if (Object.keys(scene.wristKeyframes[track] ?? {}).length === 0) {
      delete scene.wristKeyframes[track]
    }
  }
  return true
}

/** The per-held-class channel bundle on a key, created if absent. */
export function gripChannelsOn(key: WristKey, kind: GripKind, scoped: boolean): GripChannels {
  if (!scoped) return key
  const grips = (key.grips ??= {})
  return (grips[kind] ??= {})
}

/**
 * Copy one channel's value at the playhead through every key on its track.
 *
 * Only the named dimension is copied: the other channels keep their own curves,
 * which is what makes it safe to flatten, say, knuckle axis without disturbing
 * an authored finger spread.
 */
export function copyChannelThroughKeys<K extends { phase: number }>(
  keys: readonly K[],
  write: (key: K) => void,
): void {
  for (const key of keys) write(key)
}

// ---------------------------------------------------------------------------
// Hand controls
// ---------------------------------------------------------------------------

/** Every hand channel at once, as the studio's sliders currently read. */
export interface HandControlValues {
  angle: number
  gripRotation: number
  knuckleAxis: number
  fingerAngles: Record<string, number>
  fingerOffsets: Record<string, { along: number; across: number }>
}

/** Which single channel an edit is writing, or all of them. */
export type HandChannel =
  | "all"
  | "wristAngle"
  | "gripRotation"
  | "knuckleAxis"
  | "fingerAngle"
  | "fingerAlong"
  | "fingerAcross"

/**
 * Which held class a clip's grip channels belong to.
 *
 * The body clip is named `swordSwing`, but while a staff or spear is equipped
 * its hand controls stay in the staff family rather than borrowing the ordinary
 * weapon channel.
 */
export function activeGripKind(animation: string, mainHand: "weapon" | "staff"): GripKind {
  if (animation.startsWith("bow")) return "bow"
  if (mainHand === "staff" || animation.startsWith("staff")) return "staff"
  return "weapon"
}

/**
 * Combat clips whose hand channels intentionally diverge from their family
 * baseline author onto the clip itself; everything else authors onto the one
 * shared curve per held class.
 */
export function gripUsesAnimationOverride(animation: string): boolean {
  return animation === "swordSwing" || animation === "sneakAttack"
}

export function gripTrackName(animation: string, kind: GripKind): string {
  return gripUsesAnimationOverride(animation) ? animation : `__grip_${kind}`
}

/**
 * Where a clip's grip values live on a key. An override clip writing for a
 * non-natural held class scopes them under `grips`, so a staff correction on
 * the sword swing cannot leak onto the sword.
 */
function gripPayload(key: WristKey, animation: string, kind: GripKind): GripChannels | null {
  const natural = animation.startsWith("bow") ? "bow" : animation.startsWith("staff") ? "staff" : "weapon"
  if (!gripUsesAnimationOverride(animation) || kind === natural) return key
  const grips = (key.grips ??= {})
  return (grips[kind] ??= {})
}

/** Write one channel, or all of them, onto a key's grip payload. */
export function writeHandChannel(
  key: WristKey,
  animation: string,
  kind: GripKind,
  channel: HandChannel,
  values: HandControlValues,
  fingerIDs: readonly string[],
): void {
  if (channel === "wristAngle" || channel === "all") key.angle = values.angle
  if (channel === "wristAngle") return
  const payload = gripPayload(key, animation, kind)
  if (!payload) return
  if (channel === "all") {
    payload.gripRotation = values.gripRotation
    payload.knuckleAxis = values.knuckleAxis
    payload.fingerAngles = { ...values.fingerAngles }
    payload.fingerOffsets = structuredClone(values.fingerOffsets)
    return
  }
  if (channel === "gripRotation") payload.gripRotation = values.gripRotation
  else if (channel === "knuckleAxis") payload.knuckleAxis = values.knuckleAxis
  else if (channel === "fingerAngle") {
    const angles = (payload.fingerAngles ??= {})
    for (const id of fingerIDs) angles[id] = values.fingerAngles[id] ?? 0
  } else {
    const axis = channel === "fingerAlong" ? "along" : "across"
    const offsets = (payload.fingerOffsets ??= {})
    for (const id of fingerIDs) {
      const placement = (offsets[id] ??= { along: 0, across: 0 })
      placement[axis] = values.fingerOffsets[id]?.[axis] ?? 0
    }
  }
}

/**
 * Every phase at which this side has a hand key, across both tracks.
 *
 * The wrist angle is authored on the clip while grip, knuckle and finger
 * channels usually live on the shared per-held-class curve, so stepping over
 * one track alone would skip half the keys an author can see on the timeline.
 */
export function handKeyPhases(
  scene: RigScene,
  clip: string,
  gripTrack: string,
  side: Side,
): number[] {
  const phases = [
    ...wristKeys(scene, clip, side).map((key) => key.phase),
    ...wristKeys(scene, gripTrack, side).map((key) => key.phase),
  ]
  return [...new Set(phases)].sort((left, right) => left - right)
}

/** The neighbouring phase in a sorted list, or null at either end. */
export function adjacentPhase(phases: readonly number[], phase: number, direction: number): number | null {
  if (direction < 0) return [...phases].reverse().find((at) => at < phase - KEY_EPSILON) ?? null
  return phases.find((at) => at > phase + KEY_EPSILON) ?? null
}
