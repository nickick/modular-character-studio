/**
 * The finger cutout pen tool.
 *
 * One normalized path is shared by the index, middle, ring, and pinky copies,
 * so tracing it once masks all four. It behaves like Photoshop's pen: click for
 * a corner, click-drag from an anchor for a smooth pair of cubic handles, and
 * click the green first anchor to close. Option-dragging a handle breaks it
 * away from its mirrored partner.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { canvasPoint, spriteFrame, type SpriteFrame } from "@/editor/sprite-frame.ts"
import {
  CUTOUT_SOURCE_LAYER_ID,
  addAnchor,
  closePath,
  closesPath,
  deleteNode,
  emptyPath,
  hitPath,
  moveAnchor,
  moveHandle,
  pathStatus,
  shapeNewNode,
  undoAnchor,
  type PathHit,
} from "@/editor/bezier-path.ts"
import { GRIP_FINGER_LAYER_IDS, useRigEditor, type RigSnapshot } from "@/stores/rig-editor.ts"
import { useResolvedRig } from "@/hooks/use-rig-frame.ts"
import type { LayerImageResolver } from "@/hooks/use-rig-images.ts"
import type { BezierNode, BezierPathV1, Point, RigScene } from "@/rig/types.ts"

const WIDTH = 280
const HEIGHT = 170

type Tool = "pen" | "edit"

/** The mask lives on all four finger copies, so every write fans out. */
function writeSharedPath(scene: RigScene, path: BezierPathV1 | null): void {
  for (const id of GRIP_FINGER_LAYER_IDS) {
    const layer = scene.layers.find((candidate) => candidate.id === id)
    if (!layer) continue
    if (path) layer.clipPath = structuredClone(path)
    else delete layer.clipPath
  }
}

type Drag =
  | { kind: "new"; index: number; anchor: Point; frame: SpriteFrame; before: RigSnapshot }
  | {
      kind: "move"
      hit: PathHit
      original: BezierNode
      start: Point
      frame: SpriteFrame
      before: RigSnapshot
    }

