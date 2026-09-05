/** The game's inventory artwork, reused anywhere an editor names an item. */
import { inventoryIconURL, type CatalogItem } from "@/editor/equipment-catalog.ts"

export function ItemThumbnail({ item }: { item: CatalogItem | null | undefined }) {
  const source = inventoryIconURL(item)
  return (
    <span className={`inventory-thumbnail${source ? "" : " inventory-thumbnail-empty"}`} aria-hidden="true">
      {source ? <img src={source} alt="" loading="lazy" /> : <span>—</span>}
    </span>
  )
}
