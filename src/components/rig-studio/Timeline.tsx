/**
 * The transport bar: which clip, whether it is playing, where the playhead is,
 * and the keys authored on the selected bone, wrist, and face.
 *
 * The bar is a flex row rather than a grid. Controls have been added to it
 * since it was authored, and a template cut for six of them wrapped the seventh
 * and squeezed the rest into the wrong columns.
 */
import { useShallow } from "zustand/react/shallow"
import { animationDurations } from "@/rig/clips.ts"
import { animationLabel } from "@/editor/labels.ts"
import {
  KEY_EPSILON,
  activeGripKind,
  adjacentPhase,
  boneKeys,
  expressionKeys,
  gripTrackName,
  handKeyPhases,
  wristKeys,
} from "@/editor/keyframes.ts"
import { useRigEditor } from "@/stores/rig-editor.ts"
import { Toggle } from "@/components/Toggle.tsx"
import { SelectField } from "@/components/SelectField.tsx"
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
  phases,
  phase,
  onPick,
}: {
  id: string
  kind: "wrist" | "bone" | "expression"
  phases: readonly number[]
  /** The playhead, so the key it is sitting on can be marked as current. */
  phase: number
  onPick: (at: number) => void
}) {
  return (
    <div id={id} className={`${kind}-key-markers`}>
      {phases.map((at) => (
        <button
          key={at}
          type="button"
          className={`${kind}-key-marker${Math.abs(at - phase) <= KEY_EPSILON ? " current" : ""}`}
          style={{ left: `${at * 100}%` }}
          aria-label={`Jump to the key at ${(at * 100).toFixed(0)}%`}
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
  const { scene, animation, phase, playing, speed, selectedBone, wristSide, mainHand, clipScopedEdits } =
    useRigEditor(
      useShallow((state) => ({
        scene: state.scene,
        animation: state.animation,
        phase: state.phase,
        playing: state.playing,
        speed: state.speed,
        selectedBone: state.selectedBone,
        wristSide: state.wrist.side,
      mainHand: state.presentation.mainHand,
        clipScopedEdits: state.clipScopedEdits,
      })),
    )
  const setPhase = useRigEditor((state) => state.setPhase)
  const setPlaying = useRigEditor((state) => state.setPlaying)
  const setSpeed = useRigEditor((state) => state.setSpeed)
  const setClipScopedEdits = useRigEditor((state) => state.setClipScopedEdits)

  const bonePhases = scene && selectedBone ? boneKeys(scene, animation, selectedBone).map((key) => key.phase) : []
  const wristPhases = scene ? wristKeys(scene, animation, wristSide).map((key) => key.phase) : []
  const expressionPhases = scene ? expressionKeys(scene, animation).map((key) => key.phase) : []
  const seconds = (animationDurations[animation] ?? 1) * phase

  // The arrows step hand keys, which is what they have always addressed; bone
  // and face keys are stepped from their own panels.
  const handPhases = scene
    ? handKeyPhases(scene, animation, gripTrackName(animation, activeGripKind(animation, mainHand)), wristSide)
    : []
  const step = (direction: number) => {
    const next = adjacentPhase(handPhases, phase, direction)
    if (next === null) return
    setPlaying(false)
    setPhase(next)
  }

  return (
    <div className="timeline">
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
      <Toggle label="Animate bone keys" checked={clipScopedEdits} onChange={setClipScopedEdits} />
      <div className="keyframe-nav" aria-label="Hand keyframe navigation">
        <button
          id="previousWristKey"
          type="button"
          title="Previous established hand keyframe"
          aria-label="Previous hand key"
          disabled={adjacentPhase(handPhases, phase, -1) === null}
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <button
          id="nextWristKey"
          type="button"
          title="Next established hand keyframe"
          aria-label="Next hand key"
          disabled={adjacentPhase(handPhases, phase, 1) === null}
          onClick={() => step(1)}
        >
          ›
        </button>
      </div>
      <span id="timeReadout">{seconds.toFixed(2)} s</span>
      <div className="timeline-track">
        <Slider
          id="timeline"
          aria-label="Playhead"
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
        <KeyMarkers id="wristKeyMarkers" kind="wrist" phases={wristPhases} phase={phase} onPick={setPhase} />
        <KeyMarkers id="boneKeyMarkers" kind="bone" phases={bonePhases} phase={phase} onPick={setPhase} />
        <KeyMarkers
          id="expressionKeyMarkers"
          kind="expression"
          phases={expressionPhases}
          phase={phase}
          onPick={setPhase}
        />
      </div>
      <SelectField
        id="speedSelect"
        label="Speed"
        value={String(speed)}
        options={SPEEDS.map((value) => ({ id: String(value), label: `${value}x` }))}
        onChange={(value) => setSpeed(Number(value))}
      />
    </div>
  )
}
