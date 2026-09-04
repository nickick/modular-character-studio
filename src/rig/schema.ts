/**
 * Validation for a Modular Character Studio scene.
 *
 * This is the gate every save passes through, so it is deliberately strict:
 * bounded numbers, relative-only asset paths, bones that must follow their
 * parents, and mesh/grip/cutout data only on the layers that can carry it.
 * It also normalizes — sorting keys by phase, promoting legacy grip channels
 * onto the shared per-held-class tracks, and sharing universal registrations
 * across both profiles — so what reaches disk is already canonical.
 */
import {
  array,
  entries,
  finite,
  isJsonObject,
  object,
  safeAsset,
  string,
  type JsonObject,
  type JsonValue,
} from "./json.ts"
import {
  gripKinds,
  profileIDs,
  type BezierNode,
  type BezierPathV1,
  type BoneBind,
  type BoneKey,
  type BoneKeyframes,
  type ByProfile,
  type ExpressionKey,
  type ExpressionKeyframes,
  type EyeExpression,
  type GripChannels,
  type GripFinger,
  type GripKind,
  type HandPoseID,
  type LayerBind,
  type MouthExpression,
  type Point,
  type ProfileReference,
  type Pose,
  type PoseDelta,
  type ProfileID,
  type RigScene,
  type SceneBone,
  type SceneLayer,
  type SceneOption,
  type Side,
  type WeightedStripMeshV2,
  type WristKey,
  type WristKeyframes,
} from "./types.ts"

const eyeExpressions = new Set<string>(["neutral", "blink", "wide", "focused", "wince"])
const mouthExpressions = new Set<string>([
  "neutral",
  "smile",
  "smirk",
  "shout",
  "surprised",
  "frown",
  "pain",
  "grit",
  "talk",
])
const armLayerIDs = ["upperArmArmorL", "forearmVambraceL", "upperArmArmorR", "forearmVambraceR"]
const bootLayerIDs = ["lowerLegL", "footL", "lowerLegR", "footR"]
const gripFingerIDs = ["handClosedLIndex", "handClosedLMiddle", "handClosedLRing", "handClosedLPinky"]
const gripFingerIDSet = new Set<string>(gripFingerIDs)
const sides: readonly Side[] = ["L", "R"]

const requiredEquipmentLayers = new Map<string, string>([
  ["quiver", "chest"],
  ["weapon", "handL"],
  ["staff", "handL"],
  ["shield", "handR"],
  ["bow", "handL"],
])

const universalHandAssetByID: Record<string, string> = {
  handOpenL: "Layers/ArmUnits/universalV1/handOpenL.png",
  handOpenR: "Layers/ArmUnits/universalV1/handOpenR.png",
  handClosedL: "Layers/ArmUnits/universalV1/handGripPalmBaseV2.png",
  handClosedLIndex: "Layers/ArmUnits/universalV1/handGripFingerTriangleV1.png",
  handClosedLMiddle: "Layers/ArmUnits/universalV1/handGripFingerTriangleV1.png",
  handClosedLRing: "Layers/ArmUnits/universalV1/handGripFingerTriangleV1.png",
  handClosedLPinky: "Layers/ArmUnits/universalV1/handGripFingerTriangleV1.png",
  handClosedLThumb: "Layers/ArmUnits/universalV1/handGripThumbFrontV2.png",
  handClosedR: "Layers/ArmUnits/universalV1/handClosedDorsalV3.png",
}

/**
 * Slots whose placement is one value for the whole cast rather than per body.
 *
 * The hands are universal art. Equipment is universal for a different reason:
 * it is pivoted on its own grip anchor and parented to a hand bone, so its
 * placement is expressed against the hand and nothing about it depends on how
 * tall or broad the body underneath is. Sharing the bind means the hilt only
 * has to be dialled in once -- tune it in either profile and the other follows
 * on the next load, instead of one body silently keeping the unplaced defaults.
 */
const universalBindLayerIDs = new Set<string>([
  ...Object.keys(universalHandAssetByID),
  "weapon",
  "staff",
  "shield",
  "bow",
])

// ---------------------------------------------------------------------------
// Binds and small shapes
// ---------------------------------------------------------------------------

function boneBind(value: JsonValue | undefined, label: string): BoneBind {
  const source = object(value, label)
  return {
    x: finite(source.x, `${label}.x`, -2000, 2000),
    y: finite(source.y, `${label}.y`, -2000, 2000),
    rotation: finite(source.rotation ?? 0, `${label}.rotation`, -180, 180),
    scaleX: finite(source.scaleX ?? 1, `${label}.scaleX`, 0.05, 8),
    scaleY: finite(source.scaleY ?? 1, `${label}.scaleY`, 0.05, 8),
  }
}

