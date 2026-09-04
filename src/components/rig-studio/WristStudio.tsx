/**
 * The wrist studio: the animated hand channels for one side.
 *
 * Each control writes to a key at the playhead, creating one if there is none,
 * and one channel at a time — so correcting a staff's knuckle axis cannot
 * disturb an authored finger spread, and Sword Swing and Sneak Attack can
 * override a single dimension while inheriting the rest of the weapon baseline.
 */
import { useShallow } from "zustand/react/shallow"
import { NumericField } from "@/components/NumericField.tsx"
import { SelectField } from "@/components/SelectField.tsx"
import {
  activeGripKind,
  deleteWristKey,
  ensureWristKey,
  gripTrackName,
  gripUsesAnimationOverride,
  wristKeys,
  writeHandChannel,
  type HandChannel,
  type HandControlValues,
} from "@/editor/keyframes.ts"
import { useRef } from "react"
import { GRIP_FINGER_LAYER_IDS, useRigEditor, type RigSnapshot } from "@/stores/rig-editor.ts"
import { useTracks } from "@/hooks/use-rig-frame.ts"
import type { Side, WristKey } from "@/rig/types.ts"

const round2 = (value: number): number => Number(value.toFixed(2))

const FINGER_LABELS: Record<string, string> = {
  handClosedLIndex: "1 · index",
  handClosedLMiddle: "2 · middle",
  handClosedLRing: "3 · ring",
  handClosedLPinky: "4 · pinky",
}

/**
 * A finger's sprite root and size.
 *
 * These are registration rather than animation -- which point inside the PNG
 * lands on the root, and how large the copy is drawn -- so they live on the
 * layer instead of on a key, and are shared by every clip.
 */
function FingerRegistration({ fingerIDs }: { fingerIDs: readonly string[] }) {
  const scene = useRigEditor((state) => state.scene)
  const profile = useRigEditor((state) => state.presentation.profile)
  const editSceneSilently = useRigEditor((state) => state.editSceneSilently)
  const pending = useRef<RigSnapshot | null>(null)
  const first = scene?.layers.find((layer) => layer.id === fingerIDs[0])
  if (!scene || !first) return null

  const bind = first.bindByProfile[profile]
  const begin = () => {
    pending.current ??= useRigEditor.getState().snapshot()
  }
  const end = () => {
    useRigEditor.getState().commit(pending.current)
    pending.current = null
  }
  const write = (key: "pivotX" | "pivotY" | "scaleX" | "scaleY", value: number) =>
    editSceneSilently((draft) => {
      for (const id of fingerIDs) {
        const layer = draft.layers.find((candidate) => candidate.id === id)
        if (!layer) continue
        // Sizing all four at once multiplies rather than assigns, so the
        // smaller pinky stays proportionally smaller.
        const target = layer.bindByProfile[profile]
        if ((key === "scaleX" || key === "scaleY") && fingerIDs.length > 1 && bind[key]) {
          target[key] = Number(((target[key] / bind[key]) * value).toFixed(4))
        } else {
          target[key] = value
        }
      }
    })

  return (
    <>
      <NumericField label="Sprite root X" value={bind.pivotX} min={0} max={1} step={0.005}
        onBegin={begin} onEnd={end} onChange={(value) => write("pivotX", value)} />
      <NumericField label="Sprite root Y" value={bind.pivotY} min={0} max={1} step={0.005}
        onBegin={begin} onEnd={end} onChange={(value) => write("pivotY", value)} />
      <NumericField label="Finger width" value={bind.scaleX} min={0.05} max={1.5} step={0.005}
        onBegin={begin} onEnd={end} onChange={(value) => write("scaleX", value)} />
      <NumericField label="Finger height" value={bind.scaleY} min={0.05} max={1.5} step={0.005}
        onBegin={begin} onEnd={end} onChange={(value) => write("scaleY", value)} />
    </>
  )
}

