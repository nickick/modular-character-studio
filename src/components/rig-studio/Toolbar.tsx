/**
 * The top toolbar: which body is on show, what it is wearing, and the document
 * actions. Equipment lives behind one menu because its slots are changed
 * rarely, while profile and hand pose are changed constantly.
 */
import { useEffect, useRef, useState } from "react"
import { Redo2, Undo2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { SelectField } from "@/components/SelectField.tsx"
import { ItemMatrixDialog } from "@/components/shared/ItemMatrixDialog.tsx"
import { ItemThumbnail } from "@/components/shared/ItemThumbnail.tsx"
import { Toggle } from "@/components/Toggle.tsx"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx"
import { handPoseNames } from "@/rig/clips.ts"
import { loadEquipmentCatalog, type EquipmentCatalog } from "@/editor/equipment-catalog.ts"
import { EQUIPMENT_SLOTS, type EquipmentSlot } from "@/editor/equipment-slots.ts"
import { profileLabels } from "@/editor/labels.ts"
import { profileIDs, type ProfileID, type RigScene } from "@/rig/types.ts"
import {
  HEADGEAR_LAYER_ID,
  canRedo,
  canUndo,
  useRigEditor,
  type Presentation,
} from "@/stores/rig-editor.ts"

const EQUIP_MENU_SLOT_IDS = [
  "tunicBody",
  "arms",
  "boots",
  "headgear",
  "necklace",
  "weapon",
  "staff",
  "bow",
  "shield",
  "quiver",
] as const

const EQUIP_MENU_SLOTS: readonly EquipmentSlot[] = EQUIP_MENU_SLOT_IDS.flatMap((id) => {
  const slot = EQUIPMENT_SLOTS.find((candidate) => candidate.id === id)
  return slot ? [slot] : []
})

const CLEARABLE_SLOTS = new Set(["necklace", "bow", "shield", "quiver"])

function selectedEquipment(slot: EquipmentSlot, presentation: Presentation): string | null {
  switch (slot.id) {
  case "tunicBody": return presentation.chest
  case "arms": return presentation.armSet
  case "boots": return presentation.bootSet
  case "headgear": return presentation.headgear
  case "necklace": return presentation.necklace
  case "weapon": return presentation.held.weapon ?? null
  case "staff": return presentation.held.staff ?? null
  case "bow": return presentation.held.bow ?? null
  case "shield": return presentation.held.shield ?? null
  case "quiver": return presentation.held.quiver ?? null
  default: return null
  }
}

function selectedOption(scene: RigScene, slot: EquipmentSlot, id: string | null) {
  return scene[slot.catalogue]?.find((option) => option.id === id) ?? null
}

export interface ToolbarProps {
  onExportPNG: () => void
}

export function Toolbar({ onExportPNG }: ToolbarProps) {
  const [equipOpen, setEquipOpen] = useState(false)
  const [catalog, setCatalog] = useState<EquipmentCatalog | null>(null)
  const [matrixSlotID, setMatrixSlotID] = useState<string | null>(null)
  const equipRef = useRef<HTMLDivElement>(null)
  const { scene, presentation, handPose, wholeAnimationEdits, dirty } = useRigEditor(
    useShallow((state) => ({
      scene: state.scene,
      presentation: state.presentation,
      handPose: state.handPose,
      wholeAnimationEdits: state.wholeAnimationEdits,
      dirty: state.dirty,
    })),
  )
  const setPresentation = useRigEditor((state) => state.setPresentation)
  const setHandPose = useRigEditor((state) => state.setHandPose)
  const setWholeAnimationEdits = useRigEditor((state) => state.setWholeAnimationEdits)
  const editScene = useRigEditor((state) => state.editScene)
  const undo = useRigEditor((state) => state.undo)
  const redo = useRigEditor((state) => state.redo)
  const save = useRigEditor((state) => state.save)
  const load = useRigEditor((state) => state.load)
  const setManualPose = useRigEditor((state) => state.setManualPose)
  const undoAvailable = useRigEditor(canUndo)
  const redoAvailable = useRigEditor(canRedo)

  // A menu that stays open after a click elsewhere hides the stage it is meant
  // to be adjusting, so it closes on any outside pointer press.
  useEffect(() => {
    if (!equipOpen) return
    const close = (event: PointerEvent) => {
      if (!equipRef.current?.contains(event.target as Node)) setEquipOpen(false)
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEquipOpen(false)
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", dismiss)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", dismiss)
    }
  }, [equipOpen])

  useEffect(() => {
    loadEquipmentCatalog()
      .then(setCatalog)
      .catch(() => setCatalog(null))
  }, [])

  if (!scene) return <section className="toolbar" />

  const helmetVisible = Boolean(scene.layers.find((layer) => layer.id === HEADGEAR_LAYER_ID)?.visible)
  const matrixSlot = EQUIP_MENU_SLOTS.find((slot) => slot.id === matrixSlotID) ?? EQUIP_MENU_SLOTS[0]
  const matrixSelection = selectedEquipment(matrixSlot, presentation)

  const chooseEquipment = (slot: EquipmentSlot, id: string | null) => {
    switch (slot.id) {
    case "tunicBody":
      if (id) setPresentation({ chest: id })
      break
    case "arms":
      if (id) setPresentation({ armSet: id })
      break
    case "boots":
      if (id) setPresentation({ bootSet: id })
      break
    case "headgear":
      if (id) setPresentation({ headgear: id })
      break
    case "necklace":
      setPresentation({ necklace: id })
      break
    case "weapon":
    case "staff":
      if (id) {
        const mainHand = slot.id
        setPresentation({ mainHand, held: { ...presentation.held, [mainHand]: id } })
      }
      break
    case "bow":
    case "shield":
    case "quiver":
      setPresentation({ held: { ...presentation.held, [slot.id]: id } })
      break
    }
  }

  return (
    <section className="toolbar">
      {/* Two bodies, so switching is one press rather than opening a list. */}
      <ToggleGroup
        id="profileSelect"
        type="single"
        size="sm"
        className="segmented profile-pill"
        value={presentation.profile}
        aria-label="Body profile"
        onValueChange={(next) => next && setPresentation({ profile: next as ProfileID })}
      >
        {profileIDs.map((id) => (
          <ToggleGroupItem key={id} value={id}>
            {profileLabels[id]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="menu-control" ref={equipRef}>
        <button
          id="equipMenuButton"
          type="button"
          aria-expanded={equipOpen}
          aria-controls="equipMenu"
          onClick={() => setEquipOpen((open) => !open)}
        >
          Equip
        </button>
        <div id="equipMenu" className="control-menu" hidden={!equipOpen}>
          <div className="equipment-preview-list">
            {EQUIP_MENU_SLOTS.map((slot) => {
              const selected = selectedEquipment(slot, presentation)
              const option = selectedOption(scene, slot, selected)
              const item = option?.itemID ? catalog?.items.get(option.itemID) : null
              const activeMainHand = slot.id === "weapon" || slot.id === "staff"
                ? presentation.mainHand === slot.id
                : undefined
              return (
                <button
                  key={slot.id}
                  id={`equipment-${slot.id}`}
                  type="button"
                  className="equipment-preview"
                  aria-pressed={activeMainHand}
                  onClick={() => {
                    setEquipOpen(false)
                    setMatrixSlotID(slot.id)
                  }}
                >
                  <ItemThumbnail item={item} />
                  <span className="equipment-preview-copy">
                    <strong>{slot.label}</strong>
                    <span>{item?.name ?? option?.label ?? "No item"}</span>
                  </span>
                  <span className="equipment-preview-open" aria-hidden="true">›</span>
                </button>
              )
            })}
          </div>
          <Toggle
            label="Show helmet"
            checked={helmetVisible}
            onChange={(visible) =>
              editScene((draft) => {
                const layer = draft.layers.find((candidate) => candidate.id === HEADGEAR_LAYER_ID)
                if (layer) layer.visible = visible
              })
            }
          />
        </div>
      </div>

      <div className="hand-pose-control">
        <SelectField
          id="handPoseSelect"
          label="Hands"
          value={handPose}
          options={handPoseNames.map((id) => ({ id, label: id }))}
          onChange={setHandPose}
        />
      </div>
      <div
        className="animation-offset-control"
        title="Apply bone position and rotation edits evenly across the selected animation"
      >
        <Toggle
          id="wholeAnimationBoneEdits"
          label="Whole animation"
          checked={wholeAnimationEdits}
          onChange={setWholeAnimationEdits}
        />
      </div>

      <div className="toolbar-spacer" />

      {/* Pose/history actions belong together, apart from both equipment and
          persistence controls. */}
      <div className="toolbar-island" role="group" aria-label="Pose and edit history">
        <button id="resetPose" type="button" onClick={() => setManualPose({})}>
          Reset pose
        </button>
        <button
          id="undoEdit"
          type="button"
          className="icon-button"
          title="Undo"
          aria-label="Undo"
          onClick={undo}
          disabled={!undoAvailable}
        >
          <Undo2 />
        </button>
        <button
          id="redoEdit"
          type="button"
          className="icon-button"
          title="Redo"
          aria-label="Redo"
          onClick={redo}
          disabled={!redoAvailable}
        >
          <Redo2 />
        </button>
      </div>

      <div className="toolbar-spacer" />

      <button id="saveScene" type="button" className="primary" onClick={() => void save()}>
        {dirty ? "Save layout" : "Saved"}
      </button>
      <button id="reloadScene" type="button" onClick={() => void load()}>
        Reload
      </button>
      <button id="exportPng" type="button" onClick={onExportPNG}>
        Export PNG
      </button>
      <ItemMatrixDialog
        catalog={catalog}
        scene={scene}
        slot={matrixSlot}
        selected={matrixSelection}
        open={matrixSlotID !== null}
        allowClear={CLEARABLE_SLOTS.has(matrixSlot.id)}
        onClose={() => setMatrixSlotID(null)}
        onPick={(id) => chooseEquipment(matrixSlot, id)}
      />
    </section>
  )
}
