const profiles = ["maleV1", "femaleV1"];
const eyeExpressions = new Set(["neutral", "blink", "wide", "focused", "wince"]);
const mouthExpressions = new Set(["neutral", "smile", "smirk", "shout", "surprised", "frown", "pain", "grit", "talk"]);
const armLayerIDs = ["upperArmArmorL", "forearmVambraceL", "upperArmArmorR", "forearmVambraceR"];
const bootLayerIDs = ["lowerLegL", "footL", "lowerLegR", "footR"];
const requiredEquipmentLayers = new Map([
  ["quiver", "chest"],
  ["weapon", "handL"],
  ["staff", "handL"],
  ["shield", "handR"],
  ["bow", "handL"],
]);

const universalHandAssetByID = {
  handOpenL: "Layers/ArmUnits/universalV1/handOpenL.png",
  handOpenR: "Layers/ArmUnits/universalV1/handOpenR.png",
  handClosedL: "Layers/ArmUnits/universalV1/handGripPalmBaseV2.png",
  handClosedLIndex: "Layers/ArmUnits/universalV1/handGripFingerTriangleV1.png",
  handClosedLMiddle: "Layers/ArmUnits/universalV1/handGripFingerTriangleV1.png",
  handClosedLRing: "Layers/ArmUnits/universalV1/handGripFingerTriangleV1.png",
  handClosedLPinky: "Layers/ArmUnits/universalV1/handGripFingerTriangleV1.png",
  handClosedLThumb: "Layers/ArmUnits/universalV1/handGripThumbFrontV2.png",
  handClosedR: "Layers/ArmUnits/universalV1/handClosedDorsalV3.png",
};

/**
 * Slots whose placement is one value for the whole cast rather than per body.
 *
 * The hands are universal art. Equipment is universal for a different reason:
 * it is pivoted on its own grip anchor and parented to a hand bone, so its
 * placement is expressed against the hand and nothing about it depends on how
 * tall or broad the body underneath is. Sharing the bind means the hilt only
 * has to be dialled in once -- tune it in either profile and the other follows
 * on the next load, instead of one body silently keeping the unplaced defaults.
 */
const universalBindLayerIDs = new Set([
  ...Object.keys(universalHandAssetByID),
  "weapon",
  "staff",
  "shield",
  "bow",
]);

function normalizeUniversalSlots(scene) {
  for (const layer of scene.layers) {
    const asset = universalHandAssetByID[layer.id];
    if (asset) layer.assetByProfile = { maleV1: asset, femaleV1: asset };
    if (!universalBindLayerIDs.has(layer.id)) continue;
    const sharedBind = structuredClone(layer.bindByProfile[scene.activeProfile]);
    layer.bindByProfile = {
      maleV1: structuredClone(sharedBind),
      femaleV1: structuredClone(sharedBind),
    };
  }
  return scene;
}

function finite(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return Math.round(value * 10000) / 10000;
}

