/**
 * The game's item catalogue, and how its items file onto the gear ladder.
 *
 * The studio lays every slot out as a grid: one column per build line, one row
 * per tier. That makes the gaps the point — an empty cell is a piece nobody can
 * equip yet, which is exactly what the art pipeline needs to see.
 */
import { isJsonObject, object, string, type JsonObject, type JsonValue } from "../rig/json.ts"
import { UNALIGNED, UNRATED, lineFor, tierFor } from "../rig/equipment-lines.ts"
import type { SceneOption } from "../rig/types.ts"

/** One entry in the game's inventory catalogue. */
export interface CatalogItem {
  id: string
  name: string
  slot?: string
  category?: string
  rarity?: string
  level?: number
  /**
   * An explicit build line. It wins over the name prefix, because gear that
   * predates the naming scheme is assigned rather than renamed -- its name is
   * the one players already know. Dropping this files such items as unaligned.
   */
  line?: string
  /** Whether an inventory icon has been drawn for it. */
  inventoryArt?: boolean
  /** Optional inventory identifier and project-relative thumbnail path. */
  inventoryAssetName?: string
  inventoryAssetFile?: string
}

export interface EquipmentCatalog {
  items: Map<string, CatalogItem>
  /**
   * Which build lines each slot can take at all. A line that never carries a
   * given slot is not a gap in the art -- it is not a cell anyone will fill --
   * so the grid marks it apart from work that is genuinely outstanding.
   */
  applicability: Map<string, ReadonlySet<string>>
}

export const CATALOG_PATH = "/assets/equipment-catalog.json"
export const MATRIX_PATH = "/assets/equipment-matrix.json"

function readItem(value: JsonObject): CatalogItem {
  const item: CatalogItem = { id: string(value.id, "item.id"), name: string(value.name, "item.name") }
  if (typeof value.slot === "string") item.slot = value.slot
  if (typeof value.category === "string") item.category = value.category
  if (typeof value.rarity === "string") item.rarity = value.rarity
  if (typeof value.level === "number") item.level = value.level
  if (typeof value.line === "string") item.line = value.line
  if (value.inventoryArt != null) item.inventoryArt = Boolean(value.inventoryArt)
  if (typeof value.inventoryAssetName === "string") item.inventoryAssetName = value.inventoryAssetName
  if (typeof value.inventoryAssetFile === "string") item.inventoryAssetFile = value.inventoryAssetFile
  return item
}

function readItems(value: JsonValue): CatalogItem[] {
  const source = object(value, "catalogue")
  const items = source.items
  if (!Array.isArray(items)) return []
  return items.filter(isJsonObject).map(readItem)
}

export async function loadEquipmentCatalog(): Promise<EquipmentCatalog> {
  const [catalogue, matrix] = await Promise.all([
    fetch(CATALOG_PATH).then((response) => response.json() as Promise<JsonValue>),
    fetch(MATRIX_PATH).then((response) => response.json() as Promise<JsonValue>),
  ])
  const items = new Map<string, CatalogItem>()
  for (const item of [...readItems(catalogue), ...readItems(matrix)]) {
    items.set(item.id, { ...items.get(item.id), ...item })
  }
  const applicability = new Map<string, ReadonlySet<string>>()
  const source = object(matrix, "matrix").applicability
  if (isJsonObject(source)) {
    for (const [slot, lines] of Object.entries(source)) {
      if (!Array.isArray(lines)) continue
      applicability.set(slot, new Set(lines.filter((line): line is string => typeof line === "string")))
    }
  }
  return { items, applicability }
}

/** A thumbnail stored relative to the active project's assets directory. */
export function inventoryIconURL(item: CatalogItem | null | undefined): string | null {
  const path = item?.inventoryAssetFile
  if (!item?.inventoryArt || !path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === ".")) return null
  return `/assets/${path.split("/").map(encodeURIComponent).join("/")}`
}

/** Whether a slot can ever carry gear from a build line. */
export function slotTakesLine(
  catalog: EquipmentCatalog,
  slotID: string,
  lineID: string,
): boolean {
  const wanted = SLOT_ITEMS[slotID]
  const lines = wanted ? catalog.applicability.get(wanted.matrixSlot ?? slotID) : undefined
  // A slot the matrix says nothing about takes everything, rather than nothing.
  return !lines || lines.has(lineID)
}

/**
 * Which catalogue items belong in a slot's grid.
 *
 * Two studio slots share one game slot: a blade and a staff are both main hand,
 * and the rig wears them on different layers. Splitting by weapon category is
 * what keeps the staff picker from listing every axe in the game.
 */
export const SLOT_ITEMS: Record<
  string,
  { slot: string; matrixSlot?: string; categories?: readonly string[] }
> = {
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
}

/** A grid cell key: which line, and which rung of it. */
export const cellKey = (line: string, tier: string): string => `${line}/${tier}`

export interface DressedOption {
  option: SceneOption
  item: CatalogItem | null
}

/** Only selectable rig options; catalogue-only backlog items never occupy a card. */
export function availableOptions(options: readonly SceneOption[], catalog: EquipmentCatalog | null): DressedOption[] {
  return options.map((option) => ({ option, item: catalog?.items.get(option.itemID ?? "") ?? null }))
    .sort((a, b) => (a.item?.name ?? a.option.label).localeCompare(b.item?.name ?? b.option.label, "en", { sensitivity: "base", numeric: true })
      || a.option.id.localeCompare(b.option.id))
}

/** Every option in a slot, filed by build line and tier. */
export function optionsByCell(
  options: readonly SceneOption[],
  catalog: EquipmentCatalog,
): Map<string, DressedOption[]> {
  const cells = new Map<string, DressedOption[]>()
  for (const option of options) {
    const item = catalog.items.get(option.itemID ?? "") ?? null
    // An option may name its own rung when no item speaks for it.
    const line = option.line ?? lineFor(item) ?? UNALIGNED.id
    // An option with no inventory item is a look, not gear: the bare tunic, the
    // default arms. Those are what the character starts in, so they file as common
    // rather than as data with a missing rating.
    const tier = option.tier ?? tierFor(item ?? {}) ?? (option.itemID ? UNRATED.id : "common")
    const key = cellKey(line, tier)
    cells.set(key, [...(cells.get(key) ?? []), { option, item }])
  }
  return cells
}

/**
 * Items with no rig art anywhere: the backlog.
 *
 * "Dressed" is asked of every catalogue, not just this slot's, because an item
 * only needs art once. A staff picker that measured against staff options alone
 * would report every axe in the game as needing art.
 */
export function unmadeByCell(
  slotID: string,
  catalog: EquipmentCatalog,
  everyOption: readonly SceneOption[],
): Map<string, CatalogItem[]> {
  const wanted = SLOT_ITEMS[slotID]
  if (!wanted) return new Map()
  const dressed = new Set<string>()
  for (const option of everyOption) if (option.itemID) dressed.add(option.itemID)
  const cells = new Map<string, CatalogItem[]>()
  for (const item of catalog.items.values()) {
    if (item.slot !== wanted.slot || dressed.has(item.id)) continue
    if (wanted.categories && !wanted.categories.includes(item.category ?? "")) continue
    const key = cellKey(lineFor(item) ?? UNALIGNED.id, tierFor(item) ?? UNRATED.id)
    cells.set(key, [...(cells.get(key) ?? []), item])
  }
  return cells
}

/** What an item that has no rig art does already have, for the cell's tooltip. */
export function alreadyDrawn(item: CatalogItem): string {
  return item.inventoryArt
    ? "has an inventory icon, but no fitted rig art"
    : "no art at all"
}
