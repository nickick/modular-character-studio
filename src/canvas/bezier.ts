/**
 * Tracing an authored `bezierPathV1` onto a canvas path.
 *
 * The finger cutout is authored in normalized sprite space so the same mask
 * fits all four finger copies at any size; tracing scales it back up to the
 * pixels of whichever image is being drawn.
 */
import type { BezierNode, BezierPathV1, Point } from "../rig/types.ts"

type Scale = (point: Point) => Point

/** The subset of the 2D context this module draws through. */
export type PathTarget = Pick<
  CanvasRenderingContext2D,
  "beginPath" | "moveTo" | "lineTo" | "bezierCurveTo" | "closePath"
>

function appendSegment(target: PathTarget, from: BezierNode, to: BezierNode, scale: Scale): void {
  const controlA = scale(from.out ?? from)
  const controlB = scale(to.in ?? to)
  const endpoint = scale(to)
  target.bezierCurveTo(controlA.x, controlA.y, controlB.x, controlB.y, endpoint.x, endpoint.y)
}

/**
 * Trace a closed path, returning whether anything was drawn. An open path, or
 * one with fewer than three anchors, is still being authored and must not clip
 * the assembled hand.
 */
export function traceBezierPath(
  target: PathTarget,
  path: BezierPathV1 | null | undefined,
  width: number,
  height: number,
): boolean {
  if (!path?.closed || path.nodes.length < 3) return false
  const scale: Scale = (point) => ({ x: point.x * width, y: point.y * height })
  const nodes = path.nodes
  const first = scale(nodes[0])
  target.beginPath()
  target.moveTo(first.x, first.y)
  for (let index = 1; index < nodes.length; index += 1) {
    appendSegment(target, nodes[index - 1], nodes[index], scale)
  }
  appendSegment(target, nodes[nodes.length - 1], nodes[0], scale)
  target.closePath()
  return true
}