function layerBind(value: JsonValue | undefined, label: string): LayerBind {
  const source = object(value, label)
  const bind: LayerBind = {
    x: finite(source.x, `${label}.x`, -2000, 2000),
    y: finite(source.y, `${label}.y`, -2000, 2000),
    rotation: finite(source.rotation, `${label}.rotation`, -3600, 3600),
    scaleX: finite(source.scaleX, `${label}.scaleX`, -8, 8),
    scaleY: finite(source.scaleY, `${label}.scaleY`, -8, 8),
    pivotX: finite(source.pivotX, `${label}.pivotX`, -2, 2),
    pivotY: finite(source.pivotY, `${label}.pivotY`, -2, 2),
  }
  // Turning the attachment's plane away from camera. Optional: a layer painted
  // for a flat presentation simply leaves it out.
  if (source.planeYaw != null) {
    bind.planeYaw = finite(source.planeYaw, `${label}.planeYaw`, -80, 80)
  }
  if (Math.abs(bind.scaleX) < 0.01 || Math.abs(bind.scaleY) < 0.01) {
    throw new Error(`${label} scale cannot be zero`)
  }
  return bind
}

function normalizedSequence(value: JsonValue | undefined, label: string): number[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 16) {
    throw new Error(`${label} must contain 2 to 16 normalized values`)
  }
  const sequence = value.map((entry, index) => finite(entry, `${label}[${index}]`, 0, 1))
  if (sequence[0] !== 0 || sequence.at(-1) !== 1) {
    throw new Error(`${label} must begin at 0 and end at 1`)
  }
  for (let index = 1; index < sequence.length; index += 1) {
    if (sequence[index] <= sequence[index - 1]) {
      throw new Error(`${label} must be strictly increasing`)
    }
  }
  return sequence
}

function normalizedPoint(value: JsonValue | undefined, label: string): Point {
  if (!isJsonObject(value)) throw new Error(`${label} must be a normalized point`)
  return {
    x: finite(value.x, `${label}.x`, 0, 1),
    y: finite(value.y, `${label}.y`, 0, 1),
  }
}

function bezierControlPoint(value: JsonValue | undefined, label: string): Point | undefined {
  if (value == null) return undefined
  const source = object(value, `${label} must be a point`)
  return {
    // Handles may leave the image while an artist is shaping a tight curve.
    x: finite(source.x, `${label}.x`, -2, 3),
    y: finite(source.y, `${label}.y`, -2, 3),
  }
}

/** Per-profile values, required on every profile. */
function byProfile<T>(
  value: JsonValue | undefined,
  label: string,
  read: (entry: JsonValue | undefined, entryLabel: string) => T,
): ByProfile<T> {
  const source = isJsonObject(value) ? value : {}
  return {
    maleV1: read(source.maleV1, `${label}.maleV1`),
    femaleV1: read(source.femaleV1, `${label}.femaleV1`),
  }
}

/** Per-profile values where any subset may be present. */
function partialByProfile(
  value: JsonValue | undefined,
  label: string,
): ByProfile<LayerBind> | undefined {
  if (value == null) return undefined
  const source = object(value, label)
  const bind: Partial<ByProfile<LayerBind>> = {}
  for (const profile of profileIDs) {
    if (source[profile] == null) continue
    bind[profile] = layerBind(source[profile], `${label}.${profile}`)
  }
  return Object.keys(bind).length ? (bind as ByProfile<LayerBind>) : undefined
}

// ---------------------------------------------------------------------------
// Catalogue options
// ---------------------------------------------------------------------------

/** How an option names its art: one file per body, or one file per layer. */
type OptionArt =
  | { kind: "byProfile" }
  | { kind: "byLayer"; layerIDs: readonly string[] }

/**
 * Every catalogue entry validates the same way. Only how it names its art
 * differs: necklaces, chests, headgear, and each held slot carry one file per
 * body profile, while arm and boot sets name one file per layer they dress.
 */
