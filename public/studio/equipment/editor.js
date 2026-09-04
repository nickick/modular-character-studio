import {
  animationDurations,
  animationEquipment,
  animationHandPose,
  animationPose,
  constrainForearmPose,
  defaultGripKind,
  expressionAt,
  eyeExpressionNames,
  mouthExpressionNames,
  deformWeightedMesh,
  gripControlsAt,
  gripTrackName,
  gripUsesAnimationOverride,
  layerBindOwner,
  layerMatchesAnimationEquipment,
  layerMatchesHandPose,
  mergePoses,
  planeStrips,
  posedGripAttachment,
  resolveProfile,
  reviewAnimations,
  rigidLayerMatrix,
  setBoneKeyframes,
  setClipPoseOffsets,
  setExpressionKeyframes,
  setWristKeyframes,
  wristKeyframeAngle,
  triangleTransform,
  transformPoint,
  inverse,
  worldMatrices,
} from "/studio/rig/rig-model.mjs?v=20260904-staff-swing-3";
// Imported by URL, not by relative path: the browser resolves an import against
// the page's URL, and these two studios are served from sibling routes rather
// than sibling directories. One shared model means the placement previewed here
// is the placement the rig studio and the game solve.

import { equipmentLines, equipmentTiers, lineFor, tierFor, UNALIGNED, UNRATED }
  from "/studio/rig/equipment-lines.mjs";

const $ = (id) => document.getElementById(id);
const SIZE = 1254;
const RIG_ASSETS = "/assets/";

/**
 * The slots this studio places, and the layer each one dresses. Body clothing
 * is deliberately absent: chest, arms, boots and helmets are part of the rig's
 * own proportions and belong to the rig studio, not here.
 */
const SLOTS = [
  { id: "weapon", label: "Weapon", catalogue: "weaponOptions", active: "activeWeapon", worn: false },
  { id: "staff", label: "Staff & Spear", catalogue: "staffOptions", active: "activeStaff", worn: false },
  { id: "bow", label: "Bow", catalogue: "bowOptions", active: "activeBow", worn: false },
  { id: "shield", label: "Shield", catalogue: "shieldOptions", active: "activeShield", worn: false },
  { id: "necklace", label: "Necklace", catalogue: "necklaceOptions", active: "activeNecklace", worn: false },

  { id: "quiver", label: "Quiver", catalogue: "quiverOptions", active: "activeQuiver", worn: true },
  // Body armour is one sprite on the chest, but it is placed like any other
  // piece: each outfit sits differently on the same torso.
  { id: "tunicBody", label: "Body", catalogue: "chestOptions", active: "activeChest", worn: true },
  // A helmet is cut to the head it sits on, so its bind is as much registration
  // as placement -- but it is still a piece laid over the rig, and it is placed
  // the same way everything else is.
  { id: "headgear", label: "Head", catalogue: "headgearOptions", active: "activeHeadgear", worn: true },
  { id: "ring", label: "Ring", catalogue: "ringOptions", active: "activeRing", worn: true },
  // Worn gear dresses several layers from one set, so it is placed a piece at a
  // time: a boot's shaft and its foot sit on different bones and need their own
  // offsets, and the two sides are authored separately rather than mirrored.
  {
    id: "boots", label: "Boots", catalogue: "bootOptions", active: "activeBootSet", worn: true,
    pieces: [
      { id: "lowerLegL", label: "Shaft L" }, { id: "footL", label: "Foot L" },
      { id: "lowerLegR", label: "Shaft R" }, { id: "footR", label: "Foot R" },
    ],
  },
  {
    id: "arms", label: "Vambraces", catalogue: "armOptions", active: "activeArmSet", worn: true,
    pieces: [
      { id: "upperArmArmorL", label: "Upper L" }, { id: "forearmVambraceL", label: "Vambrace L" },
      { id: "upperArmArmorR", label: "Upper R" }, { id: "forearmVambraceR", label: "Vambrace R" },
    ],
  },
];

/** The moment in each clip worth judging a placement at. */
const REVIEW_PHASE = {
  idle: 0, run: 0.25, shieldUp: 0.3, staffShieldUp: 0.3, shieldMoveForward: 0.25, shieldMoveBackward: 0.25, staffShieldMoveForward: 0.25, staffShieldMoveBackward: 0.25, dodgeForward: 0.56, dodgeBackward: 0.56, staffIdle: 0.3, staffMoveForward: 0.25, staffMoveBackward: 0.25,
  swordSwing: 0.42, sneakAttack: 0.55, bowDraw: 0.85,
};
const CLIP_LABELS = {
  idle: "Idle", run: "Run", shieldUp: "Shield up", staffShieldUp: "Staff shield up", shieldMoveForward: "Guard walk", shieldMoveBackward: "Guard back", staffShieldMoveForward: "Staff guard walk", staffShieldMoveBackward: "Staff guard back", dodgeForward: "Dodge forward", dodgeBackward: "Dodge backward", staffIdle: "Staff idle",
  staffMoveForward: "Staff walk", staffMoveBackward: "Staff back",
  swordSwing: "Sword swing", blocked: "Blocked recoil", sneakAttack: "Sneak attack", bowDraw: "Bow draw",
};
function animationLabel(name) {
  if (name === "swordSwing" && state?.slot?.id === "staff") return "Staff swing";
  return CLIP_LABELS[name]
    ?? name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}
const GRIPPABLE_SLOTS = new Set(["weapon", "staff", "bow"]);
const GRIP_FINGER_LAYER_IDS = ["handClosedLIndex", "handClosedLMiddle", "handClosedLRing", "handClosedLPinky"];
const GRIP_HAND_LAYER_IDS = new Set(["handClosedL", ...GRIP_FINGER_LAYER_IDS, "handClosedLThumb"]);
const GRIP_FIELDS = [
  ["fieldFingerAlong", "along", { min: -80, max: 80, step: 1, kind: "offset" }],
  ["fieldFingerAcross", "across", { min: -80, max: 80, step: 1, kind: "offset" }],
  ["fieldFingerAngle", "angle", { min: -180, max: 180, step: 1, kind: "angle" }],
  ["fieldKnuckleAxis", "knuckleAxis", { min: -90, max: 90, step: 1, kind: "axis" }],
  ["fieldFingerPivotX", "pivotX", { min: 0, max: 1, step: 0.01, kind: "pivot" }],
  ["fieldFingerPivotY", "pivotY", { min: 0, max: 1, step: 0.01, kind: "pivot" }],
  ["fieldFingerScaleX", "scaleX", { min: 0.1, max: 1.5, step: 0.01, kind: "scale" }],
  ["fieldFingerScaleY", "scaleY", { min: 0.1, max: 1.5, step: 0.01, kind: "scale" }],
];

const state = {
  scene: null,
  savedScene: null,
  revision: null,
  profile: "maleV1",
  slot: SLOTS[0],
  item: null,
  piece: null,
  // The item last chosen in the copy-from list; it outlives the list itself.
  copySource: null,
  // Both bodies are always resolved. The combined view draws them side by
  // side; a single-profile view draws one of them. Keeping both loaded is what
  // makes switching a redraw rather than a reload.
  rigs: {},
  images: {},
  expressionCatalog: null,
  expressionImages: {},
  /// "both", or a profile id when looking at one body on its own.
  view: "both",
  catalog: new Map(),
  applicability: new Map(),
  animation: "idle",
  phase: 0,
  playing: false,
  zoom: 0.7,
  showOthers: true,
  selectedGripFinger: "all",
  dragging: null,
  history: { undo: [], redo: [], limit: 100 },
  dirty: false,
  lastTimestamp: performance.now(),
  lastAnimationPreviewTimestamp: 0,
};

const PROFILE_NAMES = { maleV1: "Male V1", femaleV1: "Female V1" };
const VIEWS = [
  { id: "both", label: "Both" },
  { id: "maleV1", label: "Male V1" },
  { id: "femaleV1", label: "Female V1" },
];

function buildViewTabs() {
  const tabs = $("viewTabs");
  tabs.replaceChildren();
  for (const view of VIEWS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = view.label;
    button.setAttribute("aria-pressed", String(view.id === state.view));
    button.addEventListener("click", () => selectView(view.id));
    tabs.append(button);
  }
  // Editing both at once is worth saying out loud, since a field change then
  // moves a piece the reader cannot see.
  $("editScope").textContent = state.view === "both"
    ? "Placement applies to both bodies"
    : `Placement applies to ${PROFILE_NAMES[state.view]} only`;
}