export function FingerCutoutEditor({ images }: { images: LayerImageResolver }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [tool, setTool] = useState<Tool>("pen")
  const [selected, setSelected] = useState<number | null>(null)
  const rig = useResolvedRig()
  const { scene, animation, phase } = useRigEditor(
    useShallow((state) => ({
      scene: state.scene,
      animation: state.animation,
      phase: state.phase,
    })),
  )
  const editScene = useRigEditor((state) => state.editScene)
  const editSceneSilently = useRigEditor((state) => state.editSceneSilently)

  const layer = rig.layers.find((candidate) => candidate.id === CUTOUT_SOURCE_LAYER_ID) ?? null
  const image = layer ? images(layer, animation, phase) : null
  const path =
    scene?.layers.find((candidate) => candidate.id === CUTOUT_SOURCE_LAYER_ID)?.clipPath ?? null

  useEffect(() => {
    const canvas = canvasRef.current
    const target = canvas?.getContext("2d")
    if (!canvas || !target) return
    target.clearRect(0, 0, WIDTH, HEIGHT)
    target.fillStyle = "#0b1016"
    target.fillRect(0, 0, WIDTH, HEIGHT)
    if (!image) return

    const frame = spriteFrame(WIDTH, HEIGHT, image.width, image.height)
    target.save()
    target.globalAlpha = 0.92
    target.drawImage(image, frame.x, frame.y, frame.width, frame.height)
    target.restore()
    if (!path?.nodes.length) return

    const nodes = path.nodes
    const control = (node: BezierNode, side: "in" | "out"): Point =>
      frame.point(node[side] ?? node)
    const first = frame.point(nodes[0])
    target.beginPath()
    target.moveTo(first.x, first.y)
    for (let index = 1; index < nodes.length; index += 1) {
      const from = control(nodes[index - 1], "out")
      const to = control(nodes[index], "in")
      const end = frame.point(nodes[index])
      target.bezierCurveTo(from.x, from.y, to.x, to.y, end.x, end.y)
    }
    // The open path is drawn while it is being authored, but only a closed one
    // is filled -- and only a closed one clips the assembled hand.
    if (path.closed && nodes.length >= 3) {
      const from = control(nodes[nodes.length - 1], "out")
      const to = control(nodes[0], "in")
      target.bezierCurveTo(from.x, from.y, to.x, to.y, first.x, first.y)
      target.closePath()
      target.save()
      target.fillStyle = "rgba(83,217,232,.13)"
      target.fill()
      target.restore()
    }
    target.strokeStyle = path.closed ? "#55d9e8" : "#f0b24b"
    target.lineWidth = 2
    target.stroke()

    const active = selected == null ? undefined : nodes[selected]
    if (active) {
      const anchor = frame.point(active)
      for (const handle of [active.in, active.out]) {
        if (!handle) continue
        const at = frame.point(handle)
        target.beginPath()
        target.moveTo(anchor.x, anchor.y)
        target.lineTo(at.x, at.y)
        target.strokeStyle = "rgba(201,150,255,.7)"
        target.lineWidth = 1
        target.stroke()
        target.beginPath()
        target.arc(at.x, at.y, 5, 0, Math.PI * 2)
        target.fillStyle = "#c996ff"
        target.fill()
      }
    }
    nodes.forEach((node, index) => {
      const anchor = frame.point(node)
      target.beginPath()
      target.rect(anchor.x - 5, anchor.y - 5, 10, 10)
      // The first anchor is green because clicking it is what closes the path.
      target.fillStyle = index === selected ? "#fff" : index === 0 ? "#68d8a1" : "#f0b24b"
      target.fill()
      target.lineWidth = 1.5
      target.strokeStyle = "#091016"
      target.stroke()
    })
  }, [image, path, selected])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas || !image) return
      const frame = spriteFrame(WIDTH, HEIGHT, image.width, image.height)
      const point = canvasPoint(event, canvas)
      const before = useRigEditor.getState().snapshot()

      if (tool === "pen") {
        if (path?.closed) return
        if (closesPath(path, frame.point, point)) {
          editScene((draft) => writeSharedPath(draft, closePath(path ?? emptyPath())))
          setSelected(0)
          setTool("edit")
          return
        }
        const next = addAnchor(path ?? emptyPath(), frame.normalized(point))
        const index = next.nodes.length - 1
        editSceneSilently((draft) => writeSharedPath(draft, next))
        setSelected(index)
        dragRef.current = { kind: "new", index, anchor: next.nodes[index], frame, before }
      } else {
        const hit = hitPath(path, selected, frame.point, point)
        if (!hit || !path) {
          setSelected(null)
          return
        }
        setSelected(hit.index)
        dragRef.current = {
          kind: "move",
          hit,
          original: structuredClone(path.nodes[hit.index]),
          start: frame.unbounded(point),
          frame,
          before,
        }
      }
      canvas.setPointerCapture(event.pointerId)
    },
    [tool, path, selected, image, editScene, editSceneSilently],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      const canvas = canvasRef.current
      if (!drag || !canvas || !path) return
      const point = drag.frame.unbounded(canvasPoint(event, canvas))
      let next: BezierPathV1
      if (drag.kind === "new") {
        // A click that never really moves stays a corner; only a real drag
        // grows the pair of handles.
        const travelled = Math.hypot(
          (point.x - drag.anchor.x) * drag.frame.width,
          (point.y - drag.anchor.y) * drag.frame.height,
        )
        if (travelled < 3) return
        next = shapeNewNode(path, drag.index, drag.anchor, point)
      } else if (drag.hit.kind === "anchor") {
        next = moveAnchor(path, drag.hit.index, drag.original, {
          x: point.x - drag.start.x,
          y: point.y - drag.start.y,
        })
      } else {
        next = moveHandle(path, drag.hit.index, drag.hit.handle, point, event.altKey)
      }
      editSceneSilently((draft) => writeSharedPath(draft, next))
    },
    [path, editSceneSilently],
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

  if (!scene || !layer) return null
  const nodeCount = path?.nodes.length ?? 0

  return (
    <section className="panel-section">
      <div className="mesh-authoring-heading">
        <strong>Finger cutout</strong>
        <span>shared by all four fingers</span>
      </div>
      <div className="finger-path-toolbar" role="toolbar" aria-label="Finger cutout tools">
        <button
          id="fingerPenTool"
          type="button"
          aria-pressed={tool === "pen"}
          className={tool === "pen" ? "active" : undefined}
          onClick={() => setTool("pen")}
        >
          Pen
        </button>
        <button
          id="fingerEditTool"
          type="button"
          aria-pressed={tool === "edit"}
          className={tool === "edit" ? "active" : undefined}
          onClick={() => setTool("edit")}
        >
          Edit
        </button>
        <button
          id="newFingerPath"
          type="button"
          onClick={() => {
            editScene((draft) => writeSharedPath(draft, null))
            setSelected(null)
            setTool("pen")
          }}
        >
          New path
        </button>
      </div>
      <canvas
        id="fingerPathEditor"
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Bezier finger cutout editor"
        style={{ cursor: tool === "pen" ? "crosshair" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="finger-path-actions">
        <button
          id="closeFingerPath"
          type="button"
          disabled={nodeCount < 3 || Boolean(path?.closed)}
          onClick={() => {
            if (!path) return
            editScene((draft) => writeSharedPath(draft, closePath(path)))
            setSelected(0)
            setTool("edit")
          }}
        >
          Close path
        </button>
        <button
          id="deleteFingerNode"
          type="button"
          disabled={selected == null || nodeCount === 0}
          onClick={() => {
            if (!path || selected == null) return
            const result = deleteNode(path, selected)
            editScene((draft) => writeSharedPath(draft, result.path))
            setSelected(result.selected)
          }}
        >
          Delete node
        </button>
        <button
          id="undoFingerPoint"
          type="button"
          disabled={nodeCount === 0}
          onClick={() => {
            if (!path) return
            const result = undoAnchor(path)
            editScene((draft) => writeSharedPath(draft, result.path))
            setSelected(result.selected)
          }}
        >
          Undo point
        </button>
        <button
          id="resetFingerPath"
          type="button"
          disabled={nodeCount === 0}
          onClick={() => {
            editScene((draft) => writeSharedPath(draft, null))
            setSelected(null)
            setTool("pen")
          }}
        >
          Clear cutout
        </button>
      </div>
      <p id="fingerPathStatus" className="hint">
        {pathStatus(path)}
      </p>
    </section>
  )
}