function sceneOption(value: JsonValue | undefined, label: string, art: OptionArt): SceneOption {
  const source = object(value, label)
  const option: SceneOption = {
    id: string(source.id, `${label}.id`),
    label: string(source.label, `${label}.label`),
  }
  if (art.kind === "byProfile") {
    option.assetByProfile = byProfile(source.assetByProfile, `${label}.assetByProfile`, safeAsset)
  } else {
    const assetByLayer: Record<string, string> = {}
    for (const layerID of art.layerIDs) {
      const assets = isJsonObject(source.assetByLayer) ? source.assetByLayer : {}
      assetByLayer[layerID] = safeAsset(assets[layerID], `${label}.assetByLayer.${layerID}`)
    }
    option.assetByLayer = assetByLayer
  }

  const bind = partialByProfile(source.bindByProfile, `${label}.bindByProfile`)
  if (bind) option.bindByProfile = bind
  // A set dresses several layers at once -- four boot pieces, four arm pieces --
  // so its placement is per layer as well as per profile. Without this a boot
  // set shares the leg layers' binds with every other set, and tuning one pair
  // moves them all.
  if (source.bindByLayer != null) {
    const byLayerSource = object(source.bindByLayer, `${label}.bindByLayer`)
    const byLayer: Record<string, ByProfile<LayerBind>> = {}
    for (const [layerID, perProfile] of entries(byLayerSource)) {
      const resolved = partialByProfile(perProfile, `${label}.bindByLayer.${layerID}`)
      if (resolved) byLayer[layerID] = resolved
    }
    if (Object.keys(byLayer).length) option.bindByLayer = byLayer
  }

  /**
   * Where an option sits when no inventory item speaks for it. The bare arms
   * and the default tunic are looks rather than gear, but they still belong on
   * the ladder, so they can be filed by hand.
   */
  if (source.line != null) option.line = string(source.line, `${label}.line`)
  if (source.tier != null) option.tier = string(source.tier, `${label}.tier`)
  // Whether this piece has been fitted over the rig by hand. Placement alone
  // cannot say: a seeded default and a dialled-in fit look the same in the
  // data, so the person who did the fitting records it.
  if (source.fitted === true) option.fitted = true
  /**
   * The inventory item that grants this option, kept through validation. It is
   * what lets the rig dress itself from equipped gear, and rebuilding an option
   * without it silently unlinks the whole catalogue on the next save.
   */
  if (source.itemID != null) option.itemID = string(source.itemID, `${label}.itemID`)
  return option
}

/** Validate a catalogue and the scene key naming which of its entries is worn. */
function catalogue(
  source: JsonObject,
  key: string,
  activeKey: string,
  art: OptionArt,
  /** How the rejection message names one of this slot's entries. */
  noun = `a ${key} entry`,
): { options: SceneOption[]; active: string } {
  const raw = source[key]
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 64) {
    throw new Error(`${key} must contain 1 to 64 entries`)
  }
  const options = raw.map((option, index) => sceneOption(option, `${key}[${index}]`, art))
  const ids = new Set(options.map((option) => option.id))
  if (ids.size !== options.length) throw new Error(`${key} IDs must be unique`)
  const active = string(source[activeKey], activeKey)
  if (!ids.has(active)) throw new Error(`${activeKey} must reference ${noun}`)
  return { options, active }
}

// ---------------------------------------------------------------------------
// Layer extras
// ---------------------------------------------------------------------------

function fingerClipPath(
  value: JsonValue | undefined,
  label: string,
  layerID: string,
): BezierPathV1 | undefined {
  if (value == null) return undefined
  if (!isJsonObject(value) || !/^handClosedL(?:Index|Middle|Ring|Pinky)$/.test(layerID)) {
    throw new Error(`${label} is supported only on a closed left-hand finger attachment`)
  }
  if (value.type !== "bezierPathV1") throw new Error(`${label}.type must be bezierPathV1`)
  if (!Array.isArray(value.nodes) || value.nodes.length > 64) {
    throw new Error(`${label}.nodes must contain at most 64 anchors`)
  }
  const nodes: BezierNode[] = value.nodes.map((node, index) => {
    const anchor = normalizedPoint(node, `${label}.nodes[${index}]`)
    const source = isJsonObject(node) ? node : {}
    const incoming = bezierControlPoint(source.in, `${label}.nodes[${index}].in`)
    const outgoing = bezierControlPoint(source.out, `${label}.nodes[${index}].out`)
    return {
      ...anchor,
      ...(incoming ? { in: incoming } : {}),
      ...(outgoing ? { out: outgoing } : {}),
    }
  })
  const closed = Boolean(value.closed)
  if (closed && nodes.length < 3) {
    throw new Error(`${label} needs at least 3 anchors before it can close`)
  }
  return { type: "bezierPathV1", closed, nodes }
}

