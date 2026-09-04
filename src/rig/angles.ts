/** Angle helpers shared by the IK solver and the authored clip library. */
export const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/** The eased 0..1 ramp every keyframe track and mesh weight blends through. */
export const smoothstep01 = (value: number): number => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

export const degrees = (radians: number): number => (radians * 180) / Math.PI

export const radians = (value: number): number => (value * Math.PI) / 180

/** Fold an angle into -180..180, which is where "closest solution" is decided. */
export const normalizeDegrees = (value: number): number =>
  (((value + 180) % 360) + 360) % 360 - 180

export const angularDistance = (left: number, right: number): number =>
  Math.abs(normalizeDegrees(left - right))
