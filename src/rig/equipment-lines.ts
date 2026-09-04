/** The bundled demo's armor families and shared utility-equipment line. */

export interface EquipmentLine {
  id: string
  name: string
  blurb: string
  prefixes: readonly string[]
}

export interface EquipmentTier {
  id: string
  name: string
  level: number
  rarities: readonly string[]
}

/** What the ladder needs to know about a catalogue item to place it. */
export interface LadderItem {
  name?: string
  /** An explicit line assignment, which always wins over the name prefix. */
  line?: string
  rarity?: string
  level?: number
}

export const equipmentLines: readonly EquipmentLine[] = [
  { id: "leather", name: "Leather", blurb: "Light armor examples", prefixes: ["Scout", "Leather", "Cutthroat"] },
  { id: "mage", name: "Mage", blurb: "Arcane armor examples", prefixes: ["Arcane", "Frostweave"] },
  { id: "metal", name: "Metal", blurb: "Plate armor examples", prefixes: ["Vanguard", "Plate", "Iron Guard"] },
  { id: "utility", name: "Utility", blurb: "Weapons and accessories", prefixes: [] },
]

/** Gear that predates the lines, so nothing in the catalogue is unreachable. */
export const UNALIGNED = {
  id: "unaligned",
  name: "Unaligned",
  blurb: "Starter and one-off gear",
} as const

/**
 * Where gear with no level or rarity recorded goes. Filing it under Common
 * would be a guess that reads as fact, and every weapon in the catalogue is
 * currently in this state.
 */
export const UNRATED = { id: "unrated", name: "Unrated", level: null } as const

/** The six rungs, by the level they unlock at and the rarity they are cut in. */
export const equipmentTiers: readonly EquipmentTier[] = [
  { id: "common", name: "Common", level: 1, rarities: ["common", "crude"] },
  { id: "magical", name: "Magical", level: 5, rarities: ["magical"] },
  { id: "rare", name: "Rare", level: 9, rarities: ["rare"] },
  { id: "epic", name: "Epic", level: 12, rarities: ["epic"] },
  { id: "legendary", name: "Legendary", level: 16, rarities: ["legendary"] },
  { id: "mythic", name: "Mythic", level: 20, rarities: ["mythic", "mythic_plus"] },
]

/** Which line a name's prefix places it in, or null when nothing claims it. */
function lineForName(name: string): string | null {
  for (const line of equipmentLines) {
    if (line.prefixes.some((prefix) => name.startsWith(`${prefix} `) || name === prefix)) {
      return line.id
    }
  }
  return null
}

/**
 * Which line an item belongs to. An explicit assignment wins: gear that
 * predates the naming scheme is assigned rather than renamed, because its name
 * is the one players already know. Otherwise the name prefix decides.
 */
export function lineFor(item: LadderItem | string | null | undefined): string | null {
  if (typeof item === "string") return lineForName(item)
  if (!item) return lineForName("")
  if (item.line) return item.line === UNALIGNED.id ? null : item.line
  return lineForName(item.name ?? "")
}

/**
 * Which rung an item sits on. Rarity is what the art is cut for, so it decides;
 * the unlock level only breaks ties for gear with no rarity recorded.
 */
export function tierFor({ rarity, level }: { rarity?: string; level?: number } = {}): string | null {
  const byRarity = equipmentTiers.find((tier) => rarity != null && tier.rarities.includes(rarity))
  if (byRarity) return byRarity.id
  if (typeof level !== "number") return null
  return [...equipmentTiers].reverse().find((tier) => level >= tier.level)?.id ?? null
}
