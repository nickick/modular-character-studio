export const identity = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function multiply(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function inverse(matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-8) throw new Error("Cannot invert singular matrix");
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

export function transformPoint(matrix, point) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function localMatrix(x, y, rotationDegrees = 0, scaleX = 1, scaleY = 1) {
  const radians = rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    a: cosine * scaleX,
    b: sine * scaleX,
    c: -sine * scaleY,
    d: cosine * scaleY,
    e: x,
    f: y,
  };
}

function boneLocalMatrix(bone, pose) {
  const delta = pose[bone.id] ?? {};
  // Bind scale is a registration value: scaling a bone scales every
  // attachment parented to it, offsets included, so resizing the head does
  // not strand the eyes, brows, nose, mouth, and hair at their old places.
  return localMatrix(
    bone.x + (delta.x ?? 0),
    bone.y + (delta.y ?? 0),
    (bone.rotation ?? 0) + (delta.rotation ?? 0),
    (bone.scaleX ?? 1) * (delta.scaleX ?? 1),
    (bone.scaleY ?? 1) * (delta.scaleY ?? 1)
  );
}

function parentChainMatrices(bones) {
  const worlds = {};
  for (const bone of bones) {
    const local = boneLocalMatrix(bone, {});
    worlds[bone.id] = bone.parent ? multiply(worlds[bone.parent], local) : local;
  }
  return worlds;
}

/**
 * A bone with `fitBones` is seated by the same best-fit transform that seats a
 * `fitBones` layer, instead of by its parent's posed matrix.
 *
 * The torso art is one such layer: `tunicBody` is fitted across hips, spine,
 * and chest, so the painted throat and collar do not sit in chest space at all
 * once that chain rotates. A head parented the ordinary way through `chest`
 * therefore drifts off the neck it is supposed to sit on -- about 36 units at
 * the peak of the sword swing, which reads as the head coming off. Fitting
 * `neck` to the same three bones pins the whole head chain to wherever the fit
 * actually put the art, so the join holds for any pose, while the bone's own
 * pose delta still applies on top of it as an ordinary local transform.
 */
export function worldMatrices(bones, pose = {}) {
  // At the bind pose every fit is the identity, so the reference chain is the
  // plain parent chain. Solving it that way also keeps this from recursing.
  const bindWorlds = bones.some((bone) => bone.fitBones) ? parentChainMatrices(bones) : null;
  const worlds = {};
  for (const bone of bones) {
    const local = boneLocalMatrix(bone, pose);
    if (bone.fitBones) {
      for (const id of bone.fitBones) {
        if (!worlds[id]) throw new Error(`Bone ${bone.id} fits to ${id}, which must be solved first`);
      }
      const seat = multiBoneRigidDelta(bindWorlds, worlds, bone.fitBones);
      const parentBind = bone.parent ? bindWorlds[bone.parent] : identity();
      worlds[bone.id] = multiply(multiply(seat, parentBind), local);
    } else {
      worlds[bone.id] = bone.parent ? multiply(worlds[bone.parent], local) : local;
    }
  }
  return worlds;
}

const LAYER_BIND_KEYS = ["x", "y", "rotation", "scaleX", "scaleY", "pivotX", "pivotY", "planeYaw"];
const BONE_POSE_KEYS = ["x", "y", "rotation"];

/**
 * Commit user-authored pose deltas into one profile's bind pose. Animation
 * deltas are never passed here, so saving cannot accidentally bake a frame.
 */
export function bakePoseIntoProfile(scene, profile, pose = {}) {
  for (const bone of scene.bones) {
    const delta = pose[bone.id];
    const bind = bone.bindByProfile?.[profile];
    if (!delta || !bind) continue;
    for (const key of BONE_POSE_KEYS) {
      if (!Number.isFinite(delta[key])) continue;
      bind[key] = Number(((bind[key] ?? 0) + delta[key]).toFixed(3));
    }
  }
  return scene;
}

/**
 * Equipment and outfit slots. Each names the scene key holding the active id,
 * the catalogue it indexes, and which layers it dresses.
 *
 * An option always carries art. It may also carry its own bind, because items
 * in a slot are not always registered to a common anchor -- the six necklaces
 * put the cord's collar point anywhere from x=243 to x=684 on their shared
 * canvas, so one placement cannot serve them all. Art authored against a slot's
 * registration can leave the bind out and inherit the layer's.
 */
const HEADGEAR_LAYER_ID = "headgear";

export const optionSlots = [
  { active: "activeNecklace", catalogue: "necklaceOptions", dresses: (layer) => layer.id === "necklace" },
  { active: "activeQuiver", catalogue: "quiverOptions", dresses: (layer) => layer.id === "quiver" },
  // Held equipment. Which clips show each of these is `animationEquipment`
  // below, which is also what decides the poses worth reviewing a placement in.
  { active: "activeWeapon", catalogue: "weaponOptions", dresses: (layer) => layer.id === "weapon" },
  { active: "activeStaff", catalogue: "staffOptions", dresses: (layer) => layer.id === "staff" },
  { active: "activeBow", catalogue: "bowOptions", dresses: (layer) => layer.id === "bow" },
  { active: "activeShield", catalogue: "shieldOptions", dresses: (layer) => layer.id === "shield" },
  { active: "activeRing", catalogue: "ringOptions", dresses: (layer) => layer.id === "ring" },
  { active: "activeChest", catalogue: "chestOptions", dresses: (layer) => layer.id === "tunicBody" },
  { active: "activeHeadgear", catalogue: "headgearOptions", dresses: (layer) => layer.id === HEADGEAR_LAYER_ID },
  { active: "activeArmSet", catalogue: "armOptions", byLayer: true },
  { active: "activeBootSet", catalogue: "bootOptions", byLayer: true },
];

/**
 * What a slot dresses a layer in, or null when no slot claims it. `assetByLayer`
 * options dress several layers at once, which is how a set of arms or boots
 * swaps its four pieces together.
 */
export function layerOption(scene, layer) {
  for (const slot of optionSlots) {
    const chosen = (scene[slot.catalogue] ?? []).find((option) => option.id === scene[slot.active]);
    if (!chosen) continue;
    if (slot.byLayer) {
      const asset = chosen.assetByLayer?.[layer.id];
      if (asset) return { option: chosen, asset, bind: chosen.bindByLayer?.[layer.id] };
      continue;
    }
    if (!slot.dresses(layer)) continue;
    if (chosen.assetByProfile) return { option: chosen, asset: chosen.assetByProfile, bind: chosen.bindByProfile };
  }
  return null;
}

/**
 * Where a layer's placement is stored for a profile, which is not always the
 * layer: an option that dresses a layer and carries its own bind owns that
 * placement, so an edit has to be written back to the option it came from.
 * Otherwise the option keeps winning and the edit looks like it never saved.
 */
export function layerBindOwner(scene, layer, profile) {
  const dressed = layerOption(scene, layer);
  if (dressed?.bind?.[profile]) return dressed.bind[profile];
  return layer.bindByProfile?.[profile] ?? null;
}

/**
 * Flatten a profile's bind pose onto the shared skeleton. Bone names, hierarchy,
 * and the animation library are shared across body profiles; the bind offsets
 * and attachment placements are not, because the male and female pieces are
 * authored at different sizes.
 */
/**
 * Fold a manual pose into one clip's corrections. The bind pose is left alone,
 * so the fix lands on the clip being looked at and nowhere else.
 */
