/** Native demo's two-second release/reconnect solver, in authored rig coordinates. */
import { identity, inverse, localMatrix, multiply, transformPoint, type MatrixTable } from "./matrix.ts"
import type { Matrix2D, Point, ResolvedBone } from "./types.ts"

export const bowReloadTiming = { pause: 0.1, reach: 0.9, settle: 1, duration: 2 } as const
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0))
const ease = (v: number) => { const t = clamp(v); return t*t*(3-2*t) }
export function bowReloadAt(phase: number) {
  const elapsed = clamp(phase)*bowReloadTiming.duration
  const reaching = ease((elapsed-0.1)/0.9), settling = ease(elapsed-1)
  return { elapsed, reaching, settling, retraction: 70*reaching*(1-settling), connected: elapsed >= 1 }
}
export const drawingGrip: Point = { x: -25.26, y: 92.12 }
const angle = (m: Matrix2D) => Math.atan2(m.b, m.a)
const radians = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
export function blendBowMatrix(a: Matrix2D, b: Matrix2D, t: number): Matrix2D {
  const sx = (m: Matrix2D) => Math.hypot(m.a,m.b)
  const sy = (m: Matrix2D) => (m.a*m.d-m.b*m.c)/Math.max(1e-12,sx(m))
  return localMatrix(a.e+(b.e-a.e)*t, a.f+(b.f-a.f)*t,
    (angle(a)+radians(angle(b)-angle(a))*t)*180/Math.PI, sx(a)+(sx(b)-sx(a))*t, sy(a)+(sy(b)-sy(a))*t)
}
function applying(rotations: Record<string,number>, world: MatrixTable, bones: ResolvedBone[]): MatrixTable {
  const result: MatrixTable = {}
  for (const bone of bones) {
    const original = world[bone.id]
    if (!bone.parent || !world[bone.parent]) { result[bone.id] = original; continue }
    let local = multiply(inverse(world[bone.parent]), original)
    if (rotations[bone.id] !== undefined) {
      const sx = Math.hypot(local.a,local.b), sy = (local.a*local.d-local.b*local.c)/sx
      local = localMatrix(local.e,local.f,rotations[bone.id]*180/Math.PI,sx,sy)
    }
    result[bone.id] = multiply(result[bone.parent],local)
  }
  return result
}
function twoBone(target: Point, first: Matrix2D, second: Matrix2D, reserve = 0) {
  const a = Math.max(0.001,Math.hypot(first.e,first.f)), b = Math.max(0.001,Math.hypot(second.e,second.f))
  const distance = clamp(Math.hypot(target.x,target.y),Math.abs(a-b)+1e-6,a+b-Math.max(1e-6,reserve))
  const upperAxis = Math.atan2(first.f,first.e), lowerAxis = Math.atan2(second.f,second.e)
  const offset = Math.acos(clamp((distance*distance+a*a-b*b)/(2*distance*a),-1,1))
  const elbow = Math.acos(clamp((distance*distance-a*a-b*b)/(2*a*b),-1,1))
  return { upper: Math.atan2(target.y,target.x)-offset-upperAxis, lower: elbow+upperAxis-lowerAxis }
}
export function bowNock(world: MatrixTable, progress: number, pitch = 0): Point {
  const r = clamp(pitch,-90,90)*Math.PI/180, dx = -Math.cos(r), dy = Math.sin(r)
  const grip = transformPoint(world.handL,{x:0,y:90})
  const seat = {x:grip.x-dy*45,y:grip.y+dx*45}
  const contact = transformPoint(world.handR,drawingGrip)
  const a = Math.hypot(world.lowerArmR.e-world.upperArmR.e,world.lowerArmR.f-world.upperArmR.f)
  const b = Math.hypot(contact.x-world.lowerArmR.e,contact.y-world.lowerArmR.f)
  const qx = seat.x-world.shoulderR.e, qy = seat.y-world.shoulderR.f
  const along = qx*dx+qy*dy, across = Math.max(0,qx*qx+qy*qy-along*along)
  const half = Math.sqrt(Math.max(0,(a+b-18)**2-across)), inner = Math.abs(a-b)+1e-4
  const reachable = (pull: number) => {
    let total = clamp(pull,along-half,along+half)
    if ((total-along)**2+across < inner*inner) total = along+Math.sqrt(Math.max(0,inner*inner-across))
    return total
  }
  const total = reachable(100)+(reachable(400)-reachable(100))*clamp(progress)
  return { x: seat.x-dx*total, y: seat.y-dy*total }
}
export function solveBowArms(input: MatrixTable, bind: MatrixTable, bones: ResolvedBone[],
  progress: number, reach = 290, rearTarget?: Point, pitch = 0): MatrixTable {
  if (!["handL","handR","lowerArmL","lowerArmR","upperArmL","upperArmR","shoulderL","shoulderR"].every(id=>input[id] && bind[id])) return input
  const wristRotations: Record<string,number> = {}
  for (const side of ["L","R"]) {
    const parent = "lowerArm"+side, hand = "hand"+side
    const neutral = angle(multiply(inverse(bind[parent]),bind[hand]))
    const delta = radians(angle(multiply(inverse(input[parent]),input[hand]))-neutral)
    const limit = (side==="L"?5:30)*Math.PI/180
    wristRotations[hand] = neutral+clamp(delta,-limit,limit)
  }
  const world = applying(wristRotations,input,bones)
  const left = world.shoulderL, right = world.shoulderR, upper = world.upperArmL, lower = world.lowerArmL
  const r = clamp(pitch,-90,90)*Math.PI/180, unit = {x:-Math.cos(r),y:Math.sin(r)}
  const target = transformPoint(inverse(left),{x:left.e+unit.x*(reach-90),y:left.f+unit.y*(reach-90)})
  const first = multiply(inverse(upper),lower), second = multiply(inverse(lower),world.handL)
  const front = twoBone(target,first,second)
  const rotations: Record<string,number> = {upperArmL:front.upper,lowerArmL:front.lower}
  const frontWorld = applying(rotations,world,bones)
  const desired = Math.atan2(unit.y,unit.x)-Math.PI/2
  const original = angle(multiply(inverse(bind.lowerArmL),bind.handL))
  const change = radians(desired-angle(frontWorld.lowerArmL)-original), limit = 5*Math.PI/180
  const wrist = original+clamp(change,-limit,limit)
  if (Math.abs(change)>limit) {
    const forearm = desired-wrist-angle(left)
    const ex = target.x-(Math.cos(forearm)*second.e-Math.sin(forearm)*second.f)
    const ey = target.y-(Math.sin(forearm)*second.e+Math.cos(forearm)*second.f)
    const ua = Math.atan2(ey,ex)-Math.atan2(first.f,first.e)
    rotations.upperArmL=ua; rotations.lowerArmL=forearm-ua
  }
  rotations.handL=wrist
  const bowWorld=applying(rotations,world,bones)
  const nock=rearTarget??bowNock(bowWorld,progress,pitch)
  const rearFirst=multiply(inverse(world.upperArmR),world.lowerArmR)
  const rearLocal=multiply(inverse(world.lowerArmR),world.handR)
  const contact=transformPoint(rearLocal,drawingGrip)
  const back=twoBone(transformPoint(inverse(right),nock),rearFirst,{...identity(),e:contact.x,f:contact.y},rearTarget?18:0)
  rotations.upperArmR=back.upper; rotations.lowerArmR=back.lower
  return applying(rotations,world,bones)
}
