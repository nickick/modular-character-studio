/** Stage view options: what is drawn over the character, and how large. */
import { Toggle } from "@/components/Toggle.tsx"
import { Slider } from "@/components/ui/slider.tsx"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx"
import { useRigEditor } from "@/stores/rig-editor.ts"
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, type StageViewOptions } from "./RigStage.tsx"

export interface StageToolbarProps {
  view: StageViewOptions
  onChange: (patch: Partial<StageViewOptions>) => void
}

export function StageToolbar({ view, onChange }: StageToolbarProps) {
  const mode = useRigEditor((state) => state.mode)
  const setMode = useRigEditor((state) => state.setMode)
  return (
    <div className="stage-toolbar">
      <ToggleGroup
        type="single"
        size="sm"
        value={mode}
        // A mode is always active, so an attempt to clear the group keeps it.
        onValueChange={(next) => setMode(next === "layer" || next === "bone" ? next : mode)}
        className="segmented"
        aria-label="What the stage edits"
      >
        <ToggleGroupItem id="modeLayer" value="layer">
          Layers
        </ToggleGroupItem>
        <ToggleGroupItem id="modeBone" value="bone">
          Bones
        </ToggleGroupItem>
      </ToggleGroup>
      <Toggle label="Bones" checked={view.showBones} onChange={(showBones) => onChange({ showBones })} />
      <Toggle label="Names" checked={view.showNames} onChange={(showNames) => onChange({ showNames })} />
      <Toggle
        label="Reference"
        checked={view.showReference}
        onChange={(showReference) => onChange({ showReference })}
      />
      <Toggle label="Grid" checked={view.showGrid} onChange={(showGrid) => onChange({ showGrid })} />
      <Toggle label="Wrist mesh" checked={view.showMesh} onChange={(showMesh) => onChange({ showMesh })} />
      <Toggle
        label="Dim unselected"
        checked={view.dimUnselected}
        onChange={(dimUnselected) => onChange({ dimUnselected })}
      />
      <label className="zoom-control">
        <span>Zoom</span>
        <Slider
          id="zoom"
          aria-label="Stage zoom"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={[view.zoom]}
          onValueChange={([zoom]) => onChange({ zoom })}
        />
        <output id="zoomValue">{view.zoom}%</output>
      </label>
    </div>
  )
}
