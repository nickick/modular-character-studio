/**
 * The closed-hand grip stack: palm, haft, four rigid fingers, and a thumb.
 *
 * Finger roots are authored in the held item's shaft space, so a translated or
 * rotated sword, staff, or spear carries the whole stack with it without
 * deforming any finger. Nothing here samples an animation track; the sampled
 * values arrive as `GripControls` from the scene's `RigTracks`.
 */
import type { Point, ResolvedLayer } from "./types.ts"

/** Placement of one finger root, in the held item's shaft space. */
export interface FingerRoot {
  along: number
  across: number
}

/** Every authored hand channel, sampled at one moment. */
export interface GripControls {
  /** Rigid rotation shared by the held item and its finger attachments. */
  gripRotation: number
  /** Rotation of the four roots around their shared centre. */
  knuckleAxis: number
  /** Additive angle per finger layer, over its authored resting angle. */
  fingerAngles: Record<string, number>
  /** Additive shaft-space placement per finger layer. */
  fingerOffsets: Record<string, Partial<FingerRoot>>
}

/**
 * What a finger is seated against. Equipment PNGs use full-artboard
 * registration, so this is often the palm's origin carrying the held item's
 * rotation rather than the held layer itself.
 */
export interface GripAnchor {
  x?: number
  y?: number
  rotation?: number
}

/**
 * Seat one rigid finger on a held item's haft.
 *
 * `along` and `across` are authored in shaft space, so changing equipment or
 * rotating the grip carries every finger root with the haft. The finger art is
 * never warped: only its root position and rigid angle change.
 */
export function gripFingerLayer(
  layer: ResolvedLayer,
  gripLayer: GripAnchor | null | undefined,
  gripRotation = 0,
  fingerRotation = 0,
  fingerOffset: Partial<FingerRoot> = {},
): ResolvedLayer {
  if (!layer.gripFinger || !gripLayer) return layer
  const shaftRotation = (gripLayer.rotation ?? 0) + gripRotation
  const radians = (shaftRotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const along = (layer.gripFinger.along ?? 0) + (fingerOffset.along ?? 0)
  const across = (layer.gripFinger.across ?? 0) + (fingerOffset.across ?? 0)
  return {
    ...layer,
    x: (gripLayer.x ?? 0) + cosine * along - sine * across,
    y: (gripLayer.y ?? 0) + sine * along + cosine * across,
    rotation: shaftRotation + (layer.gripFinger.angleOffset ?? 0) + fingerRotation,
    pivotX: layer.gripFinger.basePivot?.x ?? layer.pivotX,
    pivotY: layer.gripFinger.basePivot?.y ?? layer.pivotY,
  }
}

/**
 * Assemble the animation-specific finger roots, then rotate that complete
 * four-finger layout around its shared centre.
 *
 * Along/across keys are part of the authored knuckle layout. Applying them
 * after this rotation makes the fingers drift off their shared axis whenever
 * both channels are animated.
 */
export function gripFingerAxisLayer(
  layer: ResolvedLayer,
  fingerLayers: readonly ResolvedLayer[],
  rotation = 0,
  fingerOffsets: Record<string, Partial<FingerRoot>> = {},
): ResolvedLayer {
  const gripFinger = layer.gripFinger
  if (!gripFinger) return layer
  const fingers = fingerLayers.filter((candidate) => candidate.gripFinger)
  const root = (candidate: ResolvedLayer): FingerRoot => ({
    along: (candidate.gripFinger?.along ?? 0) + (fingerOffsets[candidate.id]?.along ?? 0),
    across: (candidate.gripFinger?.across ?? 0) + (fingerOffsets[candidate.id]?.across ?? 0),
  })
  const current = root(layer)
  if (fingers.length < 2 || Math.abs(rotation) < 1e-8) {
    return { ...layer, gripFinger: { ...gripFinger, ...current } }
  }
  const roots = fingers.map(root)
  const centerAlong = roots.reduce((sum, point) => sum + point.along, 0) / roots.length
  const centerAcross = roots.reduce((sum, point) => sum + point.across, 0) / roots.length
  const radians = (rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const along = current.along - centerAlong
  const across = current.across - centerAcross
  return {
    ...layer,
    gripFinger: {
      ...gripFinger,
      along: centerAlong + cosine * along - sine * across,
      across: centerAcross + sine * along + cosine * across,
    },
  }
}

/**
 * Rotate a registered attachment around an anatomical point in its bone's
 * local space. Full-artboard equipment often has an image pivot far away from
 * the painted grip, so merely adding to `layer.rotation` makes the visible
 * haft orbit away from the hand.
 */
export function rotateLayerAroundPoint(
  layer: ResolvedLayer,
  rotation = 0,
  point: Point | null = null,
): ResolvedLayer {
  if (!point || Math.abs(rotation) < 1e-8) return layer
  const radians = (rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const dx = layer.x - point.x
  const dy = layer.y - point.y
  return {
    ...layer,
    x: point.x + cosine * dx - sine * dy,
    y: point.y + sine * dx + cosine * dy,
    rotation: layer.rotation + rotation,
  }
}

/** Assemble one layer of the palm / haft / fingers / thumb grip stack. */
export function posedGripAttachment(
  layer: ResolvedLayer,
  layers: readonly ResolvedLayer[],
  heldLayer: ResolvedLayer | null | undefined,
  controls: Partial<GripControls> = {},
): ResolvedLayer {
  const palmLayer = layers.find((candidate) => candidate.id === "handClosedL")
  if (layer.gripFinger) {
    // Equipment PNGs use full-artboard registration, so their x/y identifies
    // the image pivot rather than the anatomical grip. Seat finger roots on
    // the palm's hand-local origin while inheriting the held item's shaft
    // rotation. Otherwise changing staff artwork can throw all four fingers
    // hundreds of pixels away from the visible hand.
    const gripAnchor: GripAnchor | null | undefined = palmLayer
      ? { rotation: heldLayer?.rotation, x: palmLayer.x, y: palmLayer.y }
      : heldLayer
    const axisLayer = gripFingerAxisLayer(
      layer,
      layers,
      controls.knuckleAxis ?? 0,
      controls.fingerOffsets,
    )
    return gripFingerLayer(
      axisLayer,
      gripAnchor,
      controls.gripRotation ?? 0,
      controls.fingerAngles?.[layer.id] ?? 0,
    )
  }
  if (layer.id !== heldLayer?.id || !controls.gripRotation) return layer
  // Staff/spear art uses full-canvas registration, whose pivot is commonly
  // hundreds of source pixels away from the hand. Rotate its existing fitted
  // placement around the palm socket so the painted shaft and composed fingers
  // cannot separate between grip-rotation keys. Sword pivots are already on
  // their handles, so retain their established placement behavior.
  if (layer.id === "staff" && palmLayer) {
    return rotateLayerAroundPoint(layer, controls.gripRotation, palmLayer)
  }
  return { ...layer, rotation: layer.rotation + controls.gripRotation }
}