function string(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function safeAsset(value, label) {
  const asset = string(value, label);
  if (asset.startsWith("/") || asset.includes("..") || !asset.endsWith(".png")) {
    throw new Error(`${label} must be a relative PNG path`);
  }
  return asset;
}

/**
 * Placement an option carries on top of its art. Items in a slot are not always
 * registered to a common anchor -- the necklaces put their cord anywhere across
 * their shared canvas -- so an option may bring its own bind. Art authored
 * against a slot's registration omits this and inherits the layer's placement.
 */
function optionBind(value, label) {
  if (value == null) return undefined;
  if (typeof value !== "object") throw new Error(`${label} must be an object`);
  const bind = {};
  for (const profile of profiles) {
    if (value[profile] == null) continue;
    bind[profile] = layerBind(value[profile], `${label}.${profile}`);
  }
  return Object.keys(bind).length ? bind : undefined;
}

/**
 * The inventory item that grants this option, kept through validation. It is
 * what lets the rig dress itself from equipped gear, and rebuilding an option
 * without it silently unlinks the whole catalogue on the next save.
 */
/**
 * Where an option sits when no inventory item speaks for it. The bare arms and
 * the default tunic are looks rather than gear, but they still belong on the
 * ladder, so they can be filed by hand.
 */
function withPlacementOnLadder(option, value, label) {
  if (value.line != null) option.line = string(value.line, `${label}.line`);
  if (value.tier != null) option.tier = string(value.tier, `${label}.tier`);
  return option;
}

function withItemID(option, value, label) {
  withPlacementOnLadder(option, value, label);
  // Whether this piece has been fitted over the rig by hand. Placement alone
  // cannot say: a seeded default and a dialled-in fit look the same in the
  // data, so the person who did the fitting records it.
  if (value.fitted === true) option.fitted = true;
  if (value.itemID == null) return option;
  option.itemID = string(value.itemID, `${label}.itemID`);
  return option;
}

function withOptionBind(option, value, label) {
  const bind = optionBind(value.bindByProfile, `${label}.bindByProfile`);
  if (bind) option.bindByProfile = bind;
  // A set dresses several layers at once -- four boot pieces, four arm pieces --
  // so its placement is per layer as well as per profile. Without this a boot
  // set shares the leg layers' binds with every other set, and tuning one pair
  // moves them all.
  if (value.bindByLayer != null) {
    if (typeof value.bindByLayer !== "object") throw new Error(`${label}.bindByLayer must be an object`);
    const byLayer = {};
    for (const [layerID, perProfile] of Object.entries(value.bindByLayer)) {
      const resolved = optionBind(perProfile, `${label}.bindByLayer.${layerID}`);
      if (resolved) byLayer[layerID] = resolved;
    }
    if (Object.keys(byLayer).length) option.bindByLayer = byLayer;
  }
  return withItemID(option, value, label);
}

function necklaceOption(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const option = {
    id: string(value.id, `${label}.id`),
    label: string(value.label, `${label}.label`),
    assetByProfile: {},
  };
  for (const profile of profiles) {
    option.assetByProfile[profile] = safeAsset(value.assetByProfile?.[profile], `${label}.assetByProfile.${profile}`);
  }
  return withOptionBind(option, value, label);
}

function chestOption(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const option = {
    id: string(value.id, `${label}.id`),
    label: string(value.label, `${label}.label`),
    assetByProfile: {},
  };
  for (const profile of profiles) {
    option.assetByProfile[profile] = safeAsset(value.assetByProfile?.[profile], `${label}.assetByProfile.${profile}`);
  }
  return withOptionBind(option, value, label);
}

function armOption(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const option = {
    id: string(value.id, `${label}.id`),
    label: string(value.label, `${label}.label`),
    assetByLayer: {},
  };
  for (const layerID of armLayerIDs) {
    option.assetByLayer[layerID] = safeAsset(value.assetByLayer?.[layerID], `${label}.assetByLayer.${layerID}`);
  }
  return withOptionBind(option, value, label);
}

function bootOption(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const option = {
    id: string(value.id, `${label}.id`),
    label: string(value.label, `${label}.label`),
    assetByLayer: {},
  };
  for (const layerID of bootLayerIDs) {
    option.assetByLayer[layerID] = safeAsset(value.assetByLayer?.[layerID], `${label}.assetByLayer.${layerID}`);
  }
  return withOptionBind(option, value, label);
}

function headgearOption(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const option = {
    id: string(value.id, `${label}.id`),
    label: string(value.label, `${label}.label`),
    assetByProfile: {},
  };
  for (const profile of profiles) {
    option.assetByProfile[profile] = safeAsset(value.assetByProfile?.[profile], `${label}.assetByProfile.${profile}`);
  }
  return withOptionBind(option, value, label);
}

function boneBind(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const bind = {
    x: finite(value.x, `${label}.x`, -2000, 2000),
    y: finite(value.y, `${label}.y`, -2000, 2000),
    rotation: finite(value.rotation ?? 0, `${label}.rotation`, -180, 180),
    scaleX: finite(value.scaleX ?? 1, `${label}.scaleX`, 0.05, 8),
    scaleY: finite(value.scaleY ?? 1, `${label}.scaleY`, 0.05, 8),
  };
  return bind;
}

function layerBind(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const bind = {
    x: finite(value.x, `${label}.x`, -2000, 2000),
    y: finite(value.y, `${label}.y`, -2000, 2000),
    rotation: finite(value.rotation, `${label}.rotation`, -3600, 3600),
    scaleX: finite(value.scaleX, `${label}.scaleX`, -8, 8),
    scaleY: finite(value.scaleY, `${label}.scaleY`, -8, 8),
    pivotX: finite(value.pivotX, `${label}.pivotX`, -2, 2),
    pivotY: finite(value.pivotY, `${label}.pivotY`, -2, 2),
  };
  // Turning the attachment's plane away from camera. Optional: a layer painted
  // for a flat presentation simply leaves it out.
  if (value.planeYaw != null) bind.planeYaw = finite(value.planeYaw, `${label}.planeYaw`, -80, 80);
  if (Math.abs(bind.scaleX) < 0.01 || Math.abs(bind.scaleY) < 0.01) throw new Error(`${label} scale cannot be zero`);
  return bind;
}

function normalizedSequence(value, label) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 16) {
    throw new Error(`${label} must contain 2 to 16 normalized values`);
  }
  const sequence = value.map((entry, index) => finite(entry, `${label}[${index}]`, 0, 1));
  if (sequence[0] !== 0 || sequence.at(-1) !== 1) throw new Error(`${label} must begin at 0 and end at 1`);
  for (let index = 1; index < sequence.length; index += 1) {
    if (sequence[index] <= sequence[index - 1]) throw new Error(`${label} must be strictly increasing`);
  }
  return sequence;
}

