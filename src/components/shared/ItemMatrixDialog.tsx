/** Available equipment, with the same inventory previews as the studios. */
import { useMemo } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx"
import type { EquipmentSlot } from "@/editor/equipment-slots.ts"
import { availableOptions, type EquipmentCatalog } from "@/editor/equipment-catalog.ts"
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

export function ItemMatrixDialog({
  catalog, scene, slot, selected, open, allowClear = false, onClose, onPick,
}: ItemMatrixDialogProps) {
  const options = scene?.[slot.catalogue]
  const choices = useMemo(() => availableOptions(options ?? [], catalog), [options, catalog])
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
            <DialogDescription>Available items, sorted alphabetically.</DialogDescription>
          </div>
          {allowClear && selected ? (
            <button type="button" className="item-matrix-clear" onClick={() => pick(null)}>
              No item
            </button>
          ) : null}
        </DialogHeader>
        <div id="itemGrid" className="item-matrix-grid">
          {choices.map(({ option, item }) => (
            <button
              key={option.id}
              type="button"
              className="item-matrix-choice"
              aria-pressed={option.id === selected}
              title={item?.name ?? option.label}
              onClick={() => pick(option.id)}
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
          {choices.length === 0 ? <p className="item-picker-empty">No items available for this slot.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
