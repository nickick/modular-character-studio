/**
 * The Equipment Studio.
 *
 * One piece of gear is fitted at a time, previewed on one or both bodies in
 * whichever clip is worth judging that placement in.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { animationDurations, reviewAnimations } from "@/rig/clips.ts"
import { profileIDs } from "@/rig/types.ts"
import { profileLabels } from "@/editor/labels.ts"
import {
  EQUIPMENT_SLOTS,
  activeLayerID,
  clipLabel,
  REVIEW_PHASE,
} from "@/editor/equipment-slots.ts"
import { loadEquipmentCatalog, type EquipmentCatalog } from "@/editor/equipment-catalog.ts"
import { useEquipmentImages } from "@/hooks/use-equipment-images.ts"
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts.ts"
import type { LayerImageResolver } from "@/hooks/use-rig-images.ts"
import {
  catalogueFor,
  equipmentCanRedo,
  equipmentCanUndo,
  primaryProfile,
  resolveBothProfiles,
  sceneTracks,
  selectedOption,
  useEquipmentEditor,
  type StageView,
} from "@/stores/equipment-editor.ts"
import { StudioNav } from "@/components/StudioNav.tsx"
import { AnimationPickerDialog } from "@/components/shared/AnimationPickerDialog.tsx"
import { ItemThumbnail } from "@/components/shared/ItemThumbnail.tsx"
import { Toggle } from "@/components/Toggle.tsx"
import { Slider } from "@/components/ui/slider.tsx"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx"
import { EquipmentStage } from "./EquipmentStage.tsx"
import { ItemPicker } from "./ItemPicker.tsx"
import { PlacementPanel } from "./PlacementPanel.tsx"

const VIEWS: ReadonlyArray<{ id: StageView; label: string }> = [
  { id: "both", label: "Both" },
  { id: "maleV1", label: profileLabels.maleV1 },
  { id: "femaleV1", label: profileLabels.femaleV1 },
]

/** A row of mutually exclusive tabs. One is always chosen, so it cannot clear. */
function SlotTabs({
  id,
  label,
  slots,
  value,
  onChange,
}: {
  id: string
  label: string
  slots: ReadonlyArray<{ id: string; label: string }>
  value: string
  onChange: (id: string) => void
}) {
  return (
    <ToggleGroup
      id={id}
      type="single"
      size="sm"
      className="slot-tabs"
      value={value}
      aria-label={label}
      onValueChange={(next) => onChange(next || value)}
    >
      {slots.map((slot) => (
        <ToggleGroupItem key={slot.id} value={slot.id}>
          {slot.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/**
 * Transport glyphs. The button carries an icon rather than a word, so its
 * `aria-label` is what says which way pressing it will go.
 */
const PlayGlyph = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 2.6v10.8L13.5 8z" />
  </svg>
)

const PauseGlyph = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 2.6h3.1v10.8H4zM8.9 2.6H12v10.8H8.9z" />
  </svg>
)

export function EquipmentStudio() {
  const [catalog, setCatalog] = useState<EquipmentCatalog | null>(null)
  const [itemPickerOpen, setItemPickerOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const { scene, status, view, slot, item, piece, animation, phase, playing, zoom, showOthers, dirty } =
    useEquipmentEditor(
      useShallow((state) => ({
        scene: state.scene,
        status: state.status,
        view: state.view,
        slot: state.slot,
        item: state.item,
        piece: state.piece,
        animation: state.animation,
        phase: state.phase,
        playing: state.playing,
        zoom: state.zoom,
        showOthers: state.showOthers,
        dirty: state.dirty,
      })),
    )
  const load = useEquipmentEditor((state) => state.load)
  const save = useEquipmentEditor((state) => state.save)
  const setView = useEquipmentEditor((state) => state.setView)
  const selectSlot = useEquipmentEditor((state) => state.selectSlot)
  const selectPiece = useEquipmentEditor((state) => state.selectPiece)
  const setAnimation = useEquipmentEditor((state) => state.setAnimation)
  const setPhase = useEquipmentEditor((state) => state.setPhase)
  const setPlaying = useEquipmentEditor((state) => state.setPlaying)
  const setZoom = useEquipmentEditor((state) => state.setZoom)
  const setShowOthers = useEquipmentEditor((state) => state.setShowOthers)
  const undo = useEquipmentEditor((state) => state.undo)
  const redo = useEquipmentEditor((state) => state.redo)
  const revertItem = useEquipmentEditor((state) => state.revertItem)
  const undoAvailable = useEquipmentEditor(equipmentCanUndo)
  const redoAvailable = useEquipmentEditor(equipmentCanRedo)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    loadEquipmentCatalog()
      .then(setCatalog)
      .catch(() => setCatalog(null))
  }, [])

  const layerID = activeLayerID(slot, piece)
  const rigs = useMemo(() => resolveBothProfiles(scene, slot, item), [scene, slot, item])
  const tracks = useMemo(() => sceneTracks(scene), [scene])
  // One cache covers both bodies: the combined view draws them side by side.
  const images = useEquipmentImages(rigs, tracks)

  /**
   * Bound to the body the fields speak for. Memoized deliberately: the picker
   * drives its previews from an animation frame loop keyed on this, and a fresh
   * arrow each render would tear that loop down before it could ever paint.
   */
  const previewImages = useCallback<LayerImageResolver>(
    (layer, clip, at) => images.resolve(primaryProfile(view), layer, clip, at),
    [images, view],
  )

  /** The clips worth judging this piece in. */
  const clips = useMemo(() => reviewAnimations(layerID), [layerID])

  useEffect(() => {
    if (!clips.includes(animation as (typeof clips)[number])) {
      const next = clips[0]
      setAnimation(next)
      setPhase(REVIEW_PHASE[next] ?? 0)
    }
  }, [clips, animation, setAnimation, setPhase])

  useEditorShortcuts({
    undo: () => useEquipmentEditor.getState().undo(),
    redo: () => useEquipmentEditor.getState().redo(),
    save: () => void useEquipmentEditor.getState().save(),
    togglePlayback: () => {
      const store = useEquipmentEditor.getState()
      store.setPlaying(!store.playing)
    },
  })

  useEffect(() => {
    if (!playing) return
    let handle = 0
    let last = performance.now()
    const tick = (timestamp: number) => {
      const elapsed = (timestamp - last) / 1000
      last = timestamp
      const duration = animationDurations[animation as keyof typeof animationDurations] ?? 1
      const store = useEquipmentEditor.getState()
      store.setPhase((store.phase + elapsed / duration) % 1)
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing, animation])

  const options = catalogueFor(scene, slot)
  const option = selectedOption(scene, slot, item)
  const catalogItem = option?.itemID ? catalog?.items.get(option.itemID) : null
  const seconds = (animationDurations[animation as keyof typeof animationDurations] ?? 1) * phase

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Modular Character Studio</p>
          <h1>Equipment Studio</h1>
        </div>
        <p id="status" className="status">
          {dirty ? "Unsaved placement" : status}
        </p>
        <div className="header-actions">
          <ToggleGroup
            id="viewTabs"
            type="single"
            size="sm"
            className="view-tabs"
            value={view}
            aria-label="Which bodies to show"
            onValueChange={(next) => setView((next || view) as StageView)}
          >
            {VIEWS.map((candidate) => (
              <ToggleGroupItem key={candidate.id} value={candidate.id}>
                {candidate.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <button type="button" onClick={undo} disabled={!undoAvailable}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!redoAvailable}>
            Redo
          </button>
          <button type="button" onClick={revertItem} disabled={!item}>
            Revert
          </button>
          <button type="button" className="accent" onClick={() => void save()}>
            {dirty ? "Save" : "Saved"}
          </button>
          <StudioNav current="/equipment" />
        </div>
      </header>

      <main className="layout">
        <aside className="panel">
          <div className="section-heading">
            <span className="eyebrow">Held</span>
          </div>
          <SlotTabs
            id="slotTabs"
            label="Held slots"
            slots={EQUIPMENT_SLOTS.filter((candidate) => !candidate.worn)}
            value={slot.id}
            onChange={selectSlot}
          />
          <div className="section-heading">
            <span className="eyebrow">Worn</span>
          </div>
          <SlotTabs
            id="wornTabs"
            label="Worn slots"
            slots={EQUIPMENT_SLOTS.filter((candidate) => candidate.worn)}
            value={slot.id}
            onChange={selectSlot}
          />

          {slot.pieces?.length ? (
            <>
              <div className="section-heading">
                <span className="eyebrow">Piece</span>
              </div>
              <SlotTabs
                id="pieceTabs"
                label="Pieces in this set"
                slots={slot.pieces}
                value={piece ?? ""}
                onChange={selectPiece}
              />
            </>
          ) : null}

          <div className="section-heading">
            <span className="eyebrow">Item</span>
            <output id="itemCount">{options.length}</output>
          </div>
          <button id="itemPicker" type="button" className="item-picker" onClick={() => setItemPickerOpen(true)}>
            <ItemThumbnail item={catalogItem} />
            <span className="item-picker-copy">
              <span id="itemPickerName">{catalogItem?.name ?? option?.label ?? "No item"}</span>
              <span id="itemPickerMeta" className="item-picker-meta">
                {option?.itemID ?? "not in the item catalogue"}
              </span>
            </span>
          </button>
        </aside>

        <section className="stage-shell">
          <div className="stage-toolbar">
            <span id="stageTitle" className="stage-title">
              {slot.label} · {option?.label ?? "nothing selected"}
            </span>
            <Toggle
              id="showOthers"
              label="Show the rest of the rig"
              checked={showOthers}
              onChange={setShowOthers}
            />
            <label className="zoom-control">
              <span>Zoom</span>
              <Slider
                id="zoom"
                aria-label="Stage zoom"
                min={30}
                max={120}
                step={1}
                value={[Math.round(zoom * 100)]}
                onValueChange={([next]) => setZoom(next / 100)}
              />
              <output id="zoomValue">{Math.round(zoom * 100)}%</output>
            </label>
          </div>

          <EquipmentStage images={images.resolve} />

          <div className="animation-controls">
            <div className="animation-picker-control">
              <button
                id="animationPickerButton"
                type="button"
                className="animation-picker-button"
                onClick={() => setPickerOpen(true)}
              >
                {clipLabel(animation, slot.id)}
              </button>
            </div>
            <button
              id="playPause"
              type="button"
              className="icon-button"
              aria-pressed={playing}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause" : "Play"}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <PauseGlyph /> : <PlayGlyph />}
            </button>
            <span id="animationTimeReadout">{seconds.toFixed(2)} s</span>
            <Slider
              id="animationTimeline"
              aria-label="Playhead"
              min={0}
              max={1000}
              step={1}
              value={[Math.round(phase * 1000)]}
              onValueChange={([at]) => {
                setPlaying(false)
                setPhase(at / 1000)
              }}
            />
          </div>
        </section>

        <PlacementPanel />
      </main>

      <ItemPicker catalog={catalog} open={itemPickerOpen} onClose={() => setItemPickerOpen(false)} />
      <AnimationPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        images={previewImages}
        rig={rigs[primaryProfile(view)]}
        tracks={tracks}
        animation={animation}
        onSelect={(next) => {
          setAnimation(next)
          // Open on the moment worth judging this placement at.
          setPhase(REVIEW_PHASE[next] ?? 0)
        }}
        mainHand={slot.id === "staff" ? "staff" : "weapon"}
        clips={clips}
        labelFor={(name) => clipLabel(name, slot.id)}
      />
    </div>
  )
}

export { profileIDs }
