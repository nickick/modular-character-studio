/**
 * The stage: the posed character, the skeleton over it, and the pointer
 * interaction that edits either.
 *
 * The old studio re-synced every panel from inside its render loop, so a change
 * anywhere repainted everything and the loop had to know about the whole UI.
 * This paints the canvas and nothing else; the panels re-render from the store
 * on their own.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useShallow } from "zustand/react/shallow"
import { paintLayers, posedGripLayer, solveFrames, type PaintContext } from "@/canvas/paint.ts"
import { drawBackdrop, drawSelectionOutline, drawSkeleton, floorLineY } from "@/canvas/overlays.ts"
import { layerCorners } from "@/canvas/paint.ts"
import {
  STAGE_OVERSCAN,
  STAGE_VIEW_SIZE,
  beginLayerDrag,
  boneDragKind,
  hitBone,
  hitLayer,
  parentInverse,
  sideOf,
  solveArmIKDrag,
  solveBoneDrag,
  solveElbowDrag,
  solveLayerDrag,
  stagePoint,
  withDragDelta,
  type DragContext,
  type LayerDragAnchor,
} from "@/editor/stage.ts"
import { worldMatrices } from "@/rig/skeleton.ts"
import { animationDurations } from "@/rig/clips.ts"
import { useRigEditor, type RigSnapshot } from "@/stores/rig-editor.ts"
import {
  heldLayerFor,
  useAuthoredPose,
  useCombinedPose,
  useHandControls,
  useResolvedRig,
  useTracks,
  useVisibleLayers,
} from "@/hooks/use-rig-frame.ts"
import type { LayerImageResolver } from "@/hooks/use-rig-images.ts"
import type { LayerImage } from "@/canvas/paint.ts"
import type { Matrix2D, Point, ProfileID, ResolvedBone, ResolvedLayer, RigScene, Side } from "@/rig/types.ts"

/** How far the stage can be zoomed, as a percentage of the artboard. */
export const ZOOM_MIN = 35
export const ZOOM_MAX = 110
export const ZOOM_STEP = 5

export interface StageViewOptions {
  showBones: boolean
  showNames: boolean
  showReference: boolean
  showGrid: boolean
  showMesh: boolean
  dimUnselected: boolean
  hideControlsDuringPlayback: boolean
  zoom: number
}

/**
 * What a drag in progress is editing. Each kind is its own member -- a shared
 * `"armIK" | "armElbow"` member reads more compactly but stops the compiler
 * narrowing the arm cases apart from the bone case.
 */
type Drag =
  | { kind: "armIK"; side: Side; before: RigSnapshot }
  | { kind: "armElbow"; side: Side; before: RigSnapshot }
  | { kind: "bone"; bone: ResolvedBone; parentInverse: Matrix2D; before: RigSnapshot }
  | { kind: "layer"; layerID: string; anchor: LayerDragAnchor; before: RigSnapshot }

