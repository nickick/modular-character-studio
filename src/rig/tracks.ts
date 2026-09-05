/**
 * The scene's authored animation tracks, and sampling them.
 *
 * These four tracks used to be module-level `let` bindings that every caller
 * mutated through `setBoneKeyframes`-style setters. Sampling functions then
 * read them implicitly, so `animationPose(name, phase)` looked pure while
 * silently depending on whichever scene had been loaded last — and a test that
 * forgot to reset a track changed the answer for every test after it. They are
 * an explicit value now: build one `RigTracks` per scene and pass it around.
 */
import { smoothstep01 } from "./angles.ts"
import { animationLoops, isAnimationName } from "./clips.ts"
import type { GripControls } from "./grip.ts"
import { authoredPose, groundStationaryPose, mergePoses, weldHeadToNeck } from "./clip-poses.ts"
import { constrainKneeRotation } from "./ik.ts"
import {
  bonePoseKeys,
  gripKinds,
  type BoneKey,
  type BoneKeyframes,
  type BonePoseKey,
  type ClipPoseOffsets,
  type ExpressionKey,
  type ExpressionKeyframes,
  type EyeExpression,
  type GripChannels,
  type GripKind,
  type MouthExpression,
  type Pose,
  type PoseDelta,
  type RigScene,
  type Side,
  type WristKey,
  type WristKeyframes,
} from "./types.ts"

export const eyeExpressionNames: readonly EyeExpression[] = [
  "neutral",
  "blink",
  "wide",
  "focused",
  "wince",
]

export const mouthExpressionNames: readonly MouthExpression[] = [
  "neutral",
  "smile",
  "smirk",
  "shout",
  "surprised",
  "frown",
  "pain",
  "grit",
  "talk",
]

const sides: readonly Side[] = ["L", "R"]

const NEUTRAL_FACE: ExpressionKey = { phase: 0, eyes: "neutral", mouth: "neutral" }

/** The legacy flat grip channels belong only to the natural held class for a clip. */
export function defaultGripKind(name: string): GripKind {
  if (name.startsWith("bow")) return "bow"
  if (name.startsWith("staff")) return "staff"
  return "weapon"
}

/** Scene key used for the one normalized grip curve shared by each held class. */
export function gripTrackName(kind: string): string {
  return `__grip_${(gripKinds as readonly string[]).includes(kind) ? kind : "weapon"}`
}

/** Combat clips whose hand channels intentionally diverge from the family baseline. */
export function gripUsesAnimationOverride(name: string): boolean {
  return name === "swordSwing" || name === "sneakAttack"
}

/**
 * Where one hand-control channel's value lives. A wrist key and a per-held-class
 * `grips` bundle carry the same channels, so one reader serves both; `angle` is
 * the exception, because it belongs to the key rather than to a held class.
 */
type ChannelSource = WristKey | GripChannels
type ChannelReader = (source: ChannelSource) => number | undefined

const readAngle: ChannelReader = (source) => ("angle" in source ? source.angle : undefined)
const readGripRotation: ChannelReader = (source) => source.gripRotation
const readKnuckleAxis: ChannelReader = (source) => source.knuckleAxis
const readFingerAngle =
  (layerID: string): ChannelReader =>
  (source) =>
    source.fingerAngles?.[layerID]
const readFingerOffset =
  (layerID: string, axis: "along" | "across"): ChannelReader =>
  (source) =>
    source.fingerOffsets?.[layerID]?.[axis]

/**
 * Smoothly interpolate one numeric channel through a sorted key list.
 *
 * Keys have already been filtered to those that actually address the channel,
 * because a missing value means "this key does not address that channel", not
 * "key it to zero" — filtering first is what stops a wrist key from erasing the
 * knuckle placement between its own authored keys.
 */