async function selectView(id) {
  state.view = id;
  buildViewTabs();
  buildStages();
  syncFields();
  render();
}

/** One canvas per body on screen, rebuilt when the view changes. */
const stages = new Map();

function buildStages() {
  const host = $("stages");
  host.replaceChildren();
  stages.clear();
  for (const profile of shownProfiles()) {
    const figure = document.createElement("figure");
    figure.className = "stage-figure";
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.dataset.profile = profile;
    canvas.addEventListener("pointerdown", beginDrag);
    canvas.addEventListener("pointermove", moveDrag);
    canvas.addEventListener("pointerup", finishDrag);
    canvas.addEventListener("pointercancel", finishDrag);
    const caption = document.createElement("figcaption");
    caption.textContent = PROFILE_NAMES[profile];
    figure.append(canvas, caption);
    host.append(figure);
    stages.set(profile, canvas);
  }
}

const assetURL = (path) => RIG_ASSETS + path;
const setStatus = (text) => { $("status").textContent = text; };
const visibleBoundsByImage = new WeakMap();

function copy(value) { return structuredClone(value); }

/**
 * History owns the complete editable scene and enough editor context to put
 * the changed piece back in front of the artist. Presentation-only controls
 * (animation, playback, zoom and "rest of rig") deliberately stay out of it.
 */
function historySnapshot() {
  return {
    scene: copy(state.scene),
    slotID: state.slot.id,
    item: state.item,
    piece: state.piece,
    view: state.view,
  };
}

function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function updateHistoryControls() {
  $("undoEdit").disabled = state.history.undo.length === 0;
  $("redoEdit").disabled = state.history.redo.length === 0;
}

function commitHistory(before) {
  if (!before || sameSnapshot(before, historySnapshot())) return;
  state.history.undo.push(before);
  if (state.history.undo.length > state.history.limit) state.history.undo.shift();
  state.history.redo = [];
  updateHistoryControls();
}

function markDirty() {
  state.dirty = JSON.stringify(state.scene) !== JSON.stringify(state.savedScene);
  setStatus(state.dirty
    ? `Unsaved editor changes · ${itemLabel(state.item) ?? "equipment"}`
    : "Editor matches scene.json");
}

async function restoreHistory(snapshot) {
  state.scene = copy(snapshot.scene);
  state.slot = SLOTS.find((slot) => slot.id === snapshot.slotID) ?? SLOTS[0];
  state.item = snapshot.item;
  state.piece = snapshot.piece;
  state.view = VIEWS.some((view) => view.id === snapshot.view) ? snapshot.view : "both";
  buildViewTabs();
  buildStages();
  buildSlotTabs();
  syncItemPicker();
  await loadImages();
  syncFields();
  markDirty();
  updateHistoryControls();
  render();
}

async function undoEdit() {
  const snapshot = state.history.undo.pop();
  if (!snapshot) return;
  state.history.redo.push(historySnapshot());
  await restoreHistory(snapshot);
}

async function redoEdit() {
  const snapshot = state.history.redo.pop();
  if (!snapshot) return;
  state.history.undo.push(historySnapshot());
  await restoreHistory(snapshot);
}

function resetHistory() {
  state.history.undo = [];
  state.history.redo = [];
  updateHistoryControls();
}

function loadImage(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

/**
 * Registered equipment lives on a full-size transparent rig canvas. Outlining
 * that whole canvas makes a rotated shield look clipped because the enormous
 * transparent rectangle leaves the stage. Cache the actual painted bounds so
 * the selection outline follows the art instead.
 */
function visibleImageBounds(image) {
  const cached = visibleBoundsByImage.get(image);
  if (cached) return cached;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const fallback = { left: 0, top: 0, right: width, bottom: height };
  try {
    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] === 0) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    const bounds = right >= left
      ? { left, top, right: right + 1, bottom: bottom + 1 }
      : fallback;
    visibleBoundsByImage.set(image, bounds);
    return bounds;
  } catch {
    // All editor assets are same-origin, but retaining the full-image fallback
    // keeps selection usable if that contract ever changes.
    visibleBoundsByImage.set(image, fallback);
    return fallback;
  }
}

function catalogueFor(slot) { return state.scene?.[slot.catalogue] ?? []; }

/** The layer being placed: a held slot is its own layer, a set is one piece. */
function activeLayerID() {
  return state.slot.pieces?.length ? state.piece : state.slot.id;
}

/** The scene as this studio is currently wearing it. */
function sceneSelection() {
  const worn = { ...state.scene };
  if (state.item) worn[state.slot.active] = state.item;
  return worn;
}

const PROFILES = ["maleV1", "femaleV1"];

/** The bodies on screen: both of them, or the one being looked at alone. */
function shownProfiles() {
  return state.view === "both" ? PROFILES : [state.view];
}

/**
 * The profile an edit lands on. In the combined view an edit is meant for both
 * bodies, so there is no single answer -- callers that write use
 * `editedProfiles()` and this only names whose numbers the fields show.
 */
function primaryProfile() {
  return state.view === "both" ? "maleV1" : state.view;
}

function editedProfiles() {
  return state.view === "both" ? PROFILES : [state.view];
}

function resolveRig() {
  if (!state.scene) {
    state.rigs = {};
    return;
  }
  setClipPoseOffsets(state.scene.clipPoseOffsets);
  setBoneKeyframes(state.scene.boneKeyframes);
  setWristKeyframes(state.scene.wristKeyframes);
  setExpressionKeyframes(state.scene.expressionKeyframes);
  // Every slot id comes from the selection, never from the scene: passing the
  // scene's own value for a slot overrides what the studio is previewing, which
  // is why picking a boot or arm set used to leave the character unchanged.
  const worn = sceneSelection();
  for (const profile of PROFILES) {
    state.rigs[profile] = resolveProfile(
      worn, profile,
      worn.activeChest, worn.activeArmSet, worn.activeHeadgear,
      worn.activeBootSet, worn.activeNecklace,
      {
        weapon: worn.activeWeapon, staff: worn.activeStaff, bow: worn.activeBow,
        shield: worn.activeShield, quiver: worn.activeQuiver,
      }
    );
  }
}

async function loadImages() {
  resolveRig();
  for (const profile of PROFILES) {
    const pairs = await Promise.all((state.rigs[profile]?.layers ?? []).map(async (layer) => [
      layer.id, await loadImage(assetURL(layer.asset)),
    ]));
    state.images[profile] = new Map(pairs.filter(([, image]) => image));
    const profileExpressions = state.expressionCatalog?.profiles?.[profile];
    const expressionPaths = new Set([
      ...Object.values(profileExpressions?.eyes ?? {}).flatMap((eyes) => [eyes.left, eyes.right]),
      ...Object.values(profileExpressions?.mouths ?? {}),
    ].filter(Boolean));
    state.expressionImages[profile] = new Map((await Promise.all([...expressionPaths].map(async (path) => [
      path, await loadImage(assetURL(path)),
    ]))).filter(([, image]) => image));
  }
}

function expressionAssetPath(profile, layerID, animation, phase) {
  const catalog = state.expressionCatalog?.profiles?.[profile];
  if (!catalog) return null;
  const expression = expressionAt(animation, phase);
  if (layerID === "eyeL") return catalog.eyes?.[expression.eyes]?.left ?? null;
  if (layerID === "eyeR") return catalog.eyes?.[expression.eyes]?.right ?? null;
  if (layerID === "mouth" && expression.mouth !== "neutral") return catalog.mouths?.[expression.mouth] ?? null;
  return null;
}

function imageForLayer(profile, layer, animation = state.animation, phase = state.phase) {
  const path = expressionAssetPath(profile, layer.id, animation, phase);
  return path ? state.expressionImages[profile]?.get(path) : state.images[profile]?.get(layer.id);
}

function expressionKeys(create = false) {
  if (!state.scene) return [];
  if (create) {
    state.scene.expressionKeyframes ??= {};
    state.scene.expressionKeyframes[state.animation] ??= [];
  }
  return state.scene.expressionKeyframes?.[state.animation] ?? [];
}