export interface RigStageProps {
  images: LayerImageResolver
  reference: LayerImage | null
  view: StageViewOptions
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

export function RigStage({ images, reference, view, canvasRef }: RigStageProps) {
  const rig = useResolvedRig()
  const tracks = useTracks()
  const pose = useCombinedPose()
  const authored = useAuthoredPose()
  const handControls = useHandControls()
  const visibleLayers = useVisibleLayers()
  const dragRef = useRef<Drag | null>(null)

  const {
    scene,
    animation,
    phase,
    mode,
    selectedBone,
    selectedLayer,
    clipScopedEdits,
    manualPose,
    mainHand,
    playing,
  } = useRigEditor(
    useShallow((state) => ({
      scene: state.scene,
      animation: state.animation,
      phase: state.phase,
      mode: state.mode,
      selectedBone: state.selectedBone,
      selectedLayer: state.selectedLayer,
      clipScopedEdits: state.clipScopedEdits,
      manualPose: state.manualPose,
      mainHand: state.presentation.mainHand,
      playing: state.playing,
    })),
  )

  const heldLayer = useMemo(
    () => heldLayerFor(rig, animation, mainHand),
    [rig, animation, mainHand],
  )

  const paintContext = useMemo<PaintContext>(
    () => ({
      rig,
      animation,
      phase,
      images,
      heldLayer,
      handControls,
      showMesh: view.showMesh,
      soloLayerID: view.dimUnselected ? selectedLayer : null,
    }),
    [rig, animation, phase, images, heldLayer, handControls, view.showMesh, view.dimUnselected, selectedLayer],
  )

  const frame = useMemo(
    () => solveFrames(rig, { authored: pose, manual: {}, clipScoped: true }),
    [rig, pose],
  )

  /**
   * Unsaved bind edits belong in the fit reference frame as well as the posed
   * one, or a fitted layer previews a similarity fit whose scale vanishes the
   * moment saving bakes those edits into the bind.
   */
  const bindFrame = useMemo(
    () => (clipScopedEdits ? frame.bindWorld : worldMatrices(rig.bones, manualPose)),
    [clipScopedEdits, frame.bindWorld, rig.bones, manualPose],
  )

  const imageForLayer = useCallback(
    (layer: ResolvedLayer) => images(layer, animation, phase),
    [images, animation, phase],
  )

  // ---- painting -----------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    const target = canvas?.getContext("2d")
    if (!canvas || !target || !scene) return
    const baseline = scene.profileReference.canonicalTargetPixels?.baseline
    const painted = { ...frame, bindWorld: bindFrame }
    drawBackdrop(target, {
      showGrid: view.showGrid,
      floorY: floorLineY(rig, frame.meshBindWorld, imageForLayer, baseline),
    })
    target.save()
    target.translate(STAGE_OVERSCAN, STAGE_OVERSCAN)
    if (view.showReference && reference) {
      target.save()
      target.globalAlpha = 0.24
      target.drawImage(reference, 0, 0, STAGE_VIEW_SIZE - STAGE_OVERSCAN * 2, STAGE_VIEW_SIZE - STAGE_OVERSCAN * 2)
      target.restore()
    }
    paintLayers(target, visibleLayers, painted, paintContext)
    const selected = rig.layers.find((layer) => layer.id === selectedLayer)
    const selectedImage = selected ? imageForLayer(selected) : null
    if (mode === "layer" && selected && selectedImage) {
      drawSelectionOutline(target, layerCorners(selected, selectedImage, painted, paintContext))
    }
    if (view.showBones && !(playing && view.hideControlsDuringPlayback)) {
      drawSkeleton(target, {
        bones: rig.bones,
        currentWorld: frame.currentWorld,
        selectedBone,
        showNames: view.showNames,
      })
    }
    target.restore()
  }, [
    canvasRef, scene, rig, frame, bindFrame, visibleLayers, paintContext, imageForLayer,
    reference, view, mode, selectedBone, selectedLayer, playing,
  ])

  // ---- pointer interaction ------------------------------------------------
  const dragContext = useCallback(
    (): DragContext => ({ bones: rig.bones, pose, authored, currentWorld: frame.currentWorld }),
    [rig.bones, pose, authored, frame.currentWorld],
  )

  const pointAt = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      return stagePoint(event, canvas.getBoundingClientRect())
    },
    [canvasRef],
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const store = useRigEditor.getState()
      if (!store.scene) return
      const point = pointAt(event)
      if (!point) return
      store.setPlaying(false)
      const before = store.snapshot()
      if (store.mode === "bone") {
        const bone = hitBone(point, rig.bones, frame.currentWorld)
        if (!bone) return
        store.selectBone(bone.id)
        const kind = boneDragKind(bone.id)
        dragRef.current =
          kind === "bone"
            ? { kind: "bone", bone, parentInverse: parentInverse(bone, frame.currentWorld), before }
            : { kind, side: sideOf(bone.id), before }
      } else {
        const hit =
          hitLayer(
            point,
            visibleLayers,
            imageForLayer,
            (layer) => posedGripLayer(layer, paintContext, handControls(layer)),
            frame.meshBindWorld,
            frame.currentWorld,
          ) ?? rig.layers.find((layer) => layer.id === store.selectedLayer)
        if (!hit) return
        store.selectLayer(hit.id)
        dragRef.current = {
          kind: "layer",
          layerID: hit.id,
          anchor: beginLayerDrag(point, hit, frame.currentWorld),
          before,
        }
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [pointAt, rig, frame, visibleLayers, imageForLayer, paintContext, handControls],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const point = pointAt(event)
      if (!point) return
      const store = useRigEditor.getState()
      if (drag.kind === "layer") {
        const placement = solveLayerDrag(point, drag.anchor)
        store.editSceneSilently((scene) => {
          writeLayerPlacement(scene, drag.layerID, store.presentation.profile, placement)
        })
        return
      }
      const context = dragContext()
      let delta
      if (drag.kind === "armElbow") delta = solveElbowDrag(point, drag.side, context)
      else if (drag.kind === "armIK") delta = solveArmIKDrag(point, drag.side, context)
      else delta = solveBoneDrag(point, drag.bone, drag.parentInverse, context.authored)
      store.setManualPose(withDragDelta(store.manualPose, delta))
    },
    [pointAt, dragContext],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      if (!drag) return
      event.currentTarget.releasePointerCapture(event.pointerId)
      const store = useRigEditor.getState()
      if (drag.kind !== "layer") store.commitManualPose()
      store.commit(drag.before)
      dragRef.current = null
    },
    [],
  )

  return (
    // The wrap is a square whose side is `--canvas-scale` of the artboard, and
    // the canvas fills it. Setting a width alone would leave the stylesheet's
    // height in place and stretch the square drawing into a rectangle.
    <div
      id="canvasWrap"
      className="canvas-wrap"
      style={{ "--canvas-scale": view.zoom / 100 } as CSSProperties}
    >
      <canvas
        id="rigCanvas"
        ref={canvasRef}
        width={STAGE_VIEW_SIZE}
        height={STAGE_VIEW_SIZE}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}

/** Write a dragged placement onto whichever record owns it for this profile. */
function writeLayerPlacement(
  scene: RigScene,
  layerID: string,
  profile: ProfileID,
  placement: { x: number; y: number },
): void {
  const layer = scene.layers.find((candidate) => candidate.id === layerID)
  if (!layer) return
  const bind = layer.bindByProfile[profile]
  bind.x = placement.x
  bind.y = placement.y
}

/** The clip's length in seconds, for the transport readout. */
export const clipSeconds = (animation: string): number =>
  animationDurations[animation as keyof typeof animationDurations] ?? 1
