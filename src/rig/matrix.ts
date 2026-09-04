/** 2D affine transforms. The only geometry primitive the rig depends on. */
import type { Matrix2D, Point } from "./types.ts"

export const identity = (): Matrix2D => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })

export function multiply(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

export function inverse(matrix: Matrix2D): Matrix2D {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (Math.abs(determinant) < 1e-8) throw new Error("Cannot invert singular matrix")
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  }
}

export function transformPoint(matrix: Matrix2D, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }
}

export function localMatrix(
  x: number,
  y: number,
  rotationDegrees = 0,
  scaleX = 1,
  scaleY = 1,
): Matrix2D {
  const radians = (rotationDegrees * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return {
    a: cosine * scaleX,
    b: sine * scaleX,
    c: -sine * scaleY,
    d: cosine * scaleY,
    e: x,
    f: y,
  }
}

/** World transform per bone id, as `worldMatrices` returns them. */
export type MatrixTable = Record<string, Matrix2D>
