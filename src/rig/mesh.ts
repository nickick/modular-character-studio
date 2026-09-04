/**
 * Attachment geometry: where a sprite sits in bone space, how a yawed plane is
 * sliced for affine renderers, and the small thickness-preserving cage that
 * bends the wrist.
 *
 * Only the four universal hand layers deform. Everything else on this rig is a
 * rigid sprite, so most of this file is about placing rigid art precisely.
 */
import { smoothstep01 } from "./angles.ts"
import { localMatrix, multiply, inverse, transformPoint, type MatrixTable } from "./matrix.ts"
import { matrixComponents, multiBoneRigidDelta } from "./fit.ts"
import type { Matrix2D, Point, ResolvedLayer, WeightedStripMeshV2 } from "./types.ts"

export const PLANE_STRIPS = 24
/** Camera distance, in multiples of the layer's own width. */
const PLANE_DISTANCE = 2.4

/** One vertical slice of a yawed sprite, in the layer's own local space. */
export interface PlaneStrip {
  sourceX: number
  sourceWidth: number
  x: number
  width: number
  y: number
  height: number
}

/**
 * Where a column of the layer lands once its plane is yawed, as a fraction of
 * the layer's width, plus how much that column foreshortens. Yaw is signed by
 * which side turns away: positive sends the screen-right corners back, negative
 * the screen-left ones. This rig draws the right arm over the torso, so
 * screen-left is its far side and a necklace wants a negative yaw.
 */
export function planeYawSample(u: number, yawDegrees: number): { u: number; scale: number } {
  if (!yawDegrees) return { u, scale: 1 }
  const yaw = (yawDegrees * Math.PI) / 180
  const offset = u - 0.5
  const depth = PLANE_DISTANCE + offset * Math.sin(yaw)
  const scale = PLANE_DISTANCE / depth
  return { u: 0.5 + offset * Math.cos(yaw) * scale, scale }
}

/**
 * The strips a yawed layer is drawn in: each names the slice of source image it
 * takes and where that slice lands, in the layer's own local space.
 *
 * The projection is sliced because every renderer here -- canvas, Pillow,
 * CoreGraphics -- can only draw an affine transform, and a yawed plane is
 * projective. Twenty-four strips is past the point where the seams show.
 */
export function planeStrips(
  layer: ResolvedLayer,
  imageWidth: number,
  imageHeight: number,
  strips: number = PLANE_STRIPS,
): PlaneStrip[] | null {
  const yaw = layer.planeYaw ?? 0
  if (!yaw) return null
  const pivotY = (layer.pivotY ?? 0.5) * imageHeight
  const out: PlaneStrip[] = []
  for (let index = 0; index < strips; index += 1) {
    const from = planeYawSample(index / strips, yaw)
    const to = planeYawSample((index + 1) / strips, yaw)
    const scale = (from.scale + to.scale) / 2
    out.push({
      sourceX: (index / strips) * imageWidth,
      sourceWidth: imageWidth / strips,
      x: from.u * imageWidth,
      width: Math.max(0.01, (to.u - from.u) * imageWidth),
      // Foreshortening shrinks a column about the row the layer hangs from.
      y: pivotY - pivotY * scale,
      height: imageHeight * scale,
    })
  }
  return out
}

/** The sprite's own placement, with its pivot moved to the origin. */
export function layerLocalMatrix(
  layer: ResolvedLayer,
  imageWidth: number,
  imageHeight: number,
): Matrix2D {
  const placement = localMatrix(layer.x, layer.y, layer.rotation, layer.scaleX, layer.scaleY)
  const pivot = localMatrix(-layer.pivotX * imageWidth, -layer.pivotY * imageHeight)
  return multiply(placement, pivot)
}

/**
 * Where a rigid sprite lands for a pose. A `fitBones` layer is seated by the
 * best-fit transform across those bones rather than by its own parent, which is
 * what keeps the torso's belt and skirt attached to the pelvis.
 */
export function rigidLayerMatrix(
  layer: ResolvedLayer,
  imageWidth: number,
  imageHeight: number,
  bindWorld: MatrixTable,
  currentWorld: MatrixTable,
): Matrix2D {
  const local = layerLocalMatrix(layer, imageWidth, imageHeight)
  if (!layer.fitBones) return multiply(currentWorld[layer.bone], local)
  const bindMatrix = multiply(bindWorld[layer.bone], local)
  return multiply(multiBoneRigidDelta(bindWorld, currentWorld, layer.fitBones), bindMatrix)
}

/** One station of the wrist cage, in the sprite's own pixel space. */
export interface MeshVertex {
  source: Point
  /** How far this station has blended from the forearm to the hand. */
  sectionWeight: number
}

/** Vertex indices of one drawn triangle. */
export type MeshTriangle = [number, number, number]

export interface MeshGeometry {
  vertices: MeshVertex[]
  triangles: MeshTriangle[]
  /** Normalized positions along the bend axis, one per cross-section. */
  stationValues: number[]
}

/** A deformed cage: the same topology, with each vertex moved into world space. */
export interface DeformedMesh extends MeshGeometry {
  points: Point[]
}

/**
 * Build a two-rail cage around the complete source image. `bendStops` only
 * subdivides the short wrist transition; rigid cap sections are added far
 * enough along the bend axis to cover every source-image corner. Two vertices
 * at each station share one transform, which lets deformation preserve the
 * distance between the dorsal and palm rails instead of narrowing the wrist.
 */