function weightedMesh(
  value: JsonValue | undefined,
  label: string,
  layer: { id: string; bone: string },
  boneIDs: ReadonlySet<string>,
  parentByBone: ReadonlyMap<string, string | null>,
): WeightedStripMeshV2 | undefined {
  if (value == null) return undefined
  if (!isJsonObject(value) || value.type !== "weightedStripV2") {
    throw new Error(`${label}.type must be weightedStripV2`)
  }
  if (!/^hand(?:Open|Closed)[LR]$/.test(layer.id)) {
    throw new Error(`${label} is currently supported only on universal hand layers`)
  }
  const parentBone = string(value.parentBone, `${label}.parentBone`)
  const childBone = string(value.childBone, `${label}.childBone`)
  if (!boneIDs.has(parentBone) || !boneIDs.has(childBone)) {
    throw new Error(`${label} references an unknown bone`)
  }
  if (childBone !== layer.bone || parentByBone.get(childBone) !== parentBone) {
    throw new Error(`${label} must bind the hand layer to its direct forearm parent`)
  }
  const bendStart = normalizedPoint(value.bendStart, `${label}.bendStart`)
  const bendEnd = normalizedPoint(value.bendEnd, `${label}.bendEnd`)
  if (Math.hypot(bendEnd.x - bendStart.x, bendEnd.y - bendStart.y) < 0.05) {
    throw new Error(`${label} bend axis is too short`)
  }
  return {
    type: "weightedStripV2",
    parentBone,
    childBone,
    bendStops: normalizedSequence(value.bendStops, `${label}.bendStops`),
    bendStart,
    bendEnd,
  }
}

function gripFinger(
  value: JsonValue | undefined,
  label: string,
  layerID: string,
): GripFinger | undefined {
  if (value == null) return undefined
  if (!isJsonObject(value) || !gripFingerIDSet.has(layerID)) {
    throw new Error(`${label} is supported only on a closed left-hand grip attachment`)
  }
  return {
    along: finite(value.along, `${label}.along`, -200, 200),
    across: finite(value.across, `${label}.across`, -200, 200),
    angleOffset: finite(value.angleOffset, `${label}.angleOffset`, -180, 180),
    basePivot: normalizedPoint(value.basePivot, `${label}.basePivot`),
  }
}

function fitBones(
  value: JsonValue | undefined,
  label: string,
  boneIDs: ReadonlySet<string>,
  self: string | null,
): string[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    throw new Error(`${label} fitBones must contain 2 to 4 bones`)
  }
  const bones = value.map((boneID) => string(boneID, `${label}.fitBones`))
  if (
    new Set(bones).size !== bones.length ||
    bones.some((boneID) => boneID === self || !boneIDs.has(boneID))
  ) {
    throw new Error(`${label} fitBones must reference distinct known bones`)
  }
  return bones
}

// ---------------------------------------------------------------------------
// Keyframe tracks
// ---------------------------------------------------------------------------

/** Sort by phase and reject keys that land on top of one another. */
function sortedByPhase<K extends { phase: number }>(keys: K[], label: string): K[] {
  const sorted = [...keys].sort((left, right) => left.phase - right.phase)
  for (let index = 1; index < sorted.length; index += 1) {
    if (Math.abs(sorted[index].phase - sorted[index - 1].phase) < 0.0005) {
      throw new Error(`${label} cannot contain duplicate phases`)
    }
  }
  return sorted
}

function poseDelta(value: JsonValue | undefined, label: string): PoseDelta {
  const source = isJsonObject(value) ? value : {}
  const delta: PoseDelta = {}
  for (const key of ["x", "y", "rotation"] as const) {
    if (source[key] == null) continue
    delta[key] = finite(source[key], `${label}.${key}`, -2000, 2000)
  }
  return delta
}

function clipPoseOffsets(
  value: JsonValue | undefined,
  boneIDs: ReadonlySet<string>,
): Record<string, Pose> | undefined {
  if (value == null) return undefined
  const source = object(value, "clipPoseOffsets")
  const corrections: Record<string, Pose> = {}
  for (const [clip, bones] of entries(source)) {
    const perBone: Pose = {}
    for (const [bone, delta] of entries(isJsonObject(bones) ? bones : {})) {
      if (!boneIDs.has(bone)) {
        throw new Error(`clipPoseOffsets.${clip} references unknown bone ${bone}`)
      }
      const corrected = poseDelta(delta, `clipPoseOffsets.${clip}.${bone}`)
      if (Object.keys(corrected).length) perBone[bone] = corrected
    }
    if (Object.keys(perBone).length) corrections[clip] = perBone
  }
  return corrections
}

