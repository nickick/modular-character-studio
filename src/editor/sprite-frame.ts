/**
 * Fitting a sprite into a small authoring canvas.
 *
 * Both sub-editors — the wrist mesh handles and the finger cutout — draw one
 * sprite letterboxed into a fixed panel and then work in the sprite's own
 * normalized space, so the authored values are resolution-independent.
 */
import type { Point } from "../rig/types.ts"

const PADDING = 16

export interface SpriteFrame {
  x: number
  y: number
  width: number
  height: number
  /** Normalized sprite space to canvas pixels. */
  point: (normalized: Point) => Point
  /** Canvas pixels to normalized sprite space, clamped inside the sprite. */
  normalized: (point: Point) => Point
  /** The same, without clamping: handles may reach outside the artwork. */
  unbounded: (point: Point) => Point
}

export function spriteFrame(
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
): SpriteFrame {
  const scale = Math.min(
    (canvasWidth - PADDING * 2) / imageWidth,
    (canvasHeight - PADDING * 2) / imageHeight,
  )
  const width = imageWidth * scale
  const height = imageHeight * scale
  const x = (canvasWidth - width) / 2
  const y = (canvasHeight - height) / 2
  return {
    x,
    y,
    width,
    height,
    point: (normalized) => ({ x: x + normalized.x * width, y: y + normalized.y * height }),
    normalized: (point) => ({
      x: Math.max(0, Math.min(1, (point.x - x) / width)),
      y: Math.max(0, Math.min(1, (point.y - y) / height)),
    }),
    unbounded: (point) => ({ x: (point.x - x) / width, y: (point.y - y) / height }),
  }
}

/** Where a pointer event lands in a canvas's own pixel space. */
export function canvasPoint(
  event: { clientX: number; clientY: number },
  canvas: { width: number; height: number; getBoundingClientRect: () => DOMRect },
): Point {
  const bounds = canvas.getBoundingClientRect()
  return {
    x: ((event.clientX - bounds.left) * canvas.width) / bounds.width,
    y: ((event.clientY - bounds.top) * canvas.height) / bounds.height,
  }
}
