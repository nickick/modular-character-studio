/**
 * The selection inspector: whichever of an attachment or a bone is selected.
 *
 * Every field is the shared numeric control, and every field produces one undo
 * transaction per drag or typed edit rather than one per keystroke.
 */
import { useShallow } from "zustand/react/shallow"
import { NumericField } from "@/components/NumericField.tsx"
import { writeBoneBind, writeDrawOrder, writeLayerBind } from "@/editor/binds.ts"
import {
  KEY_EPSILON,
  adjacentPhase,
  animationBoneOffset,
  boneKeys,
  clearAnimationBoneOffset,
  deleteBoneKey,
  ensureBoneKey,
  setAnimationBoneOffsetValue,
  setBoneKeyValue,
} from "@/editor/keyframes.ts"
import { weightedStripMesh } from "@/rig/mesh.ts"
import { sceneSelection, useRigEditor, type RigSnapshot } from "@/stores/rig-editor.ts"
import { useResolvedRig, useTracks } from "@/hooks/use-rig-frame.ts"
import type { LayerImageResolver } from "@/hooks/use-rig-images.ts"
import type { LayerBindKey, ResolvedLayer } from "@/rig/types.ts"
import { useRef } from "react"

/** One undo transaction per interaction, opened on begin and closed on end. */
function useTransaction() {
  const pending = useRef<RigSnapshot | null>(null)
  return {
    begin: () => {
      pending.current ??= useRigEditor.getState().snapshot()
    },
    end: () => {
      useRigEditor.getState().commit(pending.current)
      pending.current = null
    },
  }
}

const LAYER_FIELDS: ReadonlyArray<{ key: LayerBindKey; label: string; min: number; max: number; step: number }> = [
  { key: "x", label: "X", min: -600, max: 600, step: 0.5 },
  { key: "y", label: "Y", min: -600, max: 600, step: 0.5 },
  { key: "rotation", label: "Rotation", min: -180, max: 180, step: 0.5 },
  { key: "scaleX", label: "Scale X", min: -3, max: 3, step: 0.005 },
  { key: "scaleY", label: "Scale Y", min: -3, max: 3, step: 0.005 },
  { key: "pivotX", label: "Pivot X", min: 0, max: 1, step: 0.001 },
  { key: "pivotY", label: "Pivot Y", min: 0, max: 1, step: 0.001 },
  { key: "planeYaw", label: "Plane yaw", min: -80, max: 80, step: 0.5 },
]

export function Inspector({ images }: { images: LayerImageResolver }) {
  const { mode, selectedLayer, selectedBone } = useRigEditor(
    useShallow((state) => ({
      mode: state.mode,
      selectedLayer: state.selectedLayer,
      selectedBone: state.selectedBone,
    })),
  )
  const rig = useResolvedRig()
  const layer = rig.layers.find((candidate) => candidate.id === selectedLayer) ?? null
  const bone = rig.bones.find((candidate) => candidate.id === selectedBone) ?? null

  if (mode === "layer" && layer) return <LayerInspector layer={layer} images={images} />
  if (mode === "bone" && bone) {
    return <BoneInspector boneID={bone.id} label={bone.label} parent={bone.parent} />
  }
  return (
    <section className="panel-section" id="selectionEmpty">
      <span className="eyebrow">Selection</span>
      <h2 id="selectionTitle">No selection</h2>
      <p>Pick an attachment or a bone on the stage.</p>
    </section>
  )
}

function describeLayer(layer: ResolvedLayer, images: LayerImageResolver, animation: string, phase: number): string {
  const image = images(layer, animation, phase)
  const geometry = layer.mesh && image ? weightedStripMesh(layer.mesh, image.width, image.height) : null
  if (geometry && layer.mesh) {
    return `${geometry.vertices.length}-vertex two-rail joint cage · ${layer.mesh.parentBone} + ${layer.mesh.childBone}`
  }
  return layer.gripFinger ? "rigid finger · root and angle follow the held haft" : "rigid attachment"
}

