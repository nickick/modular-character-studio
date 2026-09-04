/**
 * Stage geometry, hit testing, and drag solving.
 *
 * All of it is pure: a point and the current rig go in, a pose delta or a hit
 * comes out. That is deliberate — this is the behaviour that was hardest to
 * check when it lived inside the studio's pointer handlers, and the old suite
 * resorted to grepping the source for `solveTwoBoneIK(` to convince itself the
 * elbow still bent the right way.
 */
import { identity, inverse, transformPoint, type MatrixTable } from "../rig/matrix.ts"
import { constrainForearmRotation, solveTwoBoneIK } from "../rig/ik.ts"
import { rigidLayerMatrix } from "../rig/mesh.ts"
import type { Matrix2D, Point, Pose, PoseDelta, ResolvedBone, ResolvedLayer, Side } from "../rig/types.ts"
import type { LayerImage } from "../canvas/paint.ts"

/** The artboard the rig is authored on. */
export const STAGE_SIZE = 1254

/**
 * Room around the artboard for attachments that swing outside it. A weapon or
 * shield rotates around its hand, not around the artboard, so the complete
 * attachment has to stay visible while it is being posed.
 */
export const STAGE_OVERSCAN = 160

export const STAGE_VIEW_SIZE = STAGE_SIZE + STAGE_OVERSCAN * 2

/** How near the pointer must come to a bone origin to grab it. */
export const BONE_GRAB_RADIUS = 28

/** Where a pointer event lands in artboard coordinates. */
export function stagePoint(event: { clientX: number; clientY: number }, bounds: DOMRect): Point {
  return {
    x: ((event.clientX - bounds.left) * STAGE_VIEW_SIZE) / bounds.width - STAGE_OVERSCAN,
    y: ((event.clientY - bounds.top) * STAGE_VIEW_SIZE) / bounds.height - STAGE_OVERSCAN,
  }
}

export const boneOrigin = (matrix: Matrix2D): Point => ({ x: matrix.e, y: matrix.f })

/** The nearest bone within grabbing distance, or null. */
export function hitBone(
  point: Point,
  bones: readonly ResolvedBone[],
  currentWorld: MatrixTable,
): ResolvedBone | null {
  let best: { bone: ResolvedBone; distance: number } | null = null
  for (const bone of bones) {
    const origin = boneOrigin(currentWorld[bone.id])
    const distance = Math.hypot(point.x - origin.x, point.y - origin.y)
    if (!best || distance < best.distance) best = { bone, distance }
  }
  return best && best.distance <= BONE_GRAB_RADIUS ? best.bone : null
}

/** The topmost drawn layer whose artwork bounds contain the point. */
export function hitLayer(
  point: Point,
  layers: readonly ResolvedLayer[],
  imageFor: (layer: ResolvedLayer) => LayerImage | null,
  posedFor: (layer: ResolvedLayer) => ResolvedLayer,
  bindWorld: MatrixTable,
  currentWorld: MatrixTable,
): ResolvedLayer | null {
  const ordered = [...layers].sort((left, right) => right.drawOrder - left.drawOrder)
  for (const layer of ordered) {
    const image = imageFor(layer)
    if (!image) continue
    const matrix = rigidLayerMatrix(posedFor(layer), image.width, image.height, bindWorld, currentWorld)
    const local = transformPoint(inverse(matrix), point)
    if (local.x >= 0 && local.y >= 0 && local.x <= image.width && local.y <= image.height) {
      return layer
    }
  }
  return null
}

/** Which kind of drag a bone starts, by what that bone is. */
export type BoneDragKind = "armIK" | "armElbow" | "bone"

export function boneDragKind(boneID: string): BoneDragKind {
  if (/^hand[LR]$/.test(boneID)) return "armIK"
  if (/^lowerArm[LR]$/.test(boneID)) return "armElbow"
  return "bone"
}

export const sideOf = (boneID: string): Side => (boneID.endsWith("R") ? "R" : "L")

const byID = (bones: readonly ResolvedBone[]): Record<string, ResolvedBone> =>
  Object.fromEntries(bones.map((bone) => [bone.id, bone]))

/** What a drag needs to know about the frame it started in. */
export interface DragContext {
  bones: readonly ResolvedBone[]
  /** The pose being drawn, including the manual edits so far. */
  pose: Pose
  currentWorld: MatrixTable
  /** The clip's own contribution, which a manual delta must not double up on. */
  authored: Pose
}

