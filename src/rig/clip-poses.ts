/**
 * The authored clip pose library.
 *
 * These are the procedural motion functions: the shapes each clip makes as a
 * function of phase alone. Anything that answers to runtime input -- bow and
 * spell aim, the IK that follows them, cross-fades between clips -- stays out
 * of here, because it is a function of what the player is doing rather than of
 * the timeline. A runtime can sample these into whatever fixed representation
 * its renderer needs.
 */
import { clamp01 } from "./angles.ts"
import { animationDurations, animationLoops, isAnimationName, type AnimationName } from "./clips.ts"
import { solveTwoBoneIK } from "./ik.ts"
import type { Point, Pose, PoseDelta, Side } from "./types.ts"

const TAU = Math.PI * 2;

const sides: readonly Side[] = ["L", "R"];

/** One leg's fixed segment lengths and hip-socket placement. */
interface LegSegment {
  upper: { x: number; y: number; rotation: number };
  thigh: number;
  shin: number;
}

/**
 * A canonical leg skeleton in canvas space. Several exist because the clips
 * that push the pelvis furthest need their own midpoint between the two body
 * profiles' painted boot registrations.
 */
interface LegRig {
  root: Point;
  hips: Point;
  L: LegSegment;
  R: LegSegment;
}

/** A hips delta given either as a bare rotation or as a full pose delta. */
type HipsInput = number | PoseDelta;

/** Ankle targets as offsets from each side's canonical resting ankle. */
type AnkleTargets = Partial<Record<Side, Point>>;

const cycle = (phase: number, offset = 0): number => Math.sin((phase + offset) * TAU);
const lift = (value: number): number => Math.max(0, value);
// Eased 0 -> 1 ramp between two points on the timeline.
const ramp = (phase: number, from: number, to: number): number => {
  const t = clamp01((phase - from) / (to - from));
  return t * t * (3 - 2 * t);
};

// A nearly straight two-bone chain is numerically and visually unstable: a
// one-pixel target change can turn into a large knee rotation. Preserve a
// small bend in every grounded solve so contact changes ease through the knee
// instead of looking like the joint twitches between solutions.
const GROUNDED_KNEE_MARGIN = 4;

/**
 * The ankle targets preserve the authored stride in screen space. The leg solver
 * bends each knee toward those targets and lowers the pelvis only when the stance
 * is wider than the fixed-length legs can otherwise reach.
 */
function stridePose(
  phase: number,
  {
    armArc,
    elbowArc,
    halfStride = 150,
    stepHeight = 20,
  }: { armArc: number; elbowArc: number; halfStride?: number; stepHeight?: number },
): Pose {
  const swing = cycle(phase);
  const hips = { rotation: 3 * swing };
  const targets = {
    L: groundedWalkFootTarget(phase, 0, 1, halfStride, stepHeight),
    R: groundedWalkFootTarget(phase, 0.5, 1, halfStride, stepHeight),
  };
  const root = groundedRootForTargets(
    { x: 0, y: 0 }, hips, targets, balancedGroundedLegRig, GROUNDED_KNEE_MARGIN,
  );
  const legs = groundedLegPose(root, hips, targets, balancedGroundedLegRig);
  return {
    root,
    hips,
    spine: { rotation: -1.5 * swing },
    chest: { rotation: -3.5 * swing },
    head: { rotation: 1.8 * swing },
    // Arms swing opposite their own leg. Matching signs read as walking backwards.
    upperArmL: { rotation: -armArc * swing },
    lowerArmL: { rotation: elbowArc + elbowArc * 0.3 * swing },
    upperArmR: { rotation: armArc * swing },
    lowerArmR: { rotation: elbowArc + elbowArc * 0.3 * swing },
    ...legs,
    skirtL: { rotation: 7 * swing },
    skirtR: { rotation: 7 * swing },
    skirtFront: { rotation: -4 * swing, y: -3 * (1 - Math.abs(swing)) },
  };
}

const heldUpperBodyBones = new Set([
  "hips", "spine", "chest", "neck", "head",
  "shoulderL", "upperArmL", "lowerArmL", "handL",
  "shoulderR", "upperArmR", "lowerArmR", "handR",
]);
function onlyBones(pose: Pose, included: ReadonlySet<string>): Pose {
  return Object.fromEntries(Object.entries(pose).filter(([bone]) => included.has(bone)));
}

/**
 * A close-to-camera crossing step. Reversing the phase reverses which knee
 * recovers behind the other leg, so backward movement is the gait played
 * backward rather than the same cycle with a different label.
 */
function crossingStepPose(phase: number, direction: number, hips: PoseDelta = {}): Pose {
  const gaitPhase = direction > 0 ? phase : 1 - phase;
  const targets = {
    L: groundedWalkFootTarget(gaitPhase, 0, 1, 150, 20),
    R: groundedWalkFootTarget(gaitPhase, 0.5, 1, 150, 20),
  };
  const root = groundedRootForTargets(
    { x: 0, y: 0 }, hips, targets, balancedGroundedLegRig, GROUNDED_KNEE_MARGIN,
  );
  const legs = groundedLegPose(root, hips, targets, balancedGroundedLegRig);
  const strideWave = cycle(gaitPhase);
  return {
    root,
    ...legs,
    skirtL: { rotation: 7 * strideWave },
    skirtR: { rotation: 7 * strideWave },
    skirtFront: { rotation: -4 * strideWave, y: -3 * (1 - Math.abs(strideWave)) },
  };
}

function heldActionStepPose(action: AnimationName, phase: number, direction: number): Pose {
  const holdPhase = action === "spellCast" ? 0.55 : 0.8;
  const upperBody = onlyBones(authoredPose(action, holdPhase), heldUpperBodyBones);
  return { ...upperBody, ...crossingStepPose(phase, direction, upperBody.hips) };
}

