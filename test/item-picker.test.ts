import test from "node:test"
import assert from "node:assert/strict"
import { availableOptions, type EquipmentCatalog } from "../src/editor/equipment-catalog.ts"
import type { SceneOption } from "../src/rig/types.ts"

const option = (id: string, label: string, itemID?: string) => ({ id, label, itemID }) as SceneOption

test("available picker cards sort by displayed name and never pad the grid with backlog", () => {
  const options = [option("z", "Zebra"), option("b", "Belt", "axe"), option("a", "apple")]
  const catalog: EquipmentCatalog = {
    items: new Map([
      ["axe", { id: "axe", name: "Axe", inventoryArt: true, inventoryAssetFile: "axe.png" }],
      ["unmade", { id: "unmade", name: "Unmade" }],
    ]),
    applicability: new Map(),
  }
  const cards = availableOptions(options, catalog)
  assert.deepEqual(cards.map(({ option }) => option.id), ["a", "b", "z"])
  assert.deepEqual(options.map(({ id }) => id), ["z", "b", "a"], "source order is untouched")
  assert.equal(cards[1].item, catalog.items.get("axe"), "the preview metadata is preserved")
  assert.equal(cards[1].option.label, "Belt", "the existing secondary label is preserved")
})

test("available picker works before the catalogue loads and for empty slots", () => {
  assert.deepEqual(availableOptions([option("z", "Zebra"), option("a", "apple")], null).map(({ option }) => option.id), ["a", "z"])
  assert.deepEqual(availableOptions([], null), [])
})
