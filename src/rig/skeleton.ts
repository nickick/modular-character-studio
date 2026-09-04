/**
 * Skeleton resolution: flattening one body profile's bind pose onto the shared
 * bones and layers, and solving world transforms for a pose.
 *
 * Bone names, hierarchy, and the animation library are shared across body
 * profiles; the bind offsets and attachment placements are not, because the
 * male and female pieces are authored at different sizes.
 */
import { identity, localMatrix, multiply, type MatrixTable } from "./matrix.ts"
import { multiBoneRigidDelta } from "./fit.ts"
import {
  bonePoseKeys,
  type ActiveSlotKey,
  type ByProfile,
  type DressedLayer,
  type HeldSelection,
  type LayerBind,
  type Matrix2D,
  type OptionSlot,
  type Pose,
  type ProfileID,
  type ResolvedBone,
  type ResolvedLayer,
  type ResolvedRig,
  type RigScene,
  type SceneLayer,
  type SceneOption,
} from "./types.ts"

function boneLocalMatrix(bone: ResolvedBone, pose: Pose): Matrix2D {
  const delta = pose[bone.id] ?? {}
  // Bind scale is a registration value: scaling a bone scales every
  // attachment parented to it, offsets included, so resizing the head does
  // not strand the eyes, brows, nose, mouth, and hair at their old places.
  return localMatrix(
    bone.x + (delta.x ?? 0),
    bone.y + (delta.y ?? 0),
    (bone.rotation ?? 0) + (delta.rotation ?? 0),
    (bone.scaleX ?? 1) * (delta.scaleX ?? 1),
    (bone.scaleY ?? 1) * (delta.scaleY ?? 1),
  )
}

