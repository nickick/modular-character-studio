/**
 * Editing a two-bone joint cage.
 *
 * The same two-rail contract bends a hand between forearm and palm or a boot
 * between lower leg and foot. Everything beyond the child handle is rigidly
 * carried by the child bone, which is why the two handles are the whole
 * interface rather than a vertex-by-vertex mesh.
 */
import type { Point, ResolvedLayer, RigScene, Side, WeightedStripMeshV2 } from "../rig/types.ts"
import type { SpriteFrame } from "./sprite-frame.ts"

/** Which of the two handles a drag is moving. */
export type MeshHandle = "bendStart" | "bendEnd"

/** How near the pointer must come to a handle to grab it. */
export const MESH_HANDLE_GRAB_RADIUS = 18

/**
 * The bend axis cannot collapse: a zero-length axis has no direction to blend
 * along, and the mesh builder rejects it outright.
 */
export const MIN_BEND_AXIS = 0.05

/** The handle under the pointer, or null. */
export function hitMeshHandle(
  mesh: WeightedStripMeshV2,
  frame: SpriteFrame,
  point: Point,
): MeshHandle | null {
  const handles: Array<{ name: MeshHandle; at: Point }> = [
    { name: "bendStart", at: frame.point(mesh.bendStart) },
    { name: "bendEnd", at: frame.point(mesh.bendEnd) },
  ]
  const closest = handles
    .map((handle) => ({
      ...handle,
      distance: Math.hypot(point.x - handle.at.x, point.y - handle.at.y),
    }))
    .sort((left, right) => left.distance - right.distance)[0]
  return closest.distance <= MESH_HANDLE_GRAB_RADIUS ? closest.name : null
}

/**
 * Where a dragged handle should land, or null when the move would collapse the
 * bend axis and the handle should simply stay put.
 */
export function movedMeshHandle(
  mesh: WeightedStripMeshV2,
  handle: MeshHandle,
  next: Point,
): Point | null {
  const other = handle === "bendStart" ? mesh.bendEnd : mesh.bendStart
  if (Math.hypot(next.x - other.x, next.y - other.y) < MIN_BEND_AXIS) return null
  return { x: Number(next.x.toFixed(4)), y: Number(next.y.toFixed(4)) }
}

/** Bend sections the studio offers between the two handles. */
export const MIN_BEND_SECTIONS = 3
export const MAX_BEND_SECTIONS = 12

/**
 * Resample a normalized, strictly increasing sequence to a new length.
 *
 * Changing the section count keeps the shape of the existing distribution
 * rather than resetting to an even spread, so raising the density around an
 * already-tuned bend does not undo the tuning.
 */
export function resampleSequence(values: readonly number[], count: number): number[] {
  if (count === values.length) return [...values]
  if (count === 2) return [0, 1]
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return 0
    if (index === count - 1) return 1
    const position = (index * (values.length - 1)) / (count - 1)
    const low = Math.floor(position)
    const mix = position - low
    const next = values[Math.min(low + 1, values.length - 1)]
    return Number((values[low] + (next - values[low]) * mix).toFixed(4))
  })
}

export function setBendSections(mesh: WeightedStripMeshV2, count: number): boolean {
  const next = Math.max(MIN_BEND_SECTIONS, Math.min(MAX_BEND_SECTIONS, Math.round(count)))
  if (!Number.isFinite(next) || next === mesh.bendStops.length) return false
  mesh.bendStops = resampleSequence(mesh.bendStops, next)
  return true
}

/** The hand layer whose cage is being edited: the one on that side's hand bone. */
export function wristLayerFor(
  layers: readonly ResolvedLayer[],
  side: Side,
  matchesHandPose: (layer: ResolvedLayer) => boolean,
): ResolvedLayer | null {
  return (
    layers.find(
      (layer) => layer.mesh && layer.bone === `hand${side}` && matchesHandPose(layer),
    ) ?? null
  )
}

/** Mesh layers relevant to the current pose, including both swappable boots. */
export function editableJointLayers(
  layers: readonly ResolvedLayer[],
  matchesHandPose: (layer: ResolvedLayer) => boolean,
): ResolvedLayer[] {
  return layers.filter(
    (layer) => layer.mesh && (!layer.handState || matchesHandPose(layer)),
  )
}

/** That layer's record in the scene, which is where an edit has to land. */
export function sceneMeshFor(scene: RigScene, layerID: string): WeightedStripMeshV2 | null {
  return scene.layers.find((layer) => layer.id === layerID)?.mesh ?? null
}