function interpolate<K extends { phase: number }>(
  keys: readonly K[],
  phase: number,
  value: (key: K) => number,
  loop = false,
): number {
  if (keys.length === 0) return 0
  if (keys.length === 1) return value(keys[0])
  const t = Math.max(0, Math.min(1, phase))
  let left = keys[0]
  let right = keys[keys.length - 1]
  let leftPhase = left.phase
  let rightPhase = right.phase
  // An explicitly authored start and end are allowed to differ. Otherwise a
  // looping numeric track treats the first key as the next key after its last
  // one, so the unkeyed tail eases back into the opening pose before wrap.
  const explicitEndpoints = left.phase <= 0.000001 && right.phase >= 0.999999
  if (loop && !explicitEndpoints && t < left.phase) {
    left = keys[keys.length - 1]
    right = keys[0]
    leftPhase = left.phase - 1
    rightPhase = right.phase
  } else if (loop && !explicitEndpoints && t > right.phase) {
    left = keys[keys.length - 1]
    right = keys[0]
    leftPhase = left.phase
    rightPhase = right.phase + 1
  } else {
    if (t <= left.phase) return value(left)
    if (t >= right.phase) return value(right)
    for (let index = 1; index < keys.length; index += 1) {
      if (t <= keys[index].phase) {
        left = keys[index - 1]
        right = keys[index]
        leftPhase = left.phase
        rightPhase = right.phase
        break
      }
    }
  }
  const span = rightPhase - leftPhase
  const local = span <= 1e-8 ? 0 : (t - leftPhase) / span
  return value(left) + (value(right) - value(left)) * smoothstep01(local)
}

/** Unknown names are editor/test tracks and retain the editor's looping default. */
function isLoopingTrack(name: string): boolean {
  return !isAnimationName(name) || animationLoops[name]
}

/** Everything a scene contributes to sampled motion. */
export interface RigTrackData {
  bone: BoneKeyframes
  wrist: WristKeyframes
  expression: ExpressionKeyframes
  clipOffsets: ClipPoseOffsets
}

/**
 * One scene's authored tracks. Immutable from the sampler's point of view:
 * editors rebuild a `RigTracks` from the scene after an edit rather than
 * mutating the one the renderer is reading.
 */
export class RigTracks {
  readonly bone: BoneKeyframes
  readonly wrist: WristKeyframes
  readonly expression: ExpressionKeyframes
  readonly clipOffsets: ClipPoseOffsets

  constructor(data: Partial<RigTrackData> = {}) {
    this.bone = data.bone ?? {}
    this.wrist = data.wrist ?? {}
    this.expression = data.expression ?? {}
    this.clipOffsets = data.clipOffsets ?? {}
  }

  /** The tracks a scene carries, ready to sample. */
  static fromScene(scene: RigScene): RigTracks {
    return new RigTracks({
      bone: scene.boneKeyframes,
      wrist: scene.wristKeyframes,
      expression: scene.expressionKeyframes,
      clipOffsets: scene.clipPoseOffsets,
    })
  }

  /** Whether this clip deliberately authors the timeline's final frame. */
  hasEndKey(name: string): boolean {
    const atEnd = (key: { phase: number }): boolean => Math.abs(key.phase - 1) <= 0.000001
    return Object.values(this.bone[name] ?? {}).some((keys) => keys.some(atEnd))
      || Object.values(this.wrist[name] ?? {}).some((keys) => keys.some(atEnd))
      || (this.expression[name] ?? []).some(atEnd)
  }

  /**
   * Every preview cycles through its opening frame at the loop boundary. An
   * explicit key at phase 1 opts the whole final frame out, so an artist can
   * deliberately author a distinct endpoint rather than having it inferred by
   * whichever track happened to end latest.
   */
  playbackPhase(name: string, phase: number): number {
    const raw = Number.isFinite(phase) ? phase : 0
    const wrapped = ((raw % 1) + 1) % 1
    const boundary = raw > 0 && Math.abs(raw - Math.round(raw)) <= 0.00000001
    return boundary && this.hasEndKey(name) ? 1 : wrapped
  }

  // -------------------------------------------------------------------------
  // Face
  // -------------------------------------------------------------------------

  /**
   * Face artwork is sampled as a stepped track: blink and mouth drawings are
   * complete replacement attachments, not values to interpolate.
   */
  expressionAt(name: string, phase: number): { eyes: EyeExpression; mouth: MouthExpression } {
    const keys = [...(this.expression[name] ?? [])].sort((left, right) => left.phase - right.phase)
    if (!keys.length) return { eyes: NEUTRAL_FACE.eyes, mouth: NEUTRAL_FACE.mouth }
    const normalized = this.playbackPhase(name, phase)
    let sampled = keys[0]
    for (const key of keys) {
      if (key.phase > normalized + 0.000001) break
      sampled = key
    }
    return { eyes: sampled.eyes, mouth: sampled.mouth }
  }