// The animation curves are shared by both body profiles, so foot locking uses
// the canonical femaleV1 chain that defines the rig proportions. MaleV1 has a
// slightly longer painted leg, but receives the same joint rotations.
const groundedLegRig = {
  root: { x: 600, y: 1190 },
  hips: { x: 0, y: -460 },
  L: { upper: { x: -66.073, y: 21.767, rotation: 4.64 }, thigh: 197.65, shin: 156.46 },
  R: { upper: { x: 58.794, y: 15.053, rotation: -4.64 }, thigh: 197.65, shin: 156.46 },
};
// The sword swing carries more pelvis rotation than the sneak or dodge clips.
// Its midpoint chain distributes the residual profile error, grounding both
// bodies within a few pixels while retaining one shared runtime pose library.
const balancedGroundedLegRig = {
  root: { x: 600, y: 1190 },
  hips: { x: 0.7085, y: -454.327 },
  L: { upper: { x: -59.482, y: 18.213, rotation: 4.64 }, thigh: 207.472, shin: 156.46 },
  R: { upper: { x: 59.941, y: 13.771, rotation: -4.64 }, thigh: 206.058, shin: 156.46 },
};
// The doubled dodge extension amplifies the small difference between the two
// profiles' painted boot registrations. This shared midpoint is biased just
// past the sword rig so neither profile takes the entire mismatch: one settles
// a few pixels through the guide while the other clears it by the same amount.
const dodgeGroundedLegRig = {
  root: { x: 600, y: 1190 },
  hips: { x: 0.8502, y: -453.1924 },
  L: { upper: { x: -58.1638, y: 17.5022, rotation: 4.64 }, thigh: 209.4364, shin: 156.46 },
  R: { upper: { x: 60.1704, y: 13.5146, rotation: -4.64 }, thigh: 207.7396, shin: 156.46 },
};

function rotatePoint(point: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: cosine * point.x - sine * point.y,
    y: sine * point.x + cosine * point.y,
  };
}

function canonicalRestAnkle(side: Side, rig: LegRig = groundedLegRig): Point {
  const leg = rig[side];
  const reach = rotatePoint({ x: 0, y: leg.thigh + leg.shin }, leg.upper.rotation);
  return {
    x: rig.root.x + rig.hips.x + leg.upper.x + reach.x,
    y: rig.root.y + rig.hips.y + leg.upper.y + reach.y,
  };
}

/**
 * Solve one leg against an ankle target in canonical canvas space. The knee
 * always takes the backward-bending solution and the foot cancels the chain's
 * rotation, so a planted boot keeps the same sole angle instead of rocking on
 * its toe as the body moves above it.
 */
function hipsDelta(value: HipsInput | undefined): { x: number; y: number; rotation: number } {
  if (typeof value === "number") return { x: 0, y: 0, rotation: value };
  return {
    x: value?.x ?? 0,
    y: value?.y ?? 0,
    rotation: value?.rotation ?? 0,
  };
}

function groundedLeg(
  side: Side,
  root: Point,
  hipsPose: HipsInput | undefined,
  targetOffset: Point,
  rig: LegRig = groundedLegRig,
): { upper: number; lower: number; foot: number } {
  const leg = rig[side];
  const hips = hipsDelta(hipsPose);
  const rest = canonicalRestAnkle(side, rig);
  const target = { x: rest.x + targetOffset.x, y: rest.y + targetOffset.y };
  const hipsWorld = {
    x: rig.root.x + root.x + rig.hips.x + hips.x,
    y: rig.root.y + root.y + rig.hips.y + hips.y,
  };
  const inHips = rotatePoint({ x: target.x - hipsWorld.x, y: target.y - hipsWorld.y }, -hips.rotation);
  const dx = inHips.x - leg.upper.x;
  const dy = inHips.y - leg.upper.y;
  const distanceSquared = dx * dx + dy * dy;
  const kneeCosine = Math.max(-1, Math.min(1,
    (distanceSquared - leg.thigh * leg.thigh - leg.shin * leg.shin) / (2 * leg.thigh * leg.shin),
  ));
  const kneeRadians = -Math.acos(kneeCosine);
  const targetRadians = Math.atan2(-dx, dy);
  const upperRadians = targetRadians - Math.atan2(
    leg.shin * Math.sin(kneeRadians),
    leg.thigh + leg.shin * Math.cos(kneeRadians),
  );
  const upperWorld = upperRadians * 180 / Math.PI;
  const lower = kneeRadians * 180 / Math.PI;
  return {
    upper: upperWorld - leg.upper.rotation,
    lower,
    foot: leg.upper.rotation - hips.rotation - upperWorld - lower,
  };
}

function groundedLegPose(
  root: Point,
  hipsPose: HipsInput | undefined,
  targets: AnkleTargets,
  rig: LegRig = groundedLegRig,
): Pose {
  const pose: Pose = {};
  for (const side of sides) {
    const solved = groundedLeg(side, root, hipsPose, targets[side] ?? { x: 0, y: 0 }, rig);
    pose[`upperLeg${side}`] = { rotation: solved.upper };
    pose[`lowerLeg${side}`] = { rotation: solved.lower };
    pose[`foot${side}`] = { rotation: solved.foot };
  }
  return pose;
}

/**
 * Lower the pelvis just enough for both fixed-length legs to reach their
 * authored ankle targets. Horizontal foot travel is never shortened: wide
 * strides become a visible body compression instead of an IK clamp.
 */
function groundedRootForTargets(
  seed: Partial<Point>,
  hipsPose: HipsInput | undefined,
  targets: AnkleTargets,
  rig: LegRig = groundedLegRig,
  kneeMargin = 2,
): Point {
  const hips = hipsDelta(hipsPose);
  const root: Point = { x: seed.x ?? 0, y: seed.y ?? 0 };
  const requiredDrops: number[] = [];
  for (const side of sides) {
    const leg = rig[side];
    const rest = canonicalRestAnkle(side, rig);
    const offset = targets[side] ?? { x: 0, y: 0 };
    const target = { x: rest.x + offset.x, y: rest.y + offset.y };
    const upperOffset = rotatePoint(leg.upper, hips.rotation);
    const joint = {
      x: rig.root.x + root.x + rig.hips.x + hips.x + upperOffset.x,
      y: rig.root.y + root.y + rig.hips.y + hips.y + upperOffset.y,
    };
    const dx = target.x - joint.x;
    const maximumReach = leg.thigh + leg.shin - kneeMargin;
    const verticalReach = Math.sqrt(Math.max(0, maximumReach * maximumReach - dx * dx));
    requiredDrops.push(target.y - joint.y - verticalReach);
  }
  // A hard max abruptly hands pelvis control from one leg to the other at the
  // middle of a stride. Smooth that ownership transfer over a few source
  // pixels; the result remains at or below the strict reachable position.
  const [leftDrop = 0, rightDrop = 0] = requiredDrops;
  const smoothing = 4;
  const smoothMaximum = 0.5 * (
    leftDrop + rightDrop + Math.sqrt((leftDrop - rightDrop) ** 2 + smoothing ** 2)
  );
  root.y += Math.max(0, smoothMaximum);
  return root;
}

