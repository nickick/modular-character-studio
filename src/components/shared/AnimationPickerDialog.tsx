/**
 * The clip picker: a labelled modal grid of live previews, five to a row.
 *
 * Both studios open it -- the rig studio over the whole motion library, the
 * equipment studio over the poses worth judging a placement in -- so it takes
 * the rig, the tracks and the selection as props rather than reading one
 * studio's store.
 *
 * Every cell paints the rig as it is currently dressed, through the same
 * painter the stage uses, so a preview cannot disagree with what selecting it
 * shows. One animation frame loop drives all of them — each cell runs at its
 * own clip's speed, but they share a single `requestAnimationFrame`.
 */
import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx"
import { animationDurations, animationNames, type AnimationName } from "@/rig/clips.ts"
import { animationLabel } from "@/editor/labels.ts"
import { paintLayers, solveFrames, type PaintContext } from "@/canvas/paint.ts"
import { STAGE_OVERSCAN, STAGE_VIEW_SIZE } from "@/editor/stage.ts"
import { layerMatchesAnimationEquipment, layerMatchesHandPose } from "@/rig/clips.ts"
import { handPoseForClip, heldLayerFor, matchesMainHand } from "@/hooks/use-rig-frame.ts"
import { GRIP_FINGER_LAYER_IDS } from "@/stores/rig-editor.ts"
import type { RigTracks } from "@/rig/tracks.ts"
import type { LayerImageResolver } from "@/hooks/use-rig-images.ts"
import type { ResolvedLayer, ResolvedRig, Side } from "@/rig/types.ts"

const PREVIEW_SIZE = 176

export interface AnimationPickerProps {
  open: boolean
  onClose: () => void
  images: LayerImageResolver
  rig: ResolvedRig
  tracks: RigTracks
  /** The clip in effect, so its cell reads as chosen. */
  animation: string
  onSelect: (name: AnimationName) => void
  /** Which item the closed grip is wrapped around. */
  mainHand: "weapon" | "staff"
  /**
   * Which clips to offer. The rig studio offers the whole library; the
   * equipment studio offers only the poses worth judging a placement in.
   */
  clips?: readonly AnimationName[]
  /** Lets a studio rename a clip for its own context, as a staff swing. */
  labelFor?: (name: string) => string
}

export function AnimationPickerDialog({
  open,
  onClose,
  images,
  rig,
  tracks,
  animation,
  onSelect,
  mainHand,
  clips = animationNames,
  labelFor = animationLabel,
}: AnimationPickerProps) {
  const canvases = useRef(new Map<AnimationName, HTMLCanvasElement>())

  /** Which layers each clip shows, and what it is holding. */
  const loadouts = useMemo(() => {
    const byClip = new Map<AnimationName, { layers: ResolvedLayer[]; held: ResolvedLayer | null }>()
    for (const name of clips) {
      const handPose = handPoseForClip(name)
      byClip.set(name, {
        layers: rig.layers.filter(
          (layer) =>
            layer.visible &&
            matchesMainHand(layer, mainHand) &&
            layerMatchesHandPose(layer, handPose) &&
            layerMatchesAnimationEquipment(layer, name),
        ),
        held: heldLayerFor(rig, name, mainHand),
      })
    }
    return byClip
  }, [rig, mainHand, clips])

  // One loop for the whole grid. Nothing in its dependencies changes while the
  // studio's own playhead runs, so the frame it schedules is never cancelled
  // before it can paint.
  useEffect(() => {
    if (!open) return
    let handle = 0
    const fingerIDs = [...GRIP_FINGER_LAYER_IDS]
    const draw = (timestamp: number) => {
      for (const [name, canvas] of canvases.current) {
        const target = canvas.getContext("2d")
        const loadout = loadouts.get(name)
        if (!target || !loadout) continue
        // Each cell runs its own clip at its own speed.
        const phase = (timestamp / (animationDurations[name] * 1000)) % 1
        const frame = solveFrames(rig, { authored: tracks.pose(name, phase) })
        const context: PaintContext = {
          rig,
          animation: name,
          phase,
          images,
          heldLayer: loadout.held,
          // Sampled at the cell's own phase, not the studio's playhead.
          handControls: (layer) =>
            tracks.gripControlsAt(
              name,
              (layer.bone.endsWith("R") ? "R" : "L") as Side,
              phase,
              fingerIDs,
            ),
        }
        target.clearRect(0, 0, canvas.width, canvas.height)
        target.save()
        const scale = canvas.width / STAGE_VIEW_SIZE
        target.scale(scale, scale)
        target.translate(STAGE_OVERSCAN, STAGE_OVERSCAN)
        paintLayers(target, loadout.layers, frame, context)
        target.restore()
      }
      handle = requestAnimationFrame(draw)
    }
    handle = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(handle)
  }, [open, rig, tracks, images, loadouts])

  const onGridKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 }
    const options = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-animation]")]
    const current = options.indexOf(document.activeElement as HTMLElement)
    let target = offsets[event.key] === undefined ? current : current + offsets[event.key]
    if (event.key === "Home") target = 0
    if (event.key === "End") target = options.length - 1
    if (target === current || target < 0 || target >= options.length) return
    event.preventDefault()
    options[target].focus()
  }, [])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent id="animationModal" className="animation-modal">
        <section className="animation-modal-panel">
          <DialogHeader className="animation-modal-header">
            <div>
              <span className="eyebrow">Motion library</span>
              <DialogTitle id="animationModalTitle">Choose an animation</DialogTitle>
              <DialogDescription>
                Every preview uses the current character and equipment.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div
            id="animationGrid"
            className="animation-grid"
            role="listbox"
            aria-label="Animation clips"
            onKeyDown={onGridKeyDown}
          >
            {clips.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                className="animation-option"
                data-animation={name}
                aria-selected={name === animation}
                aria-label={labelFor(name)}
                onClick={() => {
                  onSelect(name)
                  onClose()
                }}
              >
                <canvas
                  width={PREVIEW_SIZE}
                  height={PREVIEW_SIZE}
                  aria-hidden="true"
                  ref={(element) => {
                    if (element) canvases.current.set(name, element)
                    else canvases.current.delete(name)
                  }}
                />
                <span className="animation-option-name">{labelFor(name)}</span>
              </button>
            ))}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