export function bakePoseIntoClip(scene, animation, pose = {}) {
  const offsets = scene.clipPoseOffsets ?? (scene.clipPoseOffsets = {});
  const clip = offsets[animation] ?? (offsets[animation] = {});
  for (const [bone, delta] of Object.entries(pose)) {
    const current = clip[bone] ?? {};
    for (const key of BONE_POSE_KEYS) {
      if (!Number.isFinite(delta[key])) continue;
      current[key] = Number(((current[key] ?? 0) + delta[key]).toFixed(3));
    }
    if (Object.keys(current).length) clip[bone] = current;
  }
  setClipPoseOffsets(offsets);
  return scene;
}

export function resolveProfile(
  scene,
  profile,
  chestID = scene.activeChest,
  armSetID = scene.activeArmSet,
  headgearID = scene.activeHeadgear,
  bootSetID = scene.activeBootSet,
  necklaceID = scene.activeNecklace,
  held = {}
) {
  // Callers pass an id to preview a slot without changing what the scene wears.
  // Anything unrecognised falls back to the worn option rather than undressing.
  const worn = {
    activeChest: chestID, activeArmSet: armSetID, activeHeadgear: headgearID,
    activeBootSet: bootSetID, activeNecklace: necklaceID,
    activeQuiver: held.quiver ?? scene.activeQuiver,
    activeWeapon: held.weapon ?? scene.activeWeapon,
    activeStaff: held.staff ?? scene.activeStaff,
    activeBow: held.bow ?? scene.activeBow,
    activeShield: held.shield ?? scene.activeShield,
  };
  const selection = { ...scene };
  for (const slot of optionSlots) {
    const requested = worn[slot.active];
    selection[slot.active] = (scene[slot.catalogue] ?? []).some((option) => option.id === requested)
      ? requested
      : scene[slot.active];
  }
  // Front hair is an uncovered-head layer. Keep it authored and selectable so
  // removing or hiding the helmet restores it automatically; only suppress it
  // in the assembled rig while a real, visible headgear option is being worn.
  const hidesFrontHair = scene.layers.some((layer) => (
    layer.visible
      && layer.id === HEADGEAR_LAYER_ID
      && (scene.headgearOptions ?? []).some((option) => option.id === selection.activeHeadgear)
  ));
  const bones = scene.bones.map((bone) => ({
    id: bone.id,
    label: bone.label,
    parent: bone.parent,
    // Seating is skeleton data, not per-profile bind data: both profiles hang
    // the head off the same fitted torso frame.
    ...(bone.fitBones ? { fitBones: bone.fitBones } : {}),
    ...bone.bindByProfile[profile],
  }));
  const layers = scene.layers.map((layer) => {
    // Whatever the slot is wearing wins over the layer's own art and, when the
    // option carries one, over its placement too. Resolving here means the
    // editor and the offline renderer preview what the game will show rather
    // than the undressed layer underneath.
    const dressed = layerOption(selection, layer);
    // `assetByLayer` options name one file per layer; `assetByProfile` options
    // name one per body. Both arrive here, so accept either shape.
    const dressedAsset = typeof dressed?.asset === "string" ? dressed.asset : dressed?.asset?.[profile];
    const bind = dressed?.bind?.[profile] ?? layer.bindByProfile[profile];
    const visible = layer.visible && !(layer.id === "hairFront" && hidesFrontHair);
    const resolved = { ...layer, visible, asset: dressedAsset ?? layer.assetByProfile[profile] };
    for (const key of LAYER_BIND_KEYS) resolved[key] = bind[key];
    return resolved;
  });
  return { bones, layers };
}

/**
 * A flat attachment painted front-on sits wrong on an angled body:
 * a necklace's loop stays as wide on the far side of the chest as on the near
 * one. `planeYaw` turns the layer's plane about its vertical axis and projects
 * it, which pulls the far corners in towards the centre line, compresses the
 * detail between them, and leaves the near edge where it is.
 *
 * The projection is sliced into vertical strips because every renderer here --
 * canvas, Pillow, CoreGraphics -- can only draw an affine transform, and a
 * yawed plane is projective. Twenty-four strips is past the point where the
 * seams are visible at this canvas size.
 */
export const PLANE_STRIPS = 24;
/** Camera distance, in multiples of the layer's own width. */
const PLANE_DISTANCE = 2.4;

/**
 * Where a column of the layer lands once its plane is yawed, as a fraction of
 * the layer's width, plus how much that column foreshortens. Yaw is signed by
 * which side turns away: positive sends the screen-right corners back, negative
 * the screen-left ones. This rig draws the right arm over the torso, so
 * screen-left is its far side and a necklace wants a negative yaw.
 */
export function planeYawSample(u, yawDegrees) {
  if (!yawDegrees) return { u, scale: 1 };
  const yaw = yawDegrees * Math.PI / 180;
  const offset = u - 0.5;
  const depth = PLANE_DISTANCE + offset * Math.sin(yaw);
  const scale = PLANE_DISTANCE / depth;
  return { u: 0.5 + offset * Math.cos(yaw) * scale, scale };
}

/**
 * The strips a yawed layer is drawn in: each names the slice of source image it
 * takes and where that slice lands, in the layer's own local space.
 */
export function planeStrips(layer, imageWidth, imageHeight, strips = PLANE_STRIPS) {
  const yaw = layer.planeYaw ?? 0;
  if (!yaw) return null;
  const pivotY = (layer.pivotY ?? 0.5) * imageHeight;
  const out = [];
  for (let index = 0; index < strips; index += 1) {
    const from = planeYawSample(index / strips, yaw);
    const to = planeYawSample((index + 1) / strips, yaw);
    const scale = (from.scale + to.scale) / 2;
    out.push({
      sourceX: (index / strips) * imageWidth,
      sourceWidth: imageWidth / strips,
      x: from.u * imageWidth,
      width: Math.max(0.01, (to.u - from.u) * imageWidth),
      // Foreshortening shrinks a column about the row the layer hangs from.
      y: pivotY - pivotY * scale,
      height: imageHeight * scale,
    });
  }
  return out;
}

export function layerLocalMatrix(layer, imageWidth, imageHeight) {
  const placement = localMatrix(layer.x, layer.y, layer.rotation, layer.scaleX, layer.scaleY);
  const pivot = localMatrix(-layer.pivotX * imageWidth, -layer.pivotY * imageHeight);
  return multiply(placement, pivot);
}

/**
 * Best-fit rigid delta carrying bind-pose control points to their posed
 * positions. This is a single translate/rotate/uniform-scale transform, not a
 * mesh: the attachment stays rigid while all listed bones influence where the
 * complete sprite is seated.
 */
export function multiBoneRigidDelta(bindWorld, currentWorld, boneIDs) {
  if (!Array.isArray(boneIDs) || boneIDs.length < 2) return identity();
  const source = boneIDs.map((id) => transformPoint(bindWorld[id], { x: 0, y: 0 }));
  const target = boneIDs.map((id) => transformPoint(currentWorld[id], { x: 0, y: 0 }));
  const sourceCenter = source.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  const targetCenter = target.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  sourceCenter.x /= source.length; sourceCenter.y /= source.length;
  targetCenter.x /= target.length; targetCenter.y /= target.length;
  let denominator = 0;
  let cosineScale = 0;
  let sineScale = 0;
  for (let index = 0; index < source.length; index += 1) {
    const sx = source[index].x - sourceCenter.x;
    const sy = source[index].y - sourceCenter.y;
    const tx = target[index].x - targetCenter.x;
    const ty = target[index].y - targetCenter.y;
    denominator += sx * sx + sy * sy;
    cosineScale += sx * tx + sy * ty;
    sineScale += sx * ty - sy * tx;
  }
  if (denominator < 1e-8) return identity();
  const a = cosineScale / denominator;
  const b = sineScale / denominator;
  const c = -b;
  const d = a;
  return {
    a, b, c, d,
    e: targetCenter.x - a * sourceCenter.x - c * sourceCenter.y,
    f: targetCenter.y - b * sourceCenter.x - d * sourceCenter.y,
  };
}