function currentExpressionKey() {
  return expressionKeys().find((key) => Math.abs(key.phase - state.phase) <= 0.0015) ?? null;
}

function ensureExpressionKey() {
  const keys = expressionKeys(true);
  const phase = Number(state.phase.toFixed(4));
  let key = currentExpressionKey();
  if (key) return key;
  const sampled = expressionAt(state.animation, state.phase);
  if (!keys.length && phase > 0.0015) keys.push({ phase: 0, ...sampled });
  key = { phase, ...sampled };
  keys.push(key);
  keys.sort((left, right) => left.phase - right.phase);
  return key;
}

function adjacentExpressionKey(direction) {
  const epsilon = 0.0015;
  if (direction < 0) return [...expressionKeys()].reverse().find((key) => key.phase < state.phase - epsilon) ?? null;
  return expressionKeys().find((key) => key.phase > state.phase + epsilon) ?? null;
}

function setCurrentExpressionKey() {
  const before = historySnapshot();
  const key = ensureExpressionKey();
  key.eyes = $("expressionEyes").value;
  key.mouth = $("expressionMouth").value;
  setExpressionKeyframes(state.scene.expressionKeyframes);
  commitHistory(before);
  markDirty();
  render();
}

function updateExpressionChannel(channel, value) {
  state.playing = false;
  showPlayState();
  const before = historySnapshot();
  ensureExpressionKey()[channel] = value;
  setExpressionKeyframes(state.scene.expressionKeyframes);
  commitHistory(before);
  markDirty();
  render();
}

function deleteCurrentExpressionKey() {
  const key = currentExpressionKey();
  if (!key) return;
  const before = historySnapshot();
  const keys = expressionKeys();
  keys.splice(keys.indexOf(key), 1);
  if (!keys.length) delete state.scene.expressionKeyframes[state.animation];
  setExpressionKeyframes(state.scene.expressionKeyframes);
  commitHistory(before);
  markDirty();
  render();
}

function jumpToExpressionKey(direction) {
  const key = adjacentExpressionKey(direction);
  if (!key) return;
  state.playing = false;
  showPlayState();
  state.phase = key.phase;
  render();
}

function syncExpressionControls() {
  const sampled = expressionAt(state.animation, state.phase);
  $("expressionEyes").value = sampled.eyes;
  $("expressionMouth").value = sampled.mouth;
  const key = currentExpressionKey();
  $("deleteExpressionKey").disabled = !key;
  $("previousExpressionKey").disabled = !adjacentExpressionKey(-1);
  $("nextExpressionKey").disabled = !adjacentExpressionKey(1);
  $("expressionKeyStatus").textContent = key
    ? `Key at ${(key.phase * (animationDurations[state.animation] ?? 1.2)).toFixed(2)} s · ${key.eyes} eyes · ${key.mouth} mouth`
    : `${expressionKeys().length} expression key${expressionKeys().length === 1 ? "" : "s"} · changing a face adds one here`;
}

/** The catalogue entry the studio is editing. */
function selectedOption() {
  return catalogueFor(state.slot).find((option) => option.id === state.item) ?? null;
}

/**
 * The placements an edit writes to: one per body the current view speaks for.
 *
 * The combined view edits both at once, which is what makes it worth having --
 * most gear sits the same way on both bodies, and doing it twice by hand is how
 * the two drift apart. A single-body view writes only that body, overriding
 * whatever the combined view last set.
 */
function editableBinds() {
  if (!state.scene || !state.item) return [];
  const layer = state.scene.layers.find((candidate) => candidate.id === activeLayerID());
  if (!layer) return [];
  const selection = sceneSelection();
  return editedProfiles()
    .map((profile) => layerBindOwner(selection, layer, profile))
    .filter(Boolean);
}

/** The placement the fields display: the primary body's. */
function editableBind() {
  if (!state.scene || !state.item) return null;
  const layer = state.scene.layers.find((candidate) => candidate.id === activeLayerID());
  if (!layer) return null;
  return layerBindOwner(sceneSelection(), layer, primaryProfile());
}

function appendBezierSegment(target, from, to, scalePoint) {
  const controlA = scalePoint(from.out ?? from);
  const controlB = scalePoint(to.in ?? to);
  const endpoint = scalePoint(to);
  target.bezierCurveTo(controlA.x, controlA.y, controlB.x, controlB.y, endpoint.x, endpoint.y);
}

function traceBezierPath(target, path, width, height) {
  if (!path?.closed || path.nodes?.length < 3) return false;
  const scalePoint = (point) => ({ x: point.x * width, y: point.y * height });
  const first = scalePoint(path.nodes[0]);
  target.beginPath();
  target.moveTo(first.x, first.y);
  for (let index = 1; index < path.nodes.length; index += 1) {
    appendBezierSegment(target, path.nodes[index - 1], path.nodes[index], scalePoint);
  }
  appendBezierSegment(target, path.nodes.at(-1), path.nodes[0], scalePoint);
  target.closePath();
  return true;
}

function gripLayerID(animation) {
  if (animation.startsWith("bow")) return "bow";
  // The body clip is named swordSwing, but while fitting a staff or spear its
  // hand controls must remain in the staff family rather than borrowing the
  // ordinary weapon channel.
  if (GRIPPABLE_SLOTS.has(state.slot.id)) return state.slot.id;
  if (animation.startsWith("staff")) return "staff";
  return "weapon";
}

function gripControls(animation, phase) {
  return gripControlsAt(animation, "L", phase, GRIP_FINGER_LAYER_IDS, gripLayerID(animation));
}

function activeGripLayer(rig, animation) {
  const id = GRIPPABLE_SLOTS.has(state.slot.id) ? state.slot.id : gripLayerID(animation);
  // The resolved item layer is also the grip socket. Replacing its x/y with
  // the empty slot's registration made the same item and keys disagree with
  // the Modular Character Studio rig editor.
  return rig.layers.find((candidate) => candidate.id === id);
}

function posedGripLayer(layer, rig, animation, phase) {
  return posedGripAttachment(
    layer,
    rig.layers,
    activeGripLayer(rig, animation),
    gripControls(animation, phase),
  );
}

function drawMeshLayer(target, layer, image, bindWorld, currentWorld) {
  const deformation = deformWeightedMesh(layer, image.width, image.height, bindWorld, currentWorld);
  if (!deformation) return false;
  for (const triangle of deformation.triangles) {
    const source = triangle.map((index) => deformation.vertices[index].source);
    const destination = triangle.map((index) => deformation.points[index]);
    const matrix = triangleTransform(source, destination);
    if (!matrix) continue;
    target.save();
    target.beginPath();
    target.moveTo(destination[0].x, destination[0].y);
    target.lineTo(destination[1].x, destination[1].y);
    target.lineTo(destination[2].x, destination[2].y);
    target.closePath();
    target.clip();
    target.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    target.drawImage(image, 0, 0);
    target.restore();
  }
  return true;
}

function drawLayer(target, layer, image, bindWorld, currentWorld, rig, animation, phase) {
  const posedLayer = posedGripLayer(layer, rig, animation, phase);
  if (posedLayer.mesh && drawMeshLayer(target, posedLayer, image, bindWorld, currentWorld)) return;
  const matrix = rigidLayerMatrix(posedLayer, image.width, image.height, bindWorld, currentWorld);
  target.save();
  // Compose with paintRig's thumbnail scale instead of replacing it.
  target.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  if (traceBezierPath(target, posedLayer.clipPath, image.width, image.height)) target.clip();
  const strips = planeStrips(posedLayer, image.width, image.height);
  if (strips) {
    for (const strip of strips) {
      target.drawImage(image, strip.sourceX, 0, strip.sourceWidth, image.height,
        strip.x, strip.y, strip.width + 0.5, strip.height);
    }
  } else {
    target.drawImage(image, 0, 0);
  }
  target.restore();
}

/** Match the Rig Studio's saved-pose normalization before deriving bones. */
function constrainedAnimationPose(rig, animation, phase) {
  return constrainForearmPose(rig.bones, animationPose(animation, phase));
}

/**
 * Paint the rig at one clip. The selected item always draws; the rest of the
 * body is optional, so a hilt can be checked against a bare skeleton when the
 * torso is in the way.
 */
