/**
 * Best-fit rigid transforms.
 *
 * Seating a sprite across several bones at once is what keeps the torso's belt
 * and skirt from tearing away from the pelvis, and what pins the head chain to
 * wherever the fitted torso art actually landed. Both the skeleton solver and
 * the layer painter need it, so it lives on its own rather than in either.
 */
import { identity, transformPoint, type MatrixTable } from "./matrix.ts"
import type { Matrix2D, Point } from "./types.ts"

/**
 * The rotation, uniform scale, and translation that best carries a set of bone
 * origins from their bind places to their posed ones, in the least-squares
 * sense. Fewer than two bones leaves no rotation to solve, so it is identity.
 */
export function multiBoneRigidDelta(
  bindWorld: MatrixTable,
  currentWorld: MatrixTable,
  boneIDs: string[],
): Matrix2D {
  if (!Array.isArray(boneIDs) || boneIDs.length < 2) return identity()
  const origin: Point = { x: 0, y: 0 }
  const source = boneIDs.map((id) => transformPoint(bindWorld[id], origin))
  const target = boneIDs.map((id) => transformPoint(currentWorld[id], origin))
  const sum = (points: Point[]): Point =>
    points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 })
  const sourceCenter = sum(source)
  const targetCenter = sum(target)
  sourceCenter.x /= source.length
  sourceCenter.y /= source.length
  targetCenter.x /= target.length
  targetCenter.y /= target.length
  let denominator = 0
  let cosineScale = 0
  let sineScale = 0
  for (let index = 0; index < source.length; index += 1) {
    const sx = source[index].x - sourceCenter.x
    const sy = source[index].y - sourceCenter.y
    const tx = target[index].x - targetCenter.x
    const ty = target[index].y - targetCenter.y
    denominator += sx * sx + sy * sy
    cosineScale += sx * tx + sy * ty
    sineScale += sx * ty - sy * tx
  }
  if (denominator < 1e-8) return identity()
  const a = cosineScale / denominator
  const b = sineScale / denominator
  const c = -b
  const d = a
  return {
    a,
    b,
    c,
    d,
    e: targetCenter.x - a * sourceCenter.x - c * sourceCenter.y,
    f: targetCenter.y - b * sourceCenter.x - d * sourceCenter.y,
  }
}

/** Translation, rotation in degrees, and per-axis scale carried by a matrix. */
export function matrixComponents(matrix: Matrix2D): {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
} {
  const scaleX = Math.hypot(matrix.a, matrix.b)
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  return {
    x: matrix.e,
    y: matrix.f,
    rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
    scaleX,
    scaleY: scaleX > 1e-8 ? determinant / scaleX : 1,
  }
}