export function rigidLayerMatrix(layer, imageWidth, imageHeight, bindWorld, currentWorld) {
  const local = layerLocalMatrix(layer, imageWidth, imageHeight);
  if (!layer.fitBones) return multiply(currentWorld[layer.bone], local);
  const bindMatrix = multiply(bindWorld[layer.bone], local);
  return multiply(multiBoneRigidDelta(bindWorld, currentWorld, layer.fitBones), bindMatrix);
}

const meshClamp01 = (value) => Math.max(0, Math.min(1, value));
const meshSmoothstep01 = (value) => {
  const t = meshClamp01(value);
  return t * t * (3 - 2 * t);
};

/**
 * Build the deliberately small two-bone grid used by a universal hand.
 *
 * The grid covers the complete transparent PNG, but only vertices between the
 * authored `bendStart` and `bendEnd` points blend. Everything beyond the
 * distal point is 100% hand, so the painted palm and fingers move as a rigid
 * unit. This follows the common 100% parent -> smooth middle -> 100% child
 * workflow instead of smearing low weights across the whole attachment.
 */
export function weightedGridMesh(mesh, imageWidth, imageHeight) {
  if (!mesh || mesh.type !== "weightedGridV1") return null;
  const start = mesh.bendStart;
  const end = mesh.bendEnd;
  const axisX = end.x - start.x;
  const axisY = end.y - start.y;
  const axisLengthSquared = axisX * axisX + axisY * axisY;
  if (axisLengthSquared < 1e-8) throw new Error("Weighted mesh bend axis cannot have zero length");

  const vertices = [];
  for (const v of mesh.rows) {
    for (const u of mesh.columns) {
      const projection = ((u - start.x) * axisX + (v - start.y) * axisY) / axisLengthSquared;
      const childWeight = meshSmoothstep01(projection);
      vertices.push({
        source: { x: u * imageWidth, y: v * imageHeight },
        weights: [
          { bone: mesh.parentBone, weight: 1 - childWeight },
          { bone: mesh.childBone, weight: childWeight },
        ],
      });
    }
  }

  const triangles = [];
  const width = mesh.columns.length;
  for (let row = 0; row < mesh.rows.length - 1; row += 1) {
    for (let column = 0; column < mesh.columns.length - 1; column += 1) {
      const topLeft = row * width + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + width;
      const bottomRight = bottomLeft + 1;
      // Alternating the diagonal avoids a permanent directional crease through
      // a bent wrist while keeping the topology deterministic.
      if ((row + column) % 2 === 0) {
        triangles.push([topLeft, bottomLeft, bottomRight], [topLeft, bottomRight, topRight]);
      } else {
        triangles.push([topLeft, bottomLeft, topRight], [topRight, bottomLeft, bottomRight]);
      }
    }
  }
  return { vertices, triangles };
}

/**
 * Build a two-rail cage around the complete source image. `bendStops` only
 * subdivides the short wrist transition; rigid cap sections are added far
 * enough along the bend axis to cover every source-image corner. Two vertices
 * at each station share one transform, which lets deformation preserve the
 * distance between the dorsal and palm rails instead of narrowing the wrist.
 */
export function weightedStripMesh(mesh, imageWidth, imageHeight) {
  if (!mesh || mesh.type !== "weightedStripV2") return null;
  const start = { x: mesh.bendStart.x * imageWidth, y: mesh.bendStart.y * imageHeight };
  const end = { x: mesh.bendEnd.x * imageWidth, y: mesh.bendEnd.y * imageHeight };
  const axis = { x: end.x - start.x, y: end.y - start.y };
  const axisLengthSquared = axis.x * axis.x + axis.y * axis.y;
  if (axisLengthSquared < 1e-8) throw new Error("Weighted strip bend axis cannot have zero length");
  const axisLength = Math.sqrt(axisLengthSquared);
  const normal = { x: -axis.y / axisLength, y: axis.x / axisLength };
  const corners = [
    { x: 0, y: 0 }, { x: imageWidth, y: 0 },
    { x: imageWidth, y: imageHeight }, { x: 0, y: imageHeight },
  ];
  const projection = (point) => (
    ((point.x - start.x) * axis.x + (point.y - start.y) * axis.y) / axisLengthSquared
  );
  const lateral = (point) => (
    (point.x - start.x) * normal.x + (point.y - start.y) * normal.y
  );
  const projections = corners.map(projection);
  const laterals = corners.map(lateral);
  const stationValues = [Math.min(...projections), ...mesh.bendStops, Math.max(...projections)]
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > 1e-6);
  const lateralMinimum = Math.min(...laterals);
  const lateralMaximum = Math.max(...laterals);

  const vertices = [];
  for (const station of stationValues) {
    const center = { x: start.x + axis.x * station, y: start.y + axis.y * station };
    const childWeight = meshSmoothstep01(station);
    for (const offset of [lateralMinimum, lateralMaximum]) {
      vertices.push({
        source: { x: center.x + normal.x * offset, y: center.y + normal.y * offset },
        sectionWeight: childWeight,
        weights: [
          { bone: mesh.parentBone, weight: 1 - childWeight },
          { bone: mesh.childBone, weight: childWeight },
        ],
      });
    }
  }
  const triangles = [];
  for (let station = 0; station < stationValues.length - 1; station += 1) {
    const a = station * 2;
    const b = a + 1;
    const nextA = a + 2;
    const nextB = a + 3;
    if (station % 2 === 0) triangles.push([a, nextA, nextB], [a, nextB, b]);
    else triangles.push([a, nextA, b], [b, nextA, nextB]);
  }
  return { vertices, triangles, stationValues };
}

export function weightedMeshGeometry(mesh, imageWidth, imageHeight) {
  if (mesh?.type === "weightedStripV2") return weightedStripMesh(mesh, imageWidth, imageHeight);
  return weightedGridMesh(mesh, imageWidth, imageHeight);
}

/**
 * Seat one rigid finger on a held item's haft.
 *
 * `along` and `across` are authored in shaft space, so changing equipment or
 * rotating the grip carries every finger root with the haft. The finger art is
 * never warped: only its root position and rigid angle change.
 */
export function gripFingerLayer(layer, gripLayer, gripRotation = 0, fingerRotation = 0, fingerOffset = {}) {
  if (!layer?.gripFinger || !gripLayer) return layer;
  const shaftRotation = (gripLayer.rotation ?? 0) + gripRotation;
  const radians = shaftRotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const along = (layer.gripFinger.along ?? 0) + (fingerOffset.along ?? 0);
  const across = (layer.gripFinger.across ?? 0) + (fingerOffset.across ?? 0);
  return {
    ...layer,
    x: (gripLayer.x ?? 0) + cosine * along - sine * across,
    y: (gripLayer.y ?? 0) + sine * along + cosine * across,
    rotation: shaftRotation + (layer.gripFinger.angleOffset ?? 0) + fingerRotation,
    pivotX: layer.gripFinger.basePivot?.x ?? layer.pivotX,
    pivotY: layer.gripFinger.basePivot?.y ?? layer.pivotY,
  };
}