function paintRig(target, size, animation, phase, profile = primaryProfile()) {
  const rig = state.rigs[profile];
  if (!rig) return { bindWorld: {}, currentWorld: {} };
  const scale = size / SIZE;
  target.save();
  target.clearRect(0, 0, size, size);
  target.scale(scale, scale);
  const pose = constrainedAnimationPose(rig, animation, phase);
  const bindWorld = worldMatrices(rig.bones);
  const currentWorld = worldMatrices(rig.bones, pose);
  const handPose = animationHandPose[animation] ?? "closed";
  const placed = activeLayerID();
  const placedBone = rig.layers.find((layer) => layer.id === placed)?.bone;
  const layers = [...rig.layers]
    .filter((layer) => {
      const activeGripHand = GRIPPABLE_SLOTS.has(state.slot.id) && GRIP_HAND_LAYER_IDS.has(layer.id);
      return layer.visible
      && layerMatchesHandPose(layer, handPose)
      // The piece being placed always draws. A staff ships only in its own idle,
      // but its grip still has to be judged against a turn, a run and a lunge.
      && (activeGripHand || layer.id === placed || layerMatchesAnimationEquipment(layer, animation))
      // Nothing else the clip carries in that same hand draws, though: reviewing
      // a staff in the lunge would otherwise put the sword through it, since
      // that clip is authored to hold a blade.
      && (activeGripHand || layer.id === placed || !heldElsewhere(layer, placedBone))
      // The palm, thumb, and four rigid fingers are part of fitting a held item,
      // not "the rest of the rig", so they remain visible in every review clip.
      && (activeGripHand || state.showOthers || layer.id === placed);
    })
    .sort((left, right) => left.drawOrder - right.drawOrder);
  for (const layer of layers) {
    const image = imageForLayer(profile, layer, animation, phase);
    if (image) drawLayer(target, layer, image, bindWorld, currentWorld, rig, animation, phase);
  }
  target.restore();
  return { bindWorld, currentWorld };
}

function render() {
  if (!state.scene || !stages.size) return;
  // Two bodies share the width, so each is drawn smaller when both are up.
  const spread = shownProfiles().length > 1 ? 0.62 : 1;
  for (const [profile, canvas] of stages) {
    canvas.style.width = `${Math.round(SIZE * state.zoom * spread)}px`;
    canvas.style.height = `${Math.round(SIZE * state.zoom * spread)}px`;
    const frames = paintRig(canvas.getContext("2d"), SIZE, state.animation, state.phase, profile);
    if (profile === primaryProfile()) outlineSelection(canvas.getContext("2d"), frames);
  }
  syncAnimationPicker();
  $("animationTimeline").value = String(Math.round(state.phase * 1000));
  $("animationTimeReadout").textContent = `${(state.phase * (animationDurations[state.animation] ?? 1.2)).toFixed(2)} s`;
  syncGripControls();
  syncExpressionControls();
  const piece = state.slot.pieces?.find((candidate) => candidate.id === state.piece);
  $("stageTitle").textContent = [
    animationLabel(state.animation),
    itemLabel(state.item) ?? "no item",
    piece?.label,
  ].filter(Boolean).join(" · ");
}

/** A dashed box around the item being placed, so it is findable at any zoom. */
function outlineSelection(context, { bindWorld, currentWorld }) {
  const layer = state.rigs[primaryProfile()]?.layers
    .find((candidate) => candidate.id === activeLayerID());
  const image = layer && state.images[primaryProfile()]?.get(layer.id);
  if (!layer || !image) return;
  const posedLayer = posedGripLayer(
    layer, state.rigs[primaryProfile()], state.animation, state.phase,
  );
  const matrix = rigidLayerMatrix(posedLayer, image.width, image.height, bindWorld, currentWorld);
  const bounds = visibleImageBounds(image);
  const corners = [
    { x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom }, { x: bounds.left, y: bounds.bottom },
  ].map((corner) => transformPoint(matrix, corner));
  context.save();
  context.strokeStyle = "#f0b24b";
  context.lineWidth = 4;
  context.setLineDash([12, 8]);
  context.beginPath();
  corners.forEach((corner, index) => index ? context.lineTo(corner.x, corner.y) : context.moveTo(corner.x, corner.y));
  context.closePath();
  context.stroke();
  context.restore();
}

/** Every layer some clip singles out as equipment -- the held and worn pieces. */
const EQUIPMENT_LAYERS = new Set(Object.values(animationEquipment).flat());

/** Another piece of equipment gripped by the bone the placed one is on. */
function heldElsewhere(layer, placedBone) {
  return placedBone !== undefined
    && layer.bone === placedBone
    && EQUIPMENT_LAYERS.has(layer.id);
}

function syncAnimationPicker() {
  const label = animationLabel(state.animation);
  $("animationPickerButton").textContent = label;
  $("animationPickerButton").setAttribute("aria-label", `Animation: ${label}`);
  for (const option of $("animationGrid").querySelectorAll("[data-animation]")) {
    option.setAttribute("aria-selected", String(option.dataset.animation === state.animation));
  }
}

function selectAnimation(animation) {
  state.animation = animation;
  // Switching mid-playback starts the new motion cleanly; while paused it opens
  // at the authored review frame used for equipment and finger placement.
  state.phase = state.playing ? 0 : REVIEW_PHASE[animation] ?? 0;
  render();
}

function buildAnimationOptions() {
  const grid = $("animationGrid");
  grid.replaceChildren();
  for (const animation of reviewAnimations(activeLayerID())) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "animation-option";
    button.dataset.animation = animation;
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", animationLabel(animation));
    const preview = document.createElement("canvas");
    preview.width = 176;
    preview.height = 176;
    preview.setAttribute("aria-hidden", "true");
    const caption = document.createElement("span");
    caption.className = "animation-option-name";
    caption.textContent = animationLabel(animation);
    button.append(preview, caption);
    button.addEventListener("click", () => {
      selectAnimation(animation);
      closeAnimationModal();
    });
    grid.append(button);
  }
  syncAnimationPicker();
}

function renderAnimationPreviews(timestamp = performance.now()) {
  if (!$("animationModal").open || !state.scene) return;
  for (const option of $("animationGrid").querySelectorAll("[data-animation]")) {
    const animation = option.dataset.animation;
    const preview = option.querySelector("canvas");
    const duration = animationDurations[animation] ?? 1.2;
    const phase = (timestamp / (duration * 1000)) % 1;
    paintRig(preview.getContext("2d"), preview.width, animation, phase);
  }
}

function openAnimationModal() {
  buildAnimationOptions();
  const modal = $("animationModal");
  if (!modal.open) modal.showModal();
  $("animationPickerButton").setAttribute("aria-expanded", "true");
  state.lastAnimationPreviewTimestamp = 0;
  renderAnimationPreviews();
  const current = $("animationGrid").querySelector('[aria-selected="true"]');
  current?.focus();
  current?.scrollIntoView({ block: "nearest" });
}

function closeAnimationModal() {
  if ($("animationModal").open) $("animationModal").close();
}

function syncClosedAnimationModal() {
  $("animationPickerButton").setAttribute("aria-expanded", "false");
  $("animationPickerButton").focus();
}

function navigateAnimationGrid(event) {
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 };
  const options = [...$("animationGrid").querySelectorAll("[data-animation]")];
  const current = options.indexOf(document.activeElement);
  let target = offsets[event.key] === undefined ? current : current + offsets[event.key];
  if (event.key === "Home") target = 0;
  if (event.key === "End") target = options.length - 1;
  if (target === current || target < 0 || target >= options.length) return;
  event.preventDefault();
  options[target].focus();
}


function buildSlotTabs() {
  for (const [container, worn] of [["slotTabs", false], ["wornTabs", true]]) {
    const tabs = $(container);
    tabs.replaceChildren();
    for (const slot of SLOTS.filter((candidate) => Boolean(candidate.worn) === worn)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = slot.label;
      button.setAttribute("aria-pressed", String(slot.id === state.slot.id));
      button.disabled = !catalogueFor(slot).length;
      button.addEventListener("click", () => selectSlot(slot));
      tabs.append(button);
    }
  }
  buildPieceTabs();
}