function LayerInspector({ layer, images }: { layer: ResolvedLayer; images: LayerImageResolver }) {
  const transaction = useTransaction()
  const editSceneSilently = useRigEditor((state) => state.editSceneSilently)
  const { animation, phase, profile } = useRigEditor(
    useShallow((state) => ({
      animation: state.animation,
      phase: state.phase,
      profile: state.presentation.profile,
    })),
  )
  const presentation = useRigEditor((state) => state.presentation)

  const write = (key: LayerBindKey, value: number) =>
    editSceneSilently((draft) => {
      writeLayerBind(draft, sceneSelection(draft, presentation), layer.id, profile, key, value)
    })

  return (
    <section className="panel-section" id="layerInspector">
      <span className="eyebrow">Attachment</span>
      <h2 id="selectionTitle">{layer.id}</h2>
      <p>
        on <strong id="layerBone">{layer.bone}</strong> · <span id="layerMesh">{describeLayer(layer, images, animation, phase)}</span>
      </p>
      <div className="inspector-fields">
        {LAYER_FIELDS.map((field) => (
          <NumericField
            key={field.key}
            label={field.label}
            value={layer[field.key] ?? (field.key === "planeYaw" ? 0 : 0)}
            min={field.min}
            max={field.max}
            step={field.step}
            onBegin={transaction.begin}
            onEnd={transaction.end}
            onChange={(value) => write(field.key, value)}
          />
        ))}
        <NumericField
          label="Draw order"
          value={layer.drawOrder}
          min={-1000}
          max={1000}
          step={1}
          onBegin={transaction.begin}
          onEnd={transaction.end}
          onChange={(value) => editSceneSilently((draft) => writeDrawOrder(draft, layer.id, value))}
        />
      </div>
    </section>
  )
}