/**
 * Assemble the animation-specific finger roots, then rotate that complete
 * four-finger layout around its shared centre.
 *
 * Along/across keys are part of the authored knuckle layout. Applying them
 * after this rotation makes the fingers drift off their shared axis whenever
 * both channels are animated.
 */
export function gripFingerAxisLayer(layer, fingerLayers, rotation = 0, fingerOffsets = {}) {
  if (!layer?.gripFinger) return layer;
  const fingers = (fingerLayers ?? []).filter((candidate) => candidate?.gripFinger);
  const root = (candidate) => ({
    along: (candidate.gripFinger.along ?? 0) + (fingerOffsets?.[candidate.id]?.along ?? 0),
    across: (candidate.gripFinger.across ?? 0) + (fingerOffsets?.[candidate.id]?.across ?? 0),
  });
  const current = root(layer);
  if (fingers.length < 2 || Math.abs(rotation) < 1e-8) {
    return {
      ...layer,
      gripFinger: { ...layer.gripFinger, ...current },
    };
  }
  const roots = fingers.map(root);
  const centerAlong = roots.reduce((sum, point) => sum + point.along, 0) / roots.length;
  const centerAcross = roots.reduce((sum, point) => sum + point.across, 0) / roots.length;
  const radians = rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const along = current.along - centerAlong;
  const across = current.across - centerAcross;
  return {
    ...layer,
    gripFinger: {
      ...layer.gripFinger,
      along: centerAlong + cosine * along - sine * across,
      across: centerAcross + sine * along + cosine * across,
    },
  };
}

/**
 * Rotate a registered attachment around an anatomical point in its bone's
 * local space. Full-artboard equipment often has an image pivot far away from
 * the painted grip, so merely adding to `layer.rotation` makes the visible
 * haft orbit away from the hand.
 */
export function rotateLayerAroundPoint(layer, rotation = 0, point = null) {
  if (!layer || !point || Math.abs(rotation) < 1e-8) return layer;
  const radians = rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = (layer.x ?? 0) - (point.x ?? 0);
  const dy = (layer.y ?? 0) - (point.y ?? 0);
  return {
    ...layer,
    x: (point.x ?? 0) + cosine * dx - sine * dy,
    y: (point.y ?? 0) + sine * dx + cosine * dy,
    rotation: (layer.rotation ?? 0) + rotation,
  };
}

/**
 * Evaluate every authored hand channel used by both editor surfaces.
 * Keeping this in the shared model prevents the equipment preview from
 * silently omitting a channel that the rig studio already understands.
 */
export function gripControlsAt(animation, side, phase, fingerLayerIDs, gripKind = defaultGripKind(animation)) {
  return {
    gripRotation: gripKeyframeRotation(animation, side, phase, gripKind),
    knuckleAxis: knuckleKeyframeRotation(animation, side, phase, gripKind),
    fingerAngles: Object.fromEntries((fingerLayerIDs ?? []).map((id) => [
      id, fingerKeyframeAngle(animation, side, phase, id, gripKind),
    ])),
    fingerOffsets: Object.fromEntries((fingerLayerIDs ?? []).map((id) => [
      id,
      {
        along: fingerKeyframeOffset(animation, side, phase, id, "along", gripKind),
        across: fingerKeyframeOffset(animation, side, phase, id, "across", gripKind),
      },
    ])),
  };
}

/** Assemble one layer of the palm / haft / fingers / thumb grip stack. */
export function posedGripAttachment(layer, layers, heldLayer, controls = {}) {
  const palmLayer = (layers ?? []).find((candidate) => candidate?.id === "handClosedL");
  if (layer?.gripFinger) {
    // Equipment PNGs use full-artboard registration, so their x/y identifies
    // the image pivot rather than the anatomical grip. Seat finger roots on
    // the palm's hand-local origin while inheriting the held item's shaft
    // rotation. Otherwise changing staff artwork can throw all four fingers
    // hundreds of pixels away from the visible hand.
    const gripAnchor = palmLayer
      ? { ...heldLayer, x: palmLayer.x, y: palmLayer.y }
      : heldLayer;
    const axisLayer = gripFingerAxisLayer(
      layer,
      layers,
      controls.knuckleAxis ?? 0,
      controls.fingerOffsets,
    );
    return gripFingerLayer(
      axisLayer,
      gripAnchor,
      controls.gripRotation ?? 0,
      controls.fingerAngles?.[layer.id] ?? 0,
    );
  }
  if (layer?.id !== heldLayer?.id || !controls.gripRotation) return layer;
  // Staff/spear art uses full-canvas registration, whose pivot is commonly
  // hundreds of source pixels away from the hand. Rotate its existing fitted
  // placement around the palm socket so the painted shaft and composed fingers
  // cannot separate between grip-rotation keys. Sword pivots are already on
  // their handles, so retain their established placement behavior.
  if (layer.id === "staff" && palmLayer) {
    return rotateLayerAroundPoint(layer, controls.gripRotation, palmLayer);
  }
  return { ...layer, rotation: layer.rotation + controls.gripRotation };
}

function matrixComponents(matrix) {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return {
    x: matrix.e,
    y: matrix.f,
    rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
    scaleX,
    scaleY: scaleX > 1e-8 ? determinant / scaleX : 1,
  };
}

/** Interpolate the child bone in parent space without linearly shrinking it. */
function thicknessPreservingSkinMatrix(mesh, weight, bindWorld, currentWorld) {
  const parent = mesh.parentBone;
  const child = mesh.childBone;
  const bindRelative = multiply(inverse(bindWorld[parent]), bindWorld[child]);
  const currentRelative = multiply(inverse(currentWorld[parent]), currentWorld[child]);
  const from = matrixComponents(bindRelative);
  const to = matrixComponents(currentRelative);
  const rotationDelta = ((to.rotation - from.rotation + 540) % 360) - 180;
  const mix = (left, right) => left + (right - left) * weight;
  const partialChild = localMatrix(
    mix(from.x, to.x),
    mix(from.y, to.y),
    from.rotation + rotationDelta * weight,
    mix(from.scaleX, to.scaleX),
    mix(from.scaleY, to.scaleY),
  );
  return multiply(multiply(currentWorld[parent], partialChild), inverse(bindWorld[child]));
}

/** Linear-blend a layer's bind-space mesh through its two bone deltas. */
export function deformWeightedMesh(layer, imageWidth, imageHeight, bindWorld, currentWorld) {
  const geometry = weightedMeshGeometry(layer.mesh, imageWidth, imageHeight);
  if (!geometry) return null;
  const bindMatrix = multiply(bindWorld[layer.bone], layerLocalMatrix(layer, imageWidth, imageHeight));
  if (layer.mesh.type === "weightedStripV2") {
    const points = geometry.vertices.map((vertex) => {
      const bindPoint = transformPoint(bindMatrix, vertex.source);
      return transformPoint(
        thicknessPreservingSkinMatrix(layer.mesh, vertex.sectionWeight, bindWorld, currentWorld),
        bindPoint,
      );
    });
    return { ...geometry, points };
  }
  const skinByBone = Object.fromEntries(
    [layer.mesh.parentBone, layer.mesh.childBone].map((bone) => [
      bone,
      multiply(currentWorld[bone], inverse(bindWorld[bone])),
    ])
  );
  const points = geometry.vertices.map((vertex) => {
    const bindPoint = transformPoint(bindMatrix, vertex.source);
    return vertex.weights.reduce((point, influence) => {
      const posed = transformPoint(skinByBone[influence.bone], bindPoint);
      return {
        x: point.x + posed.x * influence.weight,
        y: point.y + posed.y * influence.weight,
      };
    }, { x: 0, y: 0 });
  });
  return { ...geometry, points };
}