function buildPieceTabs() {
  const tabs = $("pieceTabs");
  const pieces = state.slot.pieces ?? [];
  tabs.hidden = !pieces.length;
  $("pieceRow").hidden = !pieces.length;
  tabs.replaceChildren();
  for (const piece of pieces) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = piece.label;
    button.setAttribute("aria-pressed", String(piece.id === state.piece));
    button.addEventListener("click", () => selectPiece(piece.id));
    tabs.append(button);
  }
}

async function selectPiece(id) {
  state.piece = id;
  buildPieceTabs();
  syncFields();
  render();
}

/** Item metadata by id, for the picker's grid. */
async function loadCatalog() {
  const [catalogResponse, matrixResponse] = await Promise.all([
    fetch("/assets/equipment-catalog.json"),
    fetch("/assets/equipment-matrix.json"),
  ]);
  const [catalog, matrix] = await Promise.all([catalogResponse.json(), matrixResponse.json()]);
  state.catalog = new Map(
    [...catalog.items, ...matrix.items].map((item) => [item.id, item])
  );
  state.applicability = new Map(
    Object.entries(matrix.applicability).map(([slot, lines]) => [slot, new Set(lines)])
  );
}

function itemLabel(id) {
  return catalogueFor(state.slot).find((option) => option.id === id)?.label ?? null;
}

/** What the slot is wearing, shown on the box that opens the picker. */
function syncItemPicker() {
  const options = catalogueFor(state.slot);
  $("itemCount").value = String(options.length);
  $("itemPickerName").textContent = itemLabel(state.item) ?? "No item";
  const item = state.catalog.get(
    options.find((option) => option.id === state.item)?.itemID ?? ""
  );
  const line = equipmentLines.find((candidate) => candidate.id === lineFor(item));
  $("itemPickerMeta").textContent = item
    ? [line?.name ?? UNALIGNED.name, item.rarity ?? "—", `L${item.level ?? "?"}`].join(" · ")
    : "not in the item catalogue";

  const fitted = $("fittedToggle");
  fitted.checked = selectedOption()?.fitted === true;
  fitted.disabled = !state.item;

  // The source is a choice, not a view: switching piece, item, or body rebuilds
  // this list, and rebuilding it used to snap the pick back to the first entry.
  const copy = $("copySource");
  copy.replaceChildren();
  const copyOptions = options
    .filter((option) => option.id !== state.item)
    .sort((left, right) => left.label.localeCompare(
      right.label,
      undefined,
      { sensitivity: "base", numeric: true },
    ));
  for (const option of copyOptions) {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.label;
    copy.append(element);
  }
  if (options.some((option) => option.id === state.copySource && option.id !== state.item)) {
    copy.value = state.copySource;
  }
}

/**
 * Every option in this slot, filed by build line and tier. An option whose item
 * is unknown to the catalogue is unaligned: it can still be picked, it just has
 * no place on the ladder yet.
 */
function optionsByCell() {
  const cells = new Map();
  for (const option of catalogueFor(state.slot)) {
    const item = state.catalog.get(option.itemID ?? "");
    // An option may name its own rung when no item speaks for it.
    const line = option.line ?? lineFor(item) ?? UNALIGNED.id;
    // An option with no inventory item is a look, not gear: the bare tunic, the
    // default arms. Those are what the character starts in, so they file as
    // common rather than as data with a missing rating.
    const tier = option.tier ?? tierFor(item ?? {}) ?? (option.itemID ? UNRATED.id : "common");
    const key = `${line}/${tier}`;
    cells.set(key, [...(cells.get(key) ?? []), { option, item }]);
  }
  return cells;
}

/**
 * Which catalogue items belong in a slot's grid.
 *
 * Two studio slots share one game slot: a blade and a staff are both main hand,
 * and the rig wears them on different layers. Splitting by weapon category is
 * what keeps the staff picker from listing every axe in the game.
 */
const SLOT_ITEMS = {
  weapon: { slot: "mainHand", categories: ["blade", "axe"] },
  tunicBody: { slot: "body" },
  headgear: { slot: "head" },
  ring: { slot: "ring" },
  staff: { slot: "mainHand", categories: ["staff", "wand", "spear"] },
  bow: { slot: "ranged" },
  shield: { slot: "offHand" },
  necklace: { slot: "necklace" },
  quiver: { slot: "quiver" },
  boots: { slot: "boots" },
  arms: { slot: "bracers" },
};

/**
 * Items with no rig art anywhere: the backlog.
 *
 * "Dressed" is asked of every catalogue, not just this slot's, because an item
 * only needs art once. A staff picker that measured against staff options alone
 * would report every axe in the game as needing art.
 */
function unmadeByCell() {
  const wanted = SLOT_ITEMS[state.slot.id];
  if (!wanted) return new Map();
  const dressed = new Set();
  for (const slot of SLOTS) {
    for (const option of catalogueFor(slot)) {
      if (option.itemID) dressed.add(option.itemID);
    }
  }
  const cells = new Map();
  for (const item of state.catalog.values()) {
    if (item.slot !== wanted.slot || dressed.has(item.id)) continue;
    if (wanted.categories && !wanted.categories.includes(item.category)) continue;
    const key = `${lineFor(item) ?? UNALIGNED.id}/${tierFor(item) ?? UNRATED.id}`;
    cells.set(key, [...(cells.get(key) ?? []), item]);
  }
  return cells;
}


/** What an item that has no rig art does already have, for the cell's tooltip. */
function alreadyDrawn(item) {
  const has = [];
  if (item.inventoryArt) has.push("inventory icon");
  return has.length ? `has ${has.join(" and ")}, but no angled-view rig art` : "no art at all";
}

/**
 * What is still owed on a piece, marked rather than described.
 *
 * Two separate debts, because they are paid by different work: fitting the
 * piece over the rig and drawing its inventory icon.
 */
function statusMarks(option, item) {
  const marks = document.createElement("span");
  marks.className = "status-marks";
  const add = (kind, glyph, title) => {
    const mark = document.createElement("span");
    mark.className = `status-mark ${kind}`;
    mark.textContent = glyph;
    mark.title = title;
    marks.append(mark);
  };
  if (option.fitted !== true) add("unfitted", "◆", "Not fitted over the rig yet");
  if (item && item.inventoryArt === false) add("no-inventory", "▣", "No inventory icon");
  return marks;
}

function buildItemGrid() {
  const grid = $("itemGrid");
  const columns = [UNALIGNED, ...equipmentLines];
  grid.replaceChildren();
  grid.style.gridTemplateColumns = `120px repeat(${columns.length}, minmax(150px, 1fr))`;
  $("itemModalTitle").textContent = `Choose ${state.slot.label.toLowerCase()}`;

  grid.append(document.createElement("div"));
  for (const column of columns) {
    const head = document.createElement("div");
    head.className = "column-head";
    head.innerHTML = `<strong></strong>`;
    head.firstChild.textContent = column.name;
    head.append(column.blurb ?? "");
    grid.append(head);
  }

  const filled = optionsByCell();
  const unmade = unmadeByCell();
  for (const tier of [...equipmentTiers, UNRATED]) {
    const head = document.createElement("div");
    head.className = "row-head";
    head.innerHTML = `<strong></strong>`;
    head.firstChild.textContent = tier.name;
    head.append(`Level ${tier.level}`);
    grid.append(head);

    for (const column of columns) {
      const key = `${column.id}/${tier.id}`;
      const entries = filled.get(key) ?? [];
      const pending = unmade.get(key) ?? [];
      // A cell can hold more than one item -- two magical wands, three common
      // shields -- so each is its own button. Showing the first and a count
      // left the rest unreachable.
      if (entries.length) {
        const cell = document.createElement("div");
        cell.className = "item-cell filled";
        for (const { option, item } of entries) {
          const choice = document.createElement("button");
          choice.type = "button";
          choice.className = "item-choice";
          choice.setAttribute("aria-pressed", String(option.id === state.item));
          choice.dataset.fitted = String(option.fitted === true);
          choice.innerHTML = `<span></span><span class="cell-meta"></span>`;
          choice.firstChild.textContent = option.label;
          choice.children[1].textContent = item?.rarity ?? "no catalogue entry";
          choice.append(statusMarks(option, item));
          choice.addEventListener("click", async () => {
            $("itemModal").close();
            await selectItem(option.id);
          });
          cell.append(choice);
        }
        grid.append(cell);
        continue;
      }

      const cell = document.createElement("button");
      cell.type = "button";
      cell.disabled = true;
      const applicable = column.id === UNALIGNED.id
        || state.applicability.get(state.slot.id)?.has(column.id) === true;
      if (!applicable) {
        cell.className = "item-cell not-applicable";
        cell.textContent = "N/A";
        cell.title = `${column.name} does not use ${state.slot.label.toLowerCase()}`;
        grid.append(cell);
        continue;
      }
      if (pending.length) {
        // "Needs rig art", not "needs art": these are shipping items with icons.
        // What they lack is a piece cut for the angled-view rig, which is the
        // only art this studio can place.
        cell.className = "item-cell unmade";
        cell.innerHTML = `<span></span><span class="cell-meta">needs rig art</span>`;
        cell.firstChild.textContent = pending.map((item) => item.name).join(", ");
        cell.title = pending.map((item) => `${item.name}: ${alreadyDrawn(item)}`).join("\n");
      } else {
        cell.className = "item-cell empty";
        cell.textContent = "EMPTY";
      }
      grid.append(cell);
    }
  }
}