export function weightedStripMesh(
  mesh: WeightedStripMeshV2 | undefined,
  imageWidth: number,
  imageHeight: number,
): MeshGeometry | null {
  if (!mesh || mesh.type !== "weightedStripV2") return null
  const start: Point = { x: mesh.bendStart.x * imageWidth, y: mesh.bendStart.y * imageHeight }
  const end: Point = { x: mesh.bendEnd.x * imageWidth, y: mesh.bendEnd.y * imageHeight }
  const axis: Point = { x: end.x - start.x, y: end.y - start.y }
  const axisLengthSquared = axis.x * axis.x + axis.y * axis.y
  if (axisLengthSquared < 1e-8) throw new Error("Weighted strip bend axis cannot have zero length")
  const axisLength = Math.sqrt(axisLengthSquared)
  const normal: Point = { x: -axis.y / axisLength, y: axis.x / axisLength }
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: imageWidth, y: 0 },
    { x: imageWidth, y: imageHeight },
    { x: 0, y: imageHeight },
  ]
  const projection = (point: Point): number =>
    ((point.x - start.x) * axis.x + (point.y - start.y) * axis.y) / axisLengthSquared
  const lateral = (point: Point): number =>
    (point.x - start.x) * normal.x + (point.y - start.y) * normal.y
  const projections = corners.map(projection)
  const laterals = corners.map(lateral)
  const stationValues = [Math.min(...projections), ...mesh.bendStops, Math.max(...projections)]
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > 1e-6)
  const lateralMinimum = Math.min(...laterals)
  const lateralMaximum = Math.max(...laterals)

  const vertices: MeshVertex[] = []
  for (const station of stationValues) {
    const center: Point = { x: start.x + axis.x * station, y: start.y + axis.y * station }
    const sectionWeight = smoothstep01(station)
    for (const offset of [lateralMinimum, lateralMaximum]) {
      vertices.push({
        source: { x: center.x + normal.x * offset, y: center.y + normal.y * offset },
        sectionWeight,
      })
    }
  }
  const triangles: MeshTriangle[] = []
  for (let station = 0; station < stationValues.length - 1; station += 1) {
    const a = station * 2
    const b = a + 1
    const nextA = a + 2
    const nextB = a + 3
    // Alternating the diagonal avoids a permanent directional crease through a
    // bent wrist while keeping the topology deterministic.
    if (station % 2 === 0) triangles.push([a, nextA, nextB], [a, nextB, b])
    else triangles.push([a, nextA, b], [b, nextA, nextB])
  }
  return { vertices, triangles, stationValues }
}

/** Interpolate the child bone in parent space without linearly shrinking it. */
function thicknessPreservingSkinMatrix(
  mesh: WeightedStripMeshV2,
  weight: number,
  bindWorld: MatrixTable,
  currentWorld: MatrixTable,
): Matrix2D {
  const parent = mesh.parentBone
  const child = mesh.childBone
  const bindRelative = multiply(inverse(bindWorld[parent]), bindWorld[child])
  const currentRelative = multiply(inverse(currentWorld[parent]), currentWorld[child])
  const from = matrixComponents(bindRelative)
  const to = matrixComponents(currentRelative)
  const rotationDelta = ((to.rotation - from.rotation + 540) % 360) - 180
  const mix = (left: number, right: number): number => left + (right - left) * weight
  const partialChild = localMatrix(
    mix(from.x, to.x),
    mix(from.y, to.y),
    from.rotation + rotationDelta * weight,
    mix(from.scaleX, to.scaleX),
    mix(from.scaleY, to.scaleY),
  )
  return multiply(multiply(currentWorld[parent], partialChild), inverse(bindWorld[child]))
}

/** Carry a layer's bind-space cage through its two bone deltas. */
export function deformWeightedMesh(
  layer: ResolvedLayer,
  imageWidth: number,
  imageHeight: number,
  bindWorld: MatrixTable,
  currentWorld: MatrixTable,
): DeformedMesh | null {
  const mesh = layer.mesh
  const geometry = weightedStripMesh(mesh, imageWidth, imageHeight)
  if (!mesh || !geometry) return null
  const bindMatrix = multiply(bindWorld[layer.bone], layerLocalMatrix(layer, imageWidth, imageHeight))
  const points = geometry.vertices.map((vertex) => {
    const bindPoint = transformPoint(bindMatrix, vertex.source)
    return transformPoint(
      thicknessPreservingSkinMatrix(mesh, vertex.sectionWeight, bindWorld, currentWorld),
      bindPoint,
    )
  })
  return { ...geometry, points }
}

/** Affine map carrying one source triangle onto one destination triangle. */
export function triangleTransform(
  source: readonly [Point, Point, Point],
  destination: readonly [Point, Point, Point],
): Matrix2D | null {
  const [s0, s1, s2] = source
  const [d0, d1, d2] = destination
  const determinant =
    s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y)
  if (Math.abs(determinant) < 1e-8) return null
  return {
    a: (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / determinant,
    c: (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / determinant,
    e:
      (d0.x * (s1.x * s2.y - s2.x * s1.y) +
        d1.x * (s2.x * s0.y - s0.x * s2.y) +
        d2.x * (s0.x * s1.y - s1.x * s0.y)) /
      determinant,
    b: (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / determinant,
    d: (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / determinant,
    f:
      (d0.y * (s1.x * s2.y - s2.x * s1.y) +
        d1.y * (s2.x * s0.y - s0.x * s2.y) +
        d2.y * (s0.x * s1.y - s1.x * s0.y)) /
      determinant,
  }
}
