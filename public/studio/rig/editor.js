import {
  animationDurations,
  animationHandPose,
  handPoseNames,
  layerMatchesAnimationEquipment as layerDrawsUnderAnimation,
  layerMatchesHandPose as layerDrawsUnderHandPose,
  animationNames,
  animationPose,
  expressionAt,
  eyeExpressionNames,
  mouthExpressionNames,
  boneKeyframePose,
  bakePoseIntoProfile,
  setClipPoseOffsets,
  setBoneKeyframes,
  setExpressionKeyframes,
  setWristKeyframes,
  wristKeyframeAngle,
  constrainForearmRotation,
  constrainForearmPose,
  defaultGripKind,
  deformWeightedMesh,
  fingerKeyframeAngle,
  fingerKeyframeOffset,
  posedGripAttachment,
  gripKeyframeRotation,
  gripTrackName,
  gripUsesAnimationOverride,
  knuckleKeyframeRotation,
  inverse,
  layerBindOwner,
  layerOption,
  layerLocalMatrix,
  planeStrips,
  mergePoses,
  multiply,
  resolveProfile,
  rigidLayerMatrix,
  solveTwoBoneIK,
  transformPoint,
  triangleTransform,
  weightedMeshGeometry,
  worldMatrices,
} from "./rig-model.mjs?v=20260904-staff-swing-3";
import { enhanceNumericControls, syncNumericControls } from "./numeric-control.mjs";

