/**
 * Joint limits and the fixed-length two-bone solve used by hand and foot IK.
 *
 * Because this character faces three-quarter toward screen-left, both forearms
 * flex forward toward screen-left through clockwise, positive relative
 * rotation. Direct elbow dragging, hand IK, and every authored animation use
 * that same forward-sweep convention.
 */
import { angularDistance, clamp, degrees, normalizeDegrees, radians } from "./angles.ts"
import type { Point, Pose, ResolvedBone, Side } from "./types.ts"

const sides: readonly Side[] = ["L", "R"]

function assertSide(side: string, joint: string): asserts side is Side {
  if (side !== "L" && side !== "R") throw new Error(`Unknown ${joint} side: ${side}`)
}

/** Both 3/4-view arms flex forward toward screen-left (clockwise/positive). */
export function constrainForearmRotation(side: string, rotation: number): number {
  assertSide(side, "arm")
  return clamp(rotation, 0, 155)
}

/** Apply the shared forearm limits to an already-evaluated additive pose. */
export function constrainForearmPose(bones: readonly ResolvedBone[], pose: Pose): Pose {
  const constrained: Pose = structuredClone(pose ?? {})
  for (const side of sides) {
    const id = `lowerArm${side}`
    const bone = bones.find((candidate) => candidate.id === id)
    if (!bone) continue
    const total = (bone.rotation ?? 0) + (constrained[id]?.rotation ?? 0)
    constrained[id] = {
      ...(constrained[id] ?? {}),
      rotation: constrainForearmRotation(side, total) - (bone.rotation ?? 0),
    }
  }
  return constrained
}

/** Knees only bend backward, which is negative in this rig's local space. */
export function constrainKneeRotation(side: string, rotation: number): number {
  assertSide(side, "leg")
  return Math.min(0, rotation)
}

/** One solved two-bone chain, as relative rotations in degrees. */
export interface TwoBoneSolution {
  upperRotation: number
  lowerRotation: number
}

/**
 * Solve a fixed-length two-bone chain whose bind axis points down (+Y).
 * The closest elbow solution wins so dragging a hand cannot flip the joint.
 */
export function solveTwoBoneIK(
  target: Point,
  upperLength: number,
  lowerLength: number,
  currentUpperRotation = 0,
  currentLowerRotation = 0,
  bendDirection = 0,
): TwoBoneSolution {
  if (!(upperLength > 0) || !(lowerLength > 0)) {
    throw new Error("Arm segment lengths must be positive")
  }
  const rawDistance = Math.hypot(target.x, target.y)
  const distance = clamp(
    rawDistance,
    Math.abs(upperLength - lowerLength) + 1e-6,
    upperLength + lowerLength - 1e-6,
  )
  const heading = rawDistance > 1e-8 ? Math.atan2(target.y, target.x) : Math.PI / 2
  const shoulderOffset = Math.acos(
    clamp(
      (distance * distance + upperLength * upperLength - lowerLength * lowerLength) /
        (2 * distance * upperLength),
      -1,
      1,
    ),
  )
  const elbowMagnitude = Math.acos(
    clamp(
      (distance * distance - upperLength * upperLength - lowerLength * lowerLength) /
        (2 * upperLength * lowerLength),
      -1,
      1,
    ),
  )
  const candidates: TwoBoneSolution[] = [
    {
      upperRotation: degrees(heading - shoulderOffset - Math.PI / 2),
      lowerRotation: degrees(elbowMagnitude),
    },
    {
      upperRotation: degrees(heading + shoulderOffset - Math.PI / 2),
      lowerRotation: -degrees(elbowMagnitude),
    },
  ].map((candidate) => ({
    upperRotation: normalizeDegrees(candidate.upperRotation),
    lowerRotation: normalizeDegrees(candidate.lowerRotation),
  }))
  if (bendDirection !== 0) {
    const wanted = Math.sign(bendDirection)
    return (
      candidates.find((candidate) => Math.sign(candidate.lowerRotation) === wanted) ??
      candidates.find((candidate) => candidate.lowerRotation === 0) ??
      candidates[0]
    )
  }
  const cost = (candidate: TwoBoneSolution): number =>
    angularDistance(candidate.upperRotation, currentUpperRotation) +
    angularDistance(candidate.lowerRotation, currentLowerRotation)
  return [...candidates].sort((left, right) => cost(left) - cost(right))[0]
}

/** Where a two-bone chain's tip lands for a pair of relative rotations. */
export function twoBoneEndpoint(
  upperRotation: number,
  lowerRotation: number,
  upperLength: number,
  lowerLength: number,
): Point {
  const upper = radians(upperRotation)
  const lower = radians(upperRotation + lowerRotation)
  return {
    x: -Math.sin(upper) * upperLength - Math.sin(lower) * lowerLength,
    y: Math.cos(upper) * upperLength + Math.cos(lower) * lowerLength,
  }
}