function normalizedPoint(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} must be a normalized point`);
  return {
    x: finite(value.x, `${label}.x`, 0, 1),
    y: finite(value.y, `${label}.y`, 0, 1),
  };
}

function bezierControlPoint(value, label) {
  if (value == null) return undefined;
  if (!value || typeof value !== "object") throw new Error(`${label} must be a point`);
  return {
    // Handles may leave the image while an artist is shaping a tight curve.
    x: finite(value.x, `${label}.x`, -2, 3),
    y: finite(value.y, `${label}.y`, -2, 3),
  };
}

function fingerClipPath(value, label, layer) {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || !/^handClosedL(?:Index|Middle|Ring|Pinky)$/.test(layer.id)) {
    throw new Error(`${label} is supported only on a closed left-hand finger attachment`);
  }
  if (value.type !== "bezierPathV1") throw new Error(`${label}.type must be bezierPathV1`);
  if (!Array.isArray(value.nodes) || value.nodes.length > 64) {
    throw new Error(`${label}.nodes must contain at most 64 anchors`);
  }
  const nodes = value.nodes.map((node, index) => {
    const anchor = normalizedPoint(node, `${label}.nodes[${index}]`);
    const incoming = bezierControlPoint(node.in, `${label}.nodes[${index}].in`);
    const outgoing = bezierControlPoint(node.out, `${label}.nodes[${index}].out`);
    return {
      ...anchor,
      ...(incoming ? { in: incoming } : {}),
      ...(outgoing ? { out: outgoing } : {}),
    };
  });
  const closed = Boolean(value.closed);
  if (closed && nodes.length < 3) throw new Error(`${label} needs at least 3 anchors before it can close`);
  return { type: "bezierPathV1", closed, nodes };
}

function weightedMesh(value, label, layer, boneIDs, parentByBone) {
  if (value == null) return undefined;
  if (!value || typeof value !== "object") {
    throw new Error(`${label}.type must be weightedStripV2`);
  }
  if (value.type !== "weightedStripV2") {
    throw new Error(`${label}.type must be weightedStripV2`);
  }
  if (!/^hand(?:Open|Closed)[LR]$/.test(layer.id)) {
    throw new Error(`${label} is currently supported only on universal hand layers`);
  }
  const parentBone = string(value.parentBone, `${label}.parentBone`);
  const childBone = string(value.childBone, `${label}.childBone`);
  if (!boneIDs.has(parentBone) || !boneIDs.has(childBone)) throw new Error(`${label} references an unknown bone`);
  if (childBone !== layer.bone || parentByBone.get(childBone) !== parentBone) {
    throw new Error(`${label} must bind the hand layer to its direct forearm parent`);
  }
  const bendStart = normalizedPoint(value.bendStart, `${label}.bendStart`);
  const bendEnd = normalizedPoint(value.bendEnd, `${label}.bendEnd`);
  if (Math.hypot(bendEnd.x - bendStart.x, bendEnd.y - bendStart.y) < 0.05) {
    throw new Error(`${label} bend axis is too short`);
  }
  return {
    type: "weightedStripV2",
    parentBone,
    childBone,
    bendStops: normalizedSequence(value.bendStops, `${label}.bendStops`),
    bendStart,
    bendEnd,
  };
}

function gripFinger(value, label, layer) {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || !/^handClosedL(?:Index|Middle|Ring|Pinky)$/.test(layer.id)) {
    throw new Error(`${label} is supported only on a closed left-hand grip attachment`);
  }
  return {
    along: finite(value.along, `${label}.along`, -200, 200),
    across: finite(value.across, `${label}.across`, -200, 200),
    angleOffset: finite(value.angleOffset, `${label}.angleOffset`, -180, 180),
    basePivot: normalizedPoint(value.basePivot, `${label}.basePivot`),
  };
}

export function validateModularCharacterScene(value) {
  if (!value || value.format !== "modular-character-studio-scene-v1") {
    throw new Error("Unsupported Modular Character Studio scene format");
  }
  if (value.canvas?.width !== 1254 || value.canvas?.height !== 1254) throw new Error("Editor canvas must be 1254 x 1254");
  if (!profiles.includes(value.activeProfile)) throw new Error("Unknown active profile");
  const result = structuredClone(value);
  if (!Array.isArray(result.chestOptions) || result.chestOptions.length < 1 || result.chestOptions.length > 64) {
    throw new Error("chestOptions must contain 1 to 64 entries");
  }
  result.chestOptions = result.chestOptions.map((option, index) => chestOption(option, `chestOptions[${index}]`));
  const chestIDs = new Set(result.chestOptions.map((option) => option.id));
  if (chestIDs.size !== result.chestOptions.length) throw new Error("chestOptions IDs must be unique");
  result.activeChest = string(result.activeChest, "activeChest");
  if (!chestIDs.has(result.activeChest)) throw new Error("activeChest must reference a chest option");
  if (!Array.isArray(result.armOptions) || result.armOptions.length < 1 || result.armOptions.length > 64) {
    throw new Error("armOptions must contain 1 to 64 entries");
  }
  result.armOptions = result.armOptions.map((option, index) => armOption(option, `armOptions[${index}]`));
  const armIDs = new Set(result.armOptions.map((option) => option.id));
  if (armIDs.size !== result.armOptions.length) throw new Error("armOptions IDs must be unique");
  result.activeArmSet = string(result.activeArmSet, "activeArmSet");
  if (!armIDs.has(result.activeArmSet)) throw new Error("activeArmSet must reference an arm option");
  if (!Array.isArray(result.bootOptions) || result.bootOptions.length < 1 || result.bootOptions.length > 64) {
    throw new Error("bootOptions must contain 1 to 64 entries");
  }
  result.bootOptions = result.bootOptions.map((option, index) => bootOption(option, `bootOptions[${index}]`));
  const bootIDs = new Set(result.bootOptions.map((option) => option.id));
  if (bootIDs.size !== result.bootOptions.length) throw new Error("bootOptions IDs must be unique");
  result.activeBootSet = string(result.activeBootSet, "activeBootSet");
  if (!bootIDs.has(result.activeBootSet)) throw new Error("activeBootSet must reference a boot option");
  if (!Array.isArray(result.headgearOptions) || result.headgearOptions.length < 1 || result.headgearOptions.length > 64) {
    throw new Error("headgearOptions must contain 1 to 64 entries");
  }
  result.headgearOptions = result.headgearOptions.map((option, index) => headgearOption(option, `headgearOptions[${index}]`));
  const headgearIDs = new Set(result.headgearOptions.map((option) => option.id));
  if (headgearIDs.size !== result.headgearOptions.length) throw new Error("headgearOptions IDs must be unique");
  result.activeHeadgear = string(result.activeHeadgear, "activeHeadgear");
  if (!headgearIDs.has(result.activeHeadgear)) throw new Error("activeHeadgear must reference a headgear option");
  // Single-layer equipment: held items and the rear quiver use the same option
  // shape as necklaces. Each item may carry art and an independent placement.
  for (const [key, active] of [
    ["weaponOptions", "activeWeapon"],
    ["staffOptions", "activeStaff"],
    ["bowOptions", "activeBow"],
    ["shieldOptions", "activeShield"],
    ["ringOptions", "activeRing"],
    ["quiverOptions", "activeQuiver"],
  ]) {
    if (result[key] == null) continue;
    if (!Array.isArray(result[key]) || result[key].length < 1 || result[key].length > 64) {
      throw new Error(`${key} must contain 1 to 64 entries`);
    }
    result[key] = result[key].map((option, index) => necklaceOption(option, `${key}[${index}]`));
    const ids = new Set(result[key].map((option) => option.id));
    if (ids.size !== result[key].length) throw new Error(`${key} IDs must be unique`);
    result[active] = string(result[active], active);
    if (!ids.has(result[active])) throw new Error(`${active} must reference a ${key} entry`);
  }
  if (result.necklaceOptions != null) {
    if (!Array.isArray(result.necklaceOptions) || result.necklaceOptions.length < 1 || result.necklaceOptions.length > 64) {
      throw new Error("necklaceOptions must contain 1 to 64 entries");
    }
    result.necklaceOptions = result.necklaceOptions.map((option, index) => necklaceOption(option, `necklaceOptions[${index}]`));
    const necklaceIDs = new Set(result.necklaceOptions.map((option) => option.id));
    if (necklaceIDs.size !== result.necklaceOptions.length) throw new Error("necklaceOptions IDs must be unique");
    result.activeNecklace = string(result.activeNecklace, "activeNecklace");
    if (!necklaceIDs.has(result.activeNecklace)) throw new Error("activeNecklace must reference a necklace option");
  }
  for (const profile of profiles) result.referenceByProfile[profile] = safeAsset(result.referenceByProfile?.[profile], `referenceByProfile.${profile}`);
  if (!Array.isArray(result.bones) || result.bones.length < 3 || result.bones.length > 64) throw new Error("bones must contain 3 to 64 entries");
  const boneIDs = new Set();
  const parentByBone = new Map();
  for (const [index, bone] of result.bones.entries()) {
    bone.id = string(bone.id, `bones[${index}].id`);
    if (boneIDs.has(bone.id)) throw new Error(`Duplicate bone ${bone.id}`);
    if (bone.parent !== null && !boneIDs.has(bone.parent)) throw new Error(`Bone ${bone.id} must follow its parent`);
    boneIDs.add(bone.id);
    parentByBone.set(bone.id, bone.parent);
    bone.label = string(bone.label, `bones[${index}].label`);
    // Every profile carries its own bind offsets over the shared skeleton, per
    // the modular character contract.
    for (const profile of profiles) {
      bone.bindByProfile[profile] = boneBind(bone.bindByProfile?.[profile], `bones[${index}].bindByProfile.${profile}`);
    }
    // A fitted bone is seated by the same best-fit transform as a fitted layer,
    // so it can only reference bones already solved above it.
    if (bone.fitBones != null) {
      if (!Array.isArray(bone.fitBones) || bone.fitBones.length < 2 || bone.fitBones.length > 4) {
        throw new Error(`Bone ${bone.id} fitBones must contain 2 to 4 bones`);
      }
      bone.fitBones = bone.fitBones.map((boneID) => string(boneID, `bones[${index}].fitBones`));
      if (new Set(bone.fitBones).size !== bone.fitBones.length
        || bone.fitBones.some((boneID) => boneID === bone.id || !boneIDs.has(boneID))) {
        throw new Error(`Bone ${bone.id} fitBones must reference distinct bones declared above it`);
      }
    }
  }
  if (!Array.isArray(result.layers) || result.layers.length < 1 || result.layers.length > 128) throw new Error("layers must contain 1 to 128 entries");
  const layerIDs = new Set();
  for (const [index, layer] of result.layers.entries()) {
    layer.id = string(layer.id, `layers[${index}].id`);
    if (layerIDs.has(layer.id)) throw new Error(`Duplicate layer ${layer.id}`);
    layerIDs.add(layer.id);
    layer.group = string(layer.group, `layers[${index}].group`);
    if (!boneIDs.has(layer.bone)) throw new Error(`Layer ${layer.id} references unknown bone ${layer.bone}`);
    for (const profile of profiles) {
      layer.assetByProfile[profile] = safeAsset(layer.assetByProfile?.[profile], `layers[${index}].assetByProfile.${profile}`);
      layer.bindByProfile[profile] = layerBind(layer.bindByProfile?.[profile], `layers[${index}].bindByProfile.${profile}`);
    }
    layer.drawOrder = finite(layer.drawOrder, `layers[${index}].drawOrder`, -1000, 1000);
    layer.visible = Boolean(layer.visible);
    layer.mesh = weightedMesh(layer.mesh, `layers[${index}].mesh`, layer, boneIDs, parentByBone);
    if (layer.mesh == null) delete layer.mesh;
    layer.gripFinger = gripFinger(layer.gripFinger, `layers[${index}].gripFinger`, layer);
    if (layer.gripFinger == null) delete layer.gripFinger;
    layer.clipPath = fingerClipPath(layer.clipPath, `layers[${index}].clipPath`, layer);
    if (layer.clipPath == null) delete layer.clipPath;
    if (layer.handState != null && !["open", "closed"].includes(layer.handState)) throw new Error(`Unsupported hand state ${layer.handState}`);
    if (layer.fitBones != null) {
      if (!Array.isArray(layer.fitBones) || layer.fitBones.length < 2 || layer.fitBones.length > 4) {
        throw new Error(`Layer ${layer.id} fitBones must contain 2 to 4 bones`);
      }
      layer.fitBones = layer.fitBones.map((boneID) => string(boneID, `layers[${index}].fitBones`));
      if (new Set(layer.fitBones).size !== layer.fitBones.length || layer.fitBones.some((boneID) => !boneIDs.has(boneID))) {
        throw new Error(`Layer ${layer.id} fitBones must reference distinct known bones`);
      }
    }
  }
  for (const [layerID, boneID] of requiredEquipmentLayers) {
    const layer = result.layers.find((candidate) => candidate.id === layerID);
    if (!layer) throw new Error(`Scene is missing required equipment layer ${layerID}; reload the editor before saving`);
    if (layer.group !== "Equipment" || layer.bone !== boneID) {
      throw new Error(`Required equipment layer ${layerID} must be in Equipment on ${boneID}`);
    }
  }
  // Hands are equipment-independent runtime slots, not body-profile art. Use
  // the active profile's edited registration for both profiles so a stale
  // browser scene cannot restore the old gender-specific assets or offsets.
  // Per-clip pose corrections. Rotations are degrees and offsets are canvas
  // units, both bounded the same way a bone bind is.
  if (result.clipPoseOffsets != null) {
    if (typeof result.clipPoseOffsets !== "object") throw new Error("clipPoseOffsets must be an object");
    const corrections = {};
    for (const [clip, bones] of Object.entries(result.clipPoseOffsets)) {
      const perBone = {};
      for (const [bone, delta] of Object.entries(bones ?? {})) {
        if (!boneIDs.has(bone)) throw new Error(`clipPoseOffsets.${clip} references unknown bone ${bone}`);
        const corrected = {};
        for (const key of ["x", "y", "rotation"]) {
          if (delta?.[key] == null) continue;
          corrected[key] = finite(delta[key], `clipPoseOffsets.${clip}.${bone}.${key}`, -2000, 2000);
        }
        if (Object.keys(corrected).length) perBone[bone] = corrected;
      }
      if (Object.keys(perBone).length) corrections[clip] = perBone;
    }
    result.clipPoseOffsets = corrections;
  }
  // Time-scoped additive bone corrections. Each bone owns an independent,
  // smoothly interpolated track within one animation clip.
  if (result.boneKeyframes != null) {
    if (!result.boneKeyframes || typeof result.boneKeyframes !== "object" || Array.isArray(result.boneKeyframes)) {
      throw new Error("boneKeyframes must be an object");
    }
    const clips = {};
    for (const [clip, bones] of Object.entries(result.boneKeyframes)) {
      if (!bones || typeof bones !== "object" || Array.isArray(bones)) {
        throw new Error(`boneKeyframes.${clip} must be an object`);
      }
      const perBone = {};
      for (const [bone, sourceKeys] of Object.entries(bones)) {
        if (!boneIDs.has(bone)) throw new Error(`boneKeyframes.${clip} references unknown bone ${bone}`);
        if (!Array.isArray(sourceKeys) || sourceKeys.length > 256) {
          throw new Error(`boneKeyframes.${clip}.${bone} must contain at most 256 keys`);
        }
        const keys = sourceKeys.map((key, index) => {
          const normalized = {
            phase: finite(key?.phase, `boneKeyframes.${clip}.${bone}[${index}].phase`, 0, 1),
          };
          for (const field of ["x", "y", "rotation"]) {
            if (key?.[field] == null) continue;
            normalized[field] = finite(key[field], `boneKeyframes.${clip}.${bone}[${index}].${field}`, -2000, 2000);
          }
          return normalized;
        }).sort((left, right) => left.phase - right.phase);
        for (let index = 1; index < keys.length; index += 1) {
          if (Math.abs(keys[index].phase - keys[index - 1].phase) < 0.0005) {
            throw new Error(`boneKeyframes.${clip}.${bone} cannot contain duplicate phases`);
          }
        }
        if (keys.length) perBone[bone] = keys;
      }
      if (Object.keys(perBone).length) clips[clip] = perBone;
    }
    result.boneKeyframes = clips;
  }
  // Discrete face attachment changes. Unlike numeric bone and wrist curves,
  // these keys are sampled without interpolation.
  if (result.expressionKeyframes != null) {
    if (!result.expressionKeyframes || typeof result.expressionKeyframes !== "object" || Array.isArray(result.expressionKeyframes)) {
      throw new Error("expressionKeyframes must be an object");
    }
    const clips = {};
    for (const [clip, sourceKeys] of Object.entries(result.expressionKeyframes)) {
      if (!Array.isArray(sourceKeys) || sourceKeys.length > 128) {
        throw new Error(`expressionKeyframes.${clip} must contain at most 128 keys`);
      }
      const keys = sourceKeys.map((key, index) => {
        const phase = finite(key?.phase, `expressionKeyframes.${clip}[${index}].phase`, 0, 1);
        const eyes = string(key?.eyes, `expressionKeyframes.${clip}[${index}].eyes`);
        const mouth = string(key?.mouth, `expressionKeyframes.${clip}[${index}].mouth`);
        if (!eyeExpressions.has(eyes)) {
          throw new Error(`expressionKeyframes.${clip}[${index}].eyes has unsupported expression ${eyes}`);
        }
        if (!mouthExpressions.has(mouth)) {
          throw new Error(`expressionKeyframes.${clip}[${index}].mouth has unsupported expression ${mouth}`);
        }
        return { phase, eyes, mouth };
      }).sort((left, right) => left.phase - right.phase);
      for (let index = 1; index < keys.length; index += 1) {
        if (Math.abs(keys[index].phase - keys[index - 1].phase) < 0.0005) {
          throw new Error(`expressionKeyframes.${clip} cannot contain duplicate phases`);
        }
      }
      if (keys.length) clips[clip] = keys;
    }
    result.expressionKeyframes = clips;
  }
  // Additive wrist animation tracks. The body clips remain procedural; these
  // small scene-owned tracks only rotate the existing hand bones over time.
  if (result.wristKeyframes != null) {
    if (!result.wristKeyframes || typeof result.wristKeyframes !== "object" || Array.isArray(result.wristKeyframes)) {
      throw new Error("wristKeyframes must be an object");
    }
    const clips = {};
    for (const [clip, sides] of Object.entries(result.wristKeyframes)) {
      if (!sides || typeof sides !== "object" || Array.isArray(sides)) {
        throw new Error(`wristKeyframes.${clip} must be an object`);
      }
      const unknownSides = Object.keys(sides).filter((side) => !["L", "R"].includes(side));
      if (unknownSides.length) throw new Error(`wristKeyframes.${clip} contains unsupported side ${unknownSides[0]}`);
      const perSide = {};
      for (const side of ["L", "R"]) {
        if (sides[side] == null) continue;
        if (!Array.isArray(sides[side]) || sides[side].length > 64) {
          throw new Error(`wristKeyframes.${clip}.${side} must contain at most 64 keys`);
        }
        const keys = sides[side].map((key, index) => {
          const keyLabel = `wristKeyframes.${clip}.${side}[${index}]`;
          const normalized = {
            phase: finite(key?.phase, `${keyLabel}.phase`, 0, 1),
            angle: finite(key?.angle, `${keyLabel}.angle`, -85, 85),
          };
          const normalizeGripChannels = (source, label) => {
            const grip = {};
            if (source?.gripRotation != null) {
              grip.gripRotation = finite(source.gripRotation, `${label}.gripRotation`, -45, 45);
            }
            if (source?.knuckleAxis != null) {
              grip.knuckleAxis = finite(source.knuckleAxis, `${label}.knuckleAxis`, -90, 90);
            }
            if (source?.fingerAngles != null) {
              if (!source.fingerAngles || typeof source.fingerAngles !== "object" || Array.isArray(source.fingerAngles)) {
                throw new Error(`${label}.fingerAngles must be an object`);
              }
              const supported = new Set([
                "handClosedLIndex", "handClosedLMiddle", "handClosedLRing", "handClosedLPinky",
              ]);
              const unknown = Object.keys(source.fingerAngles).find((id) => !supported.has(id));
              if (unknown) throw new Error(`${label}.fingerAngles contains unsupported finger ${unknown}`);
              grip.fingerAngles = Object.fromEntries(Object.entries(source.fingerAngles).map(([id, angle]) => [
                id, finite(angle, `${label}.fingerAngles.${id}`, -180, 180),
              ]));
            }
            if (source?.fingerOffsets != null) {
              if (!source.fingerOffsets || typeof source.fingerOffsets !== "object" || Array.isArray(source.fingerOffsets)) {
                throw new Error(`${label}.fingerOffsets must be an object`);
              }
              const supported = new Set([
                "handClosedLIndex", "handClosedLMiddle", "handClosedLRing", "handClosedLPinky",
              ]);
              const unknown = Object.keys(source.fingerOffsets).find((id) => !supported.has(id));
              if (unknown) throw new Error(`${label}.fingerOffsets contains unsupported finger ${unknown}`);
              grip.fingerOffsets = Object.fromEntries(Object.entries(source.fingerOffsets).map(([id, offset]) => {
                if (!offset || typeof offset !== "object" || Array.isArray(offset)) {
                  throw new Error(`${label}.fingerOffsets.${id} must be an object`);
                }
                const unknownAxis = Object.keys(offset).find((axis) => !["along", "across"].includes(axis));
                if (unknownAxis) throw new Error(`${label}.fingerOffsets.${id} contains unsupported axis ${unknownAxis}`);
                return [id, Object.fromEntries(Object.entries(offset).map(([axis, distance]) => [
                  axis, finite(distance, `${label}.fingerOffsets.${id}.${axis}`, -160, 160),
                ]))];
              }));
            }
            return grip;
          };
          Object.assign(normalized, normalizeGripChannels(key, keyLabel));
          if (key?.grips != null) {
            if (!key.grips || typeof key.grips !== "object" || Array.isArray(key.grips)) {
              throw new Error(`${keyLabel}.grips must be an object`);
            }
            const unknownGrip = Object.keys(key.grips).find((kind) => !["weapon", "staff", "bow"].includes(kind));
            if (unknownGrip) throw new Error(`${keyLabel}.grips contains unsupported held class ${unknownGrip}`);
            normalized.grips = Object.fromEntries(Object.entries(key.grips).map(([kind, grip]) => {
              if (!grip || typeof grip !== "object" || Array.isArray(grip)) {
                throw new Error(`${keyLabel}.grips.${kind} must be an object`);
              }
              return [kind, normalizeGripChannels(grip, `${keyLabel}.grips.${kind}`)];
            }));
          }
          return normalized;
        }).sort((left, right) => left.phase - right.phase);
        for (let index = 1; index < keys.length; index += 1) {
          if (Math.abs(keys[index].phase - keys[index - 1].phase) < 0.0005) {
            throw new Error(`wristKeyframes.${clip}.${side} cannot contain duplicate phases`);
          }
        }
        if (keys.length) perSide[side] = keys;
      }
      if (Object.keys(perSide).length) clips[clip] = perSide;
    }
    // Older scenes stored grip channels beside each animation's wrist angle.
    // Promote one authoritative curve per held class so every staff motion,
    // every bow motion, and every ordinary weapon motion reads the same grip.
    const gripFields = ["gripRotation", "knuckleAxis", "fingerAngles", "fingerOffsets"];
    const hasGripChannels = (value) => gripFields.some((field) => value?.[field] != null);
    const sharedTrack = (kind) => `__grip_${kind}`;
    const naturalKind = (clip) => clip.startsWith("bow") ? "bow" : clip.startsWith("staff") ? "staff" : "weapon";
    const preferredClip = { weapon: "swordSwing", staff: "staffIdle", bow: "bowDraw" };
    for (const kind of ["weapon", "staff", "bow"]) {
      if (clips[sharedTrack(kind)]?.L?.length) continue;
      let source = null;
      for (const [clip, sides] of Object.entries(clips)) {
        if (clip.startsWith("__grip_")) continue;
        const scoped = (sides.L ?? []).filter((key) => hasGripChannels(key.grips?.[kind]));
        if (scoped.length) {
          source = scoped.map((key) => ({ phase: key.phase, angle: 0, ...key.grips[kind] }));
          break;
        }
      }
      if (!source) {
        const candidates = [preferredClip[kind], ...Object.keys(clips).filter((clip) => naturalKind(clip) === kind)];
        const clip = candidates.find((name, index) => candidates.indexOf(name) === index
          && (clips[name]?.L ?? []).some(hasGripChannels));
        if (clip) {
          source = clips[clip].L.filter(hasGripChannels).map((key) => Object.fromEntries([
            ["phase", key.phase], ["angle", 0],
            ...gripFields.filter((field) => key[field] != null).map((field) => [field, key[field]]),
          ]));
        }
      }
      if (source?.length) clips[sharedTrack(kind)] = { L: source };
    }
    result.wristKeyframes = clips;
  }
  return normalizeUniversalSlots(result);
}