/**
 * Bend one elbow toward the pointer. The forearm is a one-way hinge: both
 * three-quarter arms flex forward toward screen-left, so the solved angle is
 * clamped before it becomes a delta.
 */
export function solveElbowDrag(point: Point, side: Side, context: DragContext): Pose {
  const bones = byID(context.bones)
  const upper = `upperArm${side}`
  const lower = `lowerArm${side}`
  const target = transformPoint(inverse(context.currentWorld[upper]), point)
  target.x -= bones[lower].x
  target.y -= bones[lower].y
  const rotation = constrainForearmRotation(side, (Math.atan2(-target.x, target.y) * 180) / Math.PI)
  return {
    [lower]: {
      rotation: rotation - bones[lower].rotation - (context.authored[lower]?.rotation ?? 0),
    },
  }
}

/** Drag a hand, solving the fixed-length two-bone chain behind it. */
export function solveArmIKDrag(point: Point, side: Side, context: DragContext): Pose {
  const bones = byID(context.bones)
  const shoulder = `shoulder${side}`
  const upper = `upperArm${side}`
  const lower = `lowerArm${side}`
  const hand = `hand${side}`
  const { pose, authored, currentWorld } = context
  const target = transformPoint(inverse(currentWorld[shoulder]), point)
  target.x -= bones[upper].x + (pose[upper]?.x ?? 0)
  target.y -= bones[upper].y + (pose[upper]?.y ?? 0)
  const upperLength = Math.hypot(
    bones[lower].x + (pose[lower]?.x ?? 0),
    bones[lower].y + (pose[lower]?.y ?? 0),
  )
  const lowerLength = Math.hypot(
    bones[hand].x + (pose[hand]?.x ?? 0),
    bones[hand].y + (pose[hand]?.y ?? 0),
  )
  const solution = solveTwoBoneIK(
    target,
    upperLength,
    lowerLength,
    bones[upper].rotation + (pose[upper]?.rotation ?? 0),
    bones[lower].rotation + (pose[lower]?.rotation ?? 0),
    // The elbow only ever bends forward, so the solve is told which of the two
    // solutions it is allowed to pick rather than being left to flip.
    1,
  )
  return {
    [upper]: {
      rotation: solution.upperRotation - bones[upper].rotation - (authored[upper]?.rotation ?? 0),
    },
    [lower]: {
      rotation: solution.lowerRotation - bones[lower].rotation - (authored[lower]?.rotation ?? 0),
    },
  }
}

/** Move a bone's origin to the pointer, in its parent's space. */
export function solveBoneDrag(
  point: Point,
  bone: ResolvedBone,
  parentInverse: Matrix2D,
  authored: Pose,
): Pose {
  const local = transformPoint(parentInverse, point)
  const clip = authored[bone.id] ?? {}
  return {
    [bone.id]: {
      x: local.x - bone.x - (clip.x ?? 0),
      y: local.y - bone.y - (clip.y ?? 0),
    },
  }
}

/** The parent frame a bone drag is solved in. */
export function parentInverse(bone: ResolvedBone, currentWorld: MatrixTable): Matrix2D {
  return inverse(bone.parent ? currentWorld[bone.parent] : identity())
}

/** Merge a solved drag delta into the manual pose without losing other fields. */
export function withDragDelta(manualPose: Pose, delta: Pose): Pose {
  const next: Pose = { ...manualPose }
  for (const [bone, values] of Object.entries(delta)) {
    const current: PoseDelta = next[bone] ?? {}
    next[bone] = { ...current, ...values }
  }
  return next
}

/** Where a layer drag started, so the sprite follows the pointer exactly. */
export interface LayerDragAnchor {
  boneInverse: Matrix2D
  grab: Point
  startX: number
  startY: number
}

export function beginLayerDrag(
  point: Point,
  layer: ResolvedLayer,
  currentWorld: MatrixTable,
): LayerDragAnchor {
  const boneInverse = inverse(currentWorld[layer.bone])
  return {
    boneInverse,
    grab: transformPoint(boneInverse, point),
    startX: layer.x,
    startY: layer.y,
  }
}

/** The layer's new bone-local placement, rounded the way the scene stores it. */
export function solveLayerDrag(point: Point, anchor: LayerDragAnchor): { x: number; y: number } {
  const local = transformPoint(anchor.boneInverse, point)
  return {
    x: Number((anchor.startX + local.x - anchor.grab.x).toFixed(2)),
    y: Number((anchor.startY + local.y - anchor.grab.y).toFixed(2)),
  }
}