(() => {
  "use strict";

  const SIZE = 1254;
  // A weapon or shield rotates around its hand, not around the artboard. Keep
  // enough room around that artboard for the complete attachment to remain
  // visible while posing it.
  const OVERSCAN = 160;
  const VIEW_SIZE = SIZE + OVERSCAN * 2;
  const $ = (id) => document.getElementById(id);
  const canvas = $("rigCanvas");
  const context = canvas.getContext("2d");
  const wristMeshCanvas = $("wristMeshEditor");
  const wristMeshContext = wristMeshCanvas.getContext("2d");
  const fingerPathCanvas = $("fingerPathEditor");
  const fingerPathContext = fingerPathCanvas.getContext("2d");
  const animationLabels = {
    idle: "Idle breathing",
    staffIdle: "Staff idle",
    staffMoveForward: "Staff moving forward",
    staffMoveBackward: "Staff moving backward",
    run: "Run cycle",
    shieldUp: "Shield up",
    staffShieldUp: "Staff shield up",
    shieldMoveForward: "Guard walking forward",
    shieldMoveBackward: "Guard walking backward",
    staffShieldMoveForward: "Staff guard walking forward",
    staffShieldMoveBackward: "Staff guard walking backward",
    dodgeForward: "Dodge forward",
    dodgeBackward: "Dodge backward",
    swordSwing: "Sword swing",
    blocked: "Blocked recoil",
    sneakAttack: "Sneak attack",
    spellCast: "Spell cast",
    spellMoveForward: "Spell moving forward",
    spellMoveBackward: "Spell moving backward",
    bowDraw: "Bow draw",
    bowMoveForward: "Bow moving forward",
    bowMoveBackward: "Bow moving backward",
  };
  const animationLabel = (name) => animationLabels[name]
    ?? name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
  const HEADGEAR_LAYER_ID = "headgear";
  const GRIP_FINGER_LAYER_IDS = ["handClosedLIndex", "handClosedLMiddle", "handClosedLRing", "handClosedLPinky"];
  const GRIP_OVERLAY_LAYER_IDS = [...GRIP_FINGER_LAYER_IDS, "handClosedLThumb"];
  const GRIP_SHARED_TRANSFORM_KEYS = new Set(["x", "y", "rotation", "scaleX", "scaleY"]);

  const state = {
    scene: null,
    savedScene: null,
    sceneRevision: null,
    // Bones and layers with the active profile's bind pose already flattened on.
    rig: { bones: [], layers: [] },
    images: new Map(),
    expressionCatalog: null,
    expressionImages: new Map(),
    reference: null,
    profile: "maleV1",
    chest: "rustTunic",
    armSet: "clothBoundV1",
    bootSet: "plainLeatherV1",
    headgear: "closedCheekV1",
    necklace: null,
    // Weapons and staffs share one hand. Keep each catalogue's last selected
    // item, but expose and draw only one of those two layers at a time.
    mainHand: "weapon",
    // Worn id per held slot, keyed by the layer it dresses. Filled from the
    // scene on load, because which weapon the rig is holding is scene state.
    held: {},
    // Bone moves land on the clip being looked at rather than on the skeleton
    // every clip shares. Off by default: most rig work is skeleton work.
    clipScopedEdits: true,
    animation: "idle",
    handPose: animationHandPose.idle,
    phase: 0,
    playing: true,
    speed: 1,
    mode: "bone",
    selectedBone: "chest",
    selectedLayer: null,
    wristSide: "L",
    wristAngle: 0,
    gripRotation: 0,
    knuckleAxis: 0,
    fingerAngles: Object.fromEntries(GRIP_FINGER_LAYER_IDS.map((id) => [id, 0])),
    fingerOffsets: Object.fromEntries(GRIP_FINGER_LAYER_IDS.map((id) => [id, { along: 0, across: 0 }])),
    wristPreviewActive: false,
    meshHandleDragging: null,
    fingerPathTool: "pen",
    selectedFingerNode: null,
    fingerPathDragging: null,
    selectedGripFinger: "all",
    lastAnimationPreviewTimestamp: 0,
    manualPose: {},
    dragging: null,
    history: { undo: [], redo: [], limit: 100 },
    dirty: false,
    lastTimestamp: performance.now(),
  };

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function assetURL(path) { return `/assets/${path}`; }
  function setStatus(message) { $("status").textContent = message; }
  function selectedLayer() { return state.rig.layers.find((layer) => layer.id === state.selectedLayer) ?? null; }
  function selectedBone() { return state.rig.bones.find((bone) => bone.id === state.selectedBone) ?? null; }
  /** Single-layer equipment all behaves alike: a catalogue, a worn id, and one layer. */
  const HELD_SLOTS = [
    { layer: "weapon", catalogue: "weaponOptions", active: "activeWeapon" },
    { layer: "staff", catalogue: "staffOptions", active: "activeStaff" },
    { layer: "bow", catalogue: "bowOptions", active: "activeBow", select: "bowSelect" },
    { layer: "shield", catalogue: "shieldOptions", active: "activeShield", select: "shieldSelect" },
    { layer: "quiver", catalogue: "quiverOptions", active: "activeQuiver", select: "quiverSelect" },
  ];

  function sceneLayer(id) { return state.scene?.layers.find((layer) => layer.id === id) ?? null; }
  /** The scene as the editor is currently wearing it, for option lookups. */
  function sceneSelection() {
    const held = {};
    for (const slot of HELD_SLOTS) held[slot.active] = state.held[slot.layer];
    return {
      ...state.scene,
      activeChest: state.chest, activeArmSet: state.armSet, activeBootSet: state.bootSet,
      activeHeadgear: state.headgear, activeNecklace: state.necklace,
      ...held,
    };
  }

  function buildHeldOptions() {
    for (const slot of HELD_SLOTS) {
      if (!slot.select) continue;
      const select = $(slot.select);
      if (!select) continue;
      select.replaceChildren();
      for (const option of state.scene?.[slot.catalogue] ?? []) {
        const element = document.createElement("option");
        element.value = option.id;
        element.textContent = option.label;
        select.append(element);
      }
      select.value = state.held[slot.layer] ?? "";
    }
    buildMainHandOptions();
  }

  function buildMainHandOptions() {
    const select = $("mainHandSelect");
    select.replaceChildren();
    for (const slot of HELD_SLOTS.filter(({ layer }) => layer === "weapon" || layer === "staff")) {
      const group = document.createElement("optgroup");
      group.label = slot.layer === "weapon" ? "Weapons" : "Staffs, spears, and wands";
      for (const option of state.scene?.[slot.catalogue] ?? []) {
        const element = document.createElement("option");
        element.value = `${slot.layer}:${option.id}`;
        element.textContent = option.label;
        group.append(element);
      }
      select.append(group);
    }
    select.value = `${state.mainHand}:${state.held[state.mainHand] ?? ""}`;
  }

  function syncHeldFromScene() {
    for (const slot of HELD_SLOTS) state.held[slot.layer] = state.scene?.[slot.active] ?? null;
  }
  function sceneBone(id) { return state.scene?.bones.find((bone) => bone.id === id) ?? null; }

  function syncHeadgearToggle() {
    $("headgearToggle").checked = Boolean(sceneLayer(HEADGEAR_LAYER_ID)?.visible);
  }

  function resolveRig() {
    setBoneKeyframes(state.scene?.boneKeyframes);
    setClipPoseOffsets(state.scene?.clipPoseOffsets);
    setWristKeyframes(state.scene?.wristKeyframes);
    setExpressionKeyframes(state.scene?.expressionKeyframes);
    state.rig = state.scene ? resolveProfile(state.scene, state.profile, state.chest, state.armSet, state.headgear, state.bootSet, state.necklace, state.held) : { bones: [], layers: [] };
  }

  function activeChestOption() {
    return state.scene?.chestOptions.find((option) => option.id === state.chest) ?? null;
  }

  function buildNecklaceOptions() {
    const select = $("necklaceSelect");
    select.replaceChildren();
    for (const option of state.scene?.necklaceOptions ?? []) {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = state.necklace;
  }

  function buildChestOptions() {
    const select = $("chestSelect");
    select.replaceChildren();
    for (const option of state.scene?.chestOptions ?? []) {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = state.chest;
  }

  function activeArmOption() {
    return state.scene?.armOptions.find((option) => option.id === state.armSet) ?? null;
  }

  function buildArmOptions() {
    const select = $("armSetSelect");
    select.replaceChildren();
    for (const option of state.scene?.armOptions ?? []) {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = state.armSet;
  }

  function activeBootOption() {
    return state.scene?.bootOptions.find((option) => option.id === state.bootSet) ?? null;
  }

  function buildBootOptions() {
    const select = $("bootSetSelect");
    select.replaceChildren();
    for (const option of state.scene?.bootOptions ?? []) {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = state.bootSet;
  }

  function activeHeadgearOption() {
    return state.scene?.headgearOptions.find((option) => option.id === state.headgear) ?? null;
  }

  function buildHeadgearOptions() {
    const select = $("headgearSelect");
    select.replaceChildren();
    for (const option of state.scene?.headgearOptions ?? []) {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = state.headgear;
  }

  /**
   * Layer edits write straight back to the active profile's bind pose -- or to
   * the option dressing that layer, when the option is the one carrying the
   * placement. A necklace's position lives on the necklace, not on the slot it
   * hangs in, so writing to the layer would be overwritten on the next resolve.
   */
  function writeLayerBind(layer, key, value) {
    const source = sceneLayer(layer.id);
    if (!source) return;
    const owner = layerBindOwner(sceneSelection(), source, state.profile);
    if (!owner) return;
    const previousValue = layer[key];
    layer[key] = value;
    owner[key] = value;
    if (layer.id === "handClosedL" && GRIP_SHARED_TRANSFORM_KEYS.has(key)) {
      for (const id of GRIP_OVERLAY_LAYER_IDS) {
        const overlay = state.rig.layers.find((candidate) => candidate.id === id);
        const overlaySource = sceneLayer(id);
        const overlayOwner = overlaySource ? layerBindOwner(sceneSelection(), overlaySource, state.profile) : null;
        const adjusted = (key === "scaleX" || key === "scaleY") && previousValue
          ? overlay[key] * value / previousValue
          : value;
        if (overlay) overlay[key] = adjusted;
        if (overlayOwner) overlayOwner[key] = adjusted;
      }
    }
  }

  /** Bone inspector edits are persistent profile bind data, not disposable pose offsets. */
  function writeBoneBind(bone, key, value) {
    const source = sceneBone(bone.id);
    if (!source?.bindByProfile?.[state.profile]) return;
    bone[key] = value;
    source.bindByProfile[state.profile][key] = value;
    if (state.manualPose[bone.id]) {
      delete state.manualPose[bone.id][key];
      if (Object.keys(state.manualPose[bone.id]).length === 0) delete state.manualPose[bone.id];
    }
  }
  function expressionAssetPath(layerID, animation = state.animation, phase = state.phase) {
    const profile = state.expressionCatalog?.profiles?.[state.profile];
    if (!profile) return null;
    const expression = expressionAt(animation, phase);
    if (layerID === "eyeL") return profile.eyes?.[expression.eyes]?.left ?? null;
    if (layerID === "eyeR") return profile.eyes?.[expression.eyes]?.right ?? null;
    if (layerID === "mouth" && expression.mouth !== "neutral") return profile.mouths?.[expression.mouth] ?? null;
    return null;
  }

  function imageFor(layer, animation = state.animation, phase = state.phase) {
    const expressionPath = expressionAssetPath(layer.id, animation, phase);
    return expressionPath ? state.expressionImages.get(expressionPath) : state.images.get(layer.id);
  }

  function activeWristLayer() {
    return state.rig.layers.find((layer) => layer.mesh
      && layer.bone === `hand${state.wristSide}`
      && layerMatchesHandPose(layer)) ?? null;
  }

  function sourceWristLayer() {
    return sceneLayer(activeWristLayer()?.id);
  }

  function activeGripLayer(animation = state.animation) {
    const id = animation.startsWith("bow") ? "bow" : state.mainHand;
    return state.rig.layers.find((layer) => layer.id === id) ?? null;
  }

  function wristKeys(create = false) {
    if (!state.scene) return [];
    if (create) {
      state.scene.wristKeyframes ??= {};
      state.scene.wristKeyframes[state.animation] ??= {};
      state.scene.wristKeyframes[state.animation][state.wristSide] ??= [];
    }
    return state.scene.wristKeyframes?.[state.animation]?.[state.wristSide] ?? [];
  }

  function currentWristKey() {
    return wristKeys().find((key) => Math.abs(key.phase - state.phase) <= 0.0015) ?? null;
  }

  function gripKeys(create = false) {
    if (!state.scene || state.wristSide !== "L") return [];
    const track = gripUsesAnimationOverride(state.animation)
      ? state.animation
      : gripTrackName(activeGripKind());
    if (create) {
      state.scene.wristKeyframes ??= {};
      state.scene.wristKeyframes[track] ??= {};
      state.scene.wristKeyframes[track].L ??= [];
    }
    return state.scene.wristKeyframes?.[track]?.L ?? [];
  }

  function currentGripKey() {
    return gripKeys().find((key) => Math.abs(key.phase - state.phase) <= 0.0015) ?? null;
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
    if (!keys.length && phase > 0.0015) {
      keys.push({ phase: 0, eyes: sampled.eyes, mouth: sampled.mouth });
    }
    key = { phase, eyes: sampled.eyes, mouth: sampled.mouth };
    keys.push(key);
    keys.sort((left, right) => left.phase - right.phase);
    return key;
  }

  function adjacentExpressionKey(direction) {
    const epsilon = 0.0015;
    const keys = expressionKeys();
    if (direction < 0) return [...keys].reverse().find((key) => key.phase < state.phase - epsilon) ?? null;
    return keys.find((key) => key.phase > state.phase + epsilon) ?? null;
  }

  function jumpToExpressionKey(direction) {
    const key = adjacentExpressionKey(direction);
    if (!key) return;
    pause();
    state.phase = key.phase;
    state.wristPreviewActive = false;
    render();
  }

  function setCurrentExpressionKey() {
    const before = historySnapshot();
    const key = ensureExpressionKey();
    key.eyes = $("expressionEyes").value;
    key.mouth = $("expressionMouth").value;
    setExpressionKeyframes(state.scene.expressionKeyframes);
    markDirty();
    commitHistory(before);
    render();
  }

  function updateExpressionChannel(channel, value) {
    pause();
    const before = historySnapshot();
    ensureExpressionKey()[channel] = value;
    setExpressionKeyframes(state.scene.expressionKeyframes);
    markDirty();
    commitHistory(before);
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
    markDirty();
    commitHistory(before);
    render();
  }

  function renderExpressionKeyMarkers() {
    const container = $("expressionKeyMarkers");
    const keys = expressionKeys();
    const current = currentExpressionKey();
    const signature = JSON.stringify([state.animation, keys, current?.phase ?? null]);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    container.replaceChildren();
    for (const key of keys) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = `expression-key-marker${key === current ? " current" : ""}`;
      marker.style.left = `${key.phase * 100}%`;
      marker.title = `${(key.phase * animationDurations[state.animation]).toFixed(2)} s · ${key.eyes} eyes · ${key.mouth} mouth`;
      marker.setAttribute("aria-label", marker.title);
      marker.addEventListener("click", () => {
        pause();
        state.phase = key.phase;
        state.wristPreviewActive = false;
        render();
      });
      container.append(marker);
    }
  }

  function syncExpressionAuthoring() {
    const sampled = expressionAt(state.animation, state.phase);
    $("expressionEyes").value = sampled.eyes;
    $("expressionMouth").value = sampled.mouth;
    const key = currentExpressionKey();
    $("deleteExpressionKey").disabled = !key;
    $("previousExpressionKey").disabled = !adjacentExpressionKey(-1);
    $("nextExpressionKey").disabled = !adjacentExpressionKey(1);
    $("expressionKeyStatus").textContent = key
      ? `Key at ${(key.phase * animationDurations[state.animation]).toFixed(2)} s · ${key.eyes} eyes · ${key.mouth} mouth`
      : `${expressionKeys().length} expression key${expressionKeys().length === 1 ? "" : "s"} · changing a face adds one here`;
    renderExpressionKeyMarkers();
  }

  function boneKeys(boneID = state.selectedBone, create = false) {
    if (!state.scene || !boneID) return [];
    if (create) {
      state.scene.boneKeyframes ??= {};
      state.scene.boneKeyframes[state.animation] ??= {};
      state.scene.boneKeyframes[state.animation][boneID] ??= [];
    }
    return state.scene.boneKeyframes?.[state.animation]?.[boneID] ?? [];
  }

  function currentBoneKey(boneID = state.selectedBone) {
    return boneKeys(boneID).find((key) => Math.abs(key.phase - state.phase) <= 0.0015) ?? null;
  }

  function evaluatedBoneCorrection(boneID, phase = state.phase) {
    const delta = boneKeyframePose(state.animation, phase)[boneID] ?? {};
    return {
      x: delta.x ?? 0,
      y: delta.y ?? 0,
      rotation: delta.rotation ?? 0,
    };
  }

  function ensureBoneKey(boneID, phase = state.phase) {
    const value = evaluatedBoneCorrection(boneID, phase);
    const keys = boneKeys(boneID, true);
    if (keys.length === 0) {
      // Neutral boundary keys keep a first pose correction local instead of
      // holding it across every frame of the clip.
      keys.push(
        { phase: 0, x: 0, y: 0, rotation: 0 },
        { phase: 1, x: 0, y: 0, rotation: 0 },
      );
    }
    const normalizedPhase = Number(Math.max(0, Math.min(1, phase)).toFixed(4));
    let key = keys.find((candidate) => Math.abs(candidate.phase - normalizedPhase) <= 0.0015);
    if (!key) {
      key = { phase: normalizedPhase, ...value };
      keys.push(key);
      keys.sort((left, right) => left.phase - right.phase);
    }
    return key;
  }

  function cleanupBoneKeyframes(boneID = state.selectedBone) {
    const bones = state.scene.boneKeyframes?.[state.animation];
    if (!bones) return;
    if ((bones[boneID]?.length ?? 0) === 0) delete bones[boneID];
    if (Object.keys(bones).length === 0) delete state.scene.boneKeyframes[state.animation];
  }

  function commitManualPoseToBoneKeys() {
    if (!state.clipScopedEdits || Object.keys(state.manualPose).length === 0) return false;
    for (const [boneID, delta] of Object.entries(state.manualPose)) {
      const sampled = evaluatedBoneCorrection(boneID);
      const key = ensureBoneKey(boneID);
      for (const field of ["x", "y", "rotation"]) {
        if (!Number.isFinite(delta[field])) continue;
        key[field] = Number((sampled[field] + delta[field]).toFixed(3));
      }
    }
    state.manualPose = {};
    setBoneKeyframes(state.scene.boneKeyframes);
    resolveRig();
    markDirty();
    return true;
  }

  function setBoneAnimationValue(bone, field, value) {
    const key = ensureBoneKey(bone.id);
    key[field] = Number(value.toFixed(3));
    setBoneKeyframes(state.scene.boneKeyframes);
    markDirty();
  }

  function adjacentBoneKey(direction) {
    const epsilon = 0.0015;
    const keys = boneKeys();
    if (direction < 0) return [...keys].reverse().find((key) => key.phase < state.phase - epsilon) ?? null;
    return keys.find((key) => key.phase > state.phase + epsilon) ?? null;
  }

  function jumpToBoneKey(direction) {
    const key = adjacentBoneKey(direction);
    if (!key) return;
    pause();
    state.phase = key.phase;
    state.manualPose = {};
    state.wristPreviewActive = false;
    render();
  }

  function renderBoneKeyMarkers() {
    const container = $("boneKeyMarkers");
    const keys = state.mode === "bone" && state.clipScopedEdits ? boneKeys() : [];
    const current = currentBoneKey();
    const signature = JSON.stringify([state.animation, state.selectedBone, keys, current?.phase ?? null]);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    container.replaceChildren();
    for (const key of keys) {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = `bone-key-marker${key === current ? " current" : ""}`;
      marker.style.left = `${key.phase * 100}%`;
      marker.title = `${state.selectedBone} · ${(key.phase * animationDurations[state.animation]).toFixed(2)} s`;
      marker.setAttribute("aria-label", marker.title);
      marker.addEventListener("click", () => {
        pause();
        state.phase = key.phase;
        state.manualPose = {};
        state.wristPreviewActive = false;
        render();
      });
      container.append(marker);
    }
  }

  function syncBoneAuthoring() {
    const enabled = state.mode === "bone" && state.clipScopedEdits && Boolean(selectedBone());
    const key = enabled ? currentBoneKey() : null;
    $("setBoneKey").disabled = !enabled;
    $("deleteBoneKey").disabled = !key;
    $("previousBoneKey").disabled = !enabled || !adjacentBoneKey(-1);
    $("nextBoneKey").disabled = !enabled || !adjacentBoneKey(1);
    $("boneKeyStatus").textContent = !state.clipScopedEdits
      ? "Shared bind editing is active; changes affect every animation."
      : key
        ? `Bone key at ${(key.phase * animationDurations[state.animation]).toFixed(2)} s · X ${key.x ?? 0} · Y ${key.y ?? 0} · rotation ${key.rotation ?? 0}°`
        : `${boneKeys().length} key${boneKeys().length === 1 ? "" : "s"} for ${state.selectedBone} · dragging here creates one`;
    renderBoneKeyMarkers();
  }

  function setCurrentBoneKey() {
    const bone = selectedBone();
    if (!bone || !state.clipScopedEdits) return;
    const before = historySnapshot();
    ensureBoneKey(bone.id);
    setBoneKeyframes(state.scene.boneKeyframes);
    markDirty();
    commitHistory(before);
    render();
  }

  function deleteCurrentBoneKey() {
    const key = currentBoneKey();
    if (!key) return;
    const before = historySnapshot();
    const keys = boneKeys();
    keys.splice(keys.indexOf(key), 1);
    cleanupBoneKeyframes();
    setBoneKeyframes(state.scene.boneKeyframes);
    state.manualPose = {};
    markDirty();
    commitHistory(before);
    render();
  }

  function evaluatedWristAngle() {
    return wristKeyframeAngle(state.animation, state.wristSide, state.phase);
  }

  function activeGripKind(animation = state.animation) {
    if (animation.startsWith("bow")) return "bow";
    if (state.mainHand === "staff" || animation.startsWith("staff")) return "staff";
    return "weapon";
  }

  function gripKeyPayload(key, create = false) {
    if (!key) return null;
    const kind = activeGripKind();
    if (!gripUsesAnimationOverride(state.animation) || kind === defaultGripKind(state.animation)) return key;
    if (create) {
      key.grips ??= {};
      key.grips[kind] ??= {};
    }
    return key.grips?.[kind] ?? null;
  }

  function evaluatedGripRotation(animation = state.animation, side = state.wristSide, phase = state.phase, gripKind = activeGripKind(animation)) {
    return gripKeyframeRotation(animation, side, phase, gripKind);
  }

  function evaluatedKnuckleAxis(animation = state.animation, side = state.wristSide, phase = state.phase, gripKind = activeGripKind(animation)) {
    return knuckleKeyframeRotation(animation, side, phase, gripKind);
  }

  function evaluatedFingerAngles(animation = state.animation, side = state.wristSide, phase = state.phase, gripKind = activeGripKind(animation)) {
    return Object.fromEntries(GRIP_FINGER_LAYER_IDS.map((id) => [
      id,
      fingerKeyframeAngle(animation, side, phase, id, gripKind),
    ]));
  }

  function evaluatedFingerOffsets(animation = state.animation, side = state.wristSide, phase = state.phase, gripKind = activeGripKind(animation)) {
    return Object.fromEntries(GRIP_FINGER_LAYER_IDS.map((id) => [
      id,
      {
        along: fingerKeyframeOffset(animation, side, phase, id, "along", gripKind),
        across: fingerKeyframeOffset(animation, side, phase, id, "across", gripKind),
      },
    ]));
  }

  function setWristAngleUI(angle) {
    const rounded = Math.round(angle * 10) / 10;
    state.wristAngle = rounded;
    $("wristAngle").value = String(rounded);
    $("wristAngleValue").value = `${rounded}°`;
  }

  function setGripRotationUI(rotation) {
    const roundedRotation = Math.round(rotation * 10) / 10;
    state.gripRotation = roundedRotation;
    $("gripRotation").value = String(roundedRotation);
    $("gripRotationValue").value = `${roundedRotation}°`;
  }

  function setKnuckleAxisUI(rotation) {
    const roundedRotation = Math.round(rotation * 10) / 10;
    state.knuckleAxis = roundedRotation;
    $("fingerAxis").value = String(roundedRotation);
    $("fingerAxisValue").value = `${roundedRotation}°`;
  }

  function selectedFingerAngle(angles = state.fingerAngles) {
    const ids = state.selectedGripFinger === "all" ? GRIP_FINGER_LAYER_IDS : [state.selectedGripFinger];
    return ids.reduce((sum, id) => sum + (angles[id] ?? 0), 0) / ids.length;
  }

  function syncFingerAngleUI() {
    const rounded = Math.round(selectedFingerAngle() * 10) / 10;
    if (document.activeElement !== $("fingerAngle")) $("fingerAngle").value = String(rounded);
    $("fingerAngleValue").value = `${rounded}°`;
  }

  function setFingerAnglesUI(angles) {
    state.fingerAngles = Object.fromEntries(GRIP_FINGER_LAYER_IDS.map((id) => [id, angles?.[id] ?? 0]));
    syncFingerAngleUI();
  }

  function setFingerOffsetsUI(offsets) {
    state.fingerOffsets = Object.fromEntries(GRIP_FINGER_LAYER_IDS.map((id) => [
      id,
      {
        along: offsets?.[id]?.along ?? 0,
        across: offsets?.[id]?.across ?? 0,
      },
    ]));
  }

  function setSelectedFingerAnimationAngle(value) {
    const ids = state.selectedGripFinger === "all" ? GRIP_FINGER_LAYER_IDS : [state.selectedGripFinger];
    const delta = value - selectedFingerAngle();
    for (const id of ids) state.fingerAngles[id] = (state.fingerAngles[id] ?? 0) + delta;
    syncFingerAngleUI();
  }

  function currentHandControlValues() {
    return {
      angle: Number(state.wristAngle.toFixed(2)),
      gripRotation: Number(state.gripRotation.toFixed(2)),
      knuckleAxis: Number(state.knuckleAxis.toFixed(2)),
      fingerAngles: Object.fromEntries(GRIP_FINGER_LAYER_IDS.map((id) => [
        id,
        Number((state.fingerAngles[id] ?? 0).toFixed(2)),
      ])),
      fingerOffsets: Object.fromEntries(GRIP_FINGER_LAYER_IDS.map((id) => [
        id,
        {
          along: Number((state.fingerOffsets[id]?.along ?? 0).toFixed(2)),
          across: Number((state.fingerOffsets[id]?.across ?? 0).toFixed(2)),
        },
      ])),
    };
  }

  function writeWristControlToKey(key) {
    const controls = currentHandControlValues();
    key.angle = controls.angle;
  }

  function writeGripControlsToKey(key) {
    key = gripKeyPayload(key, true);
    const controls = currentHandControlValues();
    key.gripRotation = controls.gripRotation;
    key.knuckleAxis = controls.knuckleAxis;
    key.fingerAngles = controls.fingerAngles;
    key.fingerOffsets = controls.fingerOffsets;
  }

  function writeGripChannelToKey(key, channel) {
    key = gripKeyPayload(key, true);
    const controls = currentHandControlValues();
    const selectedIDs = state.selectedGripFinger === "all"
      ? GRIP_FINGER_LAYER_IDS
      : [state.selectedGripFinger];
    if (channel === "gripRotation") key.gripRotation = controls.gripRotation;
    else if (channel === "knuckleAxis") key.knuckleAxis = controls.knuckleAxis;
    else if (channel === "fingerAngle") {
      key.fingerAngles ??= {};
      for (const id of selectedIDs) key.fingerAngles[id] = controls.fingerAngles[id];
    } else if (channel === "fingerAlong" || channel === "fingerAcross" || channel === "fingerOffsets") {
      const axes = channel === "fingerOffsets"
        ? ["along", "across"]
        : [channel === "fingerAlong" ? "along" : "across"];
      key.fingerOffsets ??= {};
      for (const id of selectedIDs) {
        key.fingerOffsets[id] ??= { along: 0, across: 0 };
        for (const axis of axes) key.fingerOffsets[id][axis] = controls.fingerOffsets[id][axis];
      }
    }
  }

  function commitHandControlsToKey(create = false, channel = "all") {
    const wantsWrist = channel === "all" || channel === "wristAngle";
    const wantsGrip = channel !== "wristAngle";
    let wristKey = wantsWrist ? currentWristKey() : null;
    if (wantsWrist && !wristKey && create) {
      const keys = wristKeys(true);
      wristKey = { phase: Number(state.phase.toFixed(4)), angle: evaluatedWristAngle() };
      keys.push(wristKey);
      keys.sort((left, right) => left.phase - right.phase);
    }
    let gripKey = wantsGrip ? currentGripKey() : null;
    if (wantsGrip && state.wristSide === "L" && !gripKey && create) {
      const keys = gripKeys(true);
      gripKey = {
        phase: Number(state.phase.toFixed(4)),
        angle: gripUsesAnimationOverride(state.animation) ? evaluatedWristAngle() : 0,
      };
      keys.push(gripKey);
      keys.sort((left, right) => left.phase - right.phase);
    }
    if (!wristKey && !gripKey) return false;
    if (wristKey) writeWristControlToKey(wristKey);
    if (gripKey) {
      if (channel === "all") writeGripControlsToKey(gripKey);
      else writeGripChannelToKey(gripKey, channel);
    }
    // The preview has become authored data, so navigation and playback must
    // sample the updated curve instead of throwing it away.
    state.wristPreviewActive = false;
    setWristKeyframes(state.scene.wristKeyframes);
    markDirty();
    return true;
  }

  function updateEstablishedHandKey(channel = "all") {
    return commitHandControlsToKey(false, channel);
  }

  function ensureHandKeyAtPlayhead(channel = "all") {
    return commitHandControlsToKey(true, channel);
  }

  function adjacentWristKey(direction) {
    const epsilon = 0.0015;
    const keys = [...new Set([...wristKeys(), ...gripKeys()].map((key) => key.phase))]
      .sort((left, right) => left - right)
      .map((phase) => ({ phase }));
    if (direction < 0) return [...keys].reverse().find((key) => key.phase < state.phase - epsilon) ?? null;
    return keys.find((key) => key.phase > state.phase + epsilon) ?? null;
  }

  function syncWristAuthoring() {
    if (!state.wristPreviewActive) {
      setWristAngleUI(evaluatedWristAngle());
      setGripRotationUI(evaluatedGripRotation());
      setKnuckleAxisUI(evaluatedKnuckleAxis());
      setFingerAnglesUI(evaluatedFingerAngles());
      setFingerOffsetsUI(evaluatedFingerOffsets());
    }
    const wristKey = currentWristKey();
    const gripKey = currentGripKey();
    $("deleteWristKey").disabled = !wristKey && !gripKey;
    $("previousWristKey").disabled = !adjacentWristKey(-1);
    $("nextWristKey").disabled = !adjacentWristKey(1);
    const gripControlsAvailable = state.wristSide === "L"
      && GRIP_FINGER_LAYER_IDS.some((id) => state.rig.layers.some((layer) => layer.id === id));
    $("gripRotation").disabled = !gripControlsAvailable;
    $("fingerAxis").disabled = !gripControlsAvailable;
    $("fingerAngle").disabled = !gripControlsAvailable;
    const count = new Set([...wristKeys(), ...gripKeys()].map((key) => key.phase)).size;
    const gripScope = gripUsesAnimationOverride(state.animation)
      ? `${state.animation} override`
      : `shared ${activeGripKind()} grip`;
    $("wristKeyStatus").textContent = wristKey || gripKey
      ? `Key at ${(state.phase * animationDurations[state.animation]).toFixed(2)} s · ${gripScope} · wrist ${evaluatedWristAngle()}° · grip ${evaluatedGripRotation()}° · knuckles ${evaluatedKnuckleAxis()}° · fingers ${Number(selectedFingerAngle(evaluatedFingerAngles()).toFixed(1))}°`
      : `${count} hand key${count === 1 ? "" : "s"} · use Previous/Next key or click a diamond`;
    syncHandChannelKeyIndexes();
    renderWristKeyMarkers();
    renderWristMeshEditor();
  }

  function syncHandChannelKeyIndexes() {
    const selectedIDs = state.selectedGripFinger === "all"
      ? GRIP_FINGER_LAYER_IDS
      : [state.selectedGripFinger];
    const channels = [
      ["wristAngleKeyIndex", wristKeys(), (key) => Number.isFinite(key.angle)],
      ["gripRotationKeyIndex", gripKeys(), (key) => Number.isFinite(gripKeyPayload(key)?.gripRotation)],
      ["fingerAxisKeyIndex", gripKeys(), (key) => Number.isFinite(gripKeyPayload(key)?.knuckleAxis)],
      ["fingerAngleKeyIndex", gripKeys(), (key) => selectedIDs.some((id) => Number.isFinite(gripKeyPayload(key)?.fingerAngles?.[id]))],
      ["fingerAlongKeyIndex", gripKeys(), (key) => selectedIDs.some((id) => Number.isFinite(gripKeyPayload(key)?.fingerOffsets?.[id]?.along))],
      ["fingerAcrossKeyIndex", gripKeys(), (key) => selectedIDs.some((id) => Number.isFinite(gripKeyPayload(key)?.fingerOffsets?.[id]?.across))],
    ];
    for (const [outputID, sourceKeys, includesChannel] of channels) {
      const keys = sourceKeys.filter(includesChannel);
      const index = keys.findIndex((key) => Math.abs(key.phase - state.phase) <= 0.0015);
      $(outputID).textContent = index >= 0
        ? `Key ${index + 1} of ${keys.length}`
        : `${keys.length} key${keys.length === 1 ? "" : "s"}`;
      $(outputID).classList.toggle("current", index >= 0);
    }
  }

  function copyHandChannelThroughKeys() {
    const channel = $("copyHandChannel").value;
    const wristChannel = channel === "wristAngle";
    if (!wristChannel && state.wristSide !== "L") return;
    const before = historySnapshot();
    const keys = wristChannel ? wristKeys(true) : gripKeys(true);
    if (!keys.length) {
      keys.push({
        phase: Number(state.phase.toFixed(4)),
        angle: wristChannel || gripUsesAnimationOverride(state.animation)
          ? Number(state.wristAngle.toFixed(2))
          : 0,
      });
    }
    const controls = currentHandControlValues();
    const selectedIDs = state.selectedGripFinger === "all"
      ? GRIP_FINGER_LAYER_IDS
      : [state.selectedGripFinger];
    for (const sourceKey of keys) {
      const key = wristChannel ? sourceKey : gripKeyPayload(sourceKey, true);
      if (channel === "wristAngle") key.angle = controls.angle;
      else if (channel === "gripRotation") key.gripRotation = controls.gripRotation;
      else if (channel === "knuckleAxis") key.knuckleAxis = controls.knuckleAxis;
      else if (channel === "fingerAngle") {
        key.fingerAngles ??= {};
        for (const id of selectedIDs) key.fingerAngles[id] = controls.fingerAngles[id];
      } else if (channel === "fingerAlong" || channel === "fingerAcross") {
        const axis = channel === "fingerAlong" ? "along" : "across";
        key.fingerOffsets ??= {};
        for (const id of selectedIDs) {
          key.fingerOffsets[id] ??= { along: 0, across: 0 };
          key.fingerOffsets[id][axis] = controls.fingerOffsets[id][axis];
        }
      }
    }
    state.wristPreviewActive = false;
    clearWristPreviewQuery();
    setWristKeyframes(state.scene.wristKeyframes);
    resolveRig();
    markDirty();
    commitHistory(before);
    render();
    const label = $("copyHandChannel").selectedOptions[0]?.textContent ?? "Value";
    const scope = gripUsesAnimationOverride(state.animation)
      ? `${state.animation} override`
      : `${activeGripKind()} family`;
    $("wristKeyStatus").textContent = `Copied ${label.toLowerCase()} through ${keys.length} ${scope} key${keys.length === 1 ? "" : "s"}.`;
  }

  function renderWristKeyMarkers() {
    const container = $("wristKeyMarkers");
    const phases = [...new Set([...wristKeys(), ...gripKeys()].map((key) => key.phase))]
      .sort((left, right) => left - right);
    const signature = JSON.stringify([
      state.animation, activeGripKind(), state.wristSide, state.selectedGripFinger,
      wristKeys(), gripKeys(), state.phase,
    ]);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    container.replaceChildren();
    for (const phase of phases) {
      const current = Math.abs(phase - state.phase) <= 0.0015;
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = `wrist-key-marker${current ? " current" : ""}`;
      marker.style.left = `${phase * 100}%`;
      marker.title = `${state.wristSide} hand · shared ${activeGripKind()} grip · ${(phase * animationDurations[state.animation]).toFixed(2)} s`;
      marker.setAttribute("aria-label", marker.title);
      marker.addEventListener("click", () => {
        pause();
        state.phase = phase;
        state.wristPreviewActive = false;
        setWristAngleUI(evaluatedWristAngle());
        setGripRotationUI(evaluatedGripRotation());
        setKnuckleAxisUI(evaluatedKnuckleAxis());
        setFingerAnglesUI(evaluatedFingerAngles());
        setFingerOffsetsUI(evaluatedFingerOffsets());
        render();
      });
      container.append(marker);
    }
  }

  function jumpToWristKey(direction) {
    const key = adjacentWristKey(direction);
    if (!key) return;
    pause();
    state.phase = key.phase;
    state.wristPreviewActive = false;
    setWristAngleUI(evaluatedWristAngle());
    setGripRotationUI(evaluatedGripRotation());
    setKnuckleAxisUI(evaluatedKnuckleAxis());
    setFingerAnglesUI(evaluatedFingerAngles());
    setFingerOffsetsUI(evaluatedFingerOffsets());
    render();
  }

  function fingerPathSourceLayer() { return sceneLayer("handClosedLIndex"); }
  function fingerPath() { return fingerPathSourceLayer()?.clipPath ?? null; }
  function selectedGripFingerLayers() {
    const ids = state.selectedGripFinger === "all" ? GRIP_FINGER_LAYER_IDS : [state.selectedGripFinger];
    return ids.map(sceneLayer).filter((layer) => layer?.gripFinger);
  }

  function selectGripFinger(target) {
    if (target !== "all" && !GRIP_FINGER_LAYER_IDS.includes(target)) return;
    state.selectedGripFinger = target;
    state.selectedLayer = target === "all" ? GRIP_FINGER_LAYER_IDS[0] : target;
    for (const button of document.querySelectorAll("#fingerAnchorSelect [data-finger-target]")) {
      button.setAttribute("aria-pressed", String(button.dataset.fingerTarget === target));
    }
    syncFingerAnchorControls();
    syncFingerAngleUI();
    buildLayerList();
    syncInspector();
    render();
  }

  function fingerAnchorValue(finger, field) {
    if (field === "pivotX" || field === "pivotY") return finger.basePivot[field === "pivotX" ? "x" : "y"];
    return finger[field];
  }

  function posedFingerAnchorValue(layer, field) {
    return fingerAnchorValue(layer.gripFinger, field) + (state.fingerOffsets[layer.id]?.[field] ?? 0);
  }

  function syncFingerAnchorControls() {
    const layers = selectedGripFingerLayers();
    const fingers = layers.map((layer) => layer.gripFinger);
    if (!layers.length) return;
    const average = (field) => Number((layers.reduce((sum, layer) => sum + (
      field === "along" || field === "across"
        ? posedFingerAnchorValue(layer, field)
        : fingerAnchorValue(layer.gripFinger, field)
    ), 0) / layers.length).toFixed(2));
    const averageScale = (field) => Number((layers.reduce((sum, layer) => sum + Math.abs(layer.bindByProfile[state.profile][field]), 0) / layers.length).toFixed(3));
    const values = {
      fingerAlong: average("along"),
      fingerAcross: average("across"),
      fingerPivotX: average("pivotX"),
      fingerPivotY: average("pivotY"),
      fingerScaleX: averageScale("scaleX"),
      fingerScaleY: averageScale("scaleY"),
    };
    for (const [id, value] of Object.entries(values)) {
      if (document.activeElement !== $(id)) $(id).value = String(value);
    }
    $("fingerAlongValue").value = `${values.fingerAlong}px`;
    $("fingerAcrossValue").value = `${values.fingerAcross}px`;
    $("fingerPivotXValue").value = `${Math.round(values.fingerPivotX * 100)}%`;
    $("fingerPivotYValue").value = `${Math.round(values.fingerPivotY * 100)}%`;
    $("fingerScaleXValue").value = `${Math.round(values.fingerScaleX * 100)}%`;
    $("fingerScaleYValue").value = `${Math.round(values.fingerScaleY * 100)}%`;
  }

  function setSelectedFingerAnchor(field, value) {
    const sources = selectedGripFingerLayers();
    if (!sources.length) return;
    const animated = field === "along" || field === "across";
    const current = sources.reduce((sum, layer) => sum + (
      animated ? posedFingerAnchorValue(layer, field) : fingerAnchorValue(layer.gripFinger, field)
    ), 0) / sources.length;
    const delta = value - current;
    if (animated) {
      pause();
      for (const source of sources) {
        state.fingerOffsets[source.id] ??= { along: 0, across: 0 };
        state.fingerOffsets[source.id][field] = (state.fingerOffsets[source.id][field] ?? 0) + delta;
      }
      state.wristPreviewActive = true;
      // Placement is authored data, not a disposable preview. Create a key
      // when the playhead sits between existing keys so Save + reload cannot
      // silently discard an individual finger's haft alignment.
      ensureHandKeyAtPlayhead(field === "along" ? "fingerAlong" : "fingerAcross");
      render();
      return;
    }
    for (const source of sources) {
      const resolved = state.rig.layers.find((layer) => layer.id === source.id);
      if (!resolved?.gripFinger) continue;
      const next = fingerAnchorValue(source.gripFinger, field) + delta;
      if (field === "pivotX" || field === "pivotY") {
        const coordinate = field === "pivotX" ? "x" : "y";
        const clamped = Math.max(0, Math.min(1, next));
        source.gripFinger.basePivot[coordinate] = clamped;
        resolved.gripFinger.basePivot[coordinate] = clamped;
      } else {
        source.gripFinger[field] = next;
        resolved.gripFinger[field] = next;
      }
    }
    markDirty();
    render();
  }

  function setSelectedFingerScale(field, value) {
    const sources = selectedGripFingerLayers();
    if (!sources.length) return;
    const current = sources.reduce((sum, layer) => sum + Math.abs(layer.bindByProfile[state.profile][field]), 0) / sources.length;
    if (current <= 0) return;
    const ratio = value / current;
    for (const source of sources) {
      for (const profile of ["maleV1", "femaleV1"]) {
        source.bindByProfile[profile][field] *= ratio;
      }
      const resolved = state.rig.layers.find((layer) => layer.id === source.id);
      if (resolved) resolved[field] *= ratio;
    }
    markDirty();
    render();
  }

  function setSharedFingerPath(path) {
    for (const id of GRIP_FINGER_LAYER_IDS) {
      const source = sceneLayer(id);
      const resolved = state.rig.layers.find((layer) => layer.id === id);
      if (!source) continue;
      if (path) source.clipPath = copy(path); else delete source.clipPath;
      if (resolved) {
        if (path) resolved.clipPath = copy(path); else delete resolved.clipPath;
      }
    }
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

  function resampleSequence(values, count) {
    if (count === values.length) return [...values];
    if (count === 2) return [0, 1];
    return Array.from({ length: count }, (_, index) => {
      if (index === 0) return 0;
      if (index === count - 1) return 1;
      const position = index * (values.length - 1) / (count - 1);
      const low = Math.floor(position);
      const mix = position - low;
      return Number((values[low] + (values[Math.min(low + 1, values.length - 1)] - values[low]) * mix).toFixed(4));
    });
  }

  function meshEditorGeometry(layer, image) {
    const padding = 16;
    const scale = Math.min(
      (wristMeshCanvas.width - padding * 2) / image.width,
      (wristMeshCanvas.height - padding * 2) / image.height,
    );
    const width = image.width * scale;
    const height = image.height * scale;
    const x = (wristMeshCanvas.width - width) / 2;
    const y = (wristMeshCanvas.height - height) / 2;
    return {
      x, y, width, height,
      point: (normalized) => ({ x: x + normalized.x * width, y: y + normalized.y * height }),
      normalized: (point) => ({
        x: Math.max(0, Math.min(1, (point.x - x) / width)),
        y: Math.max(0, Math.min(1, (point.y - y) / height)),
      }),
      unbounded: (point) => ({ x: (point.x - x) / width, y: (point.y - y) / height }),
    };
  }

  function renderWristMeshEditor() {
    const layer = activeWristLayer();
    const source = sourceWristLayer();
    const image = layer ? imageFor(layer) : null;
    wristMeshContext.clearRect(0, 0, wristMeshCanvas.width, wristMeshCanvas.height);
    wristMeshContext.fillStyle = "#0b1016";
    wristMeshContext.fillRect(0, 0, wristMeshCanvas.width, wristMeshCanvas.height);
    if (!layer?.mesh || !source?.mesh || !image) return;

    $("meshLayerName").textContent = layer.id;
    if (document.activeElement !== $("meshSections")) $("meshSections").value = String(source.mesh.bendStops.length);
    const frame = meshEditorGeometry(layer, image);
    wristMeshContext.save();
    wristMeshContext.globalAlpha = 0.9;
    wristMeshContext.drawImage(image, frame.x, frame.y, frame.width, frame.height);
    wristMeshContext.globalAlpha = 1;
    const geometry = weightedMeshGeometry(source.mesh, image.width, image.height);
    wristMeshContext.strokeStyle = "rgba(94,226,235,.55)";
    wristMeshContext.lineWidth = 1;
    for (const triangle of geometry.triangles) {
      const points = triangle.map((index) => frame.point({
        x: geometry.vertices[index].source.x / image.width,
        y: geometry.vertices[index].source.y / image.height,
      }));
      wristMeshContext.beginPath();
      wristMeshContext.moveTo(points[0].x, points[0].y);
      wristMeshContext.lineTo(points[1].x, points[1].y);
      wristMeshContext.lineTo(points[2].x, points[2].y);
      wristMeshContext.closePath();
      wristMeshContext.stroke();
    }
    const start = frame.point(source.mesh.bendStart);
    const end = frame.point(source.mesh.bendEnd);
    const gradient = wristMeshContext.createLinearGradient(start.x, start.y, end.x, end.y);
    gradient.addColorStop(0, "#55d9e8");
    gradient.addColorStop(1, "#f0b24b");
    wristMeshContext.strokeStyle = gradient;
    wristMeshContext.lineWidth = 4;
    wristMeshContext.beginPath();
    wristMeshContext.moveTo(start.x, start.y);
    wristMeshContext.lineTo(end.x, end.y);
    wristMeshContext.stroke();
    for (const [point, color] of [[start, "#55d9e8"], [end, "#f0b24b"]]) {
      wristMeshContext.beginPath();
      wristMeshContext.arc(point.x, point.y, 8, 0, Math.PI * 2);
      wristMeshContext.fillStyle = color;
      wristMeshContext.fill();
      wristMeshContext.lineWidth = 2;
      wristMeshContext.strokeStyle = "#091016";
      wristMeshContext.stroke();
    }
    wristMeshContext.restore();
  }

  function fingerEditorGeometry(image) {
    const padding = 16;
    const scale = Math.min(
      (fingerPathCanvas.width - padding * 2) / image.width,
      (fingerPathCanvas.height - padding * 2) / image.height,
    );
    const width = image.width * scale;
    const height = image.height * scale;
    const x = (fingerPathCanvas.width - width) / 2;
    const y = (fingerPathCanvas.height - height) / 2;
    return {
      x, y, width, height,
      point: (normalized) => ({ x: x + normalized.x * width, y: y + normalized.y * height }),
      normalized: (point) => ({
        x: Math.max(0, Math.min(1, (point.x - x) / width)),
        y: Math.max(0, Math.min(1, (point.y - y) / height)),
      }),
      unbounded: (point) => ({ x: (point.x - x) / width, y: (point.y - y) / height }),
    };
  }

  function renderFingerPathEditor() {
    fingerPathContext.clearRect(0, 0, fingerPathCanvas.width, fingerPathCanvas.height);
    fingerPathContext.fillStyle = "#0b1016";
    fingerPathContext.fillRect(0, 0, fingerPathCanvas.width, fingerPathCanvas.height);
    const layer = state.rig.layers.find((candidate) => candidate.id === "handClosedLIndex");
    const image = layer ? imageFor(layer) : null;
    const path = fingerPath();
    if (!image) return;
    const frame = fingerEditorGeometry(image);
    fingerPathContext.save();
    fingerPathContext.globalAlpha = 0.92;
    fingerPathContext.drawImage(image, frame.x, frame.y, frame.width, frame.height);
    fingerPathContext.restore();

    if (path?.nodes?.length) {
      const point = frame.point;
      const first = point(path.nodes[0]);
      fingerPathContext.beginPath();
      fingerPathContext.moveTo(first.x, first.y);
      for (let index = 1; index < path.nodes.length; index += 1) {
        appendBezierSegment(fingerPathContext, path.nodes[index - 1], path.nodes[index], point);
      }
      if (path.closed && path.nodes.length >= 3) {
        appendBezierSegment(fingerPathContext, path.nodes.at(-1), path.nodes[0], point);
        fingerPathContext.closePath();
        fingerPathContext.save();
        fingerPathContext.fillStyle = "rgba(83,217,232,.13)";
        fingerPathContext.fill();
        fingerPathContext.restore();
      }
      fingerPathContext.strokeStyle = path.closed ? "#55d9e8" : "#f0b24b";
      fingerPathContext.lineWidth = 2;
      fingerPathContext.stroke();

      const selected = path.nodes[state.selectedFingerNode];
      if (selected) {
        const anchor = point(selected);
        for (const [handle, color] of [[selected.in, "#c996ff"], [selected.out, "#c996ff"]]) {
          if (!handle) continue;
          const control = point(handle);
          fingerPathContext.beginPath();
          fingerPathContext.moveTo(anchor.x, anchor.y);
          fingerPathContext.lineTo(control.x, control.y);
          fingerPathContext.strokeStyle = "rgba(201,150,255,.7)";
          fingerPathContext.lineWidth = 1;
          fingerPathContext.stroke();
          fingerPathContext.beginPath();
          fingerPathContext.arc(control.x, control.y, 5, 0, Math.PI * 2);
          fingerPathContext.fillStyle = color;
          fingerPathContext.fill();
        }
      }
      path.nodes.forEach((node, index) => {
        const anchor = point(node);
        fingerPathContext.beginPath();
        fingerPathContext.rect(anchor.x - 5, anchor.y - 5, 10, 10);
        fingerPathContext.fillStyle = index === state.selectedFingerNode ? "#fff" : index === 0 ? "#68d8a1" : "#f0b24b";
        fingerPathContext.fill();
        fingerPathContext.lineWidth = 1.5;
        fingerPathContext.strokeStyle = "#091016";
        fingerPathContext.stroke();
      });
    }
    const nodeCount = path?.nodes?.length ?? 0;
    $("closeFingerPath").disabled = nodeCount < 3 || Boolean(path?.closed);
    $("deleteFingerNode").disabled = state.selectedFingerNode == null || nodeCount === 0;
    $("undoFingerPoint").disabled = nodeCount === 0;
    $("fingerPathStatus").textContent = path?.closed
      ? `${nodeCount}-point closed cutout · cyan area is kept on all four finger copies`
      : nodeCount
        ? `${nodeCount} anchor${nodeCount === 1 ? "" : "s"} · click the green first point or Close path when finished`
        : "Click to add corners or click-drag to make curved handles. Trace clockwise or counter-clockwise around the finger.";
  }

  function markDirty(dirty = true) {
    state.dirty = dirty;
    setStatus(dirty ? "Unsaved rig layout" : "Layout matches scene.json");
  }

  function historySnapshot() {
    return {
      scene: copy(state.scene),
      manualPose: copy(state.manualPose),
      clipScopedEdits: state.clipScopedEdits,
      wristAngle: state.wristAngle,
      gripRotation: state.gripRotation,
      knuckleAxis: state.knuckleAxis,
      fingerAngles: copy(state.fingerAngles),
      fingerOffsets: copy(state.fingerOffsets),
      wristPreviewActive: state.wristPreviewActive,
    };
  }

  function sameSnapshot(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

  function updateHistoryControls() {
    $("undoEdit").disabled = state.history.undo.length === 0;
    $("redoEdit").disabled = state.history.redo.length === 0;
  }

  function commitHistory(before) {
    if (!before) return;
    const after = historySnapshot();
    if (sameSnapshot(before, after)) return;
    state.history.undo.push(before);
    if (state.history.undo.length > state.history.limit) state.history.undo.shift();
    state.history.redo = [];
    updateHistoryControls();
  }

  function restoreHistory(snapshot) {
    state.scene = copy(snapshot.scene);
    state.manualPose = copy(snapshot.manualPose);
    state.clipScopedEdits = snapshot.clipScopedEdits ?? true;
    $("clipScopedEdits").checked = state.clipScopedEdits;
    state.wristAngle = snapshot.wristAngle ?? evaluatedWristAngle();
    state.gripRotation = snapshot.gripRotation ?? evaluatedGripRotation();
    state.knuckleAxis = snapshot.knuckleAxis ?? evaluatedKnuckleAxis();
    state.fingerAngles = copy(snapshot.fingerAngles ?? evaluatedFingerAngles());
    state.fingerOffsets = copy(snapshot.fingerOffsets ?? evaluatedFingerOffsets());
    state.wristPreviewActive = snapshot.wristPreviewActive ?? false;
    setWristAngleUI(state.wristAngle);
    setGripRotationUI(state.gripRotation);
    setKnuckleAxisUI(state.knuckleAxis);
    setFingerAnglesUI(state.fingerAngles);
    setFingerOffsetsUI(state.fingerOffsets);
    state.selectedFingerNode = null;
    resolveRig();
    buildLayerList();
    syncHeadgearToggle();
    syncInspector();
    markDirty(JSON.stringify(state.scene) !== JSON.stringify(state.savedScene));
    updateHistoryControls();
    render();
  }

  function undoEdit() {
    const snapshot = state.history.undo.pop(); if (!snapshot) return;
    state.history.redo.push(historySnapshot());
    restoreHistory(snapshot);
  }

  function redoEdit() {
    const snapshot = state.history.redo.pop(); if (!snapshot) return;
    state.history.undo.push(historySnapshot());
    restoreHistory(snapshot);
  }

  function resetHistory() {
    state.history.undo = [];
    state.history.redo = [];
    updateHistoryControls();
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${source}`));
      image.src = source;
    });
  }

  async function responseJSON(response) {
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`);
    return value;
  }

  async function sceneResponse(response) {
    const scene = await responseJSON(response);
    const revision = response.headers.get("ETag");
    if (!revision) throw new Error("Rig editor server must be restarted before this protected editor can load or save scenes");
    state.sceneRevision = revision;
    return scene;
  }

  async function loadProfileImages() {
    setStatus(`Loading ${state.profile} · ${activeChestOption()?.label ?? "chest clothing"} · ${activeArmOption()?.label ?? "arm set"} · ${activeBootOption()?.label ?? "boot set"} · ${activeHeadgearOption()?.label ?? "helmet"}…`);
    resolveRig();
    const pairs = await Promise.all(state.rig.layers.map(async (layer) => [
      layer.id,
      await loadImage(assetURL(layer.asset)),
    ]));
    state.images = new Map(pairs);
    const profileExpressions = state.expressionCatalog?.profiles?.[state.profile];
    const expressionPaths = new Set([
      ...Object.values(profileExpressions?.eyes ?? {}).flatMap((eyes) => [eyes.left, eyes.right]),
      ...Object.values(profileExpressions?.mouths ?? {}),
    ].filter(Boolean));
    state.expressionImages = new Map(await Promise.all([...expressionPaths].map(async (path) => [
      path,
      await loadImage(assetURL(path)),
    ])));
    state.reference = await loadImage(assetURL(state.scene.referenceByProfile[state.profile]));
    const profileLabel = state.profile === "maleV1" ? "Male V1" : "Female V1";
    $("profileTitle").textContent = `${profileLabel} · ${activeChestOption()?.label ?? "Outfit"} · ${activeArmOption()?.label ?? "Arms"} · ${activeBootOption()?.label ?? "Boots"} · ${activeHeadgearOption()?.label ?? "Helmet"}`;
    buildLayerList();
    syncHeadgearToggle();
    syncInspector();
    markDirty(state.dirty);
  }

  function floorLineY() {
    if (!state.scene || state.rig.bones.length === 0) {
      return OVERSCAN + (state.scene?.profileReference?.canonicalTargetPixels?.baseline ?? 1190);
    }
    const bindWorld = worldMatrices(state.rig.bones);
    const contacts = ["footL", "footR"].flatMap((id) => {
      const layer = state.rig.layers.find((candidate) => candidate.id === id);
      const image = state.images.get(id);
      if (!layer || !image) return [];
      const matrix = rigidLayerMatrix(layer, image.naturalWidth, image.naturalHeight, bindWorld, bindWorld);
      // The boot PNGs are tightly trimmed. Sampling just inside the bottom at
      // their horizontal centre follows the sole without letting a rotated
      // transparent corner move the reference line.
      return [transformPoint(matrix, {
        x: image.naturalWidth * 0.5,
        y: image.naturalHeight * 0.986,
      }).y];
    });
    const baseline = contacts.length
      ? Math.max(...contacts)
      : (state.scene.profileReference?.canonicalTargetPixels?.baseline ?? 1190);
    return OVERSCAN + baseline;
  }

  function checkerboard() {
    context.fillStyle = "#10161d";
    context.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    if ($("showGrid").checked) {
      const small = 48;
      context.fillStyle = "#151e27";
      for (let y = -OVERSCAN; y < SIZE + OVERSCAN; y += small) {
        for (let x = -OVERSCAN; x < SIZE + OVERSCAN; x += small) {
          if ((x / small + y / small) % 2 === 0) {
            context.fillRect(x + OVERSCAN, y + OVERSCAN, small, small);
          }
        }
      }
      context.strokeStyle = "rgba(111,137,161,.16)";
      context.lineWidth = 1;
      for (let coordinate = -OVERSCAN; coordinate <= SIZE + OVERSCAN; coordinate += 96) {
        const viewportCoordinate = coordinate + OVERSCAN;
        context.beginPath(); context.moveTo(viewportCoordinate, 0); context.lineTo(viewportCoordinate, VIEW_SIZE); context.stroke();
        context.beginPath(); context.moveTo(0, viewportCoordinate); context.lineTo(VIEW_SIZE, viewportCoordinate); context.stroke();
      }
      context.strokeStyle = "rgba(83,218,232,.35)";
      context.beginPath(); context.moveTo(OVERSCAN + SIZE / 2, 0); context.lineTo(OVERSCAN + SIZE / 2, VIEW_SIZE); context.stroke();
    }
    const floor = floorLineY();
    context.save();
    context.setLineDash([12, 9]);
    context.strokeStyle = "rgba(240,178,75,.78)";
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(OVERSCAN, floor); context.lineTo(OVERSCAN + SIZE, floor); context.stroke();
    context.restore();
    context.fillStyle = "rgba(240,178,75,.9)";
    context.font = "600 18px system-ui, sans-serif";
    context.fillText("FLOOR", OVERSCAN + 12, floor - 10);
  }

  function combinedPose() {
    const authored = animationPose(state.animation, state.phase);
    const pose = constrainForearmPose(state.rig.bones, mergePoses(authored, state.manualPose));
    // Slider/URL previews are a paused authoring aid. They must never replace
    // the saved key curve during playback; otherwise a stale wristAngle query
    // parameter makes a refreshed page appear to play an older animation.
    if (state.wristPreviewActive && !state.playing) {
      const wrist = `hand${state.wristSide}`;
      pose[wrist] = {
        ...(pose[wrist] ?? {}),
        // animationPose already includes the stored curve. Replace that curve's
        // value with the slider preview instead of accidentally adding twice.
        rotation: (pose[wrist]?.rotation ?? 0) + state.wristAngle - evaluatedWristAngle(),
      };
    }
    return pose;
  }

  function applyMatrix(target, matrix) {
    // Preserve the stage's overscan translation around each layer transform.
    target.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  }

  function posedGripLayer(layer, controls = {}, animation = state.animation) {
    return posedGripAttachment(layer, state.rig.layers, activeGripLayer(animation), controls);
  }

  function handControlsForLayer(layer, animation = state.animation, phase = state.phase, usePreview = true) {
    const side = String(layer.bone ?? "").endsWith("R") ? "R" : "L";
    const preview = usePreview
      && state.wristPreviewActive
      && !state.playing
      && side === state.wristSide;
    return {
      gripRotation: preview ? state.gripRotation : evaluatedGripRotation(animation, side, phase),
      knuckleAxis: preview ? state.knuckleAxis : evaluatedKnuckleAxis(animation, side, phase),
      fingerAngles: preview ? state.fingerAngles : evaluatedFingerAngles(animation, side, phase),
      fingerOffsets: preview ? state.fingerOffsets : evaluatedFingerOffsets(animation, side, phase),
    };
  }

  function drawRigidLayer(target, layer, image, bindWorld, currentWorld, controls = {}, animation = state.animation) {
    const posedLayer = posedGripLayer(layer, controls, animation);
    target.save();
    applyMatrix(target, rigidLayerMatrix(posedLayer, image.width, image.height, bindWorld, currentWorld));
    if (traceBezierPath(target, posedLayer.clipPath, image.width, image.height)) target.clip();
    const strips = planeStrips(posedLayer, image.width, image.height);
    if (strips) {
      // A yawed plane is projective and canvas transforms are affine, so it is
      // drawn as vertical strips. Half a pixel of overlap hides the seams.
      for (const strip of strips) {
        target.drawImage(
          image, strip.sourceX, 0, strip.sourceWidth, image.height,
          strip.x, strip.y, strip.width + 0.5, strip.height
        );
      }
    } else {
      target.drawImage(image, 0, 0);
    }
    target.restore();
  }

  function drawMeshLayer(target, layer, image, bindWorld, currentWorld, showMesh = false, controls = {}) {
    const deformation = deformWeightedMesh(layer, image.width, image.height, bindWorld, currentWorld, controls);
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
      applyMatrix(target, matrix);
      target.drawImage(image, 0, 0);
      target.restore();
    }
    if (showMesh) {
      target.save();
      target.strokeStyle = "rgba(94,226,235,.88)";
      target.lineWidth = 1.25;
      for (const triangle of deformation.triangles) {
        const points = triangle.map((index) => deformation.points[index]);
        target.beginPath();
        target.moveTo(points[0].x, points[0].y);
        target.lineTo(points[1].x, points[1].y);
        target.lineTo(points[2].x, points[2].y);
        target.closePath();
        target.stroke();
      }
      target.restore();
    }
    return true;
  }

  function drawLayer(
    target,
    layer,
    image,
    rigidBindWorld,
    meshBindWorld,
    currentWorld,
    showMesh = false,
    animation = state.animation,
    phase = state.phase,
    usePreview = true,
  ) {
    target.save();
    if (target === context && $("dimUnselected").checked && state.selectedLayer && layer.id !== state.selectedLayer) {
      target.globalAlpha = 0.26;
    }
    const controls = handControlsForLayer(layer, animation, phase, usePreview);
    if (!layer.mesh || !drawMeshLayer(target, layer, image, meshBindWorld, currentWorld, showMesh, controls)) {
      drawRigidLayer(target, layer, image, rigidBindWorld, currentWorld, controls, animation);
    }
    target.restore();
  }

  function drawSelection(layer, image, bindWorld, currentWorld) {
    if (!layer || !image || state.mode !== "layer") return;
    const matrix = rigidLayerMatrix(
      posedGripLayer(layer, handControlsForLayer(layer)),
      image.width,
      image.height,
      bindWorld,
      currentWorld,
    );
    const corners = [
      transformPoint(matrix, { x: 0, y: 0 }),
      transformPoint(matrix, { x: image.width, y: 0 }),
      transformPoint(matrix, { x: image.width, y: image.height }),
      transformPoint(matrix, { x: 0, y: image.height }),
    ];
    context.save();
    context.strokeStyle = "#f0b24b";
    context.lineWidth = 3;
    context.setLineDash([11, 7]);
    context.beginPath(); context.moveTo(corners[0].x, corners[0].y);
    for (let index = 1; index < corners.length; index += 1) context.lineTo(corners[index].x, corners[index].y);
    context.closePath(); context.stroke();
    context.restore();
  }

  function boneOrigin(matrix) { return { x: matrix.e, y: matrix.f }; }

  function drawBones(currentWorld) {
    if (!$("showBones").checked) return;
    const hideDuringPlayback = state.playing && $("hideControlsDuringPlayback").checked;
    if (hideDuringPlayback) return;
    context.save();
    context.font = "700 15px ui-sans-serif, system-ui";
    context.textBaseline = "middle";
    for (const bone of state.rig.bones) {
      const point = boneOrigin(currentWorld[bone.id]);
      if (bone.parent) {
        const parent = boneOrigin(currentWorld[bone.parent]);
        context.strokeStyle = bone.id.startsWith("skirt") ? "rgba(240,178,75,.9)" : "rgba(83,217,232,.82)";
        context.lineWidth = state.selectedBone === bone.id ? 5 : 3;
        context.beginPath(); context.moveTo(parent.x, parent.y); context.lineTo(point.x, point.y); context.stroke();
      }
      context.beginPath(); context.arc(point.x, point.y, state.selectedBone === bone.id ? 10 : 7, 0, Math.PI * 2);
      context.fillStyle = state.selectedBone === bone.id ? "#fff" : bone.id.startsWith("skirt") ? "#f0b24b" : "#55d9e8";
      context.fill();
      context.lineWidth = 3; context.strokeStyle = "#13202a"; context.stroke();
      if ($("showNames").checked) {
        context.lineWidth = 4; context.strokeStyle = "rgba(8,12,17,.9)"; context.fillStyle = "#eaf6f8";
        context.strokeText(bone.label, point.x + 13, point.y - 10);
        context.fillText(bone.label, point.x + 13, point.y - 10);
      }
    }
    context.restore();
  }

  /**
   * Draw the rig as it is currently dressed into a context of any size, at a
   * pose of its own. Motion-picker previews render through this, so their
   * composites cannot disagree with the main stage.
   */
  function paintRig(target, animation, phase, size) {
    const authored = animationPose(animation, phase);
    const preview = animation === state.animation ? state.manualPose : {};
    const pose = mergePoses(authored, preview);
    const bindWorld = worldMatrices(state.rig.bones, state.clipScopedEdits ? {} : preview);
    const meshBindWorld = worldMatrices(state.rig.bones);
    const currentWorld = worldMatrices(state.rig.bones, pose);
    const scale = size / VIEW_SIZE;
    target.save();
    target.scale(scale, scale);
    target.translate(OVERSCAN, OVERSCAN);
    const layers = [...state.rig.layers]
      .filter((layer) => layer.visible
        && layerMatchesMainHand(layer)
        && layerDrawsUnderHandPose(layer, animationHandPose[animation] ?? state.handPose)
        && layerDrawsUnderAnimation(layer, animation))
      .sort((left, right) => left.drawOrder - right.drawOrder);
    for (const layer of layers) {
      const image = imageFor(layer, animation, phase);
      if (!image) continue;
      drawLayer(target, layer, image, bindWorld, meshBindWorld, currentWorld, false, animation, phase, false);
    }
    target.restore();
  }

  function render() {
    if (!state.scene || state.images.size === 0) return;
    checkerboard();
    context.save();
    context.translate(OVERSCAN, OVERSCAN);
    if ($("showReference").checked && state.reference) {
      context.save(); context.globalAlpha = 0.24; context.drawImage(state.reference, 0, 0, SIZE, SIZE); context.restore();
    }
    // Manual bone edits are bind data that has not been written yet, so they
    // belong in the fit reference frame as well as the posed one. Leaving them
    // out makes a fitBones layer -- the torso art across hips/spine/chest --
    // preview a similarity fit whose scale disappears the moment saving bakes
    // those edits into the bind and the two frames coincide again. Only the
    // animation should stretch a fitted layer.
    const bindWorld = worldMatrices(state.rig.bones, state.clipScopedEdits ? {} : state.manualPose);
    const meshBindWorld = worldMatrices(state.rig.bones);
    const currentWorld = worldMatrices(state.rig.bones, combinedPose());
    const layers = [...state.rig.layers]
      .filter((layer) => layer.visible && layerMatchesPresentation(layer))
      .sort((left, right) => left.drawOrder - right.drawOrder);
    for (const layer of layers) {
      const image = imageFor(layer);
      if (!image) continue;
      drawLayer(context, layer, image, bindWorld, meshBindWorld, currentWorld, $("showMesh").checked);
    }
    const layer = selectedLayer();
    if (layer) drawSelection(layer, imageFor(layer), bindWorld, currentWorld);
    drawBones(currentWorld);
    context.restore();
    $("timeline").value = String(Math.round(state.phase * 1000));
    $("timeReadout").textContent = `${(state.phase * animationDurations[state.animation]).toFixed(2)} s`;
    syncInspector();
    syncBoneAuthoring();
    syncWristAuthoring();
    syncExpressionAuthoring();
    syncFingerAnchorControls();
    renderFingerPathEditor();
    syncNumericControls();
  }

  function layerMatchesHandPose(layer) {
    return layerDrawsUnderHandPose(layer, state.handPose);
  }

  function layerMatchesMainHand(layer) {
    return !["weapon", "staff"].includes(layer.id) || layer.id === state.mainHand;
  }

  function layerMatchesAnimationEquipment(layer) {
    // The layer being edited always draws. A staff ships only in its own idle,
    // but placing it means judging the grip against a turn, a run and a lunge.
    return layer.id === state.selectedLayer
      || layerDrawsUnderAnimation(layer, state.animation);
  }

  function layerMatchesPresentation(layer) {
    return layerMatchesMainHand(layer)
      && layerMatchesHandPose(layer)
      && layerMatchesAnimationEquipment(layer);
  }

  function groupLayers(search = "") {
    const groups = new Map();
    for (const layer of [...state.rig.layers].sort((left, right) => left.drawOrder - right.drawOrder)) {
      if (!layerMatchesPresentation(layer)) continue;
      if (search && !`${layer.id} ${layer.group} ${layer.bone}`.toLowerCase().includes(search.toLowerCase())) continue;
      if (!groups.has(layer.group)) groups.set(layer.group, []);
      groups.get(layer.group).push(layer);
    }
    return groups;
  }

  function buildLayerList() {
    const container = $("layerGroups");
    container.replaceChildren();
    for (const [group, layers] of groupLayers($("layerSearch").value)) {
      const section = document.createElement("section");
      section.className = "layer-group";
      const heading = document.createElement("h3"); heading.textContent = `${group} · ${layers.length}`; section.append(heading);
      for (const layer of layers) {
        const row = document.createElement("div"); row.className = "layer-row";
        const visibility = document.createElement("button"); visibility.type = "button"; visibility.className = "visibility"; visibility.textContent = layer.visible ? "◉" : "○"; visibility.title = `${layer.visible ? "Hide" : "Show"} ${layer.id}`;
        visibility.addEventListener("click", () => {
          const before = historySnapshot();
          layer.visible = !layer.visible; sceneLayer(layer.id).visible = layer.visible;
          if (layer.id === HEADGEAR_LAYER_ID) {
            resolveRig();
            syncHeadgearToggle();
          }
          markDirty(); buildLayerList(); render();
          commitHistory(before);
        });
        const button = document.createElement("button"); button.type = "button"; button.textContent = layer.id; button.classList.toggle("selected", layer.id === state.selectedLayer);
        button.addEventListener("click", () => { state.mode = "layer"; state.selectedLayer = layer.id; selectMode("layer"); buildLayerList(); syncInspector(); render(); });
        const order = document.createElement("small"); order.textContent = String(layer.drawOrder);
        row.append(visibility, button, order); section.append(row);
      }
      container.append(section);
    }
    $("layerCount").value = String(state.rig.layers.filter(layerMatchesPresentation).length);
  }

  function setControlMenuOpen(buttonID, menuID, open) {
    $(buttonID).setAttribute("aria-expanded", String(open));
    $(menuID).hidden = !open;
  }

  function closeControlMenus() {
    setControlMenuOpen("equipMenuButton", "equipMenu", false);
  }

  function syncAnimationPicker() {
    const picker = $("animationPickerButton");
    picker.textContent = animationLabel(state.animation);
    picker.setAttribute("aria-label", `Animation: ${animationLabel(state.animation)}`);
    for (const option of $("animationGrid").querySelectorAll("[data-animation]")) {
      option.setAttribute("aria-selected", String(option.dataset.animation === state.animation));
    }
  }

  function buildAnimationOptions() {
    const container = $("animationGrid"); container.replaceChildren();
    for (const name of animationNames) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      button.className = "animation-option";
      button.dataset.animation = name;
      button.setAttribute("aria-label", animationLabel(name));
      const preview = document.createElement("canvas");
      preview.width = 176;
      preview.height = 176;
      preview.setAttribute("aria-hidden", "true");
      const caption = document.createElement("span");
      caption.className = "animation-option-name";
      caption.textContent = animationLabel(name);
      button.append(preview, caption);
      button.addEventListener("click", () => {
        selectAnimation(name);
        closeAnimationModal();
      });
      container.append(button);
    }
    syncAnimationPicker();
  }

  function renderAnimationPreviews(timestamp = performance.now()) {
    if (!$("animationModal").open || !state.scene || state.images.size === 0) return;
    for (const option of $("animationGrid").querySelectorAll("[data-animation]")) {
      const animation = option.dataset.animation;
      const preview = option.querySelector("canvas");
      const previewContext = preview.getContext("2d");
      const phase = (timestamp / (animationDurations[animation] * 1000)) % 1;
      previewContext.clearRect(0, 0, preview.width, preview.height);
      paintRig(previewContext, animation, phase, preview.width);
    }
  }

  function openAnimationModal() {
    closeControlMenus();
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
    const modal = $("animationModal");
    if (modal.open) modal.close();
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

  function selectAnimation(name) {
    state.animation = name; state.phase = 0; state.manualPose = {}; state.wristPreviewActive = false; syncAnimationPicker();
    // Follow the clip's authored hand state, so a cast previews open-handed
    // and an attack previews on a fist without hunting for the Hands control.
    const handPose = animationHandPose[name];
    if (handPose) { state.handPose = handPose; $("handPoseSelect").value = handPose; }
    const layer = selectedLayer();
    if (layer && !layerMatchesPresentation(layer)) state.selectedLayer = null;
    buildLayerList(); syncInspector(); render();
  }

  function selectMode(mode) {
    state.mode = mode;
    $("modeLayer").setAttribute("aria-pressed", String(mode === "layer"));
    $("modeBone").setAttribute("aria-pressed", String(mode === "bone"));
    syncInspector(); render();
  }

  function syncInspector() {
    const layer = selectedLayer(); const bone = selectedBone();
    const showLayer = state.mode === "layer" && layer;
    const showBone = state.mode === "bone" && bone;
    $("selectionEmpty").hidden = Boolean(showLayer || showBone);
    $("layerInspector").hidden = !showLayer;
    $("boneInspector").hidden = !showBone;
    if (showLayer) {
      $("selectionTitle").textContent = layer.id;
      for (const [field, key] of [["layerX", "x"], ["layerY", "y"], ["layerRotation", "rotation"], ["layerOrder", "drawOrder"], ["layerScaleX", "scaleX"], ["layerScaleY", "scaleY"], ["layerPivotX", "pivotX"], ["layerPivotY", "pivotY"], ["layerPlaneYaw", "planeYaw"]]) $(field).value = String(layer[key]);
      $("layerBone").textContent = layer.bone;
      const image = imageFor(layer);
      const geometry = layer.mesh && image ? weightedMeshGeometry(layer.mesh, image.width, image.height) : null;
      $("layerMesh").textContent = geometry
        ? `${geometry.vertices.length}-vertex two-rail wrist cage · ${layer.mesh.parentBone} + ${layer.mesh.childBone}`
        : layer.gripFinger
          ? "rigid finger · root and angle follow the held haft"
          : "rigid attachment";
    } else if (showBone) {
      $("selectionTitle").textContent = bone.label;
      const correction = evaluatedBoneCorrection(bone.id);
      const animationEdit = state.clipScopedEdits;
      $("boneXLabel").textContent = animationEdit ? "Pose X" : "Bind X";
      $("boneYLabel").textContent = animationEdit ? "Pose Y" : "Bind Y";
      $("boneRotationLabel").textContent = animationEdit ? "Pose rotation" : "Bind rotation";
      $("boneX").value = String(animationEdit ? correction.x : (bone.x ?? 0));
      $("boneY").value = String(animationEdit ? correction.y : (bone.y ?? 0));
      $("boneRotation").value = String(animationEdit ? correction.rotation : (bone.rotation ?? 0));
      $("boneScale").value = String(bone.scaleX ?? 1);
      $("boneScale").disabled = animationEdit;
      $("boneParent").value = bone.parent ?? "—";
      $("resetBone").textContent = animationEdit ? "Delete key at playhead" : "Reset selected bone bind";
    } else $("selectionTitle").textContent = "No selection";
  }

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * VIEW_SIZE / bounds.width - OVERSCAN,
      y: (event.clientY - bounds.top) * VIEW_SIZE / bounds.height - OVERSCAN,
    };
  }

  function hitBone(point, currentWorld) {
    let best = null;
    for (const bone of state.rig.bones) {
      const origin = boneOrigin(currentWorld[bone.id]); const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
      if (!best || distance < best.distance) best = { bone, distance };
    }
    return best && best.distance <= 28 ? best.bone : null;
  }

  function hitLayer(point, bindWorld, currentWorld) {
    const layers = [...state.rig.layers].filter((layer) => layer.visible && layerMatchesPresentation(layer)).sort((left, right) => right.drawOrder - left.drawOrder);
    for (const layer of layers) {
      const image = imageFor(layer); if (!image) continue;
      const posedLayer = posedGripLayer(layer, handControlsForLayer(layer));
      const local = transformPoint(inverse(rigidLayerMatrix(posedLayer, image.width, image.height, bindWorld, currentWorld)), point);
      if (local.x >= 0 && local.y >= 0 && local.x <= image.width && local.y <= image.height) return layer;
    }
    return null;
  }

  // The button carries a transport icon rather than a word, so its label has to
  // be spoken for: `aria-label` and the tooltip say what pressing it will do.
  const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.6v10.8L13.5 8z"/></svg>';
  const PAUSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.6h3.1v10.8H4zM8.9 2.6H12v10.8H8.9z"/></svg>';
  function showPlayState() {
    const button = $("playPause");
    button.innerHTML = state.playing ? PAUSE_ICON : PLAY_ICON;
    button.setAttribute("aria-label", state.playing ? "Pause" : "Play");
    button.title = state.playing ? "Pause" : "Play";
    button.setAttribute("aria-pressed", String(state.playing));
  }
  function clearWristPreviewQuery() {
    const url = new URL(location.href);
    if (!url.searchParams.has("wristAngle")) return;
    url.searchParams.delete("wristAngle");
    if (url.searchParams.get("play") === "0") url.searchParams.delete("play");
    history.replaceState(history.state, "", url);
  }
  function pause() { state.playing = false; showPlayState(); }
  function togglePlayback() {
    state.playing = !state.playing;
    // A transport action always returns control to the authored curve. Slider
    // input calls pause() before explicitly creating a fresh preview.
    state.wristPreviewActive = false;
    if (state.playing) clearWristPreviewQuery();
    showPlayState();
  }

  function handlePointerDown(event) {
    if (!state.scene) return;
    pause();
    const point = canvasPoint(event); const pose = combinedPose(); const currentWorld = worldMatrices(state.rig.bones, pose);
    if (state.mode === "bone") {
      const bone = hitBone(point, currentWorld); if (!bone) return;
      const before = historySnapshot();
      state.selectedBone = bone.id;
      if (/^hand[LR]$/.test(bone.id)) {
        state.dragging = { type: "armIK", side: bone.id.endsWith("R") ? "R" : "L", before };
      } else if (/^lowerArm[LR]$/.test(bone.id)) {
        state.dragging = { type: "armElbow", side: bone.id.endsWith("R") ? "R" : "L", before };
      } else {
        const parentMatrix = bone.parent ? currentWorld[bone.parent] : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        state.dragging = { type: "bone", bone, parentInverse: inverse(parentMatrix), before };
      }
    } else {
      const layer = hitLayer(point, worldMatrices(state.rig.bones), currentWorld) ?? selectedLayer(); if (!layer) return;
      const before = historySnapshot();
      state.selectedLayer = layer.id;
      const boneInverse = inverse(currentWorld[layer.bone]);
      state.dragging = { type: "layer", layer, start: transformPoint(boneInverse, point), startX: layer.x, startY: layer.y, boneInverse, before };
      buildLayerList();
    }
    canvas.setPointerCapture(event.pointerId); syncInspector(); render();
  }

  function handlePointerMove(event) {
    if (!state.dragging) return;
    const point = canvasPoint(event);
    if (state.dragging.type === "armElbow") {
      const side = state.dragging.side;
      const ids = { upper: `upperArm${side}`, lower: `lowerArm${side}` };
      const byID = Object.fromEntries(state.rig.bones.map((bone) => [bone.id, bone]));
      const pose = combinedPose();
      const currentWorld = worldMatrices(state.rig.bones, pose);
      const target = transformPoint(inverse(currentWorld[ids.upper]), point);
      target.x -= byID[ids.lower].x;
      target.y -= byID[ids.lower].y;
      const finalRotation = constrainForearmRotation(side, Math.atan2(-target.x, target.y) * 180 / Math.PI);
      const animated = animationPose(state.animation, state.phase);
      state.manualPose[ids.lower] = {
        ...(state.manualPose[ids.lower] ?? {}),
        rotation: finalRotation - byID[ids.lower].rotation - (animated[ids.lower]?.rotation ?? 0),
      };
    } else if (state.dragging.type === "armIK") {
      const side = state.dragging.side;
      const ids = { shoulder: `shoulder${side}`, upper: `upperArm${side}`, lower: `lowerArm${side}`, hand: `hand${side}` };
      const byID = Object.fromEntries(state.rig.bones.map((bone) => [bone.id, bone]));
      const pose = combinedPose();
      const currentWorld = worldMatrices(state.rig.bones, pose);
      const target = transformPoint(inverse(currentWorld[ids.shoulder]), point);
      target.x -= byID[ids.upper].x + (pose[ids.upper]?.x ?? 0);
      target.y -= byID[ids.upper].y + (pose[ids.upper]?.y ?? 0);
      const upperLength = Math.hypot(
        byID[ids.lower].x + (pose[ids.lower]?.x ?? 0),
        byID[ids.lower].y + (pose[ids.lower]?.y ?? 0)
      );
      const lowerLength = Math.hypot(
        byID[ids.hand].x + (pose[ids.hand]?.x ?? 0),
        byID[ids.hand].y + (pose[ids.hand]?.y ?? 0)
      );
      const currentUpper = byID[ids.upper].rotation + (pose[ids.upper]?.rotation ?? 0);
      const currentLower = byID[ids.lower].rotation + (pose[ids.lower]?.rotation ?? 0);
      const bendDirection = 1;
      const solution = solveTwoBoneIK(target, upperLength, lowerLength, currentUpper, currentLower, bendDirection);
      const animated = animationPose(state.animation, state.phase);
      state.manualPose[ids.upper] = {
        ...(state.manualPose[ids.upper] ?? {}),
        rotation: solution.upperRotation - byID[ids.upper].rotation - (animated[ids.upper]?.rotation ?? 0),
      };
      state.manualPose[ids.lower] = {
        ...(state.manualPose[ids.lower] ?? {}),
        rotation: solution.lowerRotation - byID[ids.lower].rotation - (animated[ids.lower]?.rotation ?? 0),
      };
    } else if (state.dragging.type === "bone") {
      const local = transformPoint(state.dragging.parentInverse, point); const bone = state.dragging.bone;
      const animated = animationPose(state.animation, state.phase)[bone.id] ?? {};
      state.manualPose[bone.id] = {
        ...(state.manualPose[bone.id] ?? {}),
        x: local.x - bone.x - (animated.x ?? 0),
        y: local.y - bone.y - (animated.y ?? 0),
      };
    } else {
      const local = transformPoint(state.dragging.boneInverse, point); const drag = state.dragging;
      writeLayerBind(drag.layer, "x", Number((drag.startX + local.x - drag.start.x).toFixed(2))); writeLayerBind(drag.layer, "y", Number((drag.startY + local.y - drag.start.y).toFixed(2))); markDirty();
    }
    if (state.dragging.type !== "layer") markDirty();
    syncInspector(); render();
  }

  function handlePointerUp(event) {
    if (!state.dragging) return;
    canvas.releasePointerCapture(event.pointerId);
    if (state.dragging.type !== "layer") commitManualPoseToBoneKeys();
    commitHistory(state.dragging.before);
    state.dragging = null;
    render();
  }

  function bindLayerInputs() {
    const trackInputHistory = (input) => {
      const begin = () => { if (!input._historyBefore) input._historyBefore = historySnapshot(); };
      const finish = () => { commitHistory(input._historyBefore); input._historyBefore = null; };
      input.addEventListener("focus", begin);
      input.addEventListener("change", finish);
      input.addEventListener("numeric-control-begin", begin);
      input.addEventListener("numeric-control-end", finish);
    };
    for (const [field, key] of [["layerX", "x"], ["layerY", "y"], ["layerRotation", "rotation"], ["layerOrder", "drawOrder"], ["layerScaleX", "scaleX"], ["layerScaleY", "scaleY"], ["layerPivotX", "pivotX"], ["layerPivotY", "pivotY"], ["layerPlaneYaw", "planeYaw"]]) {
      $(field).addEventListener("input", () => { const layer = selectedLayer(); if (!layer) return; const value = Number($(field).value); if (key === "drawOrder") { layer.drawOrder = value; sceneLayer(layer.id).drawOrder = value; buildLayerList(); } else writeLayerBind(layer, key, value); markDirty(); render(); });
      trackInputHistory($(field));
    }
    for (const [field, key] of [["boneX", "x"], ["boneY", "y"], ["boneRotation", "rotation"]]) {
      $(field).addEventListener("input", () => {
        const bone = selectedBone(); if (!bone) return;
        const value = Number($(field).value);
        if (state.clipScopedEdits) setBoneAnimationValue(bone, key, value);
        else writeBoneBind(bone, key, value);
        markDirty(); render();
      });
      trackInputHistory($(field));
    }
    // One field drives both axes: a head that stretches on one axis alone would
    // pull its own face attachments out of round.
    $("boneScale").addEventListener("input", () => {
      const bone = selectedBone(); if (!bone) return;
      if (state.clipScopedEdits) return;
      const value = Number($("boneScale").value);
      if (!Number.isFinite(value) || value < 0.05 || value > 8) return;
      writeBoneBind(bone, "scaleX", value); writeBoneBind(bone, "scaleY", value);
      markDirty(); render();
    });
    trackInputHistory($("boneScale"));
  }

  async function saveScene() {
    try {
      $("saveScene").disabled = true; setStatus("Saving rig layout…");
      if (state.clipScopedEdits) {
        commitManualPoseToBoneKeys();
      } else {
        bakePoseIntoProfile(state.scene, state.profile, state.manualPose);
      }
      state.manualPose = {};
      resolveRig(); syncInspector();
      state.scene.activeProfile = state.profile;
      state.scene.activeChest = state.chest;
      state.scene.activeArmSet = state.armSet;
      state.scene.activeBootSet = state.bootSet;
      state.scene.activeHeadgear = state.headgear;
      if (state.scene.necklaceOptions) state.scene.activeNecklace = state.necklace;
      for (const slot of HELD_SLOTS) {
        if (state.scene[slot.catalogue] && state.held[slot.layer]) {
          state.scene[slot.active] = state.held[slot.layer];
        }
      }
      state.scene = await sceneResponse(await fetch("/api/scene", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": state.sceneRevision },
        body: JSON.stringify(state.scene),
      }));
      state.savedScene = copy(state.scene); resolveRig(); markDirty(false); buildLayerList(); render();
    } catch (error) { setStatus(error.message); } finally { $("saveScene").disabled = false; }
  }

  async function reloadScene() {
    try {
      setStatus("Reloading saved rig…"); state.scene = await sceneResponse(await fetch("/api/scene")); state.savedScene = copy(state.scene); state.profile = state.scene.activeProfile; state.chest = state.scene.activeChest; state.armSet = state.scene.activeArmSet; state.bootSet = state.scene.activeBootSet; state.headgear = state.scene.activeHeadgear; state.necklace = state.scene.activeNecklace; $("profileSelect").value = state.profile; buildChestOptions(); buildArmOptions(); buildBootOptions(); buildHeadgearOptions(); buildNecklaceOptions(); syncHeldFromScene(); buildHeldOptions(); state.manualPose = {}; state.wristPreviewActive = false; resetHistory(); await loadProfileImages(); markDirty(false); render();
    } catch (error) { setStatus(error.message); }
  }

  function resetSelectedLayer() {
    const layer = selectedLayer(); const saved = state.savedScene.layers.find((candidate) => candidate.id === layer?.id); if (!layer || !saved) return;
    const before = historySnapshot();
    Object.assign(sceneLayer(layer.id), copy(saved));
    // Reverting a layer has to revert whatever is actually dressing it, or the
    // option's placement survives the reset and nothing appears to change.
    const dressed = layerOption(sceneSelection(), sceneLayer(layer.id));
    if (dressed?.bind) {
      const savedOption = layerOption(
        { ...state.savedScene, activeNecklace: state.necklace, activeChest: state.chest,
          activeArmSet: state.armSet, activeBootSet: state.bootSet, activeHeadgear: state.headgear },
        saved
      );
      if (savedOption?.bind?.[state.profile]) {
        Object.assign(dressed.bind[state.profile], copy(savedOption.bind[state.profile]));
      }
    }
    resolveRig(); markDirty(); buildLayerList(); syncInspector(); render();
    commitHistory(before);
  }

  function exportPNG() {
    canvas.toBlob((blob) => {
      if (!blob) return; const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `modular-character-${state.profile}-${state.animation}.png`; anchor.click(); URL.revokeObjectURL(anchor.href);
    }, "image/png");
  }

  function setCurrentWristKey() {
    const before = historySnapshot();
    commitHandControlsToKey(true);
    state.wristPreviewActive = false;
    clearWristPreviewQuery();
    resolveRig();
    markDirty();
    commitHistory(before);
    render();
  }

  function deleteCurrentWristKey() {
    const wristKey = currentWristKey();
    const gripKey = currentGripKey();
    if (!wristKey && !gripKey) return;
    const before = historySnapshot();
    if (wristKey) {
      const keys = wristKeys();
      keys.splice(keys.indexOf(wristKey), 1);
      const sides = state.scene.wristKeyframes?.[state.animation];
      if (keys.length === 0) delete sides?.[state.wristSide];
      if (sides && Object.keys(sides).length === 0) delete state.scene.wristKeyframes[state.animation];
    }
    if (gripKey && gripKey !== wristKey) {
      const keys = gripKeys();
      keys.splice(keys.indexOf(gripKey), 1);
      const track = gripUsesAnimationOverride(state.animation)
        ? state.animation
        : gripTrackName(activeGripKind());
      const sides = state.scene.wristKeyframes?.[track];
      if (keys.length === 0) delete sides?.L;
      if (sides && Object.keys(sides).length === 0) delete state.scene.wristKeyframes[track];
    }
    state.wristPreviewActive = false;
    resolveRig();
    markDirty();
    commitHistory(before);
    render();
  }

  function changeMeshDensity(count) {
    const source = sourceWristLayer();
    if (!source?.mesh) return;
    const next = Math.max(3, Math.min(12, Math.round(count)));
    if (!Number.isFinite(next) || next === source.mesh.bendStops.length) return;
    const before = historySnapshot();
    source.mesh.bendStops = resampleSequence(source.mesh.bendStops, next);
    resolveRig();
    markDirty();
    commitHistory(before);
    render();
  }

  function meshEditorPoint(event) {
    const bounds = wristMeshCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * wristMeshCanvas.width / bounds.width,
      y: (event.clientY - bounds.top) * wristMeshCanvas.height / bounds.height,
    };
  }

  function handleMeshPointerDown(event) {
    const layer = activeWristLayer();
    const source = sourceWristLayer();
    const image = layer ? imageFor(layer) : null;
    if (!source?.mesh || !image) return;
    const frame = meshEditorGeometry(layer, image);
    const point = meshEditorPoint(event);
    const handles = [
      { name: "bendStart", point: frame.point(source.mesh.bendStart) },
      { name: "bendEnd", point: frame.point(source.mesh.bendEnd) },
    ];
    const closest = handles.sort((left, right) =>
      Math.hypot(point.x - left.point.x, point.y - left.point.y)
      - Math.hypot(point.x - right.point.x, point.y - right.point.y))[0];
    if (Math.hypot(point.x - closest.point.x, point.y - closest.point.y) > 18) return;
    state.meshHandleDragging = { name: closest.name, frame, before: historySnapshot() };
    wristMeshCanvas.setPointerCapture(event.pointerId);
  }

  function handleMeshPointerMove(event) {
    if (!state.meshHandleDragging) return;
    const source = sourceWristLayer();
    if (!source?.mesh) return;
    const next = state.meshHandleDragging.frame.normalized(meshEditorPoint(event));
    const otherName = state.meshHandleDragging.name === "bendStart" ? "bendEnd" : "bendStart";
    const other = source.mesh[otherName];
    if (Math.hypot(next.x - other.x, next.y - other.y) < 0.05) return;
    source.mesh[state.meshHandleDragging.name] = {
      x: Number(next.x.toFixed(4)),
      y: Number(next.y.toFixed(4)),
    };
    resolveRig();
    markDirty();
    render();
  }

  function handleMeshPointerUp(event) {
    if (!state.meshHandleDragging) return;
    const { before } = state.meshHandleDragging;
    state.meshHandleDragging = null;
    if (wristMeshCanvas.hasPointerCapture(event.pointerId)) wristMeshCanvas.releasePointerCapture(event.pointerId);
    commitHistory(before);
  }

  function resetUnsavedWristMesh() {
    const source = sourceWristLayer();
    const saved = state.savedScene?.layers.find((layer) => layer.id === source?.id);
    if (!source?.mesh || !saved?.mesh) return;
    const before = historySnapshot();
    source.mesh = copy(saved.mesh);
    resolveRig();
    markDirty(JSON.stringify(state.scene) !== JSON.stringify(state.savedScene));
    commitHistory(before);
    render();
  }

  function setFingerPathTool(tool) {
    state.fingerPathTool = tool;
    for (const candidate of ["pen", "edit"]) {
      const button = $(candidate === "pen" ? "fingerPenTool" : "fingerEditTool");
      const active = candidate === tool;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    fingerPathCanvas.style.cursor = tool === "pen" ? "crosshair" : "default";
    renderFingerPathEditor();
  }

  function fingerEditorPoint(event) {
    const bounds = fingerPathCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * fingerPathCanvas.width / bounds.width,
      y: (event.clientY - bounds.top) * fingerPathCanvas.height / bounds.height,
    };
  }

  function closestFingerPathPart(path, frame, point) {
    const selected = path?.nodes?.[state.selectedFingerNode];
    if (selected) {
      for (const handle of ["in", "out"]) {
        if (!selected[handle]) continue;
        const target = frame.point(selected[handle]);
        if (Math.hypot(point.x - target.x, point.y - target.y) <= 10) {
          return { kind: "handle", index: state.selectedFingerNode, handle };
        }
      }
    }
    let closest = null;
    for (const [index, node] of (path?.nodes ?? []).entries()) {
      const target = frame.point(node);
      const distance = Math.hypot(point.x - target.x, point.y - target.y);
      if (!closest || distance < closest.distance) closest = { kind: "anchor", index, distance };
    }
    return closest?.distance <= 12 ? closest : null;
  }

  function handleFingerPathPointerDown(event) {
    const layer = state.rig.layers.find((candidate) => candidate.id === "handClosedLIndex");
    const image = layer ? imageFor(layer) : null;
    if (!image) return;
    const frame = fingerEditorGeometry(image);
    const point = fingerEditorPoint(event);
    let path = fingerPath();
    const before = historySnapshot();

    if (state.fingerPathTool === "pen") {
      if (path?.closed) return;
      if (!path) path = { type: "bezierPathV1", closed: false, nodes: [] };
      const first = path.nodes[0] ? frame.point(path.nodes[0]) : null;
      if (first && path.nodes.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= 12) {
        path.closed = true;
        state.selectedFingerNode = 0;
        setSharedFingerPath(path);
        markDirty();
        commitHistory(before);
        setFingerPathTool("edit");
        render();
        return;
      }
      const anchor = frame.normalized(point);
      path.nodes.push({ x: Number(anchor.x.toFixed(4)), y: Number(anchor.y.toFixed(4)) });
      state.selectedFingerNode = path.nodes.length - 1;
      setSharedFingerPath(path);
      state.fingerPathDragging = {
        kind: "new", index: state.selectedFingerNode, frame, before,
        anchor: copy(path.nodes[state.selectedFingerNode]),
      };
      markDirty();
    } else {
      const hit = closestFingerPathPart(path, frame, point);
      if (!hit) { state.selectedFingerNode = null; renderFingerPathEditor(); return; }
      state.selectedFingerNode = hit.index;
      state.fingerPathDragging = {
        ...hit, frame, before,
        start: frame.unbounded(point),
        original: copy(path.nodes[hit.index]),
      };
    }
    fingerPathCanvas.setPointerCapture(event.pointerId);
    render();
  }

  function handleFingerPathPointerMove(event) {
    const dragging = state.fingerPathDragging;
    const path = fingerPath();
    const node = path?.nodes?.[dragging?.index];
    if (!dragging || !node) return;
    const point = dragging.frame.unbounded(fingerEditorPoint(event));
    if (dragging.kind === "new") {
      const dx = point.x - dragging.anchor.x;
      const dy = point.y - dragging.anchor.y;
      if (Math.hypot(dx * dragging.frame.width, dy * dragging.frame.height) >= 3) {
        node.out = { x: Number(point.x.toFixed(4)), y: Number(point.y.toFixed(4)) };
        node.in = {
          x: Number((dragging.anchor.x - dx).toFixed(4)),
          y: Number((dragging.anchor.y - dy).toFixed(4)),
        };
      }
    } else if (dragging.kind === "anchor") {
      const x = Math.max(0, Math.min(1, dragging.original.x + point.x - dragging.start.x));
      const y = Math.max(0, Math.min(1, dragging.original.y + point.y - dragging.start.y));
      const dx = x - dragging.original.x;
      const dy = y - dragging.original.y;
      Object.assign(node, { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) });
      for (const handle of ["in", "out"]) {
        if (dragging.original[handle]) node[handle] = {
          x: Number((dragging.original[handle].x + dx).toFixed(4)),
          y: Number((dragging.original[handle].y + dy).toFixed(4)),
        };
      }
    } else {
      node[dragging.handle] = { x: Number(point.x.toFixed(4)), y: Number(point.y.toFixed(4)) };
      if (!event.altKey) {
        const opposite = dragging.handle === "in" ? "out" : "in";
        node[opposite] = {
          x: Number((node.x * 2 - point.x).toFixed(4)),
          y: Number((node.y * 2 - point.y).toFixed(4)),
        };
      }
    }
    setSharedFingerPath(path);
    markDirty();
    render();
  }

  function handleFingerPathPointerUp(event) {
    if (!state.fingerPathDragging) return;
    const { before } = state.fingerPathDragging;
    state.fingerPathDragging = null;
    if (fingerPathCanvas.hasPointerCapture(event.pointerId)) fingerPathCanvas.releasePointerCapture(event.pointerId);
    commitHistory(before);
    render();
  }

  function closeFingerPath() {
    const path = fingerPath();
    if (!path || path.nodes.length < 3 || path.closed) return;
    const before = historySnapshot();
    path.closed = true;
    setSharedFingerPath(path);
    state.selectedFingerNode = 0;
    markDirty();
    commitHistory(before);
    setFingerPathTool("edit");
    render();
  }

  function deleteSelectedFingerNode() {
    const path = fingerPath();
    if (!path || state.selectedFingerNode == null) return;
    const before = historySnapshot();
    path.nodes.splice(state.selectedFingerNode, 1);
    if (path.nodes.length < 3) path.closed = false;
    state.selectedFingerNode = path.nodes.length ? Math.min(state.selectedFingerNode, path.nodes.length - 1) : null;
    setSharedFingerPath(path.nodes.length ? path : null);
    markDirty();
    commitHistory(before);
    render();
  }

  function undoFingerPoint() {
    const path = fingerPath();
    if (!path?.nodes?.length) return;
    const before = historySnapshot();
    path.nodes.pop();
    if (path.nodes.length < 3) path.closed = false;
    state.selectedFingerNode = path.nodes.length ? path.nodes.length - 1 : null;
    setSharedFingerPath(path.nodes.length ? path : null);
    markDirty();
    commitHistory(before);
    render();
  }

  function trackRangeHistory(input) {
    const begin = () => { if (!input._historyBefore) input._historyBefore = historySnapshot(); };
    const finish = () => {
      if (!input._historyBefore) return;
      commitHistory(input._historyBefore);
      input._historyBefore = null;
    };
    input.addEventListener("pointerdown", begin);
    input.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) begin();
    });
    input.addEventListener("change", finish);
    input.addEventListener("blur", finish);
    input.addEventListener("numeric-control-begin", begin);
    input.addEventListener("numeric-control-end", finish);
  }

  function bindEvents() {
    $("equipMenuButton").addEventListener("click", () => {
      const open = $("equipMenuButton").getAttribute("aria-expanded") !== "true";
      closeControlMenus();
      setControlMenuOpen("equipMenuButton", "equipMenu", open);
    });
    $("animationPickerButton").addEventListener("click", () => {
      openAnimationModal();
    });
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
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".menu-control")) closeControlMenus();
    });
    $("profileSelect").addEventListener("change", async () => { state.profile = $("profileSelect").value; await loadProfileImages(); render(); });
    for (const slot of HELD_SLOTS.filter(({ select }) => select)) {
      $(slot.select).addEventListener("change", async () => {
        state.held[slot.layer] = $(slot.select).value;
        await loadProfileImages();
        markDirty();
        render();
      });
    }
    $("mainHandSelect").addEventListener("change", async () => {
      const [layer, ...itemParts] = $("mainHandSelect").value.split(":");
      if (!["weapon", "staff"].includes(layer)) return;
      state.mainHand = layer;
      state.held[layer] = itemParts.join(":");
      state.selectedLayer = layer;
      if (layer === "staff" && !state.animation.startsWith("staff")) selectAnimation("staffIdle");
      if (layer === "weapon" && state.animation.startsWith("staff")) selectAnimation("idle");
      await loadProfileImages();
      selectMode("layer");
      markDirty();
      render();
    });
    $("clipScopedEdits").addEventListener("change", () => {
      const before = historySnapshot();
      if (!state.clipScopedEdits && Object.keys(state.manualPose).length) {
        bakePoseIntoProfile(state.scene, state.profile, state.manualPose);
        state.manualPose = {};
        resolveRig();
      }
      state.clipScopedEdits = $("clipScopedEdits").checked;
      setStatus(state.clipScopedEdits
        ? `Bone moves create keys in ${animationLabel(state.animation)} at the playhead`
        : "Shared bind editing active: bone moves affect every animation");
      syncInspector();
      commitHistory(before);
      render();
    });
    $("necklaceSelect").addEventListener("change", async () => {
      state.necklace = $("necklaceSelect").value;
      await loadProfileImages();
      markDirty();
      render();
    });
    $("chestSelect").addEventListener("change", async () => {
      state.chest = $("chestSelect").value;
      await loadProfileImages();
      markDirty();
      render();
    });
    $("armSetSelect").addEventListener("change", async () => {
      state.armSet = $("armSetSelect").value;
      await loadProfileImages();
      markDirty();
      render();
    });
    $("bootSetSelect").addEventListener("change", async () => {
      state.bootSet = $("bootSetSelect").value;
      await loadProfileImages();
      markDirty();
      render();
    });
    $("headgearSelect").addEventListener("change", async () => {
      state.headgear = $("headgearSelect").value;
      const helmet = sceneLayer(HEADGEAR_LAYER_ID);
      if (helmet) helmet.visible = true;
      await loadProfileImages();
      if (helmet) {
        state.selectedLayer = HEADGEAR_LAYER_ID;
        syncHeadgearToggle();
        selectMode("layer");
      }
      markDirty(); render();
    });
    $("headgearToggle").addEventListener("change", () => {
      const helmet = sceneLayer(HEADGEAR_LAYER_ID);
      if (!helmet) return;
      const before = historySnapshot();
      helmet.visible = $("headgearToggle").checked;
      resolveRig();
      if (helmet.visible) {
        state.selectedLayer = HEADGEAR_LAYER_ID;
        selectMode("layer");
      } else if (state.selectedLayer === HEADGEAR_LAYER_ID) {
        state.selectedLayer = null;
      }
      markDirty(); buildLayerList(); syncInspector(); render(); commitHistory(before);
    });
    $("handPoseSelect").addEventListener("change", () => {
      state.handPose = $("handPoseSelect").value;
      state.wristPreviewActive = false;
      const layer = selectedLayer();
      if (layer && !layerMatchesHandPose(layer)) state.selectedLayer = null;
      buildLayerList(); syncInspector(); render();
    });
    $("playPause").addEventListener("click", togglePlayback);
    $("resetPose").addEventListener("click", () => { const before = historySnapshot(); state.manualPose = {}; state.phase = 0; state.wristPreviewActive = false; syncInspector(); render(); commitHistory(before); });
    $("saveScene").addEventListener("click", saveScene); $("reloadScene").addEventListener("click", reloadScene); $("exportPng").addEventListener("click", exportPNG);
    $("undoEdit").addEventListener("click", undoEdit); $("redoEdit").addEventListener("click", redoEdit);
    $("modeLayer").addEventListener("click", () => selectMode("layer")); $("modeBone").addEventListener("click", () => selectMode("bone"));
    for (const id of ["showBones", "showNames", "showReference", "showGrid", "showMesh", "dimUnselected", "hideControlsDuringPlayback"]) $(id).addEventListener("change", render);
    $("wristSideSelect").addEventListener("change", () => {
      state.wristSide = $("wristSideSelect").value;
      state.wristPreviewActive = false;
      state.selectedBone = `hand${state.wristSide}`;
      state.selectedLayer = activeWristLayer()?.id ?? null;
      syncInspector(); buildLayerList(); render();
    });
    $("wristAngle").addEventListener("input", () => {
      pause();
      state.wristAngle = Number($("wristAngle").value);
      state.wristPreviewActive = true;
      $("wristAngleValue").value = `${state.wristAngle}°`;
      ensureHandKeyAtPlayhead("wristAngle");
      render();
    });
    $("gripRotation").addEventListener("input", () => {
      pause();
      state.gripRotation = Number($("gripRotation").value);
      state.wristPreviewActive = true;
      $("gripRotationValue").value = `${state.gripRotation}°`;
      ensureHandKeyAtPlayhead("gripRotation");
      render();
    });
    $("fingerAxis").addEventListener("input", () => {
      pause();
      setKnuckleAxisUI(Number($("fingerAxis").value));
      state.wristPreviewActive = true;
      ensureHandKeyAtPlayhead("knuckleAxis");
      render();
    });
    $("fingerAngle").addEventListener("input", () => {
      pause();
      setSelectedFingerAnimationAngle(Number($("fingerAngle").value));
      state.wristPreviewActive = true;
      ensureHandKeyAtPlayhead("fingerAngle");
      render();
    });
    trackRangeHistory($("wristAngle"));
    trackRangeHistory($("gripRotation"));
    trackRangeHistory($("fingerAxis"));
    trackRangeHistory($("fingerAngle"));
    $("setWristKey").addEventListener("click", setCurrentWristKey);
    $("deleteWristKey").addEventListener("click", deleteCurrentWristKey);
    $("copyHandChannelThroughKeys").addEventListener("click", copyHandChannelThroughKeys);
    $("previousWristKey").addEventListener("click", () => jumpToWristKey(-1));
    $("nextWristKey").addEventListener("click", () => jumpToWristKey(1));
    $("setBoneKey").addEventListener("click", setCurrentBoneKey);
    $("deleteBoneKey").addEventListener("click", deleteCurrentBoneKey);
    $("previousBoneKey").addEventListener("click", () => jumpToBoneKey(-1));
    $("nextBoneKey").addEventListener("click", () => jumpToBoneKey(1));
    $("straightenWrist").addEventListener("click", () => {
      pause();
      setWristAngleUI(0);
      state.wristPreviewActive = true;
      ensureHandKeyAtPlayhead("wristAngle");
      render();
    });
    $("meshSections").addEventListener("change", () => changeMeshDensity(Number($("meshSections").value)));
    $("resetWristMesh").addEventListener("click", resetUnsavedWristMesh);
    wristMeshCanvas.addEventListener("pointerdown", handleMeshPointerDown);
    wristMeshCanvas.addEventListener("pointermove", handleMeshPointerMove);
    wristMeshCanvas.addEventListener("pointerup", handleMeshPointerUp);
    wristMeshCanvas.addEventListener("pointercancel", handleMeshPointerUp);
    $("fingerPenTool").addEventListener("click", () => setFingerPathTool("pen"));
    $("fingerEditTool").addEventListener("click", () => setFingerPathTool("edit"));
    $("newFingerPath").addEventListener("click", () => {
      const before = historySnapshot();
      setSharedFingerPath({ type: "bezierPathV1", closed: false, nodes: [] });
      state.selectedFingerNode = null;
      markDirty();
      commitHistory(before);
      setFingerPathTool("pen");
      render();
    });
    $("closeFingerPath").addEventListener("click", closeFingerPath);
    $("deleteFingerNode").addEventListener("click", deleteSelectedFingerNode);
    $("undoFingerPoint").addEventListener("click", undoFingerPoint);
    $("resetFingerPath").addEventListener("click", () => {
      if (!fingerPath()) return;
      const before = historySnapshot();
      setSharedFingerPath(null);
      state.selectedFingerNode = null;
      markDirty();
      commitHistory(before);
      setFingerPathTool("pen");
      render();
    });
    fingerPathCanvas.addEventListener("pointerdown", handleFingerPathPointerDown);
    fingerPathCanvas.addEventListener("pointermove", handleFingerPathPointerMove);
    fingerPathCanvas.addEventListener("pointerup", handleFingerPathPointerUp);
    fingerPathCanvas.addEventListener("pointercancel", handleFingerPathPointerUp);
    $("fingerAnchorSelect").addEventListener("click", (event) => {
      const button = event.target.closest("[data-finger-target]");
      if (button) selectGripFinger(button.dataset.fingerTarget);
    });
    for (const [id, field] of [
      ["fingerAlong", "along"], ["fingerAcross", "across"],
      ["fingerPivotX", "pivotX"], ["fingerPivotY", "pivotY"],
    ]) {
      $(id).addEventListener("input", () => setSelectedFingerAnchor(field, Number($(id).value)));
      trackRangeHistory($(id));
    }
    for (const [id, field] of [["fingerScaleX", "scaleX"], ["fingerScaleY", "scaleY"]]) {
      $(id).addEventListener("input", () => setSelectedFingerScale(field, Number($(id).value)));
      trackRangeHistory($(id));
    }
    $("resetFingerAnchor").addEventListener("click", () => {
      const sources = selectedGripFingerLayers();
      if (!sources.length) return;
      const before = historySnapshot();
      for (const source of sources) {
        const saved = state.savedScene?.layers.find((layer) => layer.id === source.id);
        if (!saved?.gripFinger) continue;
        source.gripFinger = copy(saved.gripFinger);
        for (const profile of ["maleV1", "femaleV1"]) {
          source.bindByProfile[profile].scaleX = saved.bindByProfile[profile].scaleX;
          source.bindByProfile[profile].scaleY = saved.bindByProfile[profile].scaleY;
        }
        const resolved = state.rig.layers.find((layer) => layer.id === source.id);
        if (resolved) {
          resolved.gripFinger = copy(saved.gripFinger);
          resolved.scaleX = saved.bindByProfile[state.profile].scaleX;
          resolved.scaleY = saved.bindByProfile[state.profile].scaleY;
        }
        state.fingerOffsets[source.id] = { along: 0, across: 0 };
      }
      state.wristPreviewActive = true;
      const updatedKey = updateEstablishedHandKey("fingerOffsets");
      if (!updatedKey) markDirty(JSON.stringify(state.scene) !== JSON.stringify(state.savedScene));
      commitHistory(before);
      render();
    });
    $("zoom").addEventListener("input", () => { const value = Number($("zoom").value); $("zoomValue").value = `${value}%`; $("canvasWrap").style.setProperty("--canvas-scale", String(value / 100)); });
    $("stage").addEventListener("wheel", (event) => { if (!event.metaKey && !event.ctrlKey) return; event.preventDefault(); const next = Math.max(35, Math.min(110, Number($("zoom").value) + (event.deltaY < 0 ? 5 : -5))); $("zoom").value = String(next); $("zoom").dispatchEvent(new Event("input")); }, { passive: false });
    $("timeline").addEventListener("input", () => { pause(); state.phase = Number($("timeline").value) / 1000; state.wristPreviewActive = false; render(); });
    $("speedSelect").addEventListener("change", () => { state.speed = Number($("speedSelect").value); });
    $("layerSearch").addEventListener("input", buildLayerList);
    $("resetLayer").addEventListener("click", resetSelectedLayer);
    $("resetBone").addEventListener("click", () => {
      if (state.clipScopedEdits) {
        deleteCurrentBoneKey();
        return;
      }
      const bone = selectedBone();
      const saved = state.savedScene?.bones.find((candidate) => candidate.id === bone?.id);
      const savedBind = saved?.bindByProfile?.[state.profile];
      if (!bone || !savedBind) return;
      const before = historySnapshot();
      Object.assign(sceneBone(bone.id).bindByProfile[state.profile], copy(savedBind));
      delete state.manualPose[bone.id];
      resolveRig(); markDirty(JSON.stringify(state.scene) !== JSON.stringify(state.savedScene)); syncInspector(); render(); commitHistory(before);
    });
    canvas.addEventListener("pointerdown", handlePointerDown); canvas.addEventListener("pointermove", handlePointerMove); canvas.addEventListener("pointerup", handlePointerUp); canvas.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { closeControlMenus(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
        if (event.shiftKey) redoEdit(); else undoEdit();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
      if (event.key.toLowerCase() === "b") selectMode("bone");
      if (event.key.toLowerCase() === "l") selectMode("layer");
    });
    bindLayerInputs();
  }

  function frame(timestamp) {
    const elapsed = Math.min(0.05, (timestamp - state.lastTimestamp) / 1000); state.lastTimestamp = timestamp;
    if (state.playing && state.scene) { state.phase = (state.phase + elapsed * state.speed / animationDurations[state.animation]) % 1; render(); }
    if ($("animationModal").open && timestamp - state.lastAnimationPreviewTimestamp >= 1000 / 18) {
      state.lastAnimationPreviewTimestamp = timestamp;
      renderAnimationPreviews(timestamp);
    }
    requestAnimationFrame(frame);
  }

  async function initialize() {
    enhanceNumericControls(); bindEvents(); resetHistory(); buildAnimationOptions(); $("clipScopedEdits").checked = state.clipScopedEdits; $("zoom").dispatchEvent(new Event("input"));
    try {
      state.expressionCatalog = await responseJSON(await fetch("/assets/facial-expression-assets-v1.json"));
      for (const name of eyeExpressionNames) {
        const option = document.createElement("option"); option.value = name; option.textContent = animationLabel(name); $("expressionEyes").append(option);
      }
      for (const name of mouthExpressionNames) {
        const option = document.createElement("option"); option.value = name; option.textContent = animationLabel(name); $("expressionMouth").append(option);
      }
      state.scene = await sceneResponse(await fetch("/api/scene")); state.savedScene = copy(state.scene); state.profile = state.scene.activeProfile; state.chest = state.scene.activeChest; state.armSet = state.scene.activeArmSet; state.bootSet = state.scene.activeBootSet; state.headgear = state.scene.activeHeadgear; state.necklace = state.scene.activeNecklace; $("profileSelect").value = state.profile;
      const parameters = new URLSearchParams(location.search);
      if (["maleV1", "femaleV1"].includes(parameters.get("profile"))) state.profile = parameters.get("profile");
      if (state.scene.chestOptions.some((option) => option.id === parameters.get("chest"))) state.chest = parameters.get("chest");
      if (state.scene.armOptions.some((option) => option.id === parameters.get("arms"))) state.armSet = parameters.get("arms");
      if (state.scene.bootOptions.some((option) => option.id === parameters.get("boots"))) state.bootSet = parameters.get("boots");
      if (state.scene.headgearOptions.some((option) => option.id === parameters.get("headgear"))) state.headgear = parameters.get("headgear");
      if (animationNames.includes(parameters.get("animation"))) state.animation = parameters.get("animation");
      state.mainHand = state.animation.startsWith("staff") ? "staff" : "weapon";
      state.handPose = handPoseNames.includes(parameters.get("hands"))
        ? parameters.get("hands")
        : animationHandPose[state.animation];
      if (parameters.has("phase")) state.phase = Math.max(0, Math.min(1, Number(parameters.get("phase")) || 0));
      if (["L", "R"].includes(parameters.get("wrist"))) state.wristSide = parameters.get("wrist");
      const urlRequestsPausedPreview = parameters.get("play") === "0";
      if (urlRequestsPausedPreview) pause();
      if (parameters.has("wristAngle") && urlRequestsPausedPreview) {
        state.wristAngle = Math.max(-85, Math.min(85, Number(parameters.get("wristAngle")) || 0));
        state.wristPreviewActive = true;
      }
      if (parameters.has("wristAngle") && !urlRequestsPausedPreview) clearWristPreviewQuery();
      if (parameters.get("mesh") === "1") $("showMesh").checked = true;
      $("wristSideSelect").value = state.wristSide; $("wristAngle").value = String(state.wristAngle); $("wristAngleValue").value = `${state.wristAngle}°`;
      $("profileSelect").value = state.profile; buildChestOptions(); buildArmOptions(); buildBootOptions(); buildHeadgearOptions(); buildNecklaceOptions(); syncHeldFromScene();
      if (state.scene.staffOptions.some((option) => option.id === parameters.get("staff"))) {
        state.held.staff = parameters.get("staff");
      }
      if (["weapon", "staff"].includes(parameters.get("mainHand"))) {
        state.mainHand = parameters.get("mainHand");
      }
      buildHeldOptions(); $("handPoseSelect").value = state.handPose; syncAnimationPicker();
      await loadProfileImages(); $("attachmentCount").textContent = String(state.rig.layers.length); buildLayerList(); syncInspector(); markDirty(false); render(); requestAnimationFrame(frame);
    } catch (error) { setStatus(error.message); }
  }

  initialize();
})();
