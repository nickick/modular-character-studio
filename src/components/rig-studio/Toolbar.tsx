/**
 * The top toolbar: which body is on show, what it is wearing, and the document
 * actions. Equipment lives behind one menu because it is seven selectors that
 * are changed rarely, while profile and hand pose are changed constantly.
 */
import { useEffect, useRef, useState } from "react"
import { Redo2, Undo2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { SelectField, type SelectOption } from "@/components/SelectField.tsx"
import { Toggle } from "@/components/Toggle.tsx"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx"
import { Label } from "@/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx"
import { handPoseNames } from "@/rig/clips.ts"
import { profileLabels } from "@/editor/labels.ts"
import { profileIDs, type ProfileID, type RigScene, type SceneOption } from "@/rig/types.ts"
import {
  HEADGEAR_LAYER_ID,
  HELD_SLOTS,
  canRedo,
  canUndo,
  useRigEditor,
} from "@/stores/rig-editor.ts"

const toOptions = (options: readonly SceneOption[] | undefined): SelectOption[] =>
  (options ?? []).map((option) => ({ id: option.id, label: option.label }))

export interface ToolbarProps {
  onExportPNG: () => void
}

export function Toolbar({ onExportPNG }: ToolbarProps) {
  const [equipOpen, setEquipOpen] = useState(false)
  const equipRef = useRef<HTMLDivElement>(null)
  const { scene, presentation, handPose, dirty } = useRigEditor(
    useShallow((state) => ({
      scene: state.scene,
      presentation: state.presentation,
      handPose: state.handPose,
      dirty: state.dirty,
    })),
  )
  const setPresentation = useRigEditor((state) => state.setPresentation)
  const setHandPose = useRigEditor((state) => state.setHandPose)
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

  if (!scene) return <section className="toolbar" />

  const helmetVisible = Boolean(scene.layers.find((layer) => layer.id === HEADGEAR_LAYER_ID)?.visible)

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
          <SelectField
            id="chestSelect"
            label="Chest"
            value={presentation.chest}
            options={toOptions(scene.chestOptions)}
            onChange={(chest) => setPresentation({ chest })}
          />
          <SelectField
            id="armSetSelect"
            label="Arm set"
            value={presentation.armSet}
            options={toOptions(scene.armOptions)}
            onChange={(armSet) => setPresentation({ armSet })}
          />
          <SelectField
            id="bootSetSelect"
            label="Boot set"
            value={presentation.bootSet}
            options={toOptions(scene.bootOptions)}
            onChange={(bootSet) => setPresentation({ bootSet })}
          />
          <SelectField
            id="headgearSelect"
            label="Helmet"
            value={presentation.headgear}
            options={toOptions(scene.headgearOptions)}
            onChange={(headgear) => setPresentation({ headgear })}
          />
          <SelectField
            id="necklaceSelect"
            label="Necklace"
            value={presentation.necklace ?? ""}
            options={toOptions(scene.necklaceOptions)}
            placeholder="None"
            onChange={(necklace) => setPresentation({ necklace: necklace || null })}
          />
          <MainHandSelect scene={scene} />
          {HELD_SLOTS.filter((slot) => slot.layer !== "weapon" && slot.layer !== "staff").map((slot) => (
            <SelectField
              key={slot.layer}
              id={`${slot.layer}Select`}
              label={slot.layer === "bow" ? "Bow" : slot.layer === "shield" ? "Shield" : "Quiver"}
              value={presentation.held[slot.layer] ?? ""}
              options={toOptions(scene[slot.catalogue])}
              placeholder="None"
              onChange={(id) =>
                setPresentation({ held: { ...presentation.held, [slot.layer]: id || null } })
              }
            />
          ))}
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

      <SelectField
        id="handPoseSelect"
        label="Hands"
        value={handPose}
        options={handPoseNames.map((id) => ({ id, label: id }))}
        onChange={setHandPose}
      />

      <button id="resetPose" type="button" onClick={() => setManualPose({})}>
        Reset pose
      </button>

      <div className="toolbar-spacer" />

      {/* History is its own group: it acts on the document rather than on what
          the character is wearing, and it is not a save. */}
      <div className="toolbar-island" role="group" aria-label="Edit history">
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
    </section>
  )
}

/**
 * Weapons and staffs share one hand, so they share one selector: choosing an
 * item also chooses which of the two layers is drawn.
 */
function MainHandSelect({ scene }: { scene: RigScene }) {
  const presentation = useRigEditor((state) => state.presentation)
  const setPresentation = useRigEditor((state) => state.setPresentation)
  const value = `${presentation.mainHand}:${presentation.held[presentation.mainHand] ?? ""}`
  return (
    <div className="field">
      <Label htmlFor="mainHandSelect">Main hand</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          const [layer, id] = next.split(":")
          const mainHand = layer === "staff" ? "staff" : "weapon"
          setPresentation({ mainHand, held: { ...presentation.held, [mainHand]: id } })
        }}
      >
        <SelectTrigger id="mainHandSelect" size="sm">
          <SelectValue placeholder="Main hand" />
        </SelectTrigger>
        <SelectContent>
          {/* Both catalogues share one hand, so they share one picker; the
              groups are what keep a staff from looking like another sword. */}
          <SelectGroup>
            <SelectLabel>Weapons</SelectLabel>
            {(scene.weaponOptions ?? []).map((option) => (
              <SelectItem key={option.id} value={`weapon:${option.id}`}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Staffs, spears, and wands</SelectLabel>
            {(scene.staffOptions ?? []).map((option) => (
              <SelectItem key={option.id} value={`staff:${option.id}`}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
