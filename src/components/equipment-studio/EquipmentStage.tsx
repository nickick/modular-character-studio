/**
 * The equipment stage: one canvas per body on screen.
 *
 * Both bodies stay resolved whether or not they are shown, so switching the
 * view is a redraw rather than a reload. Dragging on either canvas writes to
 * whichever placements the current view speaks for.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { layerCorners, paintLayers, solvePreviewFrames, type PaintContext } from "@/canvas/paint.ts"
import { drawSelectionOutline } from "@/canvas/overlays.ts"
import { inverse, transformPoint } from "@/rig/matrix.ts"
import { constrainForearmPose } from "@/rig/ik.ts"
import { layerMatchesAnimationEquipment, layerMatchesHandPose, animationHandPose } from "@/rig/clips.ts"
import { STAGE_SIZE } from "@/editor/stage.ts"
import {
  GRIPPABLE_SLOTS,
  GRIP_HAND_LAYER_IDS,
  MAIN_HAND_LAYER_IDS,
  activeLayerID,
  heldElsewhere,
  mainHandLayerFor,
} from "@/editor/equipment-slots.ts"
import { visibleImageBounds } from "@/editor/visible-bounds.ts"
import { writeLayerBind } from "@/editor/binds.ts"
import { profileLabels } from "@/editor/labels.ts"
import { activeGripKind } from "@/editor/keyframes.ts"
import {
  primaryProfile,
  resolveBothProfiles,
  sceneTracks,
  shownProfiles,
  useEquipmentEditor,
  wornScene,
  type EquipmentSnapshot,
} from "@/stores/equipment-editor.ts"
import type { ProfileImageResolver } from "@/hooks/use-equipment-images.ts"
import type { GripControls } from "@/rig/grip.ts"
import type { Point, ProfileID, ResolvedLayer } from "@/rig/types.ts"

export interface EquipmentStageProps {
  images: ProfileImageResolver
}

export function EquipmentStage({ images }: EquipmentStageProps) {
  const { scene, view, slot, item, piece, animation, phase, zoom, showOthers } = useEquipmentEditor(
    useShallow((state) => ({
      scene: state.scene,
      view: state.view,
      slot: state.slot,
      item: state.item,
      piece: state.piece,
      animation: state.animation,
      phase: state.phase,
      zoom: state.zoom,
      showOthers: state.showOthers,
    })),
  )
  const profiles = shownProfiles(view)
  const stagesRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(1)
  const rigs = useMemo(() => resolveBothProfiles(scene, slot, item), [scene, slot, item])
  const tracks = useMemo(() => sceneTracks(scene), [scene])
  const layerID = activeLayerID(slot, piece)

  useEffect(() => {
    const stages = stagesRef.current
    if (!stages) return

    const fitStages = () => {
      const styles = getComputedStyle(stages)
      const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
      const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
      const gap = parseFloat(styles.columnGap) || 0
      const captionHeight = 22
      const width = Math.max(1, stages.clientWidth - horizontalPadding - gap * (profiles.length - 1))
      const height = Math.max(1, stages.clientHeight - verticalPadding - captionHeight)
      const next = Math.min(width / profiles.length / STAGE_SIZE, height / STAGE_SIZE)
      setFitScale((current) => Math.abs(current - next) < 0.0005 ? current : next)
    }

    fitStages()
    const observer = new ResizeObserver(fitStages)
    observer.observe(stages)
    return () => observer.disconnect()
  }, [profiles.length])

  const displaySize = STAGE_SIZE * fitScale * zoom

  return (
    <div ref={stagesRef} id="stages" className="canvas-wrap" data-profile-count={profiles.length}>
      {profiles.map((profile) => (
        <ProfileStage
          key={profile}
          profile={profile}
          rig={rigs[profile]}
          tracks={tracks}
          images={images}
          animation={animation}
          phase={phase}
          displaySize={displaySize}
          showOthers={showOthers}
          layerID={layerID}
          slotID={slot.id}
          editable={view === "both" || view === profile}
          // The dashed box marks the piece being placed. Drawing it on both
          // bodies at once reads as two selections rather than one.
          outlined={profile === primaryProfile(view)}
        />
      ))}
    </div>
  )
}

interface ProfileStageProps {
  profile: ProfileID
  rig: ReturnType<typeof resolveBothProfiles>[ProfileID]
  tracks: ReturnType<typeof sceneTracks>
  images: ProfileImageResolver
  animation: string
  phase: number
  displaySize: number
  showOthers: boolean
  layerID: string
  slotID: string
  editable: boolean
  outlined: boolean
}

function ProfileStage(props: ProfileStageProps) {
  const { profile, rig, tracks, images, animation, phase, displaySize, showOthers, layerID, slotID } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ grab: Point; startX: number; startY: number; boneInverse: ReturnType<typeof inverse> } | null>(null)
  const dragBefore = useRef<EquipmentSnapshot | null>(null)

  const gripKind = activeGripKind(animation, slotID === "staff" ? "staff" : "weapon")
  const heldLayer = useMemo(() => {
    const id = GRIPPABLE_SLOTS.has(slotID)
      ? slotID
      : animation.startsWith("bow")
        ? "bow"
        : animation.startsWith("staff")
          ? "staff"
          : "weapon"
    return rig.layers.find((layer) => layer.id === id) ?? null
  }, [rig.layers, slotID, animation])

  const handControls = useCallback(
    (layer: ResolvedLayer): Partial<GripControls> =>
      tracks.gripControlsAt(
        animation,
        layer.bone.endsWith("R") ? "R" : "L",
        phase,
        ["handClosedLIndex", "handClosedLMiddle", "handClosedLRing", "handClosedLPinky"],
        gripKind,
      ),
    [tracks, animation, phase, gripKind],
  )

  const pose = useMemo(
    () => constrainForearmPose(rig.bones, tracks.pose(animation, phase)),
    [rig.bones, tracks, animation, phase],
  )

  const imagesForProfile = useCallback(
    (layer: ResolvedLayer, clip: string, at: number) => images(profile, layer, clip, at),
    [images, profile],
  )

  const context = useMemo<PaintContext>(
    () => ({ rig, tracks, animation, phase, images: imagesForProfile, heldLayer, handControls }),
    [rig, tracks, animation, phase, imagesForProfile, heldLayer, handControls],
  )
  const frame = useMemo(() => solvePreviewFrames(rig, { authored: pose }, context), [rig, pose, context])

  const layers = useMemo(() => {
    const handPose = animationHandPose[animation as keyof typeof animationHandPose] ?? "closed"
    const placedBone = rig.layers.find((layer) => layer.id === layerID)?.bone
    const mainHandID = mainHandLayerFor(layerID, animation)
    return rig.layers.filter((layer) => {
      // The palm, thumb, and four rigid fingers are part of fitting a held item
      // rather than "the rest of the rig", so they stay visible throughout.
      const gripHand = GRIPPABLE_SLOTS.has(slotID) && GRIP_HAND_LAYER_IDS.has(layer.id)
      if (!layer.visible || !layerMatchesHandPose(layer, handPose)) return false
      if (gripHand || layer.id === layerID) return true
      // Only one thing is in the main hand, whatever the clip's loadout lists.
      if (MAIN_HAND_LAYER_IDS.has(layer.id) && layer.id !== mainHandID) return false
      // Nothing else the clip carries in that same hand draws: reviewing a
      // staff in the lunge would otherwise put the sword through it, since that
      // clip is authored to hold a blade.
      if (heldElsewhere(layer, placedBone)) return false
      return showOthers && layerMatchesAnimationEquipment(layer, animation)
    })
  }, [rig.layers, layerID, showOthers, animation, slotID])

  useEffect(() => {
    const canvas = canvasRef.current
    const target = canvas?.getContext("2d")
    if (!canvas || !target) return
    target.clearRect(0, 0, STAGE_SIZE, STAGE_SIZE)
    paintLayers(target, layers, frame, context)
    const selected = props.outlined ? rig.layers.find((layer) => layer.id === layerID) : null
    const image = selected ? imagesForProfile(selected, animation, phase) : null
    if (selected && image) {
      // Box the painted pixels, not the mostly transparent artboard the piece
      // was drawn on -- which, once rotated, is nowhere near the artwork.
      const bounds = visibleImageBounds(image)
      drawSelectionOutline(target, layerCorners(selected, image, frame, context, bounds))
    }
  }, [layers, frame, context, rig.layers, layerID, imagesForProfile, animation, phase, props.outlined])

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - bounds.left) * STAGE_SIZE) / bounds.width,
      y: ((event.clientY - bounds.top) * STAGE_SIZE) / bounds.height,
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const store = useEquipmentEditor.getState()
    const layer = rig.layers.find((candidate) => candidate.id === layerID)
    if (!store.scene || !layer || !store.item || !props.editable) return
    const point = pointAt(event)
    const boneInverse = inverse(frame.currentWorld[layer.bone])
    dragRef.current = {
      grab: transformPoint(boneInverse, point),
      startX: layer.x,
      startY: layer.y,
      boneInverse,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    // One undo step per drag: the snapshot is taken here and committed on
    // release, rather than once per pointer move.
    dragBefore.current = store.snapshot()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const store = useEquipmentEditor.getState()
    const local = transformPoint(drag.boneInverse, pointAt(event))
    const x = Number((drag.startX + local.x - drag.grab.x).toFixed(2))
    const y = Number((drag.startY + local.y - drag.grab.y).toFixed(2))
    store.editSceneSilently((draft) => {
      const selection = wornScene(draft, store.slot, store.item)
      // In the combined view an edit is meant for both bodies; most gear sits
      // the same way on both, and doing it twice by hand is how they drift.
      for (const target of shownProfiles(store.view)) {
        writeLayerBind(draft, selection, layerID, target, "x", x)
        writeLayerBind(draft, selection, layerID, target, "y", y)
      }
    })
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    useEquipmentEditor.getState().commit(dragBefore.current)
    dragBefore.current = null
  }

  return (
    <figure className="stage-figure">
      <canvas
        ref={canvasRef}
        width={STAGE_SIZE}
        height={STAGE_SIZE}
        data-profile={profile}
        style={{ width: `${displaySize}px`, height: `${displaySize}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <figcaption>{profileLabels[profile]}</figcaption>
    </figure>
  )
}

export { primaryProfile }
