/**
 * Editing the finger cutout path.
 *
 * One normalized `bezierPathV1` mask is shared by the index, middle, ring, and
 * pinky copies, so authoring it once masks all four. The operations here are
 * pure — a path in, a path out — which is what lets the pen tool's behaviour be
 * checked without a canvas.
 */
import type { BezierNode, BezierPathV1, Point } from "../rig/types.ts"

/** The layer the shared mask is stored on. */
export const CUTOUT_SOURCE_LAYER_ID = "handClosedLIndex"

/** How near the pointer must come to an anchor or handle to grab it. */
export const ANCHOR_GRAB_RADIUS = 12
export const HANDLE_GRAB_RADIUS = 10

/** A path needs three anchors before it encloses anything. */
export const MIN_CLOSED_NODES = 3

const round4 = (value: number): number => Number(value.toFixed(4))
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))
const at = (point: Point): Point => ({ x: round4(point.x), y: round4(point.y) })

export const emptyPath = (): BezierPathV1 => ({ type: "bezierPathV1", closed: false, nodes: [] })

/** What a pointer grabbed, if anything. */
export type PathHit =
  | { kind: "anchor"; index: number }
  | { kind: "handle"; index: number; handle: "in" | "out" }

/**
 * What sits under the pointer. The selected node's handles are tested first,
 * because they are drawn on top of the anchors and are usually what is meant.
 */
export function hitPath(
  path: BezierPathV1 | null,
  selected: number | null,
  toCanvas: (point: Point) => Point,
  point: Point,
): PathHit | null {
  const node = selected == null ? undefined : path?.nodes[selected]
  if (node && selected != null) {
    for (const handle of ["in", "out"] as const) {
      const control = node[handle]
      if (!control) continue
      const target = toCanvas(control)
      if (Math.hypot(point.x - target.x, point.y - target.y) <= HANDLE_GRAB_RADIUS) {
        return { kind: "handle", index: selected, handle }
      }
    }
  }
  let closest: { index: number; distance: number } | null = null
  for (const [index, candidate] of (path?.nodes ?? []).entries()) {
    const target = toCanvas(candidate)
    const distance = Math.hypot(point.x - target.x, point.y - target.y)
    if (!closest || distance < closest.distance) closest = { index, distance }
  }
  return closest && closest.distance <= ANCHOR_GRAB_RADIUS
    ? { kind: "anchor", index: closest.index }
    : null
}

/** Whether clicking here would close the path by landing on its first anchor. */
export function closesPath(
  path: BezierPathV1 | null,
  toCanvas: (point: Point) => Point,
  point: Point,
): boolean {
  if (!path || path.closed || path.nodes.length < MIN_CLOSED_NODES) return false
  const first = toCanvas(path.nodes[0])
  return Math.hypot(point.x - first.x, point.y - first.y) <= ANCHOR_GRAB_RADIUS
}

export function addAnchor(path: BezierPathV1, anchor: Point): BezierPathV1 {
  return { ...path, nodes: [...path.nodes, at(anchor)] }
}

export function closePath(path: BezierPathV1): BezierPathV1 {
  if (path.nodes.length < MIN_CLOSED_NODES) return path
  return { ...path, closed: true }
}

/**
 * Give a node a mirrored pair of cubic handles, as dragging away from a
 * freshly placed anchor does with a pen tool.
 */
export function shapeNewNode(path: BezierPathV1, index: number, anchor: Point, drag: Point): BezierPathV1 {
  const dx = drag.x - anchor.x
  const dy = drag.y - anchor.y
  const nodes = path.nodes.map((node, at_) =>
    at_ === index
      ? {
          ...node,
          out: at(drag),
          in: at({ x: anchor.x - dx, y: anchor.y - dy }),
        }
      : node,
  )
  return { ...path, nodes }
}

/** Move an anchor, carrying its handles so the curve keeps its shape. */
export function moveAnchor(
  path: BezierPathV1,
  index: number,
  original: BezierNode,
  delta: Point,
): BezierPathV1 {
  const x = clamp01(original.x + delta.x)
  const y = clamp01(original.y + delta.y)
  const dx = x - original.x
  const dy = y - original.y
  const nodes = path.nodes.map((node, at_) => {
    if (at_ !== index) return node
    const moved: BezierNode = { ...node, x: round4(x), y: round4(y) }
    for (const handle of ["in", "out"] as const) {
      const control = original[handle]
      if (control) moved[handle] = at({ x: control.x + dx, y: control.y + dy })
    }
    return moved
  })
  return { ...path, nodes }
}

/**
 * Move one cubic handle. Its partner mirrors through the anchor so the curve
 * stays smooth, unless the drag is held with Option to break the pair.
 */
export function moveHandle(
  path: BezierPathV1,
  index: number,
  handle: "in" | "out",
  to: Point,
  breakPair: boolean,
): BezierPathV1 {
  const nodes = path.nodes.map((node, at_) => {
    if (at_ !== index) return node
    const moved: BezierNode = { ...node, [handle]: at(to) }
    if (!breakPair) {
      const opposite = handle === "in" ? "out" : "in"
      moved[opposite] = at({ x: node.x * 2 - to.x, y: node.y * 2 - to.y })
    }
    return moved
  })
  return { ...path, nodes }
}

/** Remove one anchor, reopening the path if it can no longer enclose anything. */
export function deleteNode(
  path: BezierPathV1,
  index: number,
): { path: BezierPathV1 | null; selected: number | null } {
  const nodes = path.nodes.filter((_, at_) => at_ !== index)
  if (nodes.length === 0) return { path: null, selected: null }
  const closed = nodes.length >= MIN_CLOSED_NODES && path.closed
  return { path: { ...path, closed, nodes }, selected: Math.min(index, nodes.length - 1) }
}

/** Take back the most recently placed anchor. */
export function undoAnchor(path: BezierPathV1): { path: BezierPathV1 | null; selected: number | null } {
  if (path.nodes.length === 0) return { path: null, selected: null }
  return deleteNode(path, path.nodes.length - 1)
}

/** What the status line says about a path in progress. */
export function pathStatus(path: BezierPathV1 | null): string {
  const count = path?.nodes.length ?? 0
  if (path?.closed) {
    return `${count}-point closed cutout · the cyan area is kept on all four finger copies`
  }
  if (count) {
    return `${count} anchor${count === 1 ? "" : "s"} · click the green first point or Close path when finished`
  }
  return "Click to add corners or click-drag to make curved handles. Trace around the finger."
}