  // -------------------------------------------------------------------------
  // Hands
  // -------------------------------------------------------------------------

  /** Smoothly interpolate one hand-control channel at a clip phase. */
  private handChannel(
    name: string,
    side: Side,
    phase: number,
    read: ChannelReader,
    gripKind: GripKind | null,
  ): number {
    phase = this.playbackPhase(name, phase)
    const sharedKeys = gripKind == null ? [] : (this.wrist[gripTrackName(gripKind)]?.[side] ?? [])
    const animationKeys = this.wrist[name]?.[side] ?? []
    const animationValue = (key: WristKey): number | undefined => {
      if (gripKind != null) {
        const scoped = key.grips?.[gripKind]
        const scopedValue = scoped ? read(scoped) : undefined
        if (Number.isFinite(scopedValue)) return scopedValue
        // Scenes authored before per-held-class channels stored grip values on
        // the wrist key itself. Those values belong only to the clip's natural
        // held class; treating them as a fallback for every class is the leak
        // that made bow/staff edits appear on swords.
        if (gripKind !== defaultGripKind(name)) return undefined
      }
      return read(key)
    }
    const channelKeys = (keys: readonly WristKey[], value: (key: WristKey) => number | undefined) =>
      keys.filter((key) => Number.isFinite(value(key))).sort((left, right) => left.phase - right.phase)
    const localKeys = channelKeys(animationKeys, animationValue)
    const baselineKeys = channelKeys(sharedKeys, read)
    // Sword Swing and Sneak Attack are deliberately allowed to override one
    // grip dimension at a time. Any dimension they do not author continues to
    // inherit the current ordinary-weapon baseline.
    const useLocal = gripKind != null && gripUsesAnimationOverride(name) && localKeys.length > 0
    const useBaseline = !useLocal && gripKind != null && baselineKeys.length > 0
    const keys = useLocal ? localKeys : useBaseline ? baselineKeys : localKeys
    const value = useBaseline ? read : animationValue
    const cycles = isLoopingTrack(name) && !(phase >= 0.999999 && this.hasEndKey(name))
    return interpolate(keys, phase, (key) => value(key) ?? 0, cycles)
  }

  /** One side's additive wrist rotation at a clip phase. */
  wristAngle(name: string, side: Side, phase: number): number {
    return this.handChannel(name, side, phase, readAngle, null)
  }

  /** Rigid rotation shared by the held item and its four finger attachments. */
  gripRotation(
    name: string,
    side: Side,
    phase: number,
    gripKind: GripKind = defaultGripKind(name),
  ): number {
    return this.handChannel(name, side, phase, readGripRotation, gripKind)
  }

  /** Animated rotation of the four root positions around their shared centre. */
  knuckleAxis(
    name: string,
    side: Side,
    phase: number,
    gripKind: GripKind = defaultGripKind(name),
  ): number {
    return this.handChannel(name, side, phase, readKnuckleAxis, gripKind)
  }

  /** Additive rigid angle for one finger, over its authored resting angle. */
  fingerAngle(
    name: string,
    side: Side,
    phase: number,
    layerID: string,
    gripKind: GripKind = defaultGripKind(name),
  ): number {
    return this.handChannel(name, side, phase, readFingerAngle(layerID), gripKind)
  }

  /** Additive shaft-space placement scoped to one animation and held class. */
  fingerOffset(
    name: string,
    side: Side,
    phase: number,
    layerID: string,
    axis: "along" | "across",
    gripKind: GripKind = defaultGripKind(name),
  ): number {
    return this.handChannel(name, side, phase, readFingerOffset(layerID, axis), gripKind)
  }