function boneKeyframes(
  value: JsonValue | undefined,
  boneIDs: ReadonlySet<string>,
): BoneKeyframes | undefined {
  if (value == null) return undefined
  const source = object(value, "boneKeyframes")
  const clips: BoneKeyframes = {}
  for (const [clip, bones] of entries(source)) {
    const perBone: Record<string, BoneKey[]> = {}
    for (const [bone, sourceKeys] of entries(object(bones, `boneKeyframes.${clip}`))) {
      if (!boneIDs.has(bone)) {
        throw new Error(`boneKeyframes.${clip} references unknown bone ${bone}`)
      }
      const label = `boneKeyframes.${clip}.${bone}`
      if (!Array.isArray(sourceKeys) || sourceKeys.length > 256) {
        throw new Error(`${label} must contain at most 256 keys`)
      }
      const keys = sourceKeys.map((key, index): BoneKey => {
        const entry = isJsonObject(key) ? key : {}
        return {
          phase: finite(entry.phase, `${label}[${index}].phase`, 0, 1),
          ...poseDelta(key, `${label}[${index}]`),
        }
      })
      if (keys.length) perBone[bone] = sortedByPhase(keys, label)
    }
    if (Object.keys(perBone).length) clips[clip] = perBone
  }
  return clips
}

function expressionKeyframes(value: JsonValue | undefined): ExpressionKeyframes | undefined {
  if (value == null) return undefined
  const source = object(value, "expressionKeyframes")
  const clips: ExpressionKeyframes = {}
  for (const [clip, sourceKeys] of entries(source)) {
    const label = `expressionKeyframes.${clip}`
    if (!Array.isArray(sourceKeys) || sourceKeys.length > 128) {
      throw new Error(`${label} must contain at most 128 keys`)
    }
    const keys = sourceKeys.map((key, index): ExpressionKey => {
      const entry = isJsonObject(key) ? key : {}
      const phase = finite(entry.phase, `${label}[${index}].phase`, 0, 1)
      const eyes = string(entry.eyes, `${label}[${index}].eyes`)
      const mouth = string(entry.mouth, `${label}[${index}].mouth`)
      if (!eyeExpressions.has(eyes)) {
        throw new Error(`${label}[${index}].eyes has unsupported expression ${eyes}`)
      }
      if (!mouthExpressions.has(mouth)) {
        throw new Error(`${label}[${index}].mouth has unsupported expression ${mouth}`)
      }
      return { phase, eyes: eyes as EyeExpression, mouth: mouth as MouthExpression }
    })
    if (keys.length) clips[clip] = sortedByPhase(keys, label)
  }
  return clips
}

function gripChannels(value: JsonValue | undefined, label: string): GripChannels {
  const source = isJsonObject(value) ? value : {}
  const grip: GripChannels = {}
  if (source.gripRotation != null) {
    grip.gripRotation = finite(source.gripRotation, `${label}.gripRotation`, -45, 45)
  }
  if (source.knuckleAxis != null) {
    grip.knuckleAxis = finite(source.knuckleAxis, `${label}.knuckleAxis`, -90, 90)
  }
  if (source.fingerAngles != null) {
    const angles = object(source.fingerAngles, `${label}.fingerAngles`)
    const unknown = Object.keys(angles).find((id) => !gripFingerIDSet.has(id))
    if (unknown) throw new Error(`${label}.fingerAngles contains unsupported finger ${unknown}`)
    const resolved: Record<string, number> = {}
    for (const [id, angle] of entries(angles)) {
      resolved[id] = finite(angle, `${label}.fingerAngles.${id}`, -180, 180)
    }
    grip.fingerAngles = resolved
  }
  if (source.fingerOffsets != null) {
    const offsets = object(source.fingerOffsets, `${label}.fingerOffsets`)
    const unknown = Object.keys(offsets).find((id) => !gripFingerIDSet.has(id))
    if (unknown) throw new Error(`${label}.fingerOffsets contains unsupported finger ${unknown}`)
    const resolved: Record<string, { along?: number; across?: number }> = {}
    for (const [id, offset] of entries(offsets)) {
      const axes = object(offset, `${label}.fingerOffsets.${id}`)
      const unknownAxis = Object.keys(axes).find((axis) => axis !== "along" && axis !== "across")
      if (unknownAxis) {
        throw new Error(`${label}.fingerOffsets.${id} contains unsupported axis ${unknownAxis}`)
      }
      const placement: { along?: number; across?: number } = {}
      for (const axis of ["along", "across"] as const) {
        if (axes[axis] == null) continue
        placement[axis] = finite(axes[axis], `${label}.fingerOffsets.${id}.${axis}`, -160, 160)
      }
      resolved[id] = placement
    }
    grip.fingerOffsets = resolved
  }
  return grip
}