function authoredAnkleOffset(
  side: Side,
  pose: Pose,
  rig: LegRig = balancedGroundedLegRig,
): Point {
  const leg = rig[side];
  const root = pose.root ?? {};
  const hips = hipsDelta(pose.hips);
  const upper = pose[`upperLeg${side}`] ?? {};
  const lower = pose[`lowerLeg${side}`] ?? {};
  const upperWorld = hips.rotation + leg.upper.rotation + (upper.rotation ?? 0);
  const lowerWorld = upperWorld + (lower.rotation ?? 0);
  const upperJoint = rotatePoint(leg.upper, hips.rotation);
  const thigh = rotatePoint({ x: 0, y: leg.thigh * (upper.scaleY ?? 1) }, upperWorld);
  const shin = rotatePoint({ x: 0, y: leg.shin * (lower.scaleY ?? 1) }, lowerWorld);
  const ankle = {
    x: rig.root.x + (root.x ?? 0) + rig.hips.x + hips.x
      + upperJoint.x + thigh.x + shin.x,
    y: rig.root.y + (root.y ?? 0) + rig.hips.y + hips.y
      + upperJoint.y + thigh.y + shin.y,
  };
  const rest = canonicalRestAnkle(side, rig);
  return { x: ankle.x - rest.x, y: ankle.y - rest.y };
}

function authoredAnkleXOffset(side: Side, pose: Pose, rig: LegRig = balancedGroundedLegRig): number {
  return authoredAnkleOffset(side, pose, rig).x;
}

/**
 * Keep an authored leg animation's exact screen-space ankle travel, but replace
 * its vertical path with explicit contact/lift targets. This is the attack
 * equivalent of the locomotion solver: the old stride remains the source of
 * truth and any extra reach comes from lowering the pelvis, never pulling a
 * foot back toward the body.
 */
function groundAuthoredFootTravel(
  pose: Pose,
  verticalTargets: Partial<Record<Side, number>>,
  supportWeights: Partial<Record<Side, number>> = { L: 0.5, R: 0.5 },
  kneeMargin = GROUNDED_KNEE_MARGIN,
  rig: LegRig = balancedGroundedLegRig,
): { root: Point; pose: Pose } {
  const hips = pose.hips ?? {};
  const authored: Record<Side, Point> = {
    L: authoredAnkleOffset("L", pose, rig),
    R: authoredAnkleOffset("R", pose, rig),
  };
  const targets: Record<Side, Point> = {
    L: { x: authored.L.x, y: verticalTargets.L ?? 0 },
    R: { x: authored.R.x, y: verticalTargets.R ?? 0 },
  };
  const weightTotal = Math.max(0.0001, (supportWeights.L ?? 0) + (supportWeights.R ?? 0));
  const supportCorrection = sides.reduce((sum, side) => {
    const weight = (supportWeights[side] ?? 0) / weightTotal;
    return sum + weight * (targets[side].y - authored[side].y);
  }, 0);
  const seed: Partial<Point> = { ...(pose.root ?? { x: 0, y: 0 }) };
  seed.y = (seed.y ?? 0) + supportCorrection;
  const root = groundedRootForTargets(seed, hips, targets, rig, kneeMargin);
  return {
    root,
    pose: groundedLegPose(root, hips, targets, rig),
  };
}

const groundedStationaryClips = new Set([
  "idle", "staffIdle", "shieldUp", "staffShieldUp",
  "blocked", "spellCast", "bowDraw",
]);

/** Preserve each stance's horizontal silhouette while solving both soles to
 * the shared floor. Keyframed leg corrections are layered afterward, so an
 * animator can still intentionally lift or reposition a foot. */
export function groundStationaryPose(name: string, pose: Pose): Pose {
  if (!groundedStationaryClips.has(name)) return pose;
  const hips = pose.hips ?? {};
  const targets = {
    L: { x: authoredAnkleXOffset("L", pose), y: 2 },
    R: { x: authoredAnkleXOffset("R", pose), y: 2 },
  };
  const root = groundedRootForTargets(
    pose.root ?? { x: 0, y: 0 }, hips, targets, balancedGroundedLegRig, GROUNDED_KNEE_MARGIN,
  );
  return {
    ...pose,
    root,
    ...groundedLegPose(root, hips, targets, balancedGroundedLegRig),
  };
}

function motionLift(phase: number, from: number, to: number, height: number): number {
  if (phase <= from || phase >= to) return 0;
  const local = (phase - from) / (to - from);
  const arc = Math.sin(Math.PI * local);
  // Squaring the arc makes its slope reach zero at contact. Besides reading as
  // weight settling onto the sole, it prevents the two-bone IK knee from
  // snapping straight on the final sampled runtime frame.
  return -height * arc * arc;
}

/**
 * One foot remains in its weight-bearing pass while the other clears the
 * floor and returns to the next contact. The horizontal stance travel is the
 * inverse of the character's movement, so the planted sole reads as fixed in
 * world space when the actor advances. Both ends meet at y = 0 with a flat
 * slope, preventing a pop when the loop wraps or the support foot changes.
 */
function groundedWalkFootTarget(
  phase: number,
  offset: number,
  direction: number,
  halfStride: number,
  stepHeight: number,
): Point {
  const local = ((phase + offset) % 1 + 1) % 1;
  const stanceEnd = 0.62;
  // The shared pose library sits between the two profiles' boot registrations.
  // A tiny downward bias keeps the longer male soles from hovering without
  // visibly pushing the female boots through the guide.
  const floorSettle = 2;
  if (local <= stanceEnd) {
    const travel = ramp(local, 0, stanceEnd);
    return {
      x: direction * (-halfStride + 2 * halfStride * travel),
      y: floorSettle,
    };
  }
  const swing = ramp(local, stanceEnd, 1);
  const arc = Math.sin(Math.PI * swing);
  return {
    x: direction * (halfStride - 2 * halfStride * swing),
    y: floorSettle - stepHeight * arc * arc,
  };
}

