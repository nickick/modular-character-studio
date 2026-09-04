/**
 * The opaque bounding box of a sprite.
 *
 * Equipment PNGs are drawn on the full rig artboard, so most of the file is
 * transparent. A selection outline around the file's rectangle would sit far
 * away from the piece it marks — and once the piece is rotated, nowhere near
 * it. Measuring the painted pixels puts the box on the artwork.
 */
import type { LayerImage } from "../canvas/paint.ts"

export interface VisibleBounds {
  left: number
  top: number
  right: number
  bottom: number
}

const cache = new WeakMap<LayerImage, VisibleBounds>()

export function visibleImageBounds(image: LayerImage): VisibleBounds {
  const cached = cache.get(image)
  if (cached) return cached
  const width = image.width
  const height = image.height
  const fallback: VisibleBounds = { left: 0, top: 0, right: width, bottom: height }
  try {
    const scratch = document.createElement("canvas")
    scratch.width = width
    scratch.height = height
    const context = scratch.getContext("2d", { willReadFrequently: true })
    if (!context) return fallback
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, width, height).data
    let left = width
    let top = height
    let right = -1
    let bottom = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] === 0) continue
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    }
    const bounds: VisibleBounds =
      right >= left ? { left, top, right: right + 1, bottom: bottom + 1 } : fallback
    cache.set(image, bounds)
    return bounds
  } catch {
    // All editor assets are same-origin, but retaining the full-image fallback
    // keeps selection usable if that contract ever changes.
    cache.set(image, fallback)
    return fallback
  }
}