async function selectSlot(slot) {
  state.slot = slot;
  state.piece = slot.pieces?.[0]?.id ?? null;
  const items = catalogueFor(slot);
  state.item = state.scene?.[slot.active] ?? items[0]?.id ?? null;
  const clips = reviewAnimations(slot.id);
  state.animation = clips[0] ?? "idle";
  state.phase = REVIEW_PHASE[state.animation] ?? 0;
  buildSlotTabs();
  syncItemPicker();
  await loadImages();
  syncFields();
  render();
}

async function selectItem(id) {
  // Record the choice on the scene at once, not only at save time. Until it
  // did, switching to a second slot re-read the scene's saved selection and
  // the first slot snapped back to its default, so a set could never be
  // fitted piece by piece. The change is undoable and marks the scene dirty
  // like any placement edit; save() writes the whole scene.
  const before = historySnapshot();
  state.item = id;
  if (id) state.scene[state.slot.active] = id;
  commitHistory(before);
  markDirty();
  syncItemPicker();
  await loadImages();
  syncFields();
  render();
}

/**
 * One row per placement value: a slider to sweep it and a box to type it.
 *
 * The ranges are what a placement normally needs, not a limit -- a value
 * outside one widens its own slider rather than being clipped, so typing 900
 * into X keeps working and the slider re-scales around it.
 */
const FIELDS = [
  ["fieldX", "x", { min: -400, max: 400, step: 1 }],
  ["fieldY", "y", { min: -400, max: 400, step: 1 }],
  ["fieldRotation", "rotation", { min: -180, max: 180, step: 1 }],
  ["fieldPlaneYaw", "planeYaw", { min: -60, max: 60, step: 1 }],
  ["fieldScaleX", "scaleX", { min: -2, max: 2, step: 0.01 }],
  ["fieldScaleY", "scaleY", { min: -2, max: 2, step: 0.01 }],
  ["fieldPivotX", "pivotX", { min: 0, max: 1, step: 0.005 }],
  ["fieldPivotY", "pivotY", { min: 0, max: 1, step: 0.005 }],
];

const sliderFor = (field) => $(field.replace("field", "range"));

/** Round to the step, so 0.005 nudges do not accumulate float dust. */
function quantize(value, step) {
  const places = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(value.toFixed(places));
}

function syncFields() {
  const bind = editableBind();
  const piece = state.slot.pieces?.find((candidate) => candidate.id === state.piece);
  $("itemTitle").textContent = [itemLabel(state.item) ?? "No item selected", piece?.label]
    .filter(Boolean).join(" · ");
  for (const [field, key, range] of FIELDS) {
    const value = bind ? bind[key] ?? 0 : null;
    const slider = sliderFor(field);
    // A value past the usual range pushes the slider's ends out to reach it.
    const reach = Math.max(Math.abs(range.min), Math.abs(range.max), Math.abs(value ?? 0));
    slider.min = String(range.min < 0 ? -reach : Math.min(range.min, value ?? range.min));
    slider.max = String(Math.max(range.max, reach));
    slider.step = String(range.step);
    slider.value = String(value ?? 0);
    slider.disabled = !bind;
    $(field).step = String(range.step);
    $(field).value = bind ? String(value) : "";
    $(field).disabled = !bind;
  }
}

function writeBind(key, value) {
  const binds = editableBinds();
  if (!binds.length || !Number.isFinite(value)) return;
  for (const bind of binds) bind[key] = value;
  markDirty();
  resolveRig();
  render();
}

function gripEditingIsAvailable() {
  return GRIPPABLE_SLOTS.has(state.slot.id)
    && GRIP_FINGER_LAYER_IDS.some((id) => state.scene?.layers.some((layer) => layer.id === id && layer.gripFinger));
}

function selectedFingerIDs() {
  return state.selectedGripFinger === "all" ? GRIP_FINGER_LAYER_IDS : [state.selectedGripFinger];
}

function selectedFingerLayers() {
  return selectedFingerIDs()
    .map((id) => state.scene?.layers.find((layer) => layer.id === id))
    .filter((layer) => layer?.gripFinger);
}

function gripKeys(create = false) {
  const track = gripUsesAnimationOverride(state.animation)
    ? state.animation
    : gripTrackName(gripLayerID(state.animation));
  if (create) {
    state.scene.wristKeyframes ??= {};
    state.scene.wristKeyframes[track] ??= {};
    state.scene.wristKeyframes[track].L ??= [];
  }
  return state.scene?.wristKeyframes?.[track]?.L ?? [];
}

/**
 * Attack clips can hold either an ordinary weapon or a staff. Keep the legacy
 * flat payload for the clip's natural family and store the alternate family
 * under `grips`, which the shared sampler already understands.
 */
function gripKeyPayload(key, create = false) {
  if (!key) return null;
  const kind = gripLayerID(state.animation);
  if (!gripUsesAnimationOverride(state.animation) || kind === defaultGripKind(state.animation)) return key;
  if (create) {
    key.grips ??= {};
    key.grips[kind] ??= {};
  }
  return key.grips?.[kind] ?? null;
}

function currentGripKey() {
  return gripKeys().find((key) => Math.abs(key.phase - state.phase) <= 0.0015) ?? null;
}

function ensureGripKey() {
  let key = currentGripKey();
  if (!key) {
    key = {
      phase: Number(state.phase.toFixed(4)),
      angle: gripUsesAnimationOverride(state.animation)
        ? wristKeyframeAngle(state.animation, "L", state.phase)
        : 0,
    };
    gripKeys(true).push(key);
    gripKeys().sort((left, right) => left.phase - right.phase);
  }
  return key;
}

function fingerAnchorValue(layer, field) {
  if (field === "pivotX" || field === "pivotY") {
    return layer.gripFinger.basePivot[field === "pivotX" ? "x" : "y"];
  }
  return layer.gripFinger[field];
}

function gripFieldValue(key, kind) {
  const layers = selectedFingerLayers();
  if (!layers.length) return 0;
  const controls = gripControls(state.animation, state.phase);
  if (kind === "axis") return controls.knuckleAxis;
  if (kind === "angle") {
    return layers.reduce((sum, layer) => sum + (controls.fingerAngles[layer.id] ?? 0), 0) / layers.length;
  }
  if (kind === "offset") {
    return layers.reduce((sum, layer) => sum
      + fingerAnchorValue(layer, key)
      + (controls.fingerOffsets[layer.id]?.[key] ?? 0), 0) / layers.length;
  }
  if (kind === "scale") {
    return layers.reduce((sum, layer) => sum + Math.abs(layer.bindByProfile[primaryProfile()][key]), 0) / layers.length;
  }
  return layers.reduce((sum, layer) => sum + fingerAnchorValue(layer, key), 0) / layers.length;
}

