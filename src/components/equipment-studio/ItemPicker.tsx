/** The Equipment Studio binding for the shared inventory-art item matrix. */
import { useShallow } from "zustand/react/shallow"
import { ItemMatrixDialog } from "@/components/shared/ItemMatrixDialog.tsx"
import type { EquipmentCatalog } from "@/editor/equipment-catalog.ts"
import { useEquipmentEditor } from "@/stores/equipment-editor.ts"

export interface ItemPickerProps {
  catalog: EquipmentCatalog | null
  open: boolean
  onClose: () => void
}

export function ItemPicker({ catalog, open, onClose }: ItemPickerProps) {
  const { scene, slot, item } = useEquipmentEditor(
    useShallow((state) => ({ scene: state.scene, slot: state.slot, item: state.item })),
  )
  const selectItem = useEquipmentEditor((state) => state.selectItem)

  return (
    <ItemMatrixDialog
      catalog={catalog}
      scene={scene}
      slot={slot}
      selected={item}
      open={open}
      onClose={onClose}
      onPick={selectItem}
    />
  )
}