function BoneInspector({
  boneID,
  label,
  parent,
}: {
  boneID: string
  label: string
  parent: string | null
}) {
  const transaction = useTransaction()
  const tracks = useTracks()
  const rig = useResolvedRig()
  const bone = rig.bones.find((candidate) => candidate.id === boneID)
  const editSceneSilently = useRigEditor((state) => state.editSceneSilently)
  const editScene = useRigEditor((state) => state.editScene)
  const setPhase = useRigEditor((state) => state.setPhase)
  const { scene, animation, phase, clipScopedEdits, wholeAnimationEdits, profile, manualPose } = useRigEditor(
    useShallow((state) => ({
      scene: state.scene,
      animation: state.animation,
      phase: state.phase,
      clipScopedEdits: state.clipScopedEdits,
      wholeAnimationEdits: state.wholeAnimationEdits,
      profile: state.presentation.profile,
      manualPose: state.manualPose,
    })),
  )
  if (!bone) return null

  const correction = tracks.bonePose(animation, phase)[boneID] ?? {}
  const wholeAnimationOffset = scene ? animationBoneOffset(scene, animation, boneID) : {}
  const bonePhases = scene ? boneKeys(scene, animation, boneID).map((key) => key.phase) : []
  const stepBoneKey = (direction: number) => {
    const next = adjacentPhase(bonePhases, phase, direction)
    if (next !== null) setPhase(next)
  }
  const value = (key: "x" | "y" | "rotation") => {
    if (!clipScopedEdits) return bone[key] ?? 0
    return wholeAnimationEdits ? (wholeAnimationOffset[key] ?? 0) : (correction[key] ?? 0)
  }

  const poseLabel = (field: "X" | "Y" | "rotation") =>
    wholeAnimationEdits ? `Animation ${field}` : `Pose ${field}`

  const write = (key: "x" | "y" | "rotation", next: number) =>
    editSceneSilently((draft) => {
      if (clipScopedEdits && wholeAnimationEdits) {
        setAnimationBoneOffsetValue(draft, animation, boneID, key, next)
      } else if (clipScopedEdits) setBoneKeyValue(draft, animation, boneID, phase, key, next)
      else writeBoneBind(draft, boneID, profile, key, next, manualPose)
    })

  return (
    <section className="panel-section" id="boneInspector">
      <span className="eyebrow">Bone</span>
      <h2 id="selectionTitle">{label}</h2>
      <p>
        parent <strong id="boneParent">{parent ?? "—"}</strong>
      </p>
      {wholeAnimationEdits ? (
        <p className="hint" id="wholeAnimationBoneEditHint">
          Adds the same offset on every frame. Timeline keys stay unchanged.
        </p>
      ) : null}
      <div className="inspector-fields">
        <NumericField
          label={clipScopedEdits ? poseLabel("X") : "Bind X"}
          value={value("x")}
          min={-600}
          max={600}
          step={0.5}
          onBegin={transaction.begin}
          onEnd={transaction.end}
          onChange={(next) => write("x", next)}
        />
        <NumericField
          label={clipScopedEdits ? poseLabel("Y") : "Bind Y"}
          value={value("y")}
          min={-600}
          max={600}
          step={0.5}
          onBegin={transaction.begin}
          onEnd={transaction.end}
          onChange={(next) => write("y", next)}
        />
        <NumericField
          label={clipScopedEdits ? poseLabel("rotation") : "Bind rotation"}
          value={value("rotation")}
          min={-180}
          max={180}
          step={0.5}
          onBegin={transaction.begin}
          onEnd={transaction.end}
          onChange={(next) => write("rotation", next)}
        />
        <NumericField
          label="Bind scale"
          // One field drives both axes: a head that stretched on one axis alone
          // would pull its own face attachments out of round. Scale is bind data
          // only, because changing it resizes every child and attachment.
          value={bone.scaleX ?? 1}
          min={0.05}
          max={8}
          step={0.005}
          disabled={clipScopedEdits}
          onBegin={transaction.begin}
          onEnd={transaction.end}
          onChange={(next) =>
            editSceneSilently((draft) => {
              writeBoneBind(draft, boneID, profile, "scaleX", next, manualPose)
              writeBoneBind(draft, boneID, profile, "scaleY", next, manualPose)
            })
          }
        />
      </div>
      {clipScopedEdits && !wholeAnimationEdits ? (
        <div className="wrist-key-actions">
          <button
            id="setBoneKey"
            type="button"
            className="primary"
            onClick={() => editScene((draft) => void ensureBoneKey(draft, animation, boneID, phase, tracks))}
          >
            Set bone key
          </button>
          <button
            id="deleteBoneKey"
            type="button"
            disabled={!bonePhases.some((at) => Math.abs(at - phase) <= KEY_EPSILON)}
            onClick={() => editScene((draft) => void deleteBoneKey(draft, animation, boneID, phase))}
          >
            Delete key
          </button>
          <button
            id="previousBoneKey"
            type="button"
            disabled={adjacentPhase(bonePhases, phase, -1) === null}
            onClick={() => stepBoneKey(-1)}
          >
            ◀ Bone key
          </button>
          <button
            id="nextBoneKey"
            type="button"
            disabled={adjacentPhase(bonePhases, phase, 1) === null}
            onClick={() => stepBoneKey(1)}
          >
            Bone key ▶
          </button>
        </div>
      ) : clipScopedEdits ? (
        <button
          id="resetAnimationBoneOffset"
          type="button"
          disabled={Object.keys(wholeAnimationOffset).length === 0}
          onClick={() => editScene((draft) => void clearAnimationBoneOffset(draft, animation, boneID))}
        >
          Reset animation offset
        </button>
      ) : (
        <button
          type="button"
          onClick={() =>
            editScene((draft) => {
              const bind = draft.bones.find((candidate) => candidate.id === boneID)?.bindByProfile[profile]
              if (bind) Object.assign(bind, { rotation: 0, scaleX: 1, scaleY: 1 })
            })
          }
        >
          Reset selected bone bind
        </button>
      )}
    </section>
  )
}
