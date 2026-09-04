/**
 * The placement panel: where the selected piece sits on the body.
 *
 * In the combined view a field writes to both bodies at once, which is what
 * makes that view worth having — most gear sits the same way on both, and doing
 * it twice by hand is how the two drift apart. A single-body view writes only
 * that body, overriding whatever the combined view last set.
 */
import { useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { NumericField } from "@/components/NumericField.tsx"
import { SelectField } from "@/components/SelectField.tsx"
import { ExpressionKeysPanel } from "@/components/shared/ExpressionKeysPanel.tsx"
import { GripPanel } from "./GripPanel.tsx"
import { Toggle } from "@/components/Toggle.tsx"
import { writeLayerBind } from "@/editor/binds.ts"
import { layerBindOwner } from "@/rig/skeleton.ts"
import { profileLabels } from "@/editor/labels.ts"
import { activeLayerID } from "@/editor/equipment-slots.ts"
import {
  catalogueFor,
  primaryProfile,
  selectedOption,
  shownProfiles,
  useEquipmentEditor,
  wornScene,
  type EquipmentSnapshot,
  sceneTracks,
} from "@/stores/equipment-editor.ts"
import type { LayerBindKey } from "@/rig/types.ts"

const FIELDS: ReadonlyArray<{ key: LayerBindKey; label: string; min: number; max: number; step: number }> = [
  { key: "x", label: "X", min: -600, max: 600, step: 0.5 },
  { key: "y", label: "Y", min: -600, max: 600, step: 0.5 },
  { key: "rotation", label: "Rotation", min: -180, max: 180, step: 0.5 },
  { key: "planeYaw", label: "Plane yaw", min: -80, max: 80, step: 0.5 },
  { key: "scaleX", label: "Scale X", min: -3, max: 3, step: 0.005 },
  { key: "scaleY", label: "Scale Y", min: -3, max: 3, step: 0.005 },
  { key: "pivotX", label: "Pivot X", min: 0, max: 1, step: 0.001 },
  { key: "pivotY", label: "Pivot Y", min: 0, max: 1, step: 0.001 },
]

export function PlacementPanel() {
  const pending = useRef<EquipmentSnapshot | null>(null)
  const { scene, view, slot, item, piece, copySource, animation, phase } = useEquipmentEditor(
    useShallow((state) => ({
      scene: state.scene,
      view: state.view,
      slot: state.slot,
      item: state.item,
      piece: state.piece,
      copySource: state.copySource,
      animation: state.animation,
      phase: state.phase,
    })),
  )
  const editScene = useEquipmentEditor((state) => state.editScene)
  const editSceneSilently = useEquipmentEditor((state) => state.editSceneSilently)
  const setCopySource = useEquipmentEditor((state) => state.setCopySource)
  const revertItem = useEquipmentEditor((state) => state.revertItem)
  const setPhase = useEquipmentEditor((state) => state.setPhase)

  if (!scene || !item) {
    return (
      <aside className="panel">
        <div className="empty-state">Pick an item to place it.</div>
      </aside>
    )
  }

  const layerID = activeLayerID(slot, piece)
  const layer = scene.layers.find((candidate) => candidate.id === layerID)
  const selection = wornScene(scene, slot, item)
  const bind = layer ? layerBindOwner(selection, layer, primaryProfile(view)) : null
  const option = selectedOption(scene, slot, item)

  const begin = () => {
    pending.current ??= useEquipmentEditor.getState().snapshot()
  }
  const end = () => {
    useEquipmentEditor.getState().commit(pending.current)
    pending.current = null
  }
  const write = (key: LayerBindKey, value: number) =>
    editSceneSilently((draft) => {
      const draftSelection = wornScene(draft, slot, item)
      for (const profile of shownProfiles(view)) {
        writeLayerBind(draft, draftSelection, layerID, profile, key, value)
      }
    })

  const copyOptions = catalogueFor(scene, slot)
    .filter((candidate) => candidate.id !== item)
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base", numeric: true }),
    )
    .map((candidate) => ({ id: candidate.id, label: candidate.label }))

  return (
    <aside className="panel">
      <div id="placementBox">
        <div className="section-heading">
          <span className="eyebrow">Placement</span>
        </div>
        <p id="editScope" className="edit-scope">
          {view === "both"
            ? "Placement applies to both bodies"
            : `Placement applies to ${profileLabels[view]} only`}
        </p>
        <p id="itemTitle" className="item-title">
          {option?.label ?? item}
          {slot.pieces?.length ? ` · ${slot.pieces.find((p) => p.id === piece)?.label ?? piece}` : ""}
        </p>

        {bind ? (
          <div className="field-grid">
            {FIELDS.map((field) => (
              <NumericField
                key={field.key}
                label={field.label}
                value={bind[field.key] ?? 0}
                min={field.min}
                max={field.max}
                step={field.step}
                onBegin={begin}
                onEnd={end}
                onChange={(value) => write(field.key, value)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">This piece has no placement of its own.</div>
        )}

        <Toggle
          label="Fitted over the rig"
          checked={option?.fitted === true}
          onChange={(fitted) =>
            editScene((draft) => {
              const target = draft[slot.catalogue]?.find((candidate) => candidate.id === item)
              if (!target) return
              // Placement alone cannot say whether a piece has been fitted: a
              // seeded default and a dialled-in fit look the same in the data,
              // so the person who did the fitting records it.
              if (fitted) target.fitted = true
              else delete target.fitted
            })
          }
        />

        <GripPanel />

        <SelectField
          label="Copy placement from"
          value={copySource ?? ""}
          options={copyOptions}
          placeholder="Choose an item"
          onChange={setCopySource}
        />
        <div className="wrist-key-actions">
          <button
            type="button"
            disabled={!copySource}
            onClick={() =>
              editScene((draft) => {
                const source = draft[slot.catalogue]?.find((candidate) => candidate.id === copySource)
                const target = draft[slot.catalogue]?.find((candidate) => candidate.id === item)
                if (!source || !target) return
                if (source.bindByProfile) target.bindByProfile = structuredClone(source.bindByProfile)
                if (source.bindByLayer) target.bindByLayer = structuredClone(source.bindByLayer)
              })
            }
          >
            Copy placement
          </button>
          <button type="button" onClick={revertItem}>
            Revert item
          </button>
        </div>
      </div>
      <ExpressionKeysPanel
        scene={scene}
        tracks={sceneTracks(scene)}
        animation={animation}
        phase={phase}
        editScene={editScene}
        setPhase={setPhase}
      />
    </aside>
  )
}