/** Affine map carrying one source triangle onto one destination triangle. */
export function triangleTransform(source, destination) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const determinant = s0.x * (s1.y - s2.y)
    + s1.x * (s2.y - s0.y)
    + s2.x * (s0.y - s1.y);
  if (Math.abs(determinant) < 1e-8) return null;
  return {
    a: (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / determinant,
    c: (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / determinant,
    e: (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y)
      + d2.x * (s0.x * s1.y - s1.x * s0.y)) / determinant,
    b: (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / determinant,
    d: (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / determinant,
    f: (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y)
      + d2.y * (s0.x * s1.y - s1.x * s0.y)) / determinant,
  };
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const degrees = (radians) => radians * 180 / Math.PI;
const radians = (value) => value * Math.PI / 180;
const normalizeDegrees = (value) => ((value + 180) % 360 + 360) % 360 - 180;
const angularDistance = (left, right) => Math.abs(normalizeDegrees(left - right));

/** Both angled-view arms flex forward toward screen-left (clockwise/positive). */
export function constrainForearmRotation(side, rotation) {
  if (side === "L" || side === "R") return clamp(rotation, 0, 155);
  throw new Error(`Unknown arm side: ${side}`);
}

/** Apply the shared forearm limits to an already-evaluated additive pose. */
export function constrainForearmPose(bones, pose) {
  const constrained = structuredClone(pose ?? {});
  for (const side of ["L", "R"]) {
    const id = `lowerArm${side}`;
    const bone = (bones ?? []).find((candidate) => candidate.id === id);
    if (!bone) continue;
    const total = (bone.rotation ?? 0) + (constrained[id]?.rotation ?? 0);
    constrained[id] = {
      ...(constrained[id] ?? {}),
      rotation: constrainForearmRotation(side, total) - (bone.rotation ?? 0),
    };
  }
  return constrained;
}

export function constrainKneeRotation(side, rotation) {
  if (side === "L" || side === "R") return Math.min(0, rotation);
  throw new Error(`Unknown leg side: ${side}`);
}

/**
 * Solve a fixed-length two-bone chain whose bind axis points down (+Y).
 * The closest elbow solution wins so dragging a hand cannot flip the joint.
 */
export function solveTwoBoneIK(target, upperLength, lowerLength, currentUpperRotation = 0, currentLowerRotation = 0, bendDirection = 0) {
  if (!(upperLength > 0) || !(lowerLength > 0)) throw new Error("Arm segment lengths must be positive");
  const rawDistance = Math.hypot(target.x, target.y);
  const distance = clamp(rawDistance, Math.abs(upperLength - lowerLength) + 1e-6, upperLength + lowerLength - 1e-6);
  const direction = rawDistance > 1e-8 ? Math.atan2(target.y, target.x) : Math.PI / 2;
  const shoulderOffset = Math.acos(clamp(
    (distance * distance + upperLength * upperLength - lowerLength * lowerLength) / (2 * distance * upperLength),
    -1,
    1
  ));
  const elbowMagnitude = Math.acos(clamp(
    (distance * distance - upperLength * upperLength - lowerLength * lowerLength) / (2 * upperLength * lowerLength),
    -1,
    1
  ));
  const candidates = [
    { upperRotation: degrees(direction - shoulderOffset - Math.PI / 2), lowerRotation: degrees(elbowMagnitude) },
    { upperRotation: degrees(direction + shoulderOffset - Math.PI / 2), lowerRotation: -degrees(elbowMagnitude) },
  ].map((candidate) => ({
    upperRotation: normalizeDegrees(candidate.upperRotation),
    lowerRotation: normalizeDegrees(candidate.lowerRotation),
  }));
  if (bendDirection !== 0) {
    const direction = Math.sign(bendDirection);
    return candidates.find((candidate) => Math.sign(candidate.lowerRotation) === direction)
      ?? candidates.find((candidate) => candidate.lowerRotation === 0)
      ?? candidates[0];
  }
  return candidates.sort((left, right) => (
    angularDistance(left.upperRotation, currentUpperRotation) + angularDistance(left.lowerRotation, currentLowerRotation)
    - angularDistance(right.upperRotation, currentUpperRotation) - angularDistance(right.lowerRotation, currentLowerRotation)
  ))[0];
}

export function twoBoneEndpoint(upperRotation, lowerRotation, upperLength, lowerLength) {
  const upper = radians(upperRotation);
  const lower = radians(upperRotation + lowerRotation);
  return {
    x: -Math.sin(upper) * upperLength - Math.sin(lower) * lowerLength,
    y: Math.cos(upper) * upperLength + Math.cos(lower) * lowerLength,
  };
}

export const animationNames = [
  "idle",
  "staffIdle",
  "staffMoveForward",
  "staffMoveBackward",
  "run",
  "shieldUp",
  "staffShieldUp",
  "shieldMoveForward",
  "shieldMoveBackward",
  "staffShieldMoveForward",
  "staffShieldMoveBackward",
  "dodgeForward",
  "dodgeBackward",
  "swordSwing",
  "blocked",
  "sneakAttack",
  "spellCast",
  "spellMoveForward",
  "spellMoveBackward",
  "bowDraw",
  "bowMoveForward",
  "bowMoveBackward",
];

/**
 * Hand attachments swap per side, not per character: a character grips a hilt with
 * one hand while the other stays open on a shield, a spell, or nothing. A hand
 * pose therefore names a state for each side rather than one for the pair.
 *
 * The keys are the bone suffixes, which on this rig fall on the screen-left and
 * screen-right hands respectively.
 */
export const handPoses = {
  open: { L: "open", R: "open" },
  closed: { L: "closed", R: "closed" },
  closedLOpenR: { L: "closed", R: "open" },
  openLClosedR: { L: "open", R: "closed" },
};

export const handPoseNames = Object.keys(handPoses);

/** The state one side is in under a named hand pose. */
export function handStateFor(handPose, side) {
  const pose = handPoses[handPose] ?? handPoses.open;
  return pose[side] ?? "open";
}

/**
 * Whether a layer draws under a hand pose. Layers without a `handState` are not
 * hand attachments and always draw; the rest are matched against their own
 * side, taken from the bone they hang on rather than from their id.
 */
export function layerMatchesHandPose(layer, handPose) {
  if (!layer.handState) return true;
  const side = String(layer.bone ?? "").endsWith("R") ? "R" : "L";
  return layer.handState === handStateFor(handPose, side);
}

/**
 * Which hand attachment a clip is authored against. A cast is thrown with an
 * open palm and an attack is not, and the hand state is a layer swap rather
 * than a pose, so the clip has to say which one it means.
 */
/**
 * Whether a clip runs on a loop or plays once. A one-shot has a start, so it
 * cannot look backwards past it: the necklace's trailing sample clamps there
 * rather than wrapping round to the clip's end, which would kick the pendant on
 * the opening frames.
 */
export const animationLoops = {
  idle: true,
  staffIdle: true,
  staffMoveForward: true,
  staffMoveBackward: true,
  run: true,
  shieldUp: true,
  staffShieldUp: true,
  shieldMoveForward: true,
  shieldMoveBackward: true,
  staffShieldMoveForward: true,
  staffShieldMoveBackward: true,
  dodgeForward: false,
  dodgeBackward: false,
  swordSwing: false,
  blocked: false,
  sneakAttack: false,
  spellCast: false,
  spellMoveForward: true,
  spellMoveBackward: true,
  bowDraw: false,
  bowMoveForward: true,
  bowMoveBackward: true,
};

/** Seconds one pass of a clip takes at 1x. */
export const animationDurations = {
  idle: 2.1,
  staffIdle: 2.1,
  staffMoveForward: 1,
  staffMoveBackward: 1,
  run: 0.82,
  shieldUp: 2.1,
  staffShieldUp: 2.1,
  shieldMoveForward: 1,
  shieldMoveBackward: 1,
  staffShieldMoveForward: 1,
  staffShieldMoveBackward: 1,
  dodgeForward: 0.56,
  dodgeBackward: 0.56,
  swordSwing: 1.05,
  blocked: 1.15,
  sneakAttack: 1.15,
  spellCast: 1.45,
  spellMoveForward: 1,
  spellMoveBackward: 1,
  bowDraw: 1.55,
  bowMoveForward: 1,
  bowMoveBackward: 1,
};

/**
 * The runtime input a clip bends toward, if any. A cast reaches where the spell
 * is aimed and a draw follows the arrow; everything else plays as authored.
 * This is the seam between baked motion and motion that answers to the player.
 */
export const animationAim = {
  spellCast: "spell",
  spellMoveForward: "spell",
  spellMoveBackward: "spell",
  bowDraw: "bow",
  bowMoveForward: "bow",
  bowMoveBackward: "bow",
};

export const animationHandPose = {
  idle: "closed",
  staffIdle: "closedLOpenR",
  staffMoveForward: "closedLOpenR",
  staffMoveBackward: "closedLOpenR",
  run: "closed",
  shieldUp: "closed",
  staffShieldUp: "closedLOpenR",
  shieldMoveForward: "closed",
  shieldMoveBackward: "closed",
  staffShieldMoveForward: "closedLOpenR",
  staffShieldMoveBackward: "closedLOpenR",
  dodgeForward: "closed",
  dodgeBackward: "closed",
  swordSwing: "closed",
  blocked: "closed",
  sneakAttack: "closed",
  spellCast: "open",
  spellMoveForward: "open",
  spellMoveBackward: "open",
  bowDraw: "closedLOpenR",
  bowMoveForward: "closedLOpenR",
  bowMoveBackward: "closedLOpenR",
};

/**
 * Equipment shown by each authored clip. `weapon` and `staff` are alternative
 * render layers for the equipped main-hand item, so keeping both ids active
 * preserves swords, axes, spears, staffs, and wands through every non-ranged
 * pose. Casting clears both hands, while bow draw swaps the whole set for the
 * bow instead of drawing all three items together.
 */
export const animationEquipment = {
  idle: ["weapon", "staff", "shield"],
  staffIdle: ["weapon", "staff", "shield"],
  staffMoveForward: ["weapon", "staff", "shield"],
  staffMoveBackward: ["weapon", "staff", "shield"],
  run: ["weapon", "staff", "shield"],
  shieldUp: ["weapon", "staff", "shield"],
  staffShieldUp: ["weapon", "staff", "shield"],
  shieldMoveForward: ["weapon", "staff", "shield"],
  shieldMoveBackward: ["weapon", "staff", "shield"],
  staffShieldMoveForward: ["weapon", "staff", "shield"],
  staffShieldMoveBackward: ["weapon", "staff", "shield"],
  dodgeForward: ["weapon", "staff", "shield"],
  dodgeBackward: ["weapon", "staff", "shield"],
  swordSwing: ["weapon", "staff", "shield"],
  blocked: ["weapon", "staff", "shield"],
  sneakAttack: ["weapon", "staff", "shield"],
  spellCast: [],
  spellMoveForward: [],
  spellMoveBackward: [],
  bowDraw: ["bow"],
  bowMoveForward: ["bow"],
  bowMoveBackward: ["bow"],
};

const equipmentLayerIDs = new Set(["weapon", "staff", "shield", "bow"]);

/** Non-equipment layers always draw; equipment must belong to the clip loadout. */
/**
 * The clips worth checking a slot's placement in: the ones that show it. A
 * sword is reviewed swinging, a bow at full draw, a staff through its own idle,
 * and everything held is reviewed standing and running as well.
 */
export const REVIEW_ANIMATIONS = ["idle", "run", "staffIdle", "shieldUp", "staffShieldUp", "shieldMoveForward", "shieldMoveBackward", "staffShieldMoveForward", "staffShieldMoveBackward", "dodgeForward", "dodgeBackward", "swordSwing", "blocked", "sneakAttack", "bowDraw"];

/**
 * Poses worth judging a placement in, which is not the same question as which
 * poses the game draws a layer in.
 *
 * A staff or spear ships in its carried and guarded states, but a grip that
 * reads there can still be wrong once the body lunges. Reviewing includes that
 * attack pose too, so this can return more than a layer's runtime presentation
 * set and the studio draws the reviewed layer regardless of clip loadout.
 */
const REVIEW_OVERRIDES = {
  staff: ["staffIdle", "staffMoveForward", "staffMoveBackward", "staffShieldUp", "staffShieldMoveForward", "staffShieldMoveBackward", "swordSwing", "sneakAttack"],
};

export function reviewAnimations(layerID) {
  if (REVIEW_OVERRIDES[layerID]) return REVIEW_OVERRIDES[layerID];
  const shown = REVIEW_ANIMATIONS.filter(
    (name) => (animationEquipment[name] ?? []).includes(layerID)
  );
  // A layer no clip singles out -- a necklace, a boot -- is worn in all of
  // them, so it is reviewed against the standing, moving and swinging poses.
  return shown.length ? shown : ["idle", "run", "swordSwing", "bowDraw"];
}

export function layerMatchesAnimationEquipment(layer, animation) {
  if (!equipmentLayerIDs.has(layer.id)) return true;
  return (animationEquipment[animation] ?? []).includes(layer.id);
}

/**
 * The editor normally keeps a selected equipment layer visible outside its
 * authored clips so its placement can be reviewed. Bow clips are deliberately
 * strict: selecting a sword, staff, or shield must never leak it into a ranged
 * preview beside the bow.
 */
export function layerMatchesAnimationPreview(layer, animation, selectedLayerID = null) {
  const belongsToClip = layerMatchesAnimationEquipment(layer, animation);
  if (String(animation).startsWith("bow")) return belongsToClip;
  return layer.id === selectedLayerID || belongsToClip;
}

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const cycle = (phase, offset = 0) => Math.sin((phase + offset) * TAU);
const lift = (value) => Math.max(0, value);
// Eased 0 -> 1 ramp between two points on the timeline.
const ramp = (phase, from, to) => {
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
function stridePose(phase, { armArc, elbowArc, halfStride = 150, stepHeight = 20 }) {
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
function onlyBones(pose, included) {
  return Object.fromEntries(Object.entries(pose).filter(([bone]) => included.has(bone)));
}

/**
 * A close-to-camera crossing step. Reversing the phase reverses which knee
 * recovers behind the other leg, so backward movement is the gait played
 * backward rather than the same cycle with a different label.
 */
function crossingStepPose(phase, direction, hips = {}) {
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

function heldActionStepPose(action, phase, direction) {
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

function rotatePoint(point, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: cosine * point.x - sine * point.y,
    y: sine * point.x + cosine * point.y,
  };
}

function canonicalRestAnkle(side, rig = groundedLegRig) {
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
function hipsDelta(value) {
  return typeof value === "number" ? { x: 0, y: 0, rotation: value } : {
    x: value?.x ?? 0,
    y: value?.y ?? 0,
    rotation: value?.rotation ?? 0,
  };
}

function groundedLeg(side, root, hipsPose, targetOffset, rig = groundedLegRig) {
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

function groundedLegPose(root, hipsPose, targets, rig = groundedLegRig) {
  const pose = {};
  for (const side of ["L", "R"]) {
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
function groundedRootForTargets(seed, hipsPose, targets, rig = groundedLegRig, kneeMargin = 2) {
  const hips = hipsDelta(hipsPose);
  const root = { x: seed.x ?? 0, y: seed.y ?? 0 };
  const requiredDrops = [];
  for (const side of ["L", "R"]) {
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

function authoredAnkleOffset(side, pose, rig = balancedGroundedLegRig) {
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

function authoredAnkleXOffset(side, pose, rig = balancedGroundedLegRig) {
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
  pose,
  verticalTargets,
  supportWeights = { L: 0.5, R: 0.5 },
  kneeMargin = GROUNDED_KNEE_MARGIN,
  rig = balancedGroundedLegRig,
) {
  const hips = pose.hips ?? {};
  const authored = Object.fromEntries(["L", "R"].map((side) => [side,
    authoredAnkleOffset(side, pose, rig),
  ]));
  const targets = Object.fromEntries(["L", "R"].map((side) => [side, {
    x: authored[side].x,
    y: verticalTargets[side] ?? 0,
  }]));
  const weightTotal = Math.max(0.0001, (supportWeights.L ?? 0) + (supportWeights.R ?? 0));
  const supportCorrection = ["L", "R"].reduce((sum, side) => {
    const weight = (supportWeights[side] ?? 0) / weightTotal;
    return sum + weight * (targets[side].y - authored[side].y);
  }, 0);
  const seed = { ...(pose.root ?? { x: 0, y: 0 }) };
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
function groundStationaryPose(name, pose) {
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

function motionLift(phase, from, to, height) {
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
 * inverse of the character's map movement, so the planted sole reads as fixed in
 * world space when the actor advances. Both ends meet at y = 0 with a flat
 * slope, preventing a pop when the loop wraps or the support foot changes.
 */
function groundedWalkFootTarget(phase, offset, direction, halfStride, stepHeight) {
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

function guardWalkPose(guardClip, phase, direction) {
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

function dodgeLungePose(phase, direction) {
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
  const targets = {
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
function rotateAboutJoint(rotation, jointY) {
  const radians = rotation * Math.PI / 180;
  return {
    rotation,
    x: Math.sin(radians) * jointY,
    y: jointY - Math.cos(radians) * jointY,
  };
}

/** Re-anchor a pose's head and neck rotations onto the painted neck joint. */
function weldHeadToNeck(pose) {
  for (const [bone, jointY] of [["head", HEAD_JOINT_Y], ["neck", NECK_JOINT_Y]]) {
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

/**
 * Corrections that belong to one clip rather than to the skeleton.
 *
 * A bone's bind pose is shared by every animation, so nudging an arm to fix the
 * bow draw moves it in the idle, the run and both attacks as well. These
 * offsets are added on top of one clip's authored motion instead, which is how
 * a bow correction stays a bow correction.
 *
 * They are held for the whole clip rather than keyed to a phase: the authored
 * motion carries the timing, and a correction is almost always "this limb sits
 * a little wrong throughout".
 */
let clipPoseOffsets = {};

// Time-scoped additive bone corrections authored in the editor. They are
// folded into animationPose before the fixed-sample iOS pose library is baked.
let boneKeyframes = {};

// Wrist keys are authored separately from the procedural body clips. Keeping
// this as a narrow additive track lets the editor add expressive hand rotation
// without replacing the existing run/attack functions or baking a second copy
// of their poses into the scene.
let wristKeyframes = {};

// Face artwork is intentionally sampled as a stepped track: blink and mouth
// drawings are complete replacement attachments, not values to interpolate.
let expressionKeyframes = {};
export const eyeExpressionNames = ["neutral", "blink", "wide", "focused", "wince"];
export const mouthExpressionNames = ["neutral", "smile", "smirk", "shout", "surprised", "frown", "pain", "grit", "talk"];

export function setClipPoseOffsets(offsets) {
  clipPoseOffsets = offsets ?? {};
}

export function getClipPoseOffsets() {
  return clipPoseOffsets;
}

export function setBoneKeyframes(keyframes) {
  boneKeyframes = keyframes ?? {};
}

export function getBoneKeyframes() {
  return boneKeyframes;
}

export function setWristKeyframes(keyframes) {
  wristKeyframes = keyframes ?? {};
}

export function getWristKeyframes() {
  return wristKeyframes;
}

export function setExpressionKeyframes(keyframes) {
  expressionKeyframes = keyframes ?? {};
}

export function getExpressionKeyframes() {
  return expressionKeyframes;
}

export function expressionAt(name, phase) {
  const keys = [...(expressionKeyframes?.[name] ?? [])]
    .sort((left, right) => left.phase - right.phase);
  if (!keys.length) return { eyes: "neutral", mouth: "neutral" };
  const normalized = Math.max(0, Math.min(1, Number(phase) || 0));
  let sampled = keys[0];
  for (const key of keys) {
    if (key.phase > normalized + 0.000001) break;
    sampled = key;
  }
  return { eyes: sampled.eyes, mouth: sampled.mouth };
}

/** The legacy flat grip channels belong only to the natural held class for a clip. */
export function defaultGripKind(name) {
  if (String(name).startsWith("bow")) return "bow";
  if (String(name).startsWith("staff")) return "staff";
  return "weapon";
}

/** Scene key used for the one normalized grip curve shared by each held class. */
export function gripTrackName(kind) {
  return `__grip_${["weapon", "staff", "bow"].includes(kind) ? kind : "weapon"}`;
}

/** Combat clips whose hand channels intentionally diverge from the family baseline. */
export function gripUsesAnimationOverride(name) {
  return name === "swordSwing" || name === "sneakAttack";
}

/** Smoothly interpolate one numeric hand-control field at a clip phase. */
function handKeyframeValue(name, side, phase, field, member = null, gripKind = null) {
  const path = member == null ? [field] : [field, ...(Array.isArray(member) ? member : [member])];
  const sharedKeys = gripKind == null ? [] : (wristKeyframes?.[gripTrackName(gripKind)]?.[side] ?? []);
  const animationKeys = wristKeyframes?.[name]?.[side] ?? [];
  const animationValue = (key) => {
    if (gripKind != null) {
      const scoped = key?.grips?.[gripKind];
      const scopedValue = path.reduce((current, component) => current?.[component], scoped);
      if (Number.isFinite(scopedValue)) return scopedValue;
      // Scenes authored before per-held-class channels stored grip values on
      // the wrist key itself. Those values belong only to the clip's natural
      // held class; treating them as a fallback for every class is the leak
      // that made bow/staff edits appear on swords.
      if (gripKind !== defaultGripKind(name)) return undefined;
    }
    return path.reduce((current, component) => current?.[component], key);
  };
  const directValue = (key) => path.reduce((current, component) => current?.[component], key);
  const channelKeys = (keys, value) => keys
    .filter((key) => Number.isFinite(value(key)))
    .sort((left, right) => left.phase - right.phase);
  const localKeys = channelKeys(animationKeys, animationValue);
  const baselineKeys = channelKeys(sharedKeys, directValue);
  // Sword Swing and Sneak Attack are deliberately allowed to override one
  // grip dimension at a time. Any dimension they do not author continues to
  // inherit the current ordinary-weapon baseline.
  const keys = gripKind != null && gripUsesAnimationOverride(name) && localKeys.length
    ? localKeys
    : (gripKind != null && baselineKeys.length ? baselineKeys : localKeys);
  const value = keys === baselineKeys ? directValue : animationValue;
  // Hand keys bundle several independently authored channels. A missing value
  // means "this key does not address that channel", not "key this channel to
  // zero". Filtering first prevents a wrist/grip/finger key from erasing the
  // animation-specific knuckle placement between its own authored keys.
  if (keys.length === 0) return 0;
  if (keys.length === 1) return value(keys[0]);

  const t = Math.max(0, Math.min(1, phase));
  let left = keys[0];
  let right = keys[keys.length - 1];
  if (t <= left.phase) return value(left);
  if (t >= right.phase) return value(right);
  for (let index = 1; index < keys.length; index += 1) {
    if (t <= keys[index].phase) {
      left = keys[index - 1];
      right = keys[index];
      break;
    }
  }
  const span = right.phase - left.phase;
  const local = span <= 1e-8 ? 0 : (t - left.phase) / span;
  const eased = meshSmoothstep01(local);
  return value(left) + (value(right) - value(left)) * eased;
}

/** Smoothly interpolate one side's additive wrist rotation at a clip phase. */
export function wristKeyframeAngle(name, side, phase) {
  return handKeyframeValue(name, side, phase, "angle");
}

/** Rigid rotation shared by the held item and its four finger attachments. */
export function gripKeyframeRotation(name, side, phase, gripKind = defaultGripKind(name)) {
  return handKeyframeValue(name, side, phase, "gripRotation", null, gripKind);
}

/** Animated rotation of the four root positions around their shared centre. */
export function knuckleKeyframeRotation(name, side, phase, gripKind = defaultGripKind(name)) {
  return handKeyframeValue(name, side, phase, "knuckleAxis", null, gripKind);
}

/** Additive rigid angle for one finger, relative to its authored resting angle. */
export function fingerKeyframeAngle(name, side, phase, layerID, gripKind = defaultGripKind(name)) {
  return handKeyframeValue(name, side, phase, "fingerAngles", layerID, gripKind);
}

/** Additive shaft-space placement scoped to one animation and held class. */
export function fingerKeyframeOffset(name, side, phase, layerID, axis, gripKind = defaultGripKind(name)) {
  return handKeyframeValue(name, side, phase, "fingerOffsets", [layerID, axis], gripKind);
}

function boneKeyframeValue(name, bone, phase, field) {
  const keys = boneKeyframes?.[name]?.[bone] ?? [];
  if (keys.length === 0) return 0;
  const value = (key) => Number.isFinite(key?.[field]) ? key[field] : 0;
  if (keys.length === 1) return value(keys[0]);
  const t = Math.max(0, Math.min(1, phase));
  let left = keys[0];
  let right = keys[keys.length - 1];
  if (t <= left.phase) return value(left);
  if (t >= right.phase) return value(right);
  for (let index = 1; index < keys.length; index += 1) {
    if (t <= keys[index].phase) {
      left = keys[index - 1];
      right = keys[index];
      break;
    }
  }
  const span = right.phase - left.phase;
  const local = span <= 1e-8 ? 0 : (t - left.phase) / span;
  const eased = meshSmoothstep01(local);
  return value(left) + (value(right) - value(left)) * eased;
}

/** Sample additive editor-authored corrections for every keyed bone. */
export function boneKeyframePose(name, phase) {
  const pose = {};
  for (const bone of Object.keys(boneKeyframes?.[name] ?? {})) {
    const delta = {};
    for (const field of BONE_POSE_KEYS) {
      const value = boneKeyframeValue(name, bone, phase, field);
      if (Math.abs(value) >= 1e-8) delta[field] = value;
    }
    if (Object.keys(delta).length) pose[bone] = delta;
  }
  return pose;
}

function applyBoneKeyframes(name, phase, pose) {
  if (!boneKeyframes?.[name] || Object.keys(boneKeyframes[name]).length === 0) return pose;
  return mergePoses(pose, boneKeyframePose(name, phase));
}

function applyClipOffsets(name, pose) {
  const offsets = clipPoseOffsets[name];
  if (!offsets) return pose;
  for (const [bone, delta] of Object.entries(offsets)) {
    const current = pose[bone] ?? {};
    const corrected = { ...current };
    for (const [key, value] of Object.entries(delta)) {
      if (!Number.isFinite(value)) continue;
      corrected[key] = key === "scaleX" || key === "scaleY"
        ? (current[key] ?? 1) * value
        : (current[key] ?? 0) + value;
    }
    pose[bone] = corrected;
  }
  return pose;
}

function applyWristKeyframes(name, phase, pose) {
  for (const side of ["L", "R"]) {
    const angle = wristKeyframeAngle(name, side, phase);
    if (Math.abs(angle) < 1e-8) continue;
    const bone = `hand${side}`;
    pose[bone] = {
      ...(pose[bone] ?? {}),
      rotation: (pose[bone]?.rotation ?? 0) + angle,
    };
  }
  return pose;
}

function applyKneeConstraints(pose) {
  for (const side of ["L", "R"]) {
    const bone = `lowerLeg${side}`;
    const rotation = pose[bone]?.rotation;
    if (rotation === undefined) continue;
    pose[bone] = { ...pose[bone], rotation: constrainKneeRotation(side, rotation) };
  }
  return pose;
}

export function animationPose(name, phase) {
  const grounded = groundStationaryPose(name, authoredPose(name, phase));
  return applyKneeConstraints(
    applyWristKeyframes(
      name,
      phase,
      applyBoneKeyframes(name, phase, applyClipOffsets(name, weldHeadToNeck(grounded))),
    ),
  );
}

function authoredPose(name, phase) {
  // Looping gaits wrap; one-shot actions must retain their authored endpoint.
  // Wrapping phase 1 to phase 0 made the final baked sample snap every leg
  // back to its opening solve before the runtime could transition away.
  const t = animationLoops[name] === false
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
    const beat = (value) => value * exposed;
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
    const blend = (rest, wound, struck) => rest * (1 - load - follow) + wound * load + struck * follow;
    // Held poses stay at one value across all three keys so the guard arm is
    // static while the blade arm travels.
    const hold = (value) => blend(value, value, value);
    // `follow` deliberately keeps a fifth of the strike alive to the last
    // frame so the arms do not freeze at contact. The lunge has its own two
    // recovery beats: the lead foot stays planted through impact while the
    // rear foot catches up first, then the lead leg relaxes into neutral.
    const leadRecovery = ramp(t, 0.80, 0.96);
    const leadStep = strike * (1 - leadRecovery);
    const leadStride = (wound, struck) => wound * load + struck * leadStep;
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
    const rearStride = (wound, struck) => wound * load + struck * rearStep;
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
    const beat = (crouched, struck) => crouched * coil + struck * drive;
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
    const beat = (gathered, cast) => gathered * gather + cast * release;
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
    const stringArm = (reached, anchored) => reached * (reach - pull) + anchored * pull;
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
      upperArmR: { rotation: stringArm(92, -30) },
      lowerArmR: { rotation: stringArm(6, 130) },
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

export function mergePoses(base, overlay) {
  const result = structuredClone(base);
  for (const [bone, delta] of Object.entries(overlay)) {
    result[bone] = { ...(result[bone] ?? {}) };
    for (const [key, value] of Object.entries(delta)) {
      if (key === "scaleX" || key === "scaleY") result[bone][key] = (result[bone][key] ?? 1) * value;
      else result[bone][key] = (result[bone][key] ?? 0) + value;
    }
  }
  return result;
}
