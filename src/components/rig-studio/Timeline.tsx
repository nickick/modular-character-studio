/**
 * The transport bar: which clip, whether it is playing, where the playhead is,
 * and the keys authored on one explicitly selected bone, hand, or face track.
 *
 * Controls wrap independently above a full-width ruler and scrubber.
 */
import { useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Eraser } from "lucide-react"
import { animationDurations } from "@/rig/clips.ts"
import { animationLabel } from "@/editor/labels.ts"
import {
  KEY_EPSILON,
  activeGripKind,
  adjacentPhase,
  boneKeys,
  deleteBoneKey,
  deleteExpressionKey,
  deleteWristKey,
  expressionKeys,
  gripTrackName,
  handKeyPhases,
} from "@/editor/keyframes.ts"
import { useRigEditor, type TimelineTrackID } from "@/stores/rig-editor.ts"
import { Toggle } from "@/components/Toggle.tsx"
import { SelectField } from "@/components/SelectField.tsx"
import { FilterSelectField } from "@/components/FilterSelectField.tsx"
import { Slider } from "@/components/ui/slider.tsx"

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

/**
 * Diamonds under the slider, one per authored key on a track.
 *
 * The container positions them; each marker carries its own class, because the
 * stylesheet sizes and shapes them individually -- without it they fall through
 * to the studio's ordinary button styling and lay themselves out as a row.
 */
function KeyMarkers({
  id,
  kind,
  trackLabel,
  phases,
  phase,
  onPick,
}: {
  id: string
  kind: "wrist" | "bone" | "expression"
  trackLabel: string
  phases: readonly number[]
  /** The playhead, so the key it is sitting on can be marked as current. */
  phase: number
  onPick: (at: number) => void
}) {
  return (
    <div id={id} className={`timeline-key-markers ${kind}-key-markers`} data-track-kind={kind}>
      {phases.map((at) => (
        <button
          key={at}
          type="button"
          className={`${kind}-key-marker${Math.abs(at - phase) <= KEY_EPSILON ? " current" : ""}`}
          style={{ left: `${at * 100}%` }}
          aria-label={`Jump to ${trackLabel} key at ${(at * 100).toFixed(0)}%`}
          title={`${trackLabel} · ${(at * 100).toFixed(0)}%`}
          onClick={() => onPick(at)}
        />
      ))}
    </div>
  )
}

export interface TimelineProps {
  onOpenAnimationPicker: () => void
}