function wristKey(value: JsonValue | undefined, label: string): WristKey {
  const source = isJsonObject(value) ? value : {}
  const key: WristKey = {
    phase: finite(source.phase, `${label}.phase`, 0, 1),
    angle: finite(source.angle, `${label}.angle`, -85, 85),
    ...gripChannels(source, label),
  }
  if (source.grips != null) {
    const grips = object(source.grips, `${label}.grips`)
    const unknown = Object.keys(grips).find((kind) => !(gripKinds as readonly string[]).includes(kind))
    if (unknown) throw new Error(`${label}.grips contains unsupported held class ${unknown}`)
    const resolved: Partial<Record<GripKind, GripChannels>> = {}
    for (const kind of gripKinds) {
      if (grips[kind] == null) continue
      resolved[kind] = gripChannels(object(grips[kind], `${label}.grips.${kind}`), `${label}.grips.${kind}`)
    }
    key.grips = resolved
  }
  return key
}

const GRIP_FIELDS = ["gripRotation", "knuckleAxis", "fingerAngles", "fingerOffsets"] as const

const hasGripChannels = (value: GripChannels | undefined): boolean =>
  value != null && GRIP_FIELDS.some((field) => value[field] != null)

const sharedTrack = (kind: GripKind): string => `__grip_${kind}`

const naturalKind = (clip: string): GripKind =>
  clip.startsWith("bow") ? "bow" : clip.startsWith("staff") ? "staff" : "weapon"

const preferredClip: Record<GripKind, string> = {
  weapon: "swordSwing",
  staff: "staffIdle",
  bow: "bowDraw",
}

/**
 * Older scenes stored grip channels beside each animation's wrist angle.
 * Promote one authoritative curve per held class so every staff motion, every
 * bow motion, and every ordinary weapon motion reads the same grip.
 */
function promoteSharedGripTracks(clips: WristKeyframes): void {
  for (const kind of gripKinds) {
    if (clips[sharedTrack(kind)]?.L?.length) continue
    let source: WristKey[] | null = null
    for (const [clip, perSide] of Object.entries(clips)) {
      if (clip.startsWith("__grip_")) continue
      const scoped = (perSide.L ?? []).filter((key) => hasGripChannels(key.grips?.[kind]))
      if (scoped.length) {
        source = scoped.map((key) => ({ phase: key.phase, angle: 0, ...key.grips?.[kind] }))
        break
      }
    }
    if (!source) {
      const candidates = [
        preferredClip[kind],
        ...Object.keys(clips).filter((clip) => naturalKind(clip) === kind),
      ]
      const clip = candidates.find(
        (name, index) =>
          candidates.indexOf(name) === index && (clips[name]?.L ?? []).some(hasGripChannels),
      )
      const found = clip ? (clips[clip]?.L ?? []) : []
      if (found.length) {
        source = found
          .filter(hasGripChannels)
          .map((key) => {
            const promoted: WristKey = { phase: key.phase, angle: 0 }
            for (const field of GRIP_FIELDS) {
              if (key[field] == null) continue
              Object.assign(promoted, { [field]: key[field] })
            }
            return promoted
          })
      }
    }
    if (source?.length) clips[sharedTrack(kind)] = { L: source }
  }
}