function syncGripControls() {
  const available = gripEditingIsAvailable();
  $("gripPlacementBox").hidden = !available;
  if (!available) return;
  const heldClass = gripLayerID(state.animation);
  $("gripMotionName").value = `${CLIP_LABELS[state.animation] ?? state.animation} · ${heldClass}`;
  for (const [field, key, range] of GRIP_FIELDS) {
    const box = $(field);
    const slider = sliderFor(field);
    const value = quantize(gripFieldValue(key, range.kind), range.step);
    const reach = Math.max(Math.abs(range.min), Math.abs(range.max), Math.abs(value));
    slider.min = String(range.min < 0 ? -reach : Math.min(range.min, value));
    slider.max = String(Math.max(range.max, reach));
    slider.step = String(range.step);
    box.step = String(range.step);
    if (document.activeElement !== box && document.activeElement !== slider) {
      slider.value = String(value);
      box.value = String(value);
    }
  }
}

function writeGripField(key, kind, value) {
  const layers = selectedFingerLayers();
  if (!layers.length || !Number.isFinite(value)) return;
  if (["offset", "angle", "axis"].includes(kind)) {
    state.playing = false;
    showPlayState();
    const current = gripFieldValue(key, kind);
    const sampled = gripControls(state.animation, state.phase);
    const gripKey = gripKeyPayload(ensureGripKey(), true);
    if (kind === "axis") {
      gripKey.knuckleAxis = value;
    } else if (kind === "angle") {
      const delta = value - current;
      gripKey.fingerAngles ??= {};
      for (const layer of layers) {
        const base = Number.isFinite(gripKey.fingerAngles[layer.id])
          ? gripKey.fingerAngles[layer.id]
          : (sampled.fingerAngles[layer.id] ?? 0);
        gripKey.fingerAngles[layer.id] = base + delta;
      }
    } else {
      const delta = value - current;
      gripKey.fingerOffsets ??= {};
      for (const layer of layers) {
        gripKey.fingerOffsets[layer.id] ??= {};
        const base = Number.isFinite(gripKey.fingerOffsets[layer.id][key])
          ? gripKey.fingerOffsets[layer.id][key]
          : (sampled.fingerOffsets[layer.id]?.[key] ?? 0);
        gripKey.fingerOffsets[layer.id][key] = base + delta;
      }
    }
    setWristKeyframes(state.scene.wristKeyframes);
  } else if (kind === "pivot") {
    const delta = value - gripFieldValue(key, kind);
    const coordinate = key === "pivotX" ? "x" : "y";
    for (const layer of layers) {
      layer.gripFinger.basePivot[coordinate] = Math.max(0, Math.min(1,
        layer.gripFinger.basePivot[coordinate] + delta));
    }
  } else if (kind === "scale") {
    const current = gripFieldValue(key, kind);
    if (current <= 0) return;
    const ratio = value / current;
    for (const layer of layers) {
      for (const profile of PROFILES) layer.bindByProfile[profile][key] *= ratio;
    }
  }
  markDirty();
  resolveRig();
  render();
}

function copyGripChannelThroughKeys() {
  if (!gripEditingIsAvailable()) return;
  const before = historySnapshot();
  if (!gripKeys().length) ensureGripKey();
  const keys = gripKeys();
  const controls = gripControls(state.animation, state.phase);
  const layers = selectedFingerLayers();
  const channel = $("copyGripChannel").value;
  for (const sourceKey of keys) {
    const gripKey = gripKeyPayload(sourceKey, true);
    if (channel === "knuckleAxis") {
      gripKey.knuckleAxis = controls.knuckleAxis;
    } else if (channel === "fingerAngle") {
      gripKey.fingerAngles ??= {};
      for (const layer of layers) gripKey.fingerAngles[layer.id] = controls.fingerAngles[layer.id] ?? 0;
    } else {
      const axis = channel === "fingerAlong" ? "along" : "across";
      gripKey.fingerOffsets ??= {};
      for (const layer of layers) {
        gripKey.fingerOffsets[layer.id] ??= { along: 0, across: 0 };
        gripKey.fingerOffsets[layer.id][axis] = controls.fingerOffsets[layer.id]?.[axis] ?? 0;
      }
    }
  }
  setWristKeyframes(state.scene.wristKeyframes);
  markDirty();
  resolveRig();
  commitHistory(before);
  render();
  const label = $("copyGripChannel").selectedOptions[0]?.textContent ?? "Value";
  const scope = gripUsesAnimationOverride(state.animation)
    ? `${animationLabel(state.animation)} override`
    : `${gripLayerID(state.animation)} family`;
  setStatus(`Copied ${label.toLowerCase()} through ${keys.length} ${scope} key${keys.length === 1 ? "" : "s"}`);
}

function canvasPoint(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) / bounds.width * SIZE,
    y: (event.clientY - bounds.top) / bounds.height * SIZE,
  };
}

/**
 * Dragging moves the item in the space its bind is written in, so the offset
 * has to come back through the bone's own matrix rather than being applied in
 * canvas pixels -- otherwise a rotated or scaled bone drags at the wrong rate.
 */
