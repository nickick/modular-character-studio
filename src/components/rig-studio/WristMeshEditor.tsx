/**
 * The wrist cage editor.
 *
 * A hand sprite with its two rails drawn over it, and the two handles that set
 * where the bend begins and ends. The hidden cuff side of the cyan handle stays
 * forearm-weighted; the palm side of the gold handle stays 100% hand-weighted,
 * which is what keeps the painted palm and fingers rigid.
 */
import { useCallback, useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { NumericField } from "@/components/NumericField.tsx"
import { canvasPoint, spriteFrame } from "@/editor/sprite-frame.ts"
import {
  MAX_BEND_SECTIONS,
  MIN_BEND_SECTIONS,
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

const CUFF_COLOR = "#55d9e8"
const PALM_COLOR = "#f0b24b"

export function WristMeshEditor({ images }: { images: LayerImageResolver }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ handle: MeshHandle; before: RigSnapshot } | null>(null)
  const rig = useResolvedRig()
  const { scene, side, handPose, animation, phase } = useRigEditor(
    useShallow((state) => ({
      scene: state.scene,
      side: state.wrist.side,
      handPose: state.handPose,
      animation: state.animation,
      phase: state.phase,
    })),
  )
  const editSceneSilently = useRigEditor((state) => state.editSceneSilently)
  const editScene = useRigEditor((state) => state.editScene)

  const layer = wristLayerFor(rig.layers, side, (candidate) =>
    layerMatchesHandPose(candidate, handPose),
  )
  const image = layer ? images(layer, animation, phase) : null
  const mesh = layer?.mesh ?? null

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
    gradient.addColorStop(0, CUFF_COLOR)
    gradient.addColorStop(1, PALM_COLOR)
    target.strokeStyle = gradient
    target.lineWidth = 4
    target.beginPath()
    target.moveTo(start.x, start.y)
    target.lineTo(end.x, end.y)
    target.stroke()
    for (const [point, color] of [
      [start, CUFF_COLOR],
      [end, PALM_COLOR],
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

  return (
    <section className="panel-section">
      <div className="mesh-authoring-heading">
        <strong id="meshLayerName">{layer.id}</strong>
        <span>two thickness-preserving rails</span>
      </div>
      <canvas
        id="wristMeshEditor"
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Wrist mesh bend-region editor"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
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
      <div className="wrist-key-actions">
        <button
          id="resetWristMesh"
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
          Reset unsaved mesh
        </button>
      </div>
      <p className="hint">
        Drag the cyan handle to where the bend begins and the gold handle to where it ends. The cuff
        side of cyan stays on the forearm; the palm side of gold stays rigid with the hand.
      </p>
    </section>
  )
}