function guardWalkPose(guardClip: AnimationName, phase: number, direction: number): Pose {
  const upperBody = onlyBones(authoredPose(guardClip, phase), heldUpperBodyBones);
  const gaitPhase = direction > 0 ? phase : 1 - phase;
  const root = {
    x: 0,
    y: 0,
  };
  const targets = {
    L: groundedWalkFootTarget(gaitPhase, 0, 1, 150, 20),
    R: groundedWalkFootTarget(gaitPhase, 0.5, 1, 150, 20),
  };
  const hips = upperBody.hips ?? {};
  const reachableRoot = groundedRootForTargets(
    root, hips, targets, balancedGroundedLegRig, GROUNDED_KNEE_MARGIN,
  );
  const legs = groundedLegPose(reachableRoot, hips, targets, balancedGroundedLegRig);
  const strideWave = cycle(gaitPhase);
  return {
    ...upperBody,
    root: reachableRoot,
    ...legs,
    skirtL: { rotation: 3 * strideWave },
    skirtR: { rotation: 3 * strideWave },
    skirtFront: { rotation: -2 * strideWave, y: -1.5 * Math.abs(strideWave) },
  };
}

function dodgeLungePose(phase: number, direction: number): Pose {
  const upperBody = onlyBones(authoredPose("shieldUp", 0.8), heldUpperBodyBones);
  // Hold the committed displacement through the rear-foot catch. Recovering
  // the pelvis as soon as it arrived made the old dodge read as a bounce and
  // could briefly overextend the catching leg; the body and feet now leave
  // the leap together during the final beat.
  const stepOut = ramp(phase, 0.02, 0.24) * (1 - ramp(phase, 0.80, 1));
  const bodyPull = ramp(phase, 0.28, 0.54) * (1 - ramp(phase, 0.80, 1));
  const rearClose = ramp(phase, 0.6, 0.78) * (1 - ramp(phase, 0.84, 1));
  const leadSide = direction > 0 ? "L" : "R";
  const rearSide = direction > 0 ? "R" : "L";
  // The torso follows the lead foot immediately, then commits most of its
  // travel after that foot plants. This is deliberately a large leap rather
  // than the old quick shuffle: the lead sole travels 280 authored pixels and
  // the pelvis settles between the widely separated contacts so neither leg
  // exceeds its fixed length while the solver preserves floor contact.
  const authoredRoot = {
    x: -direction * (140 * stepOut + 40 * bodyPull),
    y: 90 * stepOut + 10 * bodyPull,
  };
  const leadLift = motionLift(phase, 0.02, 0.24, 5.5)
    + motionLift(phase, 0.78, 1, 1.5);
  const rearLift = motionLift(phase, 0.60, 0.78, 1.5)
    + motionLift(phase, 0.84, 1, 1.5);
  const rearTravel = direction > 0 ? 140 : 220;
  const targets: AnkleTargets = {
    // A tiny downward settle compensates for the different male/female boot
    // registrations at this unusually wide extension, keeping the painted
    // sole on the editor's floor rather than hovering above it.
    [leadSide]: { x: -direction * 280 * stepOut, y: leadLift + stepOut },
    [rearSide]: {
      x: -direction * rearTravel * rearClose,
      y: rearLift + bodyPull * (1 - rearClose),
    },
  };
  const root = groundedRootForTargets(
    authoredRoot, 0, targets, dodgeGroundedLegRig, GROUNDED_KNEE_MARGIN,
  );
  const legs = groundedLegPose(root, 0, targets, dodgeGroundedLegRig);
  const lowerBody = {
    root,
    // The held shield pose contains a small idle hip cant. Dodges override it
    // so the leg solver owns the complete pelvis-to-floor relationship.
    hips: { rotation: 0 },
    skirtL: { rotation: direction * (-5 * stepOut - 3 * rearClose) },
    skirtR: { rotation: direction * (-3 * stepOut + 5 * rearClose) },
    skirtFront: { rotation: direction * 4 * bodyPull, y: 5 * bodyPull },
    ...legs,
  };
  return { ...upperBody, ...lowerBody };
}

/**
 * The head art is a no-neck cutout and `neck` owns no layer of its own: the
 * throat and collar are painted into the torso, which rides `chest`. Rotating
 * `head` or `neck` about its own origin therefore swings the skull off a neck
 * that stays put, and the join visibly comes apart.
 *
 * These are the joint positions in each bone's parent space, measured down from
 * the bone origin: the head pivots about the chin line where the cutout meets
 * the painted throat, and the neck pivots about that same point rather than
 * about the collar. Both profiles land within a couple of units of these, and a
 * pivot that is off by `e` only leaves `e * 2sin(angle/2)` of slide, so one
 * shared pair covers the whole cast.
 */
const HEAD_JOINT_Y = 112;
const NECK_JOINT_Y = -24;

/**
 * Rotation delta that turns a bone about a point on its own Y axis instead of
 * about its origin, by adding the translation the rotation would otherwise
 * introduce. `localMatrix` maps a child point p to (x, y) + R * S * p, so
 * holding the joint still costs (I - R) * q, where q is the joint offset in
 * parent-space units.
 */
function rotateAboutJoint(
  rotation: number,
  jointY: number,
): { rotation: number; x: number; y: number } {
  const radians = rotation * Math.PI / 180;
  return {
    rotation,
    x: Math.sin(radians) * jointY,
    y: jointY - Math.cos(radians) * jointY,
  };
}

/** Re-anchor a pose's head and neck rotations onto the painted neck joint. */
export function weldHeadToNeck(pose: Pose): Pose {
  const joints: ReadonlyArray<readonly [string, number]> = [
    ["head", HEAD_JOINT_Y],
    ["neck", NECK_JOINT_Y],
  ];
  for (const [bone, jointY] of joints) {
    const delta = pose[bone];
    if (!delta?.rotation) continue;
    const anchored = rotateAboutJoint(delta.rotation, jointY);
    pose[bone] = {
      ...delta,
      rotation: anchored.rotation,
      x: (delta.x ?? 0) + anchored.x,
      y: (delta.y ?? 0) + anchored.y,
    };
  }
  return pose;
}