function beginDrag(event) {
  const binds = editableBinds();
  const bind = editableBind();
  const layer = state.rigs[primaryProfile()]?.layers
    .find((candidate) => candidate.id === activeLayerID());
  if (!bind || !binds.length || !layer) return;
  const bone = worldMatrices(
    state.rigs[primaryProfile()].bones,
    animationPose(state.animation, state.phase)
  )[layer.bone];
  if (!bone) return;
  const start = transformPoint(inverse(bone), canvasPoint(event));
  state.dragging = {
    binds, bone, start, originX: bind.x, originY: bind.y,
    before: historySnapshot(), pointerID: event.pointerId,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function moveDrag(event) {
  if (!state.dragging) return;
  const { binds, bone, start, originX, originY } = state.dragging;
  const local = transformPoint(inverse(bone), canvasPoint(event));
  // Every body the view speaks for moves together, the same as a typed edit.
  for (const bind of binds) {
    bind.x = Number((originX + local.x - start.x).toFixed(2));
    bind.y = Number((originY + local.y - start.y).toFixed(2));
  }
  markDirty();
  resolveRig();
  syncFields();
  render();
}

function finishDrag(event) {
  if (!state.dragging) return;
  if (event.currentTarget.hasPointerCapture?.(state.dragging.pointerID)) {
    event.currentTarget.releasePointerCapture(state.dragging.pointerID);
  }
  commitHistory(state.dragging.before);
  state.dragging = null;
}

async function save() {
  try {
    setStatus("Saving…");
    const before = historySnapshot();
    // Selections are already on the scene (selectItem writes them); this only
    // guards a slot whose picker was never touched. Everything this studio
    // does not own is whatever the rig studio last wrote.
    if (state.item) state.scene[state.slot.active] = state.item;
    const response = await fetch("/api/scene", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(state.revision ? { "If-Match": state.revision } : {}) },
      body: JSON.stringify(state.scene),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    state.scene = await response.json();
    state.revision = response.headers.get("ETag");
    state.savedScene = structuredClone(state.scene);
    state.dirty = false;
    commitHistory(before);
    await loadImages();
    syncFields();
    render();
    setStatus("Saved to scene.json");
  } catch (error) {
    setStatus(`Save failed: ${error.message}`);
  }
}

function optionBindFor(option) {
  if (!option) return null;
  return state.slot.pieces?.length
    ? option.bindByLayer?.[state.piece]?.[primaryProfile()]
    : option.bindByProfile?.[primaryProfile()];
}

function revertItem() {
  const saved = state.savedScene?.[state.slot.catalogue]?.find((option) => option.id === state.item);
  const binds = editableBinds();
  const source = optionBindFor(saved);
  if (!source || !binds.length) return;
  const before = historySnapshot();
  for (const bind of binds) Object.assign(bind, structuredClone(source));
  resolveRig();
  syncFields();
  render();
  commitHistory(before);
  markDirty();
}

/** One placement to copy: the source's bind for a piece, and the bind it lands on. */
function copyPair(source, pieceID, profile) {
  const layer = state.scene.layers.find((candidate) => candidate.id === pieceID);
  const from = state.slot.pieces?.length
    ? source.bindByLayer?.[pieceID]?.[profile]
    : source.bindByProfile?.[profile];
  const target = layer && layerBindOwner(sceneSelection(), layer, profile);
  return from && target ? [target, from] : null;
}

/**
 * Copy a whole set's placement, piece by piece: a boot's shaft and foot were
 * fitted together, so taking one without the other is never what is wanted.
 */
function copyFrom() {
  const source = catalogueFor(state.slot).find((option) => option.id === $("copySource").value);
  if (!source || !state.item) return;
  const pieces = state.slot.pieces?.map((piece) => piece.id) ?? [state.slot.id];
  const copies = pieces.flatMap((pieceID) => editedProfiles().map((profile) => copyPair(source, pieceID, profile)))
    .filter(Boolean);
  if (!copies.length) return;
  const before = historySnapshot();
  for (const [target, from] of copies) Object.assign(target, structuredClone(from));
  resolveRig();
  syncFields();
  render();
  commitHistory(before);
  markDirty();
}

// A transport icon instead of a word, so the label has to be spoken for: the
// `aria-label` and tooltip both say what pressing the button will do next.
const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.6v10.8L13.5 8z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.6h3.1v10.8H4zM8.9 2.6H12v10.8H8.9z"/></svg>';

function showPlayState() {
  const button = $("playPause");
  button.innerHTML = state.playing ? PAUSE_ICON : PLAY_ICON;
  button.setAttribute("aria-label", state.playing ? "Pause" : "Play");
  button.title = state.playing ? "Pause" : "Play";
  button.setAttribute("aria-pressed", String(state.playing));
}

function tick(timestamp) {
  const elapsed = (timestamp - state.lastTimestamp) / 1000;
  state.lastTimestamp = timestamp;
  if (state.playing && state.scene) {
    state.phase = (state.phase + elapsed / (animationDurations[state.animation] ?? 1.2)) % 1;
    render();
  }
  if ($("animationModal").open && timestamp - state.lastAnimationPreviewTimestamp >= 1000 / 18) {
    state.lastAnimationPreviewTimestamp = timestamp;
    renderAnimationPreviews(timestamp);
  }
  requestAnimationFrame(tick);
}

async function boot() {
  const response = await fetch("/api/scene");
  state.scene = await response.json();
  state.revision = response.headers.get("ETag");
  state.savedScene = structuredClone(state.scene);
  state.expressionCatalog = await (await fetch(`${RIG_ASSETS}facial-expression-assets-v1.json`)).json();
  for (const name of eyeExpressionNames) {
    const option = document.createElement("option"); option.value = name; option.textContent = animationLabel(name); $("expressionEyes").append(option);
  }
  for (const name of mouthExpressionNames) {
    const option = document.createElement("option"); option.value = name; option.textContent = animationLabel(name); $("expressionMouth").append(option);
  }
  buildViewTabs();
  buildStages();

  for (const [field, key, range] of FIELDS) {
    const box = $(field);
    const slider = sliderFor(field);
    const beginInputHistory = (input) => {
      if (!input._historyBefore) input._historyBefore = historySnapshot();
    };
    const finishInputHistory = (input) => {
      commitHistory(input._historyBefore);
      input._historyBefore = null;
    };
    box.addEventListener("focus", () => beginInputHistory(box));
    box.addEventListener("input", () => {
      beginInputHistory(box);
      writeBind(key, Number(box.value));
    });
    box.addEventListener("change", () => finishInputHistory(box));
    box.addEventListener("blur", () => finishInputHistory(box));
    slider.addEventListener("pointerdown", () => beginInputHistory(slider));
    slider.addEventListener("focus", () => beginInputHistory(slider));
    slider.addEventListener("input", (event) => {
      beginInputHistory(slider);
      box.value = event.target.value;
      writeBind(key, Number(event.target.value));
    });
    slider.addEventListener("change", () => finishInputHistory(slider));
    slider.addEventListener("blur", () => finishInputHistory(slider));
    // Scrolling over the box nudges the value, but only once it has been
    // clicked into -- otherwise scrolling past the panel would retune the item.
    box.addEventListener("wheel", (event) => {
      if (document.activeElement !== box || box.disabled) return;
      event.preventDefault();
      beginInputHistory(box);
      const steps = event.deltaY > 0 ? -1 : 1;
      const size = range.step * (event.shiftKey ? 10 : 1);
      const next = quantize(Number(box.value || 0) + steps * size, range.step);
      box.value = String(next);
      slider.value = String(next);
      writeBind(key, next);
    }, { passive: false });
  }
  for (const [field, key, range] of GRIP_FIELDS) {
    const box = $(field);
    const slider = sliderFor(field);
    const beginInputHistory = (input) => {
      if (!input._historyBefore) input._historyBefore = historySnapshot();
    };
    const finishInputHistory = (input) => {
      commitHistory(input._historyBefore);
      input._historyBefore = null;
    };
    box.addEventListener("focus", () => beginInputHistory(box));
    box.addEventListener("input", () => {
      beginInputHistory(box);
      writeGripField(key, range.kind, Number(box.value));
    });
    box.addEventListener("change", () => finishInputHistory(box));
    box.addEventListener("blur", () => finishInputHistory(box));
    slider.addEventListener("pointerdown", () => beginInputHistory(slider));
    slider.addEventListener("focus", () => beginInputHistory(slider));
    slider.addEventListener("input", () => {
      beginInputHistory(slider);
      box.value = slider.value;
      writeGripField(key, range.kind, Number(slider.value));
    });
    slider.addEventListener("change", () => finishInputHistory(slider));
    slider.addEventListener("blur", () => finishInputHistory(slider));
  }
  $("fingerTarget").addEventListener("change", () => {
    state.selectedGripFinger = $("fingerTarget").value;
    syncGripControls();
  });
  $("copyGripChannelThroughKeys").addEventListener("click", copyGripChannelThroughKeys);
  $("fittedToggle").addEventListener("change", () => {
    const option = selectedOption();
    if (!option) return;
    const before = historySnapshot();
    if ($("fittedToggle").checked) option.fitted = true;
    else delete option.fitted;
    commitHistory(before);
    markDirty();
  });
  $("itemPicker").addEventListener("click", () => {
    buildItemGrid();
    $("itemModal").showModal();
  });
  $("itemModalClose").addEventListener("click", () => $("itemModal").close());
  $("animationPickerButton").addEventListener("click", openAnimationModal);
  $("closeAnimationModal").addEventListener("click", closeAnimationModal);
  $("animationModal").addEventListener("close", syncClosedAnimationModal);
  $("animationModal").addEventListener("click", (event) => {
    if (event.target === $("animationModal")) closeAnimationModal();
  });
  $("animationGrid").addEventListener("keydown", navigateAnimationGrid);
  $("expressionEyes").addEventListener("change", () => updateExpressionChannel("eyes", $("expressionEyes").value));
  $("expressionMouth").addEventListener("change", () => updateExpressionChannel("mouth", $("expressionMouth").value));
  $("setExpressionKey").addEventListener("click", setCurrentExpressionKey);
  $("deleteExpressionKey").addEventListener("click", deleteCurrentExpressionKey);
  $("previousExpressionKey").addEventListener("click", () => jumpToExpressionKey(-1));
  $("nextExpressionKey").addEventListener("click", () => jumpToExpressionKey(1));
  $("saveButton").addEventListener("click", save);
  $("undoEdit").addEventListener("click", undoEdit);
  $("redoEdit").addEventListener("click", redoEdit);
  $("revertButton").addEventListener("click", revertItem);
  $("copyButton").addEventListener("click", copyFrom);
  $("copySource").addEventListener("change", () => { state.copySource = $("copySource").value; });
  $("showOthers").addEventListener("change", () => { state.showOthers = $("showOthers").checked; render(); });
  $("playPause").addEventListener("click", () => {
    state.playing = !state.playing;
    showPlayState();
  });
  $("animationTimeline").addEventListener("input", () => {
    state.playing = false;
    showPlayState();
    state.phase = Number($("animationTimeline").value) / 1000;
    render();
  });
  $("zoom").addEventListener("input", () => {
    state.zoom = Number($("zoom").value) / 100;
    $("zoomValue").textContent = `${$("zoom").value}%`;
    render();
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) event.preventDefault();
  });
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const command = event.metaKey || event.ctrlKey;
    const undo = command && key === "z" && !event.shiftKey;
    const redo = command && ((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey));
    if (!undo && !redo) return;
    event.preventDefault();
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    if (redo) redoEdit();
    else undoEdit();
  });

  await loadCatalog();
  await selectSlot(SLOTS[0]);
  resetHistory();
  setStatus("Placement is per item: tuning one never moves the rest");
  requestAnimationFrame(tick);
}

boot();
