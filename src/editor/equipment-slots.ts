/**
 * The slots the equipment studio places gear into.
 *
 * A held slot is one layer. A worn set dresses several layers from one option,
 * so it is placed a piece at a time: a boot's shaft and its foot sit on
 * different bones and need their own offsets, and the two sides are authored
 * separately rather than mirrored.
 */
import type { ActiveSlotKey, CatalogueKey } from "../rig/types.ts"

export interface SlotPiece {
  id: string
  label: string
}

export interface EquipmentSlot {
  id: string
  label: string
  catalogue: CatalogueKey
  active: ActiveSlotKey
  /** Worn gear stays on the body; held gear is picked up. */
  worn: boolean
  pieces?: readonly SlotPiece[]
}

export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
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
  {
    id: "headgear",
    label: "Head",
    catalogue: "headgearOptions",
    active: "activeHeadgear",
    worn: true,
  },
  { id: "ring", label: "Ring", catalogue: "ringOptions", active: "activeRing", worn: true },
  {
    id: "boots",
    label: "Boots",
    catalogue: "bootOptions",
    active: "activeBootSet",
    worn: true,
    pieces: [
      { id: "lowerLegL", label: "Shaft L" },
      { id: "footL", label: "Foot L" },
      { id: "lowerLegR", label: "Shaft R" },
      { id: "footR", label: "Foot R" },
    ],
  },
  {
    id: "arms",
    label: "Vambraces",
    catalogue: "armOptions",
    active: "activeArmSet",
    worn: true,
    pieces: [
      { id: "upperArmArmorL", label: "Upper L" },
      { id: "forearmVambraceL", label: "Vambrace L" },
      { id: "upperArmArmorR", label: "Upper R" },
      { id: "forearmVambraceR", label: "Vambrace R" },
    ],
  },
]

/** Slots whose item is gripped, so the finger stack follows it. */
export const GRIPPABLE_SLOTS: ReadonlySet<string> = new Set(["weapon", "staff", "bow"])

/** The palm, thumb, and four rigid fingers that make up the closed grip. */
export const GRIP_HAND_LAYER_IDS: ReadonlySet<string> = new Set([
  "handClosedL",
  "handClosedLIndex",
  "handClosedLMiddle",
  "handClosedLRing",
  "handClosedLPinky",
  "handClosedLThumb",
])

/** Layer ids any clip treats as held equipment. */
const EQUIPMENT_LAYER_IDS: ReadonlySet<string> = new Set(["weapon", "staff", "shield", "bow"])

/**
 * Weapon and staff art occupy the same main hand. While fitting a staff we
 * preview that family; every unrelated slot uses the ordinary weapon family
 * by default so a necklace or boot cannot make both alternatives appear.
 */
export function layerMatchesMainHandPreview(layerID: string, selectedSlotID: string): boolean {
  if (layerID === "staff") return selectedSlotID === "staff"
  if (layerID === "weapon") return selectedSlotID !== "staff"
  return true
}

/** Another piece of equipment gripped by the bone the placed one sits on. */
export function heldElsewhere(layer: { id: string; bone: string }, placedBone: string | undefined): boolean {
  return placedBone !== undefined && layer.bone === placedBone && EQUIPMENT_LAYER_IDS.has(layer.id)
}

/** The moment in each clip worth judging a placement at. */
export const REVIEW_PHASE: Record<string, number> = {
  bowIdle: 0, bowWalkForward: 0.25, bowRunForward: 0.25,
  spellIdle: 0, spellRunForward: 0.25,
  staffSpellIdle: 0, staffSpellRunForward: 0.25,

  idle: 0,
  run: 0.25,
  shieldUp: 0.3,
  staffShieldUp: 0.3,
  shieldMoveForward: 0.25,
  shieldMoveBackward: 0.25,
  staffShieldMoveForward: 0.25,
  staffShieldMoveBackward: 0.25,
  dodgeForward: 0.56,
  dodgeBackward: 0.56,
  staffIdle: 0.3,
  staffMoveForward: 0.25,
  staffMoveBackward: 0.25,
  swordSwing: 0.42,
  sneakAttack: 0.55,
  bowDraw: 0.85,
  bowReload: 0.75,
}

const CLIP_LABELS: Record<string, string> = {
  idle: "Idle",
  run: "Run",
  shieldUp: "Shield up",
  staffShieldUp: "Staff shield up",
  shieldMoveForward: "Guard walk",
  shieldMoveBackward: "Guard back",
  staffShieldMoveForward: "Staff guard walk",
  staffShieldMoveBackward: "Staff guard back",
  dodgeForward: "Dodge forward",
  dodgeBackward: "Dodge backward",
  staffIdle: "Staff idle",
  staffMoveForward: "Staff walk",
  staffMoveBackward: "Staff back",
  swordSwing: "Sword swing",
  blocked: "Blocked recoil",
  sneakAttack: "Sneak attack",
  bowDraw: "Bow draw",
  bowReload: "Bow reload",
}

/** A clip's name in this studio, which depends on what is being fitted. */
export function clipLabel(name: string, slotID: string): string {
  // The body clip is named `swordSwing`, but a staff or spear swings it too.
  if (name === "swordSwing" && slotID === "staff") return "Staff swing"
  return (
    CLIP_LABELS[name] ??
    name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase())
  )
}

/** The layer being placed: a held slot is its own layer, a set is one piece. */
export function activeLayerID(slot: EquipmentSlot, piece: string | null): string {
  return slot.pieces?.length ? (piece ?? slot.pieces[0].id) : slot.id
}

/** The three held items that share the closed left hand. */
export const MAIN_HAND_LAYER_IDS: ReadonlySet<string> = new Set(["weapon", "staff", "bow"])

/**
 * Which main-hand item to draw.
 *
 * Only one can be held at a time, but a clip's loadout names `weapon` and
 * `staff` together, because they are alternative render layers for whatever is
 * equipped. Reviewing a necklace would otherwise put a sword and a staff in the
 * same fist. The piece being placed always wins; otherwise the clip family
 * decides, the way the rig studio's main-hand selector does.
 */
export function mainHandLayerFor(placedLayerID: string, animation: string): string {
  if (MAIN_HAND_LAYER_IDS.has(placedLayerID)) return placedLayerID
  if (animation.startsWith("bow")) return "bow"
  if (animation.startsWith("staff")) return "staff"
  return "weapon"
}
