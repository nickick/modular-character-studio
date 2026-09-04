/**
 * Finger placement for a gripped item.
 *
 * A weapon, staff, or bow is held, so fitting it means fitting the hand around
 * it too. Roots are authored in the held item's shaft space, which is what lets
 * one authored grip carry across every item in the slot.
 */
import { useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { NumericField } from "@/components/NumericField.tsx"
import { SelectField } from "@/components/SelectField.tsx"
import {
  activeGripKind,
  ensureWristKey,
  gripTrackName,
  gripUsesAnimationOverride,
  wristKeys,
  writeHandChannel,
  type HandChannel,
  type HandControlValues,
} from "@/editor/keyframes.ts"
import { GRIPPABLE_SLOTS } from "@/editor/equipment-slots.ts"
import { sceneTracks, useEquipmentEditor, type EquipmentSnapshot } from "@/stores/equipment-editor.ts"

const FINGER_IDS = ["handClosedLIndex", "handClosedLMiddle", "handClosedLRing", "handClosedLPinky"]

const FINGER_LABELS: Record<string, string> = {
  handClosedLIndex: "1 · index",
  handClosedLMiddle: "2 · middle",
  handClosedLRing: "3 · ring",
  handClosedLPinky: "4 · pinky",
}

const round2 = (value: number): number => Number(value.toFixed(2))

export function GripPanel() {
  const pending = useRef<EquipmentSnapshot | null>(null)
  const { scene, slot, animation, phase } = useEquipmentEditor(
    useShallow((state) => ({
      scene: state.scene,
      slot: state.slot,
      animation: state.animation,
      phase: state.phase,
    })),
  )
  const editScene = useEquipmentEditor((state) => state.editScene)
  const selectedGripFinger = useEquipmentEditor((state) => state.selectedGripFinger)
  const setSelectedGripFinger = useEquipmentEditor((state) => state.setSelectedGripFinger)

  // Only a held item has a grip to author.
  if (!scene || !GRIPPABLE_SLOTS.has(slot.id)) return null

  const tracks = sceneTracks(scene)
  const kind = activeGripKind(animation, slot.id === "staff" ? "staff" : "weapon")
  const track = gripTrackName(animation, kind)
  const fingerIDs = selectedGripFinger === "all" ? FINGER_IDS : [selectedGripFinger]

  const sampled: HandControlValues = {
    angle: tracks.wristAngle(animation, "L", phase),
    gripRotation: tracks.gripRotation(animation, "L", phase, kind),
    knuckleAxis: tracks.knuckleAxis(animation, "L", phase, kind),
    fingerAngles: Object.fromEntries(
      FINGER_IDS.map((id) => [id, tracks.fingerAngle(animation, "L", phase, id, kind)]),
    ),
    fingerOffsets: Object.fromEntries(
      FINGER_IDS.map((id) => [
        id,
        {
          along: tracks.fingerOffset(animation, "L", phase, id, "along", kind),
          across: tracks.fingerOffset(animation, "L", phase, id, "across", kind),
        },
      ]),
    ),
  }

  const write = (channel: HandChannel, values: HandControlValues) =>
    editScene((draft) => {
      const key = ensureWristKey(draft, track, "L", phase, () => ({
        angle: gripUsesAnimationOverride(animation) ? sampled.angle : 0,
      }))
      writeHandChannel(key, animation, kind, channel, values, fingerIDs)
    })

  const along = round2(sampled.fingerOffsets[fingerIDs[0]]?.along ?? 0)
  const across = round2(sampled.fingerOffsets[fingerIDs[0]]?.across ?? 0)
  const angle = round2(sampled.fingerAngles[fingerIDs[0]] ?? 0)

  /** Moving all four fingers preserves the authored spacing between them. */
  const shift = (axis: "along" | "across", value: number): HandControlValues => {
    const delta = value - (axis === "along" ? along : across)
    const offsets = { ...sampled.fingerOffsets }
    for (const id of fingerIDs) {
      const current = offsets[id] ?? { along: 0, across: 0 }
      offsets[id] = { ...current, [axis]: current[axis] + delta }
    }
    return { ...sampled, fingerOffsets: offsets }
  }

  const begin = () => {
    pending.current ??= useEquipmentEditor.getState().snapshot()
  }
  const end = () => {
    useEquipmentEditor.getState().commit(pending.current)
    pending.current = null
  }

  return (
    <div id="gripBox" className="grip-field-grid">
      <div className="section-heading">
        <span className="eyebrow">Grip</span>
      </div>
      <SelectField
        label="Finger"
        value={selectedGripFinger}
        options={[
          { id: "all", label: "All fingers" },
          ...FINGER_IDS.map((id) => ({ id, label: FINGER_LABELS[id] ?? id })),
        ]}
        onChange={setSelectedGripFinger}
      />
      <NumericField
        label="Grip rotation"
        value={round2(sampled.gripRotation)}
        min={-45}
        max={45}
        step={0.5}
        onBegin={begin}
        onEnd={end}
        onChange={(gripRotation) => write("gripRotation", { ...sampled, gripRotation })}
      />
      <NumericField
        label="Knuckle axis"
        value={round2(sampled.knuckleAxis)}
        min={-90}
        max={90}
        step={0.5}
        onBegin={begin}
        onEnd={end}
        onChange={(knuckleAxis) => write("knuckleAxis", { ...sampled, knuckleAxis })}
      />
      <NumericField
        label="Along haft"
        value={along}
        min={-160}
        max={160}
        step={0.5}
        onBegin={begin}
        onEnd={end}
        onChange={(value) => write("fingerAlong", shift("along", value))}
      />
      <NumericField
        label="Across haft"
        value={across}
        min={-160}
        max={160}
        step={0.5}
        onBegin={begin}
        onEnd={end}
        onChange={(value) => write("fingerAcross", shift("across", value))}
      />
      <NumericField
        label="Finger angle"
        value={angle}
        min={-180}
        max={180}
        step={0.5}
        onBegin={begin}
        onEnd={end}
        onChange={(value) => {
          const fingerAngles = { ...sampled.fingerAngles }
          for (const id of fingerIDs) fingerAngles[id] = value
          write("fingerAngle", { ...sampled, fingerAngles })
        }}
      />
      <button
        id="copyGripChannelThroughKeys"
        type="button"
        title="Copy the values at the playhead through every key on this track"
        onClick={() =>
          editScene((draft) => {
            for (const key of wristKeys(draft, track, "L")) {
              writeHandChannel(key, animation, kind, "all", sampled, fingerIDs)
            }
          })
        }
      >
        Copy through all keys
      </button>
      <p className="hint">
        Authoring on{" "}
        <strong>{track.startsWith("__grip_") ? `the shared ${kind} grip` : animation}</strong>.
      </p>
    </div>
  )
}
