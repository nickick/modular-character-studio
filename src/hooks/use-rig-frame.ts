/**
 * Derived rig state for the studio.
 *
 * Nothing here is stored: the resolved rig, the sampled tracks, the pose being
 * drawn, and the grip controls are all recomputed from the scene and the
 * current selection. That is the point — in the old studio each of these was a
 * field that some other function had to remember to refresh, and forgetting was
 * how the canvas ended up showing a rig the scene no longer described.
 */
import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { RigTracks } from "@/rig/tracks.ts"
import { constrainForearmPose } from "@/rig/ik.ts"
import { mergePoses } from "@/rig/clip-poses.ts"
import { animationHandPose, layerMatchesAnimationEquipment, layerMatchesHandPose } from "@/rig/clips.ts"
import type { GripControls } from "@/rig/grip.ts"
import type { Pose, ResolvedLayer, ResolvedRig, Side } from "@/rig/types.ts"
import {
  GRIP_FINGER_LAYER_IDS,
  resolveRig,
  sceneTracks,
  useRigEditor,
  type Presentation,
  type WristPreview,
} from "@/stores/rig-editor.ts"

/** Bones and layers with the active profile's bind pose flattened on. */
export function useResolvedRig(): ResolvedRig {
  const scene = useRigEditor((state) => state.scene)
  const presentation = useRigEditor((state) => state.presentation)
  return useMemo(() => resolveRig(scene, presentation), [scene, presentation])
}

/** The scene's authored keyframe tracks, rebuilt whenever the scene changes. */
export function useTracks(): RigTracks {
  const scene = useRigEditor((state) => state.scene)
  return useMemo(() => sceneTracks(scene), [scene])
}

/**
 * The pose the canvas draws: the clip, plus unsaved manual edits, with the
 * forearm hinge applied last so no drag can push an elbow through its limit.
 *
 * A wrist preview replaces the stored curve's contribution rather than adding
 * to it, and only while paused — otherwise a stale `wristAngle` URL parameter
 * would make a refreshed page appear to play an older animation.
 */
export function useCombinedPose(): Pose {
  const rig = useResolvedRig()
  const tracks = useTracks()
  const { animation, phase, manualPose, wrist, playing } = useRigEditor(
    useShallow((state) => ({
      animation: state.animation,
      phase: state.phase,
      manualPose: state.manualPose,
      wrist: state.wrist,
      playing: state.playing,
    })),
  )
  return useMemo(() => {
    const pose = constrainForearmPose(rig.bones, mergePoses(tracks.pose(animation, phase), manualPose))
    if (wrist.active && !playing) {
      const bone = `hand${wrist.side}`
      pose[bone] = {
        ...(pose[bone] ?? {}),
        rotation:
          (pose[bone]?.rotation ?? 0) + wrist.angle - tracks.wristAngle(animation, wrist.side, phase),
      }
    }
    return pose
  }, [rig.bones, tracks, animation, phase, manualPose, wrist, playing])
}

/** The clip's own contribution, with no editor edits layered on. */
export function useAuthoredPose(): Pose {
  const tracks = useTracks()
  const animation = useRigEditor((state) => state.animation)
  const phase = useRigEditor((state) => state.phase)
  return useMemo(() => tracks.pose(animation, phase), [tracks, animation, phase])
}

/**
 * Sampled hand controls for a layer's own side, honouring an unsaved preview.
 * Returned as a factory so the painter can ask per layer without this hook
 * needing to know which layers exist.
 */
export function useHandControls(): (layer: ResolvedLayer) => Partial<GripControls> {
  const tracks = useTracks()
  const { animation, phase, wrist, playing } = useRigEditor(
    useShallow((state) => ({
      animation: state.animation,
      phase: state.phase,
      wrist: state.wrist,
      playing: state.playing,
    })),
  )
  return useMemo(() => {
    const fingerIDs = [...GRIP_FINGER_LAYER_IDS]
    return (layer: ResolvedLayer): Partial<GripControls> => {
      const side: Side = layer.bone.endsWith("R") ? "R" : "L"
      if (wrist.active && !playing && side === wrist.side) {
        return {
          gripRotation: wrist.gripRotation,
          knuckleAxis: wrist.knuckleAxis,
          fingerAngles: wrist.fingerAngles,
          fingerOffsets: wrist.fingerOffsets,
        }
      }
      return tracks.gripControlsAt(animation, side, phase, fingerIDs)
    }
  }, [tracks, animation, phase, wrist, playing])
}

/** Which layers the stage shows for the current presentation. */
export function useVisibleLayers(): ResolvedLayer[] {
  const rig = useResolvedRig()
  const { animation, handPose, mainHand } = useRigEditor(
    useShallow((state) => ({
      animation: state.animation,
      handPose: state.handPose,
      mainHand: state.presentation.mainHand,
    })),
  )
  return useMemo(
    () =>
      rig.layers.filter(
        (layer) =>
          layer.visible &&
          matchesMainHand(layer, mainHand) &&
          layerMatchesHandPose(layer, handPose) &&
          layerMatchesAnimationEquipment(layer, animation),
      ),
    [rig.layers, animation, handPose, mainHand],
  )
}

/**
 * Weapons and staffs share one hand, so only the selected one is ever drawn
 * even though both catalogues keep their last selection.
 */
export function matchesMainHand(layer: ResolvedLayer, mainHand: "weapon" | "staff"): boolean {
  if (layer.id !== "weapon" && layer.id !== "staff") return true
  return layer.id === mainHand
}

/** The held layer the closed grip is wrapped around for a clip. */
export function heldLayerFor(
  rig: ResolvedRig,
  animation: string,
  mainHand: "weapon" | "staff",
): ResolvedLayer | null {
  const id = animation.startsWith("bow") ? "bow" : mainHand
  return rig.layers.find((layer) => layer.id === id) ?? null
}

/** The hand pose a clip is authored against, for the preview grid. */
export const handPoseForClip = (animation: string): string =>
  animationHandPose[animation as keyof typeof animationHandPose] ?? "closed"

export type { Presentation, WristPreview }
