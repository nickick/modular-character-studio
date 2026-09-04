/**
 * The item picker: every option in a slot laid out as one column per build line
 * and one row per tier.
 *
 * The gaps are the point. Three of them read differently: a cell no line will
 * ever fill for this slot, a cell nobody has drawn art for yet, and a cell that
 * simply has nothing in it. The art pipeline works from the middle one.
 */
import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx"
import { UNALIGNED, UNRATED, equipmentLines, equipmentTiers } from "@/rig/equipment-lines.ts"
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
import { EQUIPMENT_SLOTS, catalogueFor, useEquipmentEditor } from "@/stores/equipment-editor.ts"

export interface ItemPickerProps {
  catalog: EquipmentCatalog | null
  open: boolean
  onClose: () => void
}

/** Unaligned gear leads: it is what the character starts in. */
const COLUMNS = [UNALIGNED, ...equipmentLines]
const ROWS = [...equipmentTiers, UNRATED]

export function ItemPicker({ catalog, open, onClose }: ItemPickerProps) {
  const { scene, slot, item } = useEquipmentEditor(
    useShallow((state) => ({ scene: state.scene, slot: state.slot, item: state.item })),
  )
  const selectItem = useEquipmentEditor((state) => state.selectItem)

  const options = catalogueFor(scene, slot)
  const filled = useMemo(
    () => (catalog ? optionsByCell(options, catalog) : new Map<string, DressedOption[]>()),
    [options, catalog],
  )
  const unmade = useMemo(() => {
    if (!catalog || !scene) return new Map<string, CatalogItem[]>()
    const every = EQUIPMENT_SLOTS.flatMap((candidate) => scene[candidate.catalogue] ?? [])
    return unmadeByCell(slot.id, catalog, every)
  }, [catalog, scene, slot.id])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent id="itemModal" className="item-modal">
        <DialogHeader className="item-modal-header">
          <div>
            <DialogTitle id="itemModalTitle">Choose {slot.label.toLowerCase()}</DialogTitle>
            <DialogDescription>
              One column per build line, one row per tier. Empty cells are the backlog.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div
          id="itemGrid"
          className="item-grid"
          style={{ gridTemplateColumns: `120px repeat(${COLUMNS.length}, minmax(150px, 1fr))` }}
        >
          <div />
          {COLUMNS.map((line) => (
            <div className="column-head" key={line.id}>
              <strong>{line.name}</strong>
              {line.blurb}
            </div>
          ))}
          {ROWS.map((tier) => (
            <Row
              key={tier.id}
              tier={tier}
              slotID={slot.id}
              catalog={catalog}
              filled={filled}
              unmade={unmade}
              selected={item}
              onPick={(id) => {
                selectItem(id)
                onClose()
              }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({
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
      <div className="row-head">
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
            <div className="item-cell filled" key={key}>
              {made.map(({ option, item }) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={option.id === selected}
                  title={item?.name ?? option.label}
                  onClick={() => onPick(option.id)}
                >
                  {option.label}
                  <span className="status-marks">
                    {/* Two debts, paid by different work: fitting the piece over
                        the rig, and drawing its inventory icon. */}
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
            <div className="item-cell unmade" key={key}>
              {missing.map((entry) => (
                <span key={entry.id} title={`${entry.name}: ${alreadyDrawn(entry)}`}>
                  {entry.name}
                </span>
              ))}
              <span className="cell-meta">needs rig art</span>
            </div>
          )
        }
        return (
          <div className={`item-cell ${applicable ? "empty" : "not-applicable"}`} key={key}>
            <span className="cell-meta">{applicable ? "nothing yet" : "not this slot"}</span>
          </div>
        )
      })}
    </>
  )
}
