/** A reusable inventory-art matrix for choosing one dressed rig option. */
import { useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx"
import { EQUIPMENT_SLOTS, type EquipmentSlot } from "@/editor/equipment-slots.ts"
import {
  alreadyDrawn,
  cellKey,
  optionsByCell,
  slotTakesLine,
  unmadeByCell,
  type CatalogItem,
  type DressedOption,
  type EquipmentCatalog,
} from "@/editor/equipment-catalog.ts"
import { UNALIGNED, UNRATED, equipmentLines, equipmentTiers } from "@/rig/equipment-lines.ts"
import type { RigScene } from "@/rig/types.ts"
import { ItemThumbnail } from "./ItemThumbnail.tsx"
import "@/styles/item-matrix.css"

export interface ItemMatrixDialogProps {
  catalog: EquipmentCatalog | null
  scene: RigScene | null
  slot: EquipmentSlot
  selected: string | null
  open: boolean
  allowClear?: boolean
  onClose: () => void
  onPick: (id: string | null) => void
}

/** Unaligned gear leads: it is what the hunter starts in. */
const COLUMNS = [UNALIGNED, ...equipmentLines]
const ROWS = [...equipmentTiers, UNRATED]

export function ItemMatrixDialog({
  catalog,
  scene,
  slot,
  selected,
  open,
  allowClear = false,
  onClose,
  onPick,
}: ItemMatrixDialogProps) {
  const options = scene?.[slot.catalogue] ?? []
  const filled = useMemo(
    () => (catalog ? optionsByCell(options, catalog) : new Map<string, DressedOption[]>()),
    [options, catalog],
  )
  const unmade = useMemo(() => {
    if (!catalog || !scene) return new Map<string, CatalogItem[]>()
    const every = EQUIPMENT_SLOTS.flatMap((candidate) => scene[candidate.catalogue] ?? [])
    return unmadeByCell(slot.id, catalog, every)
  }, [catalog, scene, slot.id])

  const pick = (id: string | null) => {
    onPick(id)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent id="itemModal" className="item-matrix-modal">
        <DialogHeader className="item-matrix-header">
          <div>
            <DialogTitle id="itemModalTitle">Choose {slot.label.toLowerCase()}</DialogTitle>
            <DialogDescription>Inventory previews arranged by build line and item tier.</DialogDescription>
          </div>
          {allowClear && selected ? (
            <button type="button" className="item-matrix-clear" onClick={() => pick(null)}>
              No item
            </button>
          ) : null}
        </DialogHeader>
        <div
          id="itemGrid"
          className="item-matrix-grid"
          style={{ gridTemplateColumns: `112px repeat(${COLUMNS.length}, minmax(156px, 1fr))` }}
        >
          <div />
          {COLUMNS.map((line) => (
            <div className="item-matrix-column" key={line.id}>
              <strong>{line.name}</strong>
              {line.blurb}
            </div>
          ))}
          {ROWS.map((tier) => (
            <ItemMatrixRow
              key={tier.id}
              tier={tier}
              slotID={slot.id}
              catalog={catalog}
              filled={filled}
              unmade={unmade}
              selected={selected}
              onPick={pick}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ItemMatrixRow({
  tier,
  slotID,
  catalog,
  filled,
  unmade,
  selected,
  onPick,
}: {
  tier: { id: string; name: string; level: number | null }
  slotID: string
  catalog: EquipmentCatalog | null
  filled: Map<string, DressedOption[]>
  unmade: Map<string, CatalogItem[]>
  selected: string | null
  onPick: (id: string) => void
}) {
  return (
    <>
      <div className="item-matrix-row">
        <strong>{tier.name}</strong>
        {tier.level === null ? "No level recorded" : `Level ${tier.level}`}
      </div>
      {COLUMNS.map((line) => {
        const key = cellKey(line.id, tier.id)
        const made = filled.get(key) ?? []
        const missing = unmade.get(key) ?? []
        const applicable = !catalog || slotTakesLine(catalog, slotID, line.id)

        if (made.length) {
          return (
            <div className="item-matrix-cell item-matrix-filled" key={key}>
              {made.map(({ option, item }) => (
                <button
                  key={option.id}
                  type="button"
                  className="item-matrix-choice"
                  aria-pressed={option.id === selected}
                  title={item?.name ?? option.label}
                  onClick={() => onPick(option.id)}
                >
                  <ItemThumbnail item={item} />
                  <span className="item-matrix-copy">
                    <strong>{item?.name ?? option.label}</strong>
                    {item?.name && item.name !== option.label ? <small>{option.label}</small> : null}
                  </span>
                  <span className="item-matrix-marks">
                    {option.fitted ? null : <em title="not fitted over the rig">◇</em>}
                    {item && !item.inventoryArt ? <em title="no inventory icon">▫</em> : null}
                  </span>
                </button>
              ))}
            </div>
          )
        }
        if (missing.length) {
          return (
            <div className="item-matrix-cell item-matrix-unmade" key={key}>
              {missing.map((entry) => (
                <span className="item-matrix-missing" key={entry.id} title={`${entry.name}: ${alreadyDrawn(entry)}`}>
                  <ItemThumbnail item={entry} />
                  <span>{entry.name}</span>
                </span>
              ))}
              <small>needs rig art</small>
            </div>
          )
        }
        return (
          <div
            className={`item-matrix-cell ${applicable ? "item-matrix-empty" : "item-matrix-na"}`}
            key={key}
          >
            <small>{applicable ? "nothing yet" : "not this slot"}</small>
          </div>
        )
      })}
    </>
  )
}
