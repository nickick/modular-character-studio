/**
 * The joint-cage editor.
 *
 * A hand sprite with its two rails drawn over it, and the two handles that set
 * where the bend begins and ends. The hidden cuff side of the cyan handle stays
 * parent-weighted; the gold side stays 100% child-weighted. The same contract
 * edits the elbow and ankle bridges on the currently equipped arms and boots.
 */
import { useCallback, useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { NumericField } from "@/components/NumericField.tsx"
import { canvasPoint, spriteFrame } from "@/editor/sprite-frame.ts"
import {
  MAX_BEND_SECTIONS,
  MIN_BEND_SECTIONS,
  editableJointLayers,
  hitMeshHandle,
  movedMeshHandle,
  setBendSections,
  wristLayerFor,
  type MeshHandle,
} from "@/editor/wrist-mesh.ts"
import { weightedStripMesh } from "@/rig/mesh.ts"
import { layerMatchesHandPose } from "@/rig/clips.ts"
import { useRigEditor, type RigSnapshot } from "@/stores/rig-editor.ts"
import { useResolvedRig } from "@/hooks/use-rig-frame.ts"
import type { LayerImageResolver } from "@/hooks/use-rig-images.ts"

const WIDTH = 280
const HEIGHT = 210

const PARENT_COLOR = "#55d9e8"
const CHILD_COLOR = "#f0b24b"

const jointLabel = (id: string): string => {
  const side = id.endsWith("L") ? "Left" : "Right"
  if (id.startsWith("upperArmArmor")) return `${side} elbow · upper arm end`
  if (id.startsWith("forearmVambrace")) return `${side} elbow · forearm top`
  if (id.startsWith("lowerLeg")) return `${side} ankle · shaft`
  if (id.startsWith("foot")) return `${side} ankle · foot overlap`
  return `${side} wrist · active hand`
}

export interface JointMeshEditorProps {
  images: LayerImageResolver
  showStageMesh: boolean
  onShowStageMeshChange: (show: boolean) => void
}

export function JointMeshEditor({ images, showStageMesh, onShowStageMeshChange }: JointMeshEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ handle: MeshHandle; before: RigSnapshot } | null>(null)
  const rig = useResolvedRig()
  const { scene, side, handPose, animation, phase, selectedLayer } = useRigEditor(
    useShallow((state) => ({
      scene: state.scene,
      side: state.wrist.side,
      handPose: state.handPose,
      animation: state.animation,
      phase: state.phase,
      selectedLayer: state.selectedLayer,
    })),
  )
  const editSceneSilently = useRigEditor((state) => state.editSceneSilently)
  const editScene = useRigEditor((state) => state.editScene)
  const selectLayer = useRigEditor((state) => state.selectLayer)

  const availableLayers = editableJointLayers(rig.layers, (candidate) =>
    layerMatchesHandPose(candidate, handPose),
  )
  const preferredWrist = wristLayerFor(rig.layers, side, (candidate) =>
    layerMatchesHandPose(candidate, handPose),
  )
  const layer =
    availableLayers.find((candidate) => candidate.id === selectedLayer) ??
    preferredWrist ??
    availableLayers[0] ??
    null
  const image = layer ? images(layer, animation, phase) : null
  const mesh = layer?.mesh ?? null
  const isShaft = layer?.id.startsWith("lowerLeg") ?? false
  const isFootOverlap = layer?.id.startsWith("foot") ?? false
  const isAnkle = isShaft || isFootOverlap
  const isUpperArm = layer?.id.startsWith("upperArmArmor") ?? false
  const isElbow = isUpperArm || (layer?.id.startsWith("forearmVambrace") ?? false)
  const triangleCount = mesh && image
    ? weightedStripMesh(mesh, image.width, image.height)?.triangles.length
    : undefined

  useEffect(() => {
    const canvas = canvasRef.current
    const target = canvas?.getContext("2d")
    if (!canvas || !target) return
    target.clearRect(0, 0, WIDTH, HEIGHT)
    target.fillStyle = "#0b1016"
    target.fillRect(0, 0, WIDTH, HEIGHT)
    if (!mesh || !image) return

    const frame = spriteFrame(WIDTH, HEIGHT, image.width, image.height)
    target.save()
    target.globalAlpha = 0.9
    target.drawImage(image, frame.x, frame.y, frame.width, frame.height)
    target.globalAlpha = 1

    const geometry = weightedStripMesh(mesh, image.width, image.height)
    if (geometry) {
      target.strokeStyle = "rgba(94,226,235,.55)"
      target.lineWidth = 1
      for (const triangle of geometry.triangles) {
        const points = triangle.map((index) =>
          frame.point({
            x: geometry.vertices[index].source.x / image.width,
            y: geometry.vertices[index].source.y / image.height,
          }),
        )
        target.beginPath()
        target.moveTo(points[0].x, points[0].y)
        target.lineTo(points[1].x, points[1].y)
        target.lineTo(points[2].x, points[2].y)
        target.closePath()
        target.stroke()
      }
    }

    const start = frame.point(mesh.bendStart)
    const end = frame.point(mesh.bendEnd)
    const gradient = target.createLinearGradient(start.x, start.y, end.x, end.y)
    gradient.addColorStop(0, PARENT_COLOR)
    gradient.addColorStop(1, CHILD_COLOR)
    target.strokeStyle = gradient
    target.lineWidth = 4
    target.beginPath()
    target.moveTo(start.x, start.y)
    target.lineTo(end.x, end.y)
    target.stroke()
    for (const [point, color] of [
      [start, PARENT_COLOR],
      [end, CHILD_COLOR],
    ] as const) {
      target.beginPath()
      target.arc(point.x, point.y, 8, 0, Math.PI * 2)
      target.fillStyle = color
      target.fill()
      target.lineWidth = 2
      target.strokeStyle = "#091016"
      target.stroke()
    }
    target.restore()
  }, [mesh, image])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas || !mesh || !image || !layer) return
      const frame = spriteFrame(WIDTH, HEIGHT, image.width, image.height)
      const handle = hitMeshHandle(mesh, frame, canvasPoint(event, canvas))
      if (!handle) return
      dragRef.current = { handle, before: useRigEditor.getState().snapshot() }
      canvas.setPointerCapture(event.pointerId)
    },
    [mesh, image, layer],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      const canvas = canvasRef.current
      if (!drag || !canvas || !mesh || !image || !layer) return
      const frame = spriteFrame(WIDTH, HEIGHT, image.width, image.height)
      const next = movedMeshHandle(mesh, drag.handle, frame.normalized(canvasPoint(event, canvas)))
      if (!next) return
      editSceneSilently((draft) => {
        const target = draft.layers.find((candidate) => candidate.id === layer.id)?.mesh
        if (target) target[drag.handle] = next
      })
    },
    [mesh, image, layer, editSceneSilently],
  )

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    useRigEditor.getState().commit(drag.before)
  }, [])

  if (!scene || !layer || !mesh) return null

  const setPointCoordinate = (
    handle: "bendStart" | "bendEnd",
    coordinate: "x" | "y",
    value: number,
  ) =>
    editScene((draft) => {
      const target = draft.layers.find((candidate) => candidate.id === layer.id)?.mesh
      if (target) target[handle][coordinate] = value
    })

  return (
    <section className="panel-section" id="jointMeshLab">
      <span className="eyebrow">Deformation</span>
      <div className="mesh-authoring-heading">
        <strong>Joint cage</strong>
        <span id="meshLayerName">{layer.id}</span>
      </div>
      <label className="joint-mesh-target" htmlFor="meshJointSelect">
        Joint to edit
        <select
          id="meshJointSelect"
          value={layer.id}
          onChange={(event) => {
            selectLayer(event.target.value)
            onShowStageMeshChange(true)
          }}
        >
          {availableLayers.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {jointLabel(candidate.id)}
            </option>
          ))}
        </select>
      </label>
      <button
        id="showJointMeshesOnStage"
        type="button"
        className={showStageMesh ? "accent" : undefined}
        aria-pressed={showStageMesh}
        onClick={() => onShowStageMeshChange(!showStageMesh)}
      >
        {showStageMesh ? "Hide cages on character" : "Show cages on character"}
      </button>
      <canvas
        id="jointMeshEditor"
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label={isElbow ? "Elbow mesh bend-region editor" : isAnkle ? "Ankle mesh bend-region editor" : "Wrist mesh bend-region editor"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="joint-mesh-coordinates">
        <NumericField
          label="Parent handle X"
          value={mesh.bendStart.x}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setPointCoordinate("bendStart", "x", value)}
        />
        <NumericField
          label="Parent handle Y"
          value={mesh.bendStart.y}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setPointCoordinate("bendStart", "y", value)}
        />
        <NumericField
          label="Child handle X"
          value={mesh.bendEnd.x}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setPointCoordinate("bendEnd", "x", value)}
        />
        <NumericField
          label="Child handle Y"
          value={mesh.bendEnd.y}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setPointCoordinate("bendEnd", "y", value)}
        />
      </div>
      <NumericField
        label="Bend sections"
        value={mesh.bendStops.length}
        min={MIN_BEND_SECTIONS}
        max={MAX_BEND_SECTIONS}
        step={1}
        onChange={(count) =>
          editScene((draft) => {
            const target = draft.layers.find((candidate) => candidate.id === layer.id)?.mesh
            if (target) setBendSections(target, count)
          })
        }
      />
      {triangleCount !== undefined && (
        <p className="hint" id="meshTriangleCount">{triangleCount} triangles on this piece</p>
      )}
      <div className="wrist-key-actions">
        <button
          id="resetJointMesh"
          type="button"
          onClick={() =>
            editScene((draft) => {
              const saved = useRigEditor
                .getState()
                .savedScene?.layers.find((candidate) => candidate.id === layer.id)?.mesh
              const target = draft.layers.find((candidate) => candidate.id === layer.id)
              if (saved && target) target.mesh = structuredClone(saved)
            })
          }
        >
          Reset unsaved joint mesh
        </button>
      </div>
      <p className="hint">
        Drag cyan to where the parent bone stops and gold to where the child becomes rigid.{" "}
        {isElbow
          ? isUpperArm
            ? "Only the bottom elbow band blends into the forearm; the shoulder and upper arm stay rigid."
            : "Only the top elbow band blends from the upper arm; the rest of the forearm stays rigid."
          : isAnkle
          ? isShaft
            ? "This is the primary flex: the shaft stays on the lower leg while its bottom ankle band blends into the foot."
            : "This narrow companion blend keeps the raised foot overlap seated; the sole and toe stay rigid on the foot."
          : "The cuff follows the forearm while the palm and fingers follow the hand."}
      </p>
    </section>
  )
}