export function authoredPose(name: string, phase: number): Pose {
  // Looping gaits wrap; one-shot actions must retain their authored endpoint.
  // Wrapping phase 1 to phase 0 made the final baked sample snap every leg
  // back to its opening solve before the runtime could transition away.
  const t = isAnimationName(name) && animationLoops[name] === false
    ? clamp01(phase)
    : ((phase % 1) + 1) % 1;
  const wave = cycle(t);

  if (name === "staffIdle") {
    const breath = 0.5 + 0.5 * cycle(t, -0.25);
    return {
      root: { y: -4 * breath },
      hips: { x: 1.5 * wave, rotation: 0.9 * wave },
      spine: { rotation: -0.6 * wave },
      chest: { rotation: -1.4 * wave, scaleX: 1 - 0.006 * breath, scaleY: 1 + 0.012 * breath },
      neck: { rotation: 0.5 * wave },
      head: { rotation: 0.9 * cycle(t, 0.08) },
      // A staff, spear or rod is carried upright, gripped at the side rather
      // than held out. The upper arm hangs from the shoulder and the elbow
      // folds to about a right angle, which puts the forearm across the body
      // roughly level and the shaft vertical through the fist.
      //
      // All of the bend is at the elbow: the wrist stays straight, because the
      // vambrace art is painted on the forearm and shears if the hand turns.
      shoulderL: { rotation: -2 + 0.8 * breath },
      upperArmL: { rotation: 12 + 1.4 * wave },
      lowerArmL: { rotation: 66 + 1.6 * wave },
      shoulderR: { rotation: -1.2 * breath },
      upperArmR: { rotation: -1.8 * wave },
      lowerArmR: { rotation: 2.4 + 1.4 * wave },
      skirtL: { rotation: 1.1 * wave },
      skirtR: { rotation: 1.1 * wave },
      skirtFront: { rotation: -0.7 * wave },
    };
  }

  if (name === "run") {
    return stridePose(t, { armArc: 19, elbowArc: 34, halfStride: 150, stepHeight: 20 });
  }

  if (name === "shieldUp") {
    const breath = 0.5 + 0.5 * cycle(t, -0.25);
    const brace = cycle(t, 0.08);
    return {
      root: { y: -3 * breath },
      hips: { rotation: -2 + 0.5 * brace },
      spine: { rotation: 2 - 0.4 * brace },
      chest: { rotation: 4 - 0.8 * brace, scaleX: 1 - 0.004 * breath, scaleY: 1 + 0.008 * breath },
      neck: { rotation: -1 + 0.3 * brace },
      head: { rotation: -2 + 0.5 * brace },
      // A sword or axe stays ready just beyond the shield instead of lifting
      // into a permanent overhead wind-up. The elbow remains softly bent, so
      // the weapon hand reads as a guarded extension rather than a thrust.
      shoulderL: { rotation: 1 + 0.6 * brace },
      upperArmL: { rotation: 52 + 1.2 * brace },
      lowerArmL: { rotation: 38 + 0.8 * brace },
      // The shield forearm folds sharply across the torso. This puts the boss
      // over the sternum and covers the chest while leaving the eyes visible.
      shoulderR: { rotation: -12 - 0.6 * brace },
      upperArmR: { rotation: -11 + 0.8 * brace },
      lowerArmR: { rotation: 120 + 1.2 * brace },
      upperLegL: { rotation: 5 },
      lowerLegL: { rotation: -8 },
      upperLegR: { rotation: -4 },
      lowerLegR: { rotation: -3 },
      skirtL: { rotation: -2 + 0.4 * brace },
      skirtR: { rotation: -2 + 0.4 * brace },
      skirtFront: { rotation: 1 - 0.3 * brace },
    };
  }

  if (name === "staffShieldUp") {
    const breath = 0.5 + 0.5 * cycle(t, -0.25);
    const brace = cycle(t, 0.08);
    return {
      root: { y: -3 * breath },
      hips: { rotation: -2 + 0.5 * brace },
      spine: { rotation: 2 - 0.4 * brace },
      chest: { rotation: 4 - 0.8 * brace, scaleX: 1 - 0.004 * breath, scaleY: 1 + 0.008 * breath },
      neck: { rotation: -1 + 0.3 * brace },
      head: { rotation: -2 + 0.5 * brace },
      // The staff-side arm reuses the proven vertical carry geometry. It keeps
      // the long shaft upright beside the character instead of spearing through
      // the shield or sweeping across the face.
      shoulderL: { rotation: -2 + 0.8 * breath },
      upperArmL: { rotation: 12 + 1.4 * brace },
      lowerArmL: { rotation: 68 + 1.6 * brace },
      // Identical chest guard on both weapon families: bent elbow, shield boss
      // centered over the torso, and only a restrained breathing sway.
      shoulderR: { rotation: -12 - 0.6 * brace },
      upperArmR: { rotation: -11 + 0.8 * brace },
      lowerArmR: { rotation: 120 + 1.2 * brace },
      upperLegL: { rotation: 5 },
      lowerLegL: { rotation: -8 },
      upperLegR: { rotation: -4 },
      lowerLegR: { rotation: -3 },
      skirtL: { rotation: -2 + 0.4 * brace },
      skirtR: { rotation: -2 + 0.4 * brace },
      skirtFront: { rotation: 1 - 0.3 * brace },
    };
  }

  if (name === "staffMoveForward") return heldActionStepPose("staffIdle", t, 1);
  if (name === "staffMoveBackward") return heldActionStepPose("staffIdle", t, -1);
  if (name === "shieldMoveForward") return guardWalkPose("shieldUp", t, 1);
  if (name === "shieldMoveBackward") return guardWalkPose("shieldUp", t, -1);
  if (name === "staffShieldMoveForward") return guardWalkPose("staffShieldUp", t, 1);
  if (name === "staffShieldMoveBackward") return guardWalkPose("staffShieldUp", t, -1);
  if (name === "spellMoveForward") return heldActionStepPose("spellCast", t, 1);
  if (name === "spellMoveBackward") return heldActionStepPose("spellCast", t, -1);
  if (name === "bowMoveForward") return heldActionStepPose("bowDraw", t, 1);
  if (name === "bowMoveBackward") return heldActionStepPose("bowDraw", t, -1);
  if (name === "dodgeForward") return dodgeLungePose(t, 1);
  if (name === "dodgeBackward") return dodgeLungePose(t, -1);

  if (name === "blocked") {
    // A shield counter catches the character at full commitment and deflects the
    // blow upward: the weapon arm is thrown straight overhead through the
    // front while the shield arm stays in guard. The fast opening beat makes
    // the impact read and the long hold leaves an exposed silhouette before
    // recovery, but the body is deliberately understated: the den's BLOCKED
    // callout tells the player what happened.
    const impact = ramp(t, 0, 0.14);
    const recover = ramp(t, 0.68, 1);
    const exposed = impact * (1 - recover);
    const beat = (value: number): number => value * exposed;
    return {
      // Unmirrored characters face screen-left, so positive X is backward. The
      // map position remains fixed: this is recoil inside the actor frame.
      root: { x: beat(22), y: beat(10) },
      hips: { rotation: beat(-4) },
      spine: { rotation: beat(-6) },
      chest: { rotation: beat(-10) },
      neck: { rotation: beat(2) },
      head: { rotation: beat(4) },
      // The weapon arm goes up the same front arc the swing wind-up uses, so
      // the deflected blade ends overhead rather than behind the body. The
      // elbow stays slightly bent so the weapon does not stand on end.
      shoulderL: { rotation: beat(12) },
      upperArmL: { rotation: beat(130), scaleY: 1 - 0.04 * exposed },
      lowerArmL: { rotation: beat(30) },
      // The shield arm absorbs the counter in place: a small jolt back toward
      // the body, still raised in front.
      shoulderR: { rotation: beat(-6) },
      upperArmR: { rotation: beat(-12) },
      lowerArmR: { rotation: beat(10) },
      // A slightly widened stance keeps the reaction grounded and reads as a
      // stumble rather than a loss of balance.
      upperLegL: { rotation: beat(-10) },
      lowerLegL: { rotation: beat(-14) },
      footL: { rotation: beat(8) },
      upperLegR: { rotation: beat(12) },
      lowerLegR: { rotation: beat(-12) },
      footR: { rotation: beat(-6) },
      skirtL: { rotation: beat(-5) },
      skirtR: { rotation: beat(-5) },
      skirtFront: { rotation: beat(3), y: beat(3) },
    };
  }

  if (name === "swordSwing") {
    // Rotations are absolute targets blended between rest, wind-up, and strike
    // rather than stacked deltas, so no joint can drift past its pose.
    //
    // The screen-left arm carries the blade: it lifts overhead on the wind-up
    // and chops down across the body on the strike. The screen-right arm never
    // joins the arc; it holds a bent guard with the hand up the whole way
    // through, reading either as a shield block or as a readied spell.
    const windup = ramp(t, 0, 0.42);
    const strike = ramp(t, 0.42, 0.62);
    const settle = ramp(t, 0.62, 1);
    const load = windup * (1 - strike);
    const follow = strike * (1 - 0.8 * settle);
    const blend = (rest: number, wound: number, struck: number): number =>
      rest * (1 - load - follow) + wound * load + struck * follow;
    // Held poses stay at one value across all three keys so the guard arm is
    // static while the blade arm travels.
    const hold = (value: number): number => blend(value, value, value);
    // `follow` deliberately keeps a fifth of the strike alive to the last
    // frame so the arms do not freeze at contact. The lunge has its own two
    // recovery beats: the lead foot stays planted through impact while the
    // rear foot catches up first, then the lead leg relaxes into neutral.
    const leadRecovery = ramp(t, 0.80, 0.96);
    const leadStep = strike * (1 - leadRecovery);
    const leadStride = (wound: number, struck: number): number => wound * load + struck * leadStep;
    const hipTwist = blend(0, 7, -9);
    const spineTwist = blend(0, 6, -8);
    const chestTwist = blend(0, 12, -16);
    // Cancelling the torso twist out of the guard shoulder keeps that arm
    // aimed where it started while the body turns through the blow, the way a
    // raised shield or a readied spell holds on the threat instead of swinging
    // around with the hips.
    const torsoTwist = hipTwist + spineTwist + chestTwist;
    const authoredRoot = { x: leadStride(-4, -26), y: leadStride(-4, 10) };
    // Recover the exact pre-solver leg tracks and use their screen-space ankle
    // travel as the IK target. Only the height is replaced: the left foot lands
    // before the blade comes down, while the right foot supports the strike and
    // performs its original catch-up during recovery.
    const rearRecovery = ramp(t, 0.62, 0.88);
    const rearStep = strike * (1 - rearRecovery);
    const rearStride = (wound: number, struck: number): number => wound * load + struck * rearStep;
    const authoredLegPose = {
      root: authoredRoot,
      hips: { rotation: hipTwist },
      upperLegL: { rotation: leadStride(18, 38) },
      lowerLegL: { rotation: leadStride(-22, -48) },
      upperLegR: { rotation: rearStride(-18, -20) },
      lowerLegR: { rotation: rearStride(-6, -10) },
    };
    const leadSupport = ramp(t, 0.34, 0.46) * (1 - ramp(t, 0.80, 0.96));
    const leadPlantSettle = 4.5 * ramp(t, 0.605, 0.62) * (1 - ramp(t, 0.80, 0.92));
    const rearImpactSettle = 3 * strike * (1 - ramp(t, 0.62, 0.68));
    const kneeMargin = GROUNDED_KNEE_MARGIN
      + 2 * Math.max(load, strike * (1 - ramp(t, 0.96, 1)));
    const legs = groundAuthoredFootTravel(authoredLegPose, {
      L: motionLift(t, 0, 0.42, 9) + motionLift(t, 0.80, 0.98, 8)
        - 3 * strike + leadPlantSettle,
      R: motionLift(t, 0.62, 0.88, 6)
        - 3 * strike + rearImpactSettle,
    }, { L: leadSupport, R: 1 - leadSupport }, kneeMargin);
    return {
      // The map carries the full collision-aware step. This smaller local root
      // drive makes the body visibly commit into that travel instead of
      // skating upright with the feet underneath it.
      root: legs.root,
      hips: { rotation: hipTwist },
      spine: { rotation: spineTwist },
      chest: { rotation: chestTwist },
      neck: { rotation: blend(0, -3, 4) },
      head: { rotation: blend(0, -5, 6) },
      shoulderL: { rotation: blend(0, 15, -14) },
      // Strike values are local, and hips/spine/chest/shoulder already carry
      // about 32 degrees of counter-twist into the blow, so this lands the arm
      // just past vertical in world space. Swinging further would bury it
      // behind the torso, whose layers draw over the blade arm, on exactly the
      // frames that have to read as the hit.
      upperArmL: { rotation: blend(0, 138, 8) },
      // Near-straight at impact so the blade line reads as one arc, then the
      // elbow re-folds on the way back to guard.
      lowerArmL: { rotation: blend(0, 28, 2) },
      shoulderR: { rotation: hold(-10) - torsoTwist },
      upperArmR: { rotation: hold(-11) },
      // The animation library is shared while the forearm binds are not
      // (femaleV1 -14.2, maleV1 +26.1), and the elbow hinge only accepts a
      // total of 0 to 155 degrees, so the usable fold is a narrow band. This
      // sits inside it for both and still reads as a raised guard.
      lowerArmR: { rotation: hold(120) },
      // Solve the whole pelvis-to-sole chain instead of rotating three leg
      // sprites independently. This keeps the support boot on the floor and
      // keeps the moving boot's clearance deliberately small.
      ...legs.pose,
      skirtL: { rotation: blend(0, 6, -11) },
      skirtR: { rotation: blend(0, 6, -11) },
      skirtFront: { rotation: blend(0, 3, -7) },
    };
  }

  if (name === "sneakAttack") {
    // A low, coiled version of the swing: the character drops into a deep crouch
    // on both knees, tucks the blade in against the ribs, then drives out of
    // that crouch into a lunge and throws the weapon arm out and forward. Both
    // weights fall back to zero by the last frame, so the clip ends standing
    // rather than holding any part of the attack.
    const coil = ramp(t, 0, 0.35) * (1 - ramp(t, 0.35, 0.55));
    const drive = ramp(t, 0.35, 0.55) * (1 - ramp(t, 0.62, 1));
    const beat = (crouched: number, struck: number): number => crouched * coil + struck * drive;
    // Peak the extra reach at 0.60 seconds in this 1.15-second clip. The
    // matching hand counter-rotation lives in the visible wrist key track,
    // rather than being hidden inside this procedural body pose.
    const extension = ramp(t, 0.40, 0.60 / animationDurations.sneakAttack)
      * (1 - ramp(t, 0.60 / animationDurations.sneakAttack, 0.72));
    const armReach = 52 * extension;
    // The coil twists away; the strike barely twists back. Torso rotation on
    // the strike would eat the elbow's budget below, because it all has to be
    // cancelled out of the same hinge.
    const hipTwist = beat(-6, 1);
    const spineTwist = beat(-4, 1);
    const chestTwist = beat(-8, 1);
    // Same trick as the sword swing: taking the torso twist back out of the
    // guard shoulder keeps that arm pointed where it started.
    const torsoTwist = hipTwist + spineTwist + chestTwist;
    const bladeShoulder = beat(-10, 0);
    // The elbow does the work: a hard fold cocks the fist back beside the ribs,
    // then it pays most of that back as the stab runs out.
    // The straightening has to clear the hinge floor on the shallower of the
    // two forearm binds, and those are authored per profile: -9 leaves maleV1
    // at 4.2 degrees and femaleV1 at 13.9. Lower a forearm bind past this and
    // the hinge test in rig-model.test.mjs will say so.
    const bladeElbow = beat(90, -9);
    // The old pose cancelled everything above the wrist and therefore limited
    // the stab to the short arc of a hanging upper arm. Drive that upper arm
    // forward now, then pay the angle back at the deformable wrist so the blade
    // remains a thrust instead of pitching upward.
    const bladeUpperArm = -(torsoTwist + bladeShoulder + bladeElbow) + armReach;
    const authoredRoot = { x: beat(8, -38), y: beat(30, 22) };
    // Preserve the old crouch/lunge leg tracks as horizontal targets. The
    // screen-right foot remains the brace; the lead foot clears the floor only
    // while travelling into and out of the lunge.
    const authoredLegPose = {
      root: authoredRoot,
      hips: { rotation: hipTwist },
      upperLegL: { rotation: beat(10, 30) },
      lowerLegL: { rotation: beat(-34, -40) },
      upperLegR: { rotation: beat(-12, -20) },
      lowerLegR: { rotation: beat(-30, -34) },
    };
    const leadLift = motionLift(t, 0.35, 0.55, 7) + motionLift(t, 0.62, 0.95, 7);
    const legs = groundAuthoredFootTravel(
      authoredLegPose,
      { L: leadLift + drive, R: 0 },
      { L: 0, R: 1 },
      GROUNDED_KNEE_MARGIN + 2 * Math.max(coil, drive),
    );
    return {
      // Sinks onto the coil, then the whole body steps in behind the blade:
      // with the forearm direction pinned, this is where most of the forward
      // reach comes from.
      root: legs.root,
      hips: { rotation: hipTwist },
      spine: { rotation: spineTwist },
      chest: { rotation: chestTwist },
      neck: { rotation: beat(4, -3) },
      head: { rotation: beat(6, -5) },
      shoulderL: { rotation: bladeShoulder },
      // Derived, not authored: it swings back to absorb the elbow fold and
      // forward as the elbow pays it back. Squashing scaleY as it extends
      // foreshortens the limb, which is how this rig sells depth.
      upperArmL: { rotation: bladeUpperArm, scaleY: 1 + beat(0, -0.08) },
      // Folded hard against the ribs on the tuck, straightening past its own
      // bind angle as the arm runs out.
      lowerArmL: { rotation: bladeElbow, scaleY: 1 + beat(0, -0.06) },
      // The guard arm holds the same pose it holds through the sword swing.
      shoulderR: { rotation: -10 - torsoTwist },
      upperArmR: { rotation: -11 },
      lowerArmR: { rotation: 120 },
      // These are solved from the floor targets above instead of independently
      // rotated. That prevents the old screen-right boot from floating upward
      // by more than fifty pixels during the coil.
      ...legs.pose,
      skirtL: { rotation: beat(-8, 9) },
      skirtR: { rotation: beat(-8, 9) },
      skirtFront: { rotation: beat(5, -8), y: beat(-4, -6) },
    };
  }

  if (name === "spellCast") {
    // The same coil-and-release shape the sneak attack was originally built
    // on: drop onto both knees, gather the casting hand in against the ribs,
    // then drive out of the crouch and throw it open and forward. It reads as
    // a cast rather than a stab because the hand turns over with the arm
    // instead of holding a blade level, and because it is played open-handed.
    const gather = ramp(t, 0, 0.35) * (1 - ramp(t, 0.35, 0.55));
    // Reach the cast endpoint, then hold it. The gameplay runtime keeps this
    // clip active for as long as the spell remains held or charging and blends
    // back out only after release/cancel.
    const release = ramp(t, 0.35, 0.55);
    const beat = (gathered: number, cast: number): number => gathered * gather + cast * release;
    const hipTwist = beat(-6, 7);
    const spineTwist = beat(-4, 5);
    const chestTwist = beat(-8, 10);
    // Taking the torso twist back out of the off shoulder keeps that arm
    // pointed where it started while the body turns under it.
    const torsoTwist = hipTwist + spineTwist + chestTwist;
    return {
      // Sinks through the gather and stays low across the release.
      // Sinks onto the coil, then the whole body steps in behind the blade:
      // with the forearm direction pinned, this is where most of the forward
      // reach comes from.
      root: { x: beat(8, -38), y: beat(30, 22) },
      hips: { rotation: hipTwist },
      spine: { rotation: spineTwist },
      chest: { rotation: chestTwist },
      neck: { rotation: beat(4, -3) },
      head: { rotation: beat(6, -5) },
      shoulderL: { rotation: beat(-8, 6) },
      // Gathered in against the ribs, then thrown open and forward. Squashing
      // scaleY as it extends foreshortens the limb, which is how this
      // near-front-facing rig sells depth.
      upperArmL: { rotation: beat(-12, 55), scaleY: 1 + beat(0, -0.08) },
      lowerArmL: { rotation: beat(95, 10), scaleY: 1 + beat(0, -0.06) },
      // The off hand holds the same guard the attacks hold, which doubles as a
      // readied spell in the palm.
      shoulderR: { rotation: -10 - torsoTwist },
      upperArmR: { rotation: -11 },
      lowerArmR: { rotation: 120 },
      // Both knees carry the crouch, and the lead leg steps out on the release.
      upperLegL: { rotation: beat(10, 30) },
      lowerLegL: { rotation: beat(-34, -40) },
      footL: { rotation: beat(12, 4) },
      upperLegR: { rotation: beat(-12, -20) },
      lowerLegR: { rotation: beat(-30, -34) },
      footR: { rotation: beat(20, 26) },
      skirtL: { rotation: beat(-8, 9) },
      skirtR: { rotation: beat(-8, 9) },
      skirtFront: { rotation: beat(5, -8), y: beat(-4, -6) },
    };
  }

  if (name === "bowDraw") {
    // Bow arm out first, then the string hand meets it and draws straight back.
    const raise = ramp(t, 0, 0.3);
    const reach = ramp(t, 0.05, 0.4);
    const pull = ramp(t, 0.4, 0.8);
    // Reach and anchor are absolute poses for the string arm, crossfaded rather
    // than added, so the hand travels between them instead of past them.
    const stringArm = (reached: number, anchored: number): number =>
      reached * (reach - pull) + anchored * pull;
    return {
      hips: { rotation: 5 * raise },
      spine: { rotation: 3 * raise },
      chest: { rotation: -7 * raise + 4 * pull },
      neck: { rotation: 2 * raise },
      head: { rotation: 4 * raise },
      // The bow arm straightens out to the horizontal and locks there. The bow
      // sits perpendicular to it from its own bind rotation, and the wrist
      // never turns, so the limbs stay square to the arm through the draw.
      shoulderL: { rotation: 10 * raise },
      upperArmL: { rotation: 82 * raise },
      lowerArmL: { rotation: -10 * raise },
      // The string hand reaches out to the bow, then draws back until the fist
      // itself sits on the collarbone -- the drawn hand runs about 50 units
      // past the wrist bone, so anchoring the wrist there would leave the
      // fingers on the sternum. Solved against both bodies at once: the fist
      // lands within 10 units of the collarbone on each, with the elbow drawn
      // 70 behind the shoulder.
      //
      // The shoulder lifts by rotation only. Translating it would carry the
      // socket off the painted torso it is fitted to, which is the seam that
      // pulls the pauldron away from the body.
      shoulderR: { rotation: stringArm(-8, 12) },
      upperArmR: { rotation: stringArm(92, -28) },
      lowerArmR: { rotation: stringArm(6, 128) },
      upperLegL: { rotation: -6 * raise },
      // The hips turn into the shot, which carries both legs with them. Left
      // alone that swings the screen-right leg in under the midline, so this
      // rotation has to out-run the hips: it takes the leg back past vertical
      // and a little further, planting it out to the side as a brace.
      upperLegR: { rotation: -10 * raise },
      skirtL: { rotation: -4 * raise },
      skirtR: { rotation: -4 * raise },
    };
  }

  // Idle: a slow breath plus a little weight shift, nothing that pops.
  const breath = 0.5 + 0.5 * cycle(t, -0.25);
  return {
    root: { y: -4 * breath },
    hips: { rotation: 0.9 * wave, x: 1.5 * wave },
    spine: { rotation: -0.6 * wave },
    chest: { rotation: -1.4 * wave, scaleY: 1 + 0.012 * breath, scaleX: 1 - 0.006 * breath },
    neck: { rotation: 0.5 * wave },
    head: { rotation: 0.9 * cycle(t, 0.08) },
    shoulderL: { rotation: 1.2 * breath },
    shoulderR: { rotation: -1.2 * breath },
    upperArmL: { rotation: 1.8 * wave },
    lowerArmL: { rotation: 2.4 + 1.4 * wave },
    upperArmR: { rotation: -1.8 * wave },
    lowerArmR: { rotation: 2.4 + 1.4 * wave },
    skirtL: { rotation: 1.1 * wave },
    skirtR: { rotation: 1.1 * wave },
    skirtFront: { rotation: -0.7 * wave },
  };
}

/**
 * Add one pose on top of another. Scale multiplies and everything else sums,
 * which is what makes editor corrections additive to the procedural clip.
 */
export function mergePoses(base: Pose, overlay: Pose): Pose {
  const result: Pose = structuredClone(base);
  for (const [bone, delta] of Object.entries(overlay)) {
    const current: PoseDelta = { ...(result[bone] ?? {}) };
    for (const key of poseDeltaKeys) {
      const value = delta[key];
      if (value === undefined) continue;
      current[key] = key === "scaleX" || key === "scaleY"
        ? (current[key] ?? 1) * value
        : (current[key] ?? 0) + value;
    }
    result[bone] = current;
  }
  return result;
}

const poseDeltaKeys = ["x", "y", "rotation", "scaleX", "scaleY"] as const;
