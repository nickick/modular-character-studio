/**
 * Writing attachment and bone registrations back onto the scene.
 *
 * The subtlety is ownership: a layer's placement is not always stored on the
 * layer. An option that dresses a layer and carries its own bind owns that
 * placement, so an edit has to be written back to the option it came from --
 * otherwise the option keeps winning and the edit looks like it never saved.
 */
import { layerBindOwner } from "../rig/skeleton.ts"
import type { LayerBindKey, Pose, ProfileID, RigScene } from "../rig/types.ts"

/** The palm the closed grip is built on. */
const GRIP_PALM_LAYER_ID = "handClosedL"

/** The finger and thumb copies that sit on that palm. */
export const GRIP_OVERLAY_LAYER_IDS = [
  "handClosedLIndex",
  "handClosedLMiddle",
  "handClosedLRing",
  "handClosedLPinky",
  "handClosedLThumb",
]

/**
 * Transform fields the grip stack shares. Moving or resizing the palm has to
 * carry its fingers, or the hand comes apart the moment it is adjusted.
 */
const GRIP_SHARED_KEYS = new Set<LayerBindKey>(["x", "y", "rotation", "scaleX", "scaleY"])

/** Write one field of a layer's placement, wherever that placement is stored. */
export function writeLayerBind(
  scene: RigScene,
  selection: RigScene,
  layerID: string,
  profile: ProfileID,
  key: LayerBindKey,
  value: number,
): void {
  const layer = scene.layers.find((candidate) => candidate.id === layerID)
  if (!layer) return
  const owner = layerBindOwner(selection, layer, profile)
  if (!owner) return
  const previous = owner[key]
  owner[key] = value
  if (layerID !== GRIP_PALM_LAYER_ID || !GRIP_SHARED_KEYS.has(key)) return
  for (const overlayID of GRIP_OVERLAY_LAYER_IDS) {
    const overlay = scene.layers.find((candidate) => candidate.id === overlayID)
    if (!overlay) continue
    const overlayOwner = layerBindOwner(selection, overlay, profile)
    if (!overlayOwner) continue
    // Scale is a ratio, so the fingers keep their own proportions relative to
    // the palm; everything else is a shared absolute placement.
    const scaled = key === "scaleX" || key === "scaleY"
    overlayOwner[key] =
      scaled && previous ? (overlayOwner[key] ?? 1) * (value / previous) : value
  }
}

/**
 * Write one field of a bone's bind. Bone inspector edits are persistent profile
 * registration data, not disposable pose offsets, so any manual pose delta on
 * the same field is dropped rather than left to double up on the new bind.
 */
export function writeBoneBind(
  scene: RigScene,
  boneID: string,
  profile: ProfileID,
  key: "x" | "y" | "rotation" | "scaleX" | "scaleY",
  value: number,
  manualPose: Pose,
): void {
  const bind = scene.bones.find((candidate) => candidate.id === boneID)?.bindByProfile[profile]
  if (!bind) return
  bind[key] = value
  const delta = manualPose[boneID]
  if (!delta) return
  delete delta[key]
  if (Object.keys(delta).length === 0) delete manualPose[boneID]
}

/** Draw order lives on the layer itself, never on the option dressing it. */
export function writeDrawOrder(scene: RigScene, layerID: string, drawOrder: number): void {
  const layer = scene.layers.find((candidate) => candidate.id === layerID)
  if (layer) layer.drawOrder = drawOrder
}