  /**
   * Every authored hand channel at once. Both studios draw the grip from this,
   * so neither can silently omit a channel the other already understands.
   */
  gripControlsAt(
    animation: string,
    side: Side,
    phase: number,
    fingerLayerIDs: readonly string[],
    gripKind: GripKind = defaultGripKind(animation),
  ): GripControls {
    const fingerAngles: Record<string, number> = {}
    const fingerOffsets: Record<string, { along: number; across: number }> = {}
    for (const id of fingerLayerIDs) {
      fingerAngles[id] = this.fingerAngle(animation, side, phase, id, gripKind)
      fingerOffsets[id] = {
        along: this.fingerOffset(animation, side, phase, id, "along", gripKind),
        across: this.fingerOffset(animation, side, phase, id, "across", gripKind),
      }
    }
    return {
      gripRotation: this.gripRotation(animation, side, phase, gripKind),
      knuckleAxis: this.knuckleAxis(animation, side, phase, gripKind),
      fingerAngles,
      fingerOffsets,
    }
  }

  // -------------------------------------------------------------------------
  // Bones
  // -------------------------------------------------------------------------

  private boneChannel(name: string, bone: string, phase: number, field: BonePoseKey): number {
    const keys: readonly BoneKey[] = this.bone[name]?.[bone] ?? []
    const cycles = isLoopingTrack(name) && !(phase >= 0.999999 && this.hasEndKey(name))
    return interpolate(
      keys,
      phase,
      (key) => (Number.isFinite(key[field]) ? (key[field] ?? 0) : 0),
      cycles,
    )
  }

  /** Sample additive editor-authored corrections for every keyed bone. */
  bonePose(name: string, phase: number): Pose {
    phase = this.playbackPhase(name, phase)
    const pose: Pose = {}
    for (const bone of Object.keys(this.bone[name] ?? {})) {
      const delta: PoseDelta = {}
      for (const field of bonePoseKeys) {
        const value = this.boneChannel(name, bone, phase, field)
        if (Math.abs(value) >= 1e-8) delta[field] = value
      }
      if (Object.keys(delta).length) pose[bone] = delta
    }
    return pose
  }

  // -------------------------------------------------------------------------
  // The assembled pose
  // -------------------------------------------------------------------------

  private applyBoneKeys(name: string, phase: number, pose: Pose): Pose {
    const clip = this.bone[name]
    if (!clip || Object.keys(clip).length === 0) return pose
    return mergePoses(pose, this.bonePose(name, phase))
  }

  private applyClipOffsets(name: string, pose: Pose): Pose {
    const offsets = this.clipOffsets[name]
    if (!offsets) return pose
    for (const [bone, delta] of Object.entries(offsets)) {
      const current = pose[bone] ?? {}
      const corrected: PoseDelta = { ...current }
      for (const key of bonePoseKeys) {
        const value = delta[key]
        if (!Number.isFinite(value)) continue
        corrected[key] = (current[key] ?? 0) + (value ?? 0)
      }
      for (const key of ["scaleX", "scaleY"] as const) {
        const value = delta[key]
        if (!Number.isFinite(value)) continue
        corrected[key] = (current[key] ?? 1) * (value ?? 1)
      }
      pose[bone] = corrected
    }
    return pose
  }

  private applyWristKeys(name: string, phase: number, pose: Pose): Pose {
    for (const side of sides) {
      const angle = this.wristAngle(name, side, phase)
      if (Math.abs(angle) < 1e-8) continue
      const bone = `hand${side}`
      pose[bone] = { ...(pose[bone] ?? {}), rotation: (pose[bone]?.rotation ?? 0) + angle }
    }
    return pose
  }

  /**
   * The complete pose for a clip at a phase: the authored procedural motion,
   * grounded, welded at the neck, then corrected by everything the scene keys.
   */
  pose(name: string, phase: number): Pose {
    phase = this.playbackPhase(name, phase)
    const grounded = groundStationaryPose(name, authoredPose(name, phase))
    const corrected = this.applyWristKeys(
      name,
      phase,
      this.applyBoneKeys(name, phase, this.applyClipOffsets(name, weldHeadToNeck(grounded))),
    )
    return applyKneeConstraints(corrected)
  }
}

function applyKneeConstraints(pose: Pose): Pose {
  for (const side of sides) {
    const bone = `lowerLeg${side}`
    const rotation = pose[bone]?.rotation
    if (rotation === undefined) continue
    pose[bone] = { ...pose[bone], rotation: constrainKneeRotation(side, rotation) }
  }
  return pose
}

/** Tracks with nothing authored: the bare procedural clip library. */
export const emptyTracks = new RigTracks()