export function Timeline({ onOpenAnimationPicker }: TimelineProps) {
  const { scene, animation, phase, playing, speed, timelineTrack, mainHand, clipScopedEdits } =
    useRigEditor(
      useShallow((state) => ({
        scene: state.scene,
        animation: state.animation,
        phase: state.phase,
        playing: state.playing,
        speed: state.speed,
        timelineTrack: state.timelineTrack,
        mainHand: state.presentation.mainHand,
        clipScopedEdits: state.clipScopedEdits,
      })),
    )
  const setPhase = useRigEditor((state) => state.setPhase)
  const setPlaying = useRigEditor((state) => state.setPlaying)
  const setSpeed = useRigEditor((state) => state.setSpeed)
  const setClipScopedEdits = useRigEditor((state) => state.setClipScopedEdits)
  const setTimelineTrack = useRigEditor((state) => state.setTimelineTrack)
  const editScene = useRigEditor((state) => state.editScene)

  const duration = animationDurations[animation] ?? 1
  const seconds = duration * phase
  const [hoverPhase, setHoverPhase] = useState<number | null>(null)
  const trackOptions = [
    { id: "hand:L", label: "Hands · Screen-left" },
    { id: "hand:R", label: "Hands · Screen-right" },
    { id: "expression", label: "Face · Expressions" },
    ...(scene?.bones.map((bone) => ({ id: `bone:${bone.id}`, label: `Bone · ${bone.label}` })) ?? []),
  ]
  const boneID = timelineTrack.startsWith("bone:") ? timelineTrack.slice("bone:".length) : null
  const handSide = timelineTrack === "hand:R" ? "R" : "L"
  const trackKind: "wrist" | "bone" | "expression" = timelineTrack === "expression"
    ? "expression"
    : timelineTrack.startsWith("hand:")
      ? "wrist"
      : "bone"
  const trackLabel = trackOptions.find((option) => option.id === timelineTrack)?.label ?? timelineTrack
  const trackPhases = !scene
    ? []
    : timelineTrack === "expression"
      ? expressionKeys(scene, animation).map((key) => key.phase)
      : timelineTrack.startsWith("hand:")
        ? handKeyPhases(
            scene,
            animation,
            gripTrackName(animation, activeGripKind(animation, mainHand)),
            handSide,
          )
        : boneID
          ? boneKeys(scene, animation, boneID).map((key) => key.phase)
          : []
  const step = (direction: number) => {
    const next = adjacentPhase(trackPhases, phase, direction)
    if (next === null) return
    setPlaying(false)
    setPhase(next)
  }
  const jumpToKey = (at: number) => {
    setPlaying(false)
    setPhase(at)
  }
  const keyAtPlayhead = trackPhases.some((at) => Math.abs(at - phase) <= KEY_EPSILON)
  const deleteSelectedKey = () => {
    if (!keyAtPlayhead) return
    editScene((draft) => {
      if (timelineTrack === "expression") {
        deleteExpressionKey(draft, animation, phase)
      } else if (timelineTrack.startsWith("hand:")) {
        deleteWristKey(draft, animation, handSide, phase)
        deleteWristKey(
          draft,
          gripTrackName(animation, activeGripKind(animation, mainHand)),
          handSide,
          phase,
        )
      } else if (boneID) {
        deleteBoneKey(draft, animation, boneID, phase)
      }
    })
  }

  return (
    <div className="timeline">
      <div className="timeline-authoring-controls">
        <div className="timeline-authoring-primary">
          <div className="animation-picker-control">
            <button
              id="animationPickerButton"
              type="button"
              className="animation-picker-button"
              onClick={onOpenAnimationPicker}
            >
              {animationLabel(animation)}
            </button>
          </div>
          <button
            id="playPause"
            type="button"
            className="accent icon-button"
            aria-pressed={playing}
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause" : "Play"}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 2.6h3.1v10.8H4zM8.9 2.6H12v10.8H8.9z" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 2.6v10.8L13.5 8z" />
              </svg>
            )}
          </button>
          <div className="timeline-track-selector">
            <FilterSelectField
              id="timelineTrackSelect"
              label="Track"
              menuSide="top"
              value={timelineTrack}
              options={trackOptions}
              onChange={(value) => setTimelineTrack(value as TimelineTrackID)}
            />
          </div>
          <span id="timeReadout" aria-label="Current time and duration">{seconds.toFixed(2)} / {duration.toFixed(2)} s</span>
        </div>
        <div className="timeline-authoring-secondary">
          <Toggle label="Animate bone keys" checked={clipScopedEdits} onChange={setClipScopedEdits} />
          <div className="keyframe-nav" aria-label={`${trackLabel} keyframe navigation`}>
            <button
              id="previousTrackKey"
              type="button"
              title={`Previous ${trackLabel} keyframe`}
              aria-label={`Previous ${trackLabel} key`}
              disabled={adjacentPhase(trackPhases, phase, -1) === null}
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <button
              id="nextTrackKey"
              type="button"
              title={`Next ${trackLabel} keyframe`}
              aria-label={`Next ${trackLabel} key`}
              disabled={adjacentPhase(trackPhases, phase, 1) === null}
              onClick={() => step(1)}
            >
              ›
            </button>
          </div>
          <button
            id="deleteTrackKey"
            type="button"
            className="icon-button eraser-button"
            disabled={!keyAtPlayhead}
            title={`Delete ${trackLabel} key at the playhead`}
            aria-label={`Delete ${trackLabel} key at the playhead`}
            onClick={deleteSelectedKey}
          >
            <Eraser aria-hidden="true" />
          </button>
          <SelectField
            id="speedSelect"
            label="Speed"
            menuSide="top"
            value={String(speed)}
            options={SPEEDS.map((value) => ({ id: String(value), label: `${value}x` }))}
            onChange={(value) => setSpeed(Number(value))}
          />
        </div>
      </div>
      <div
        className="timeline-track"
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          setHoverPhase(Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))))
        }}
        onPointerLeave={() => setHoverPhase(null)}
      >
        <div className="timeline-ruler" aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((at) => (
            <span key={at} style={{ left: `${at * 100}%` }}>{(at * duration).toFixed(2)} s</span>
          ))}
        </div>
        {hoverPhase !== null && (
          <div className="timeline-hover-guide" aria-hidden="true" style={{ left: `${hoverPhase * 100}%` }}>
            <span style={{ transform: `translateX(-${hoverPhase * 100}%)` }}>{(hoverPhase * duration).toFixed(2)} s</span>
          </div>
        )}
        <Slider
          id="timeline"
          aria-label={`Playhead for ${trackLabel}`}
          min={0}
          max={1000}
          step={1}
          value={[Math.round(phase * 1000)]}
          onValueChange={([at]) => {
            // Scrubbing takes over from playback rather than fighting it.
            setPlaying(false)
            setPhase(at / 1000)
          }}
        />
        <KeyMarkers
          id="selectedTrackKeyMarkers"
          kind={trackKind}
          trackLabel={trackLabel}
          phases={trackPhases}
          phase={phase}
          onPick={jumpToKey}
        />
      </div>
    </div>
  )
}
