/**
 * The Rig Studio.
 *
 * The shell owns the document lifecycle (load, playback, keyboard shortcuts)
 * and lays out the three columns. Every panel reads what it needs from the
 * store, so a change in one no longer forces the others to be re-synced by
 * hand — which is what the old studio's render loop spent most of its time on.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { animationDurations } from "@/rig/clips.ts"
import { STAGE_VIEW_SIZE } from "@/editor/stage.ts"
import { useRigEditor } from "@/stores/rig-editor.ts"
import { useResolvedRig, useTracks } from "@/hooks/use-rig-frame.ts"
import { useRigImages } from "@/hooks/use-rig-images.ts"
import { useEditorShortcuts } from "@/hooks/use-editor-shortcuts.ts"
import { profileLabels } from "@/editor/labels.ts"
import { StudioNav } from "@/components/StudioNav.tsx"
import { AnimationPicker } from "./AnimationPicker.tsx"
import { ExpressionKeys } from "./ExpressionKeys.tsx"
import { FingerCutoutEditor } from "./FingerCutoutEditor.tsx"
import { WristMeshEditor } from "./WristMeshEditor.tsx"
import { Inspector } from "./Inspector.tsx"
import { LayerPanel } from "./LayerPanel.tsx"
import { RigStage, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, type StageViewOptions } from "./RigStage.tsx"
import { StageToolbar } from "./StageToolbar.tsx"
import { Timeline } from "./Timeline.tsx"
import { Toolbar } from "./Toolbar.tsx"
import { WristStudio } from "./WristStudio.tsx"

const DEFAULT_VIEW: StageViewOptions = {
  showBones: true,
  showNames: false,
  showReference: false,
  showGrid: true,
  showMesh: false,
  dimUnselected: false,
  hideControlsDuringPlayback: true,
  zoom: 45,
}

export function RigStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState<StageViewOptions>(DEFAULT_VIEW)
  const [pickerOpen, setPickerOpen] = useState(false)

  const { scene, status, dirty, presentation, animation, playing, speed } = useRigEditor(
    useShallow((state) => ({
      scene: state.scene,
      status: state.status,
      dirty: state.dirty,
      presentation: state.presentation,
      animation: state.animation,
      playing: state.playing,
      speed: state.speed,
    })),
  )
  const load = useRigEditor((state) => state.load)
  const rig = useResolvedRig()
  const tracks = useTracks()
  const images = useRigImages(scene, rig, tracks, presentation.profile)

  useEffect(() => {
    void load()
  }, [load])

  // ---- playback ------------------------------------------------------------
  useEffect(() => {
    if (!playing) return
    let handle = 0
    let last = performance.now()
    const tick = (timestamp: number) => {
      const elapsed = (timestamp - last) / 1000
      last = timestamp
      const duration = animationDurations[animation] ?? 1
      const store = useRigEditor.getState()
      store.setPhase((store.phase + (elapsed * speed) / duration) % 1)
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing, animation, speed])

  // ---- keyboard ------------------------------------------------------------
  useEditorShortcuts({
    undo: () => useRigEditor.getState().undo(),
    redo: () => useRigEditor.getState().redo(),
    save: () => void useRigEditor.getState().save(),
    togglePlayback: () => {
      const store = useRigEditor.getState()
      store.setPlaying(!store.playing)
    },
    setMode: (mode) => useRigEditor.getState().setMode(mode),
  })

  const exportPNG = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement("a")
    link.download = `rig-${presentation.profile}-${animation}.png`
    link.href = canvas.toDataURL("image/png")
    link.click()
  }, [presentation.profile, animation])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="eyebrow">Modular Character Studio</span>
          <h1>Rig Studio</h1>
        </div>
        <div id="status" className="status">
          {/* Unsaved work is worth saying out loud; the status only carries a
              message of its own while loading, saving, or after a failure. */}
          {dirty ? "Unsaved rig layout" : status}
        </div>
        <StudioNav current="/rig" />
      </header>

      <Toolbar onExportPNG={exportPNG} />

      <section className="workspace">
        <LayerPanel />

        <section className="stage-shell">
          <StageToolbar view={view} onChange={(patch) => setView((current) => ({ ...current, ...patch }))} />
          <div
            id="stage"
            className="stage"
            onWheel={(event) => {
              // Plain scrolling pans the stage; only a modifier zooms it, so a
              // trackpad flick cannot resize the artboard by accident.
              if (!event.metaKey && !event.ctrlKey) return
              event.preventDefault()
              setView((current) => ({
                ...current,
                zoom: Math.max(
                  ZOOM_MIN,
                  Math.min(ZOOM_MAX, current.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)),
                ),
              }))
            }}
          >
            <RigStage images={images.resolve} reference={images.reference} view={view} canvasRef={canvasRef} />
          </div>
          <Timeline onOpenAnimationPicker={() => setPickerOpen(true)} />
        </section>

        <aside className="panel">
          <section className="panel-section">
            <span className="eyebrow">Profile</span>
            <h2 id="profileTitle">{profileLabels[presentation.profile]}</h2>
            <p>
              {presentation.chest} · {presentation.armSet} · {presentation.bootSet} ·{" "}
              {presentation.headgear}
            </p>
          </section>
          <ExpressionKeys />
          <WristStudio />
          <WristMeshEditor images={images.resolve} />
          <FingerCutoutEditor images={images.resolve} />
          <Inspector images={images.resolve} />
        </aside>
      </section>

      <AnimationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} images={images.resolve} />
    </main>
  )
}

export { STAGE_VIEW_SIZE }