function wristKeyframes(value: JsonValue | undefined): WristKeyframes | undefined {
  if (value == null) return undefined
  const source = object(value, "wristKeyframes")
  const clips: WristKeyframes = {}
  for (const [clip, perSideSource] of entries(source)) {
    const sideSource = object(perSideSource, `wristKeyframes.${clip}`)
    const unknownSide = Object.keys(sideSource).find((side) => side !== "L" && side !== "R")
    if (unknownSide) {
      throw new Error(`wristKeyframes.${clip} contains unsupported side ${unknownSide}`)
    }
    const perSide: Partial<Record<Side, WristKey[]>> = {}
    for (const side of sides) {
      const raw = sideSource[side]
      if (raw == null) continue
      const label = `wristKeyframes.${clip}.${side}`
      if (!Array.isArray(raw) || raw.length > 64) {
        throw new Error(`${label} must contain at most 64 keys`)
      }
      const keys = raw.map((key, index) => wristKey(key, `${label}[${index}]`))
      if (keys.length) perSide[side] = sortedByPhase(keys, label)
    }
    if (Object.keys(perSide).length) clips[clip] = perSide
  }
  promoteSharedGripTracks(clips)
  return clips
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/**
 * Share the universal registrations across both profiles, using the active
 * profile's edited values, so a stale browser scene cannot restore the old
 * gender-specific hand assets or offsets.
 */
function normalizeUniversalSlots(scene: RigScene): RigScene {
  for (const layer of scene.layers) {
    const asset = universalHandAssetByID[layer.id]
    if (asset) layer.assetByProfile = { maleV1: asset, femaleV1: asset }
    if (!universalBindLayerIDs.has(layer.id)) continue
    const sharedBind = layer.bindByProfile[scene.activeProfile]
    layer.bindByProfile = {
      maleV1: structuredClone(sharedBind),
      femaleV1: structuredClone(sharedBind),
    }
  }
  return scene
}

/** A flat map of measurements, as the builder records its pixel targets. */
function numberMap(value: JsonValue | undefined, label: string): Record<string, number> {
  const source = object(value, label)
  const measurements: Record<string, number> = {}
  for (const [key, measurement] of entries(source)) {
    measurements[key] = finite(measurement, `${label}.${key}`, -100000, 100000)
  }
  return measurements
}

function readProfileReference(value: JsonValue | undefined): ProfileReference {
  const source = object(value, "profileReference")
  const reference: ProfileReference = {
    originalLandmarks: string(source.originalLandmarks, "profileReference.originalLandmarks"),
    sizingRule: string(source.sizingRule, "profileReference.sizingRule"),
  }
  if (source.torsoRatioRule != null) {
    reference.torsoRatioRule = string(source.torsoRatioRule, "profileReference.torsoRatioRule")
  }
  if (source.tunicRegionsByProfile != null) {
    reference.tunicRegionsByProfile = byProfile(
      source.tunicRegionsByProfile,
      "profileReference.tunicRegionsByProfile",
      numberMap,
    )
  }
  if (source.canonicalTargetPixels != null) {
    reference.canonicalTargetPixels = numberMap(
      source.canonicalTargetPixels,
      "profileReference.canonicalTargetPixels",
    )
  }
  return reference
}

function isProfileID(value: JsonValue | undefined): value is ProfileID {
  return value === "maleV1" || value === "femaleV1"
}

export function validateModularCharacterScene(value: JsonValue): RigScene {
  if (!isJsonObject(value) || value.format !== "modular-character-studio-scene-v1") {
    throw new Error("Unsupported Modular Character Studio scene format")
  }
  const canvas = isJsonObject(value.canvas) ? value.canvas : {}
  if (canvas.width !== 1254 || canvas.height !== 1254) {
    throw new Error("Editor canvas must be 1254 x 1254")
  }
  if (!isProfileID(value.activeProfile)) throw new Error("Unknown active profile")
  const activeProfile = value.activeProfile

  const chest = catalogue(value, "chestOptions", "activeChest", { kind: "byProfile" }, "a chest option")
  const arms = catalogue(
    value, "armOptions", "activeArmSet", { kind: "byLayer", layerIDs: armLayerIDs }, "an arm option",
  )
  const boots = catalogue(
    value, "bootOptions", "activeBootSet", { kind: "byLayer", layerIDs: bootLayerIDs }, "a boot option",
  )
  const headgear = catalogue(
    value, "headgearOptions", "activeHeadgear", { kind: "byProfile" }, "a headgear option",
  )

  // Single-layer equipment: held items, the rear quiver, and the necklace all
  // use one option shape. Each item may carry art and an independent placement.
  const singleLayerSlots = [
    ["weaponOptions", "activeWeapon"],
    ["staffOptions", "activeStaff"],
    ["bowOptions", "activeBow"],
    ["shieldOptions", "activeShield"],
    ["ringOptions", "activeRing"],
    ["quiverOptions", "activeQuiver"],
    ["necklaceOptions", "activeNecklace"],
  ] as const
  const optional: Partial<RigScene> = {}
  for (const [key, activeKey] of singleLayerSlots) {
    // A scene that never declares a slot must round-trip without gaining it.
    if (value[key] == null) continue
    const noun = key === "necklaceOptions" ? "a necklace option" : `a ${key} entry`
    const resolved = catalogue(value, key, activeKey, { kind: "byProfile" }, noun)
    optional[key] = resolved.options
    optional[activeKey] = resolved.active
  }

  const referenceByProfile = byProfile(value.referenceByProfile, "referenceByProfile", safeAsset)

  // Bones, in declaration order: a bone may only reference bones above it.
  const rawBones = array(value.bones, "bones")
  if (rawBones.length < 3 || rawBones.length > 64) {
    throw new Error("bones must contain 3 to 64 entries")
  }
  const boneIDs = new Set<string>()
  const parentByBone = new Map<string, string | null>()
  const bones: SceneBone[] = rawBones.map((entry, index) => {
    const source = object(entry, `bones[${index}]`)
    const id = string(source.id, `bones[${index}].id`)
    if (boneIDs.has(id)) throw new Error(`Duplicate bone ${id}`)
    const parent = source.parent == null ? null : string(source.parent, `bones[${index}].parent`)
    if (parent !== null && !boneIDs.has(parent)) {
      throw new Error(`Bone ${id} must follow its parent`)
    }
    boneIDs.add(id)
    parentByBone.set(id, parent)
    const bone: SceneBone = {
      id,
      label: string(source.label, `bones[${index}].label`),
      parent,
      // Every profile carries its own bind offsets over the shared skeleton,
      // per the modular character contract.
      bindByProfile: byProfile(source.bindByProfile, `bones[${index}].bindByProfile`, boneBind),
    }
    // A fitted bone is seated by the same best-fit transform as a fitted layer,
    // so it can only reference bones already solved above it.
    const fitted = fitBones(source.fitBones, `Bone ${id}`, boneIDs, id)
    if (fitted) bone.fitBones = fitted
    return bone
  })

  const rawLayers = array(value.layers, "layers")
  if (rawLayers.length < 1 || rawLayers.length > 128) {
    throw new Error("layers must contain 1 to 128 entries")
  }
  const layerIDs = new Set<string>()
  const layers: SceneLayer[] = rawLayers.map((entry, index) => {
    const source = object(entry, `layers[${index}]`)
    const id = string(source.id, `layers[${index}].id`)
    if (layerIDs.has(id)) throw new Error(`Duplicate layer ${id}`)
    layerIDs.add(id)
    const bone = string(source.bone, `layers[${index}].bone`)
    if (!boneIDs.has(bone)) throw new Error(`Layer ${id} references unknown bone ${bone}`)
    const layer: SceneLayer = {
      id,
      group: string(source.group, `layers[${index}].group`),
      bone,
      assetByProfile: byProfile(source.assetByProfile, `layers[${index}].assetByProfile`, safeAsset),
      bindByProfile: byProfile(source.bindByProfile, `layers[${index}].bindByProfile`, layerBind),
      drawOrder: finite(source.drawOrder, `layers[${index}].drawOrder`, -1000, 1000),
      visible: Boolean(source.visible),
    }
    const mesh = weightedMesh(source.mesh, `layers[${index}].mesh`, layer, boneIDs, parentByBone)
    if (mesh) layer.mesh = mesh
    const finger = gripFinger(source.gripFinger, `layers[${index}].gripFinger`, id)
    if (finger) layer.gripFinger = finger
    const clipPath = fingerClipPath(source.clipPath, `layers[${index}].clipPath`, id)
    if (clipPath) layer.clipPath = clipPath
    if (source.handState != null) {
      if (source.handState !== "open" && source.handState !== "closed") {
        throw new Error(`Unsupported hand state ${String(source.handState)}`)
      }
      layer.handState = source.handState satisfies HandPoseID
    }
    const fitted = fitBones(source.fitBones, `Layer ${id}`, boneIDs, null)
    if (fitted) layer.fitBones = fitted
    return layer
  })

  for (const [layerID, boneID] of requiredEquipmentLayers) {
    const layer = layers.find((candidate) => candidate.id === layerID)
    if (!layer) {
      throw new Error(
        `Scene is missing required equipment layer ${layerID}; reload the editor before saving`,
      )
    }
    if (layer.group !== "Equipment" || layer.bone !== boneID) {
      throw new Error(`Required equipment layer ${layerID} must be in Equipment on ${boneID}`)
    }
  }

  const profileReference = readProfileReference(value.profileReference)
  const scene: RigScene = {
    format: "modular-character-studio-scene-v1",
    canvas: { width: 1254, height: 1254 },
    activeProfile,
    profileReference,
    referenceByProfile,
    bones,
    layers,
    chestOptions: chest.options,
    activeChest: chest.active,
    armOptions: arms.options,
    activeArmSet: arms.active,
    bootOptions: boots.options,
    activeBootSet: boots.active,
    headgearOptions: headgear.options,
    activeHeadgear: headgear.active,
    ...optional,
    boneKeyframes: boneKeyframes(value.boneKeyframes, boneIDs) ?? {},
    expressionKeyframes: expressionKeyframes(value.expressionKeyframes) ?? {},
    wristKeyframes: wristKeyframes(value.wristKeyframes) ?? {},
  }
  const offsets = clipPoseOffsets(value.clipPoseOffsets, boneIDs)
  if (offsets) scene.clipPoseOffsets = offsets
  return normalizeUniversalSlots(scene)
}

/** Compatibility alias for integrations built against the original internal name. */
export const validateThreeQuarterRigScene = validateModularCharacterScene
