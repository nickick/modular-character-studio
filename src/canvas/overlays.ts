/**
 * The stage's non-artwork drawing: the backdrop, the floor reference line, the
 * skeleton, and the selection outline.
 *
 * Kept apart from `paint.ts` because none of it is the character: an offscreen
 * render for a motion preview or a PNG export wants the rig without any of it.
 */
import { transformPoint, type MatrixTable } from "../rig/matrix.ts"
import { rigidLayerMatrix } from "../rig/mesh.ts"
import { STAGE_OVERSCAN, STAGE_SIZE, STAGE_VIEW_SIZE, boneOrigin } from "../editor/stage.ts"
import type { LayerImage } from "./paint.ts"
import type { Point, ResolvedBone, ResolvedLayer, ResolvedRig } from "../rig/types.ts"

const BACKDROP = "#10161d"
const GRID_CELL = "#151e27"
const GRID_LINE = "rgba(111,137,161,.16)"
const CENTRE_LINE = "rgba(83,218,232,.35)"
const FLOOR_LINE = "rgba(240,178,75,.78)"
const FLOOR_LABEL = "rgba(240,178,75,.9)"
const BONE_LINE = "rgba(83,217,232,.82)"
const SKIRT_LINE = "rgba(240,178,75,.9)"
const SELECTION = "#f0b24b"

/** The default floor, when no boot artwork is available to measure. */
const DEFAULT_BASELINE = 1190

/**
 * Where the floor sits, measured from the boot soles at the bind pose so the
 * reference line follows whichever boots are worn.
 *
 * The boot PNGs are tightly trimmed, so the sample is taken just inside the
 * bottom at their horizontal centre: that follows the sole without letting a
 * rotated transparent corner drag the line down.
 */
export function floorLineY(
  rig: ResolvedRig,
  bindWorld: MatrixTable,
  imageFor: (layer: ResolvedLayer) => LayerImage | null,
  fallbackBaseline: number = DEFAULT_BASELINE,
): number {
  const contacts: number[] = []
  for (const id of ["footL", "footR"]) {
    const layer = rig.layers.find((candidate) => candidate.id === id)
    const image = layer ? imageFor(layer) : null
    if (!layer || !image) continue
    const matrix = rigidLayerMatrix(layer, image.width, image.height, bindWorld, bindWorld)
    contacts.push(transformPoint(matrix, { x: image.width * 0.5, y: image.height * 0.986 }).y)
  }
  const baseline = contacts.length ? Math.max(...contacts) : fallbackBaseline
  return STAGE_OVERSCAN + baseline
}

export interface BackdropOptions {
  showGrid: boolean
  floorY: number
}

export function drawBackdrop(target: CanvasRenderingContext2D, options: BackdropOptions): void {
  target.fillStyle = BACKDROP
  target.fillRect(0, 0, STAGE_VIEW_SIZE, STAGE_VIEW_SIZE)
  if (options.showGrid) {
    const cell = 48
    target.fillStyle = GRID_CELL
    for (let y = -STAGE_OVERSCAN; y < STAGE_SIZE + STAGE_OVERSCAN; y += cell) {
      for (let x = -STAGE_OVERSCAN; x < STAGE_SIZE + STAGE_OVERSCAN; x += cell) {
        if ((x / cell + y / cell) % 2 === 0) {
          target.fillRect(x + STAGE_OVERSCAN, y + STAGE_OVERSCAN, cell, cell)
        }
      }
    }
    target.strokeStyle = GRID_LINE
    target.lineWidth = 1
    for (let at = -STAGE_OVERSCAN; at <= STAGE_SIZE + STAGE_OVERSCAN; at += 96) {
      const view = at + STAGE_OVERSCAN
      target.beginPath()
      target.moveTo(view, 0)
      target.lineTo(view, STAGE_VIEW_SIZE)
      target.stroke()
      target.beginPath()
      target.moveTo(0, view)
      target.lineTo(STAGE_VIEW_SIZE, view)
      target.stroke()
    }
    target.strokeStyle = CENTRE_LINE
    target.beginPath()
    target.moveTo(STAGE_OVERSCAN + STAGE_SIZE / 2, 0)
    target.lineTo(STAGE_OVERSCAN + STAGE_SIZE / 2, STAGE_VIEW_SIZE)
    target.stroke()
  }
  target.save()
  target.setLineDash([12, 9])
  target.strokeStyle = FLOOR_LINE
  target.lineWidth = 2
  target.beginPath()
  target.moveTo(STAGE_OVERSCAN, options.floorY)
  target.lineTo(STAGE_OVERSCAN + STAGE_SIZE, options.floorY)
  target.stroke()
  target.restore()
  target.fillStyle = FLOOR_LABEL
  target.font = "600 18px system-ui, sans-serif"
  target.fillText("FLOOR", STAGE_OVERSCAN + 12, options.floorY - 10)
}

export interface SkeletonOptions {
  bones: readonly ResolvedBone[]
  currentWorld: MatrixTable
  selectedBone: string | null
  showNames: boolean
}

export function drawSkeleton(target: CanvasRenderingContext2D, options: SkeletonOptions): void {
  const { bones, currentWorld, selectedBone, showNames } = options
  target.save()
  target.font = "700 15px ui-sans-serif, system-ui"
  target.textBaseline = "middle"
  for (const bone of bones) {
    const point = boneOrigin(currentWorld[bone.id])
    const selected = selectedBone === bone.id
    const skirt = bone.id.startsWith("skirt")
    if (bone.parent) {
      const parent = boneOrigin(currentWorld[bone.parent])
      target.strokeStyle = skirt ? SKIRT_LINE : BONE_LINE
      target.lineWidth = selected ? 5 : 3
      target.beginPath()
      target.moveTo(parent.x, parent.y)
      target.lineTo(point.x, point.y)
      target.stroke()
    }
    target.beginPath()
    target.arc(point.x, point.y, selected ? 10 : 7, 0, Math.PI * 2)
    target.fillStyle = selected ? "#fff" : skirt ? "#f0b24b" : "#55d9e8"
    target.fill()
    target.lineWidth = 3
    target.strokeStyle = "#13202a"
    target.stroke()
    if (showNames) {
      target.lineWidth = 4
      target.strokeStyle = "rgba(8,12,17,.9)"
      target.fillStyle = "#eaf6f8"
      target.strokeText(bone.label, point.x + 13, point.y - 10)
      target.fillText(bone.label, point.x + 13, point.y - 10)
    }
  }
  target.restore()
}

/** Outline the selected attachment's drawn quad. */
export function drawSelectionOutline(target: CanvasRenderingContext2D, corners: readonly Point[]): void {
  if (corners.length === 0) return
  target.save()
  target.strokeStyle = SELECTION
  target.lineWidth = 3
  target.setLineDash([11, 7])
  target.beginPath()
  target.moveTo(corners[0].x, corners[0].y)
  for (let index = 1; index < corners.length; index += 1) {
    target.lineTo(corners[index].x, corners[index].y)
  }
  target.closePath()
  target.stroke()
  target.restore()
}