function parentChainMatrices(bones: ResolvedBone[]): MatrixTable {
  const worlds: MatrixTable = {}
  for (const bone of bones) {
    const local = boneLocalMatrix(bone, {})
    worlds[bone.id] = bone.parent ? multiply(worlds[bone.parent], local) : local
  }
  return worlds
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
export function worldMatrices(bones: ResolvedBone[], pose: Pose = {}): MatrixTable {
  // At the bind pose every fit is the identity, so the reference chain is the
  // plain parent chain. Solving it that way also keeps this from recursing.
  const bindWorlds = bones.some((bone) => bone.fitBones) ? parentChainMatrices(bones) : null
  const worlds: MatrixTable = {}
  for (const bone of bones) {
    const local = boneLocalMatrix(bone, pose)
    if (bone.fitBones && bindWorlds) {
      for (const id of bone.fitBones) {
        if (!worlds[id]) throw new Error(`Bone ${bone.id} fits to ${id}, which must be solved first`)
      }
      const seat = multiBoneRigidDelta(bindWorlds, worlds, bone.fitBones)
      const parentBind = bone.parent ? bindWorlds[bone.parent] : identity()
      worlds[bone.id] = multiply(multiply(seat, parentBind), local)
    } else {
      worlds[bone.id] = bone.parent ? multiply(worlds[bone.parent], local) : local
    }
  }
  return worlds
}

/**
 * Commit user-authored pose deltas into one profile's bind pose. Animation
 * deltas are never passed here, so saving cannot accidentally bake a frame.
 */
export function bakePoseIntoProfile(scene: RigScene, profile: ProfileID, pose: Pose = {}): RigScene {
  for (const bone of scene.bones) {
    const delta = pose[bone.id]
    const bind = bone.bindByProfile[profile]
    if (!delta || !bind) continue
    for (const key of bonePoseKeys) {
      const value = delta[key]
      if (!Number.isFinite(value)) continue
      bind[key] = Number(((bind[key] ?? 0) + (value ?? 0)).toFixed(3))
    }
  }
  return scene
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
export const optionSlots: readonly OptionSlot[] = [
  { active: "activeNecklace", catalogue: "necklaceOptions", dresses: (layer) => layer.id === "necklace" },
  { active: "activeQuiver", catalogue: "quiverOptions", dresses: (layer) => layer.id === "quiver" },
  // Held equipment. Which clips show each of these is `animationEquipment`,
  // which is also what decides the poses worth reviewing a placement in.
  { active: "activeWeapon", catalogue: "weaponOptions", dresses: (layer) => layer.id === "weapon" },
  { active: "activeStaff", catalogue: "staffOptions", dresses: (layer) => layer.id === "staff" },
  { active: "activeBow", catalogue: "bowOptions", dresses: (layer) => layer.id === "bow" },
  { active: "activeShield", catalogue: "shieldOptions", dresses: (layer) => layer.id === "shield" },
  { active: "activeRing", catalogue: "ringOptions", dresses: (layer) => layer.id === "ring" },
  { active: "activeChest", catalogue: "chestOptions", dresses: (layer) => layer.id === "tunicBody" },
  {
    active: "activeHeadgear",
    catalogue: "headgearOptions",
    dresses: (layer) => layer.id === "headgear" || /helmet/i.test(layer.id),
  },
  { active: "activeArmSet", catalogue: "armOptions", byLayer: true },
  { active: "activeBootSet", catalogue: "bootOptions", byLayer: true },
]

/**
 * What a slot dresses a layer in, or null when no slot claims it. `assetByLayer`
 * options dress several layers at once, which is how a set of arms or boots
 * swaps its four pieces together.
 */
export function layerOption(scene: RigScene, layer: SceneLayer): DressedLayer | null {
  for (const slot of optionSlots) {
    const catalogue: SceneOption[] = scene[slot.catalogue] ?? []
    const chosen = catalogue.find((option) => option.id === scene[slot.active])
    if (!chosen) continue
    if (slot.byLayer) {
      const asset = chosen.assetByLayer?.[layer.id]
      if (asset) return { option: chosen, asset, bind: chosen.bindByLayer?.[layer.id] }
      continue
    }
    if (!slot.dresses?.(layer)) continue
    if (chosen.assetByProfile) {
      return { option: chosen, asset: chosen.assetByProfile, bind: chosen.bindByProfile }
    }
  }
  return null
}

/**
 * Where a layer's placement is stored for a profile, which is not always the
 * layer: an option that dresses a layer and carries its own bind owns that
 * placement, so an edit has to be written back to the option it came from.
 * Otherwise the option keeps winning and the edit looks like it never saved.
 */
export function layerBindOwner(
  scene: RigScene,
  layer: SceneLayer,
  profile: ProfileID,
): LayerBind | null {
  const dressed = layerOption(scene, layer)
  if (dressed?.bind?.[profile]) return dressed.bind[profile]
  return layer.bindByProfile[profile] ?? null
}

/**
 * Fold a manual pose into one clip's corrections. The bind pose is left alone,
 * so the fix lands on the clip being looked at and nowhere else.
 */
export function bakePoseIntoClip(scene: RigScene, animation: string, pose: Pose = {}): RigScene {
  const offsets = scene.clipPoseOffsets ?? (scene.clipPoseOffsets = {})
  const clip = offsets[animation] ?? (offsets[animation] = {})
  for (const [bone, delta] of Object.entries(pose)) {
    const current = clip[bone] ?? {}
    for (const key of bonePoseKeys) {
      const value = delta[key]
      if (!Number.isFinite(value)) continue
      current[key] = Number(((current[key] ?? 0) + (value ?? 0)).toFixed(3))
    }
    if (Object.keys(current).length) clip[bone] = current
  }
  return scene
}

/** Which option ids each slot should resolve against for this render. */
function wornSelection(
  scene: RigScene,
  requested: Partial<Record<ActiveSlotKey, string | null | undefined>>,
): RigScene {
  const selection: RigScene = { ...scene }
  for (const slot of optionSlots) {
    const wanted = requested[slot.active]
    const catalogue: SceneOption[] = scene[slot.catalogue] ?? []
    // Callers pass an id to preview a slot without changing what the scene
    // wears. Anything unrecognised falls back to the worn option rather than
    // undressing the character.
    if (wanted != null && catalogue.some((option) => option.id === wanted)) {
      Object.assign(selection, { [slot.active]: wanted })
    }
  }
  return selection
}

export function resolveProfile(
  scene: RigScene,
  profile: ProfileID,
  chestID: string | null = scene.activeChest,
  armSetID: string | null = scene.activeArmSet,
  headgearID: string | null = scene.activeHeadgear,
  bootSetID: string | null = scene.activeBootSet,
  necklaceID: string | null = scene.activeNecklace ?? null,
  held: HeldSelection = {},
): ResolvedRig {
  const selection = wornSelection(scene, {
    activeChest: chestID,
    activeArmSet: armSetID,
    activeHeadgear: headgearID,
    activeBootSet: bootSetID,
    activeNecklace: necklaceID,
    activeQuiver: held.quiver ?? scene.activeQuiver,
    activeWeapon: held.weapon ?? scene.activeWeapon,
    activeStaff: held.staff ?? scene.activeStaff,
    activeBow: held.bow ?? scene.activeBow,
    activeShield: held.shield ?? scene.activeShield,
  })
  // Front hair is an uncovered-head layer. Keep it authored and selectable so
  // removing or hiding the helmet restores it automatically; only suppress it
  // in the assembled rig while a real, visible headgear option is being worn.
  const hidesFrontHair = scene.layers.some(
    (layer) =>
      layer.visible &&
      (layer.id === "headgear" || /helmet/i.test(layer.id)) &&
      (scene.headgearOptions ?? []).some((option) => option.id === selection.activeHeadgear),
  )
  const bones: ResolvedBone[] = scene.bones.map((bone) => ({
    id: bone.id,
    label: bone.label,
    parent: bone.parent,
    // Seating is skeleton data, not per-profile bind data: both profiles hang
    // the head off the same fitted torso frame.
    ...(bone.fitBones ? { fitBones: bone.fitBones } : {}),
    ...bone.bindByProfile[profile],
  }))
  const layers: ResolvedLayer[] = scene.layers.map((layer) => {
    // Whatever the slot is wearing wins over the layer's own art and, when the
    // option carries one, over its placement too. Resolving here means the
    // editor and the offline renderer preview what the game will show rather
    // than the undressed layer underneath.
    const dressed = layerOption(selection, layer)
    // `assetByLayer` options name one file per layer; `assetByProfile` options
    // name one per body. Both arrive here, so accept either shape.
    const dressedAsset = resolveDressedAsset(dressed, profile)
    const bind = dressed?.bind?.[profile] ?? layer.bindByProfile[profile]
    const visible = layer.visible && !(layer.id === "hairFront" && hidesFrontHair)
    return {
      ...layer,
      ...bind,
      visible,
      asset: dressedAsset ?? layer.assetByProfile[profile],
    }
  })
  return { bones, layers }
}

function resolveDressedAsset(dressed: DressedLayer | null, profile: ProfileID): string | undefined {
  if (!dressed) return undefined
  const asset: string | ByProfile<string> = dressed.asset
  return typeof asset === "string" ? asset : asset[profile]
}