export function WristStudio() {
  const tracks = useTracks()
  const { scene, animation, phase, wrist, mainHand, selectedGripFinger } = useRigEditor(
    useShallow((state) => ({
      scene: state.scene,
      animation: state.animation,
      phase: state.phase,
      wrist: state.wrist,
      mainHand: state.presentation.mainHand,
      selectedGripFinger: state.selectedGripFinger,
    })),
  )
  const setWrist = useRigEditor((state) => state.setWrist)
  const setSelectedGripFinger = useRigEditor((state) => state.setSelectedGripFinger)
  const editScene = useRigEditor((state) => state.editScene)
  if (!scene) return null

  const side: Side = wrist.side
  const kind = activeGripKind(animation, mainHand)
  const gripTrack = gripTrackName(animation, kind)
  const fingerIDs =
    selectedGripFinger === "all" ? [...GRIP_FINGER_LAYER_IDS] : [selectedGripFinger]

  // What the saved curves say right now, which is what the sliders show unless
  // a preview is in progress.
  const sampled: HandControlValues = {
    angle: tracks.wristAngle(animation, side, phase),
    gripRotation: tracks.gripRotation(animation, side, phase, kind),
    knuckleAxis: tracks.knuckleAxis(animation, side, phase, kind),
    fingerAngles: Object.fromEntries(
      GRIP_FINGER_LAYER_IDS.map((id) => [id, tracks.fingerAngle(animation, side, phase, id, kind)]),
    ),
    fingerOffsets: Object.fromEntries(
      GRIP_FINGER_LAYER_IDS.map((id) => [
        id,
        {
          along: tracks.fingerOffset(animation, side, phase, id, "along", kind),
          across: tracks.fingerOffset(animation, side, phase, id, "across", kind),
        },
      ]),
    ),
  }
  // Sampled values are interpolated, so they arrive with far more precision
  // than anyone authors at. The fields show them rounded the way a key stores
  // them; the underlying curve keeps its own resolution.
  const shown: HandControlValues = wrist.active
    ? {
        angle: wrist.angle,
        gripRotation: wrist.gripRotation,
        knuckleAxis: wrist.knuckleAxis,
        fingerAngles: wrist.fingerAngles,
        fingerOffsets: Object.fromEntries(
          GRIP_FINGER_LAYER_IDS.map((id) => [
            id,
            {
              along: wrist.fingerOffsets[id]?.along ?? 0,
              across: wrist.fingerOffsets[id]?.across ?? 0,
            },
          ]),
        ),
      }
    : sampled
  const rounded = (values: HandControlValues): HandControlValues => ({
    angle: round2(values.angle),
    gripRotation: round2(values.gripRotation),
    knuckleAxis: round2(values.knuckleAxis),
    fingerAngles: Object.fromEntries(
      GRIP_FINGER_LAYER_IDS.map((id) => [id, round2(values.fingerAngles[id] ?? 0)]),
    ),
    fingerOffsets: Object.fromEntries(
      GRIP_FINGER_LAYER_IDS.map((id) => [
        id,
        {
          along: round2(values.fingerOffsets[id]?.along ?? 0),
          across: round2(values.fingerOffsets[id]?.across ?? 0),
        },
      ]),
    ),
  })

  const display = rounded(shown)

  /** Seed a fresh key from the curve it is being inserted into. */
  const seedWrist = (): Omit<WristKey, "phase"> => ({ angle: sampled.angle })
  const seedGrip = (): Omit<WristKey, "phase"> => ({
    angle: gripUsesAnimationOverride(animation) ? sampled.angle : 0,
  })

  /** Adjusting a channel writes it to a key at the playhead, creating if needed. */
  const write = (channel: HandChannel, next: HandControlValues) => {
    const values = rounded(next)
    editScene((draft) => {
      if (channel === "wristAngle" || channel === "all") {
        const key = ensureWristKey(draft, animation, side, phase, seedWrist)
        writeHandChannel(key, animation, kind, "wristAngle", values, fingerIDs)
      }
      // Grip, knuckle, and finger channels belong to the left hand's stack.
      if (channel !== "wristAngle" && side === "L") {
        const key = ensureWristKey(draft, gripTrack, side, phase, seedGrip)
        writeHandChannel(key, animation, kind, channel, values, fingerIDs)
      }
    })
    setWrist({ active: false })
  }

  const wristTrackKeys = wristKeys(scene, animation, side)
  const gripTrackKeys = wristKeys(scene, gripTrack, side)
  const keyIndex = (keys: readonly WristKey[]): string => {
    if (keys.length === 0) return "no keys"
    const index = keys.findIndex((key) => Math.abs(key.phase - phase) <= 0.0015)
    return index === -1 ? `${keys.length} keys` : `Key ${index + 1} of ${keys.length}`
  }

  const selectedFingerAngle = display.fingerAngles[fingerIDs[0]] ?? 0
  const selectedAlong = display.fingerOffsets[fingerIDs[0]]?.along ?? 0
  const selectedAcross = display.fingerOffsets[fingerIDs[0]]?.across ?? 0

  /** Moving all four fingers preserves the authored spacing between them. */
  const shiftOffsets = (axis: "along" | "across", value: number): HandControlValues => {
    const delta = value - (axis === "along" ? selectedAlong : selectedAcross)
    const offsets = { ...shown.fingerOffsets }
    for (const id of fingerIDs) {
      const current = offsets[id] ?? { along: 0, across: 0 }
      offsets[id] = { ...current, [axis]: current[axis] + delta }
    }
    return { ...shown, fingerOffsets: offsets }
  }

  return (
    <section className="panel-section">
      <div className="section-heading">
        <span className="eyebrow">Hands</span>
        <strong>Wrist studio</strong>
      </div>
      <SelectField
        label="Side"
        value={side}
        options={[
          { id: "L", label: "Screen-left" },
          { id: "R", label: "Screen-right" },
        ]}
        onChange={(value) => setWrist({ side: value as Side, active: false })}
      />

      <NumericField
        label="Angle at playhead"
        suffix={keyIndex(wristTrackKeys)}
        value={display.angle}
        min={-85}
        max={85}
        step={0.5}
        onChange={(angle) => write("wristAngle", { ...shown, angle })}
      />
      <NumericField
        label="Grip and weapon rotation"
        suffix={keyIndex(gripTrackKeys)}
        value={display.gripRotation}
        min={-45}
        max={45}
        step={0.5}
        disabled={side !== "L"}
        onChange={(gripRotation) => write("gripRotation", { ...shown, gripRotation })}
      />
      <NumericField
        label="Knuckle axis at playhead"
        value={display.knuckleAxis}
        min={-90}
        max={90}
        step={0.5}
        disabled={side !== "L"}
        onChange={(knuckleAxis) => write("knuckleAxis", { ...shown, knuckleAxis })}
      />

      <SelectField
        label="Finger"
        value={selectedGripFinger}
        options={[
          { id: "all", label: "All fingers" },
          ...GRIP_FINGER_LAYER_IDS.map((id) => ({ id, label: FINGER_LABELS[id] ?? id })),
        ]}
        onChange={setSelectedGripFinger}
      />
      <NumericField
        label="Finger angle at playhead"
        value={selectedFingerAngle}
        min={-180}
        max={180}
        step={0.5}
        disabled={side !== "L"}
        onChange={(angle) => {
          const fingerAngles = { ...shown.fingerAngles }
          for (const id of fingerIDs) fingerAngles[id] = angle
          write("fingerAngle", { ...shown, fingerAngles })
        }}
      />
      <NumericField
        label="Along haft"
        value={selectedAlong}
        min={-160}
        max={160}
        step={0.5}
        disabled={side !== "L"}
        onChange={(value) => write("fingerAlong", shiftOffsets("along", value))}
      />
      <NumericField
        label="Across haft"
        value={selectedAcross}
        min={-160}
        max={160}
        step={0.5}
        disabled={side !== "L"}
        onChange={(value) => write("fingerAcross", shiftOffsets("across", value))}
      />

      <FingerRegistration fingerIDs={fingerIDs} />

      <div className="wrist-key-actions">
        <button
          id="setWristKey"
          type="button"
          className="primary"
          onClick={() => write("all", shown)}
        >
          Set hand key
        </button>
        <button
          id="deleteWristKey"
          type="button"
          onClick={() =>
            editScene((draft) => {
              deleteWristKey(draft, animation, side, phase)
              if (side === "L") deleteWristKey(draft, gripTrack, side, phase)
            })
          }
        >
          Delete key
        </button>
        <button
          id="copyHandChannelThroughKeys"
          type="button"
          title="Copy the value at the playhead through every key on this track"
          onClick={() =>
            editScene((draft) => {
              // Only the selected dimension is copied: the other channels keep
              // their own curves, so flattening the knuckle axis cannot disturb
              // an authored finger spread.
              const values = rounded(shown)
              for (const key of wristKeys(draft, gripTrack, side)) {
                writeHandChannel(key, animation, kind, "all", values, fingerIDs)
              }
            })
          }
        >
          Copy through all keys
        </button>
      </div>
      <p className="hint">
        Authoring on <strong>{gripTrack.startsWith("__grip_") ? `the shared ${kind} grip` : animation}</strong>.
      </p>
    </section>
  )
}
