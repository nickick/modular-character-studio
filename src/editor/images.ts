/**
 * Loading and caching the rig's artwork.
 *
 * Both studios kept their own `Map` of decoded images plus a near-identical
 * `loadImage` promise wrapper. The cache is shared now, which also means a
 * layer's art is decoded once even when both studios are open.
 */
import type { LayerImage } from "../canvas/paint.ts"

/** Where the project server mounts the active character's art. */
export const RIG_ASSET_ROOT = "/assets/"

export const assetURL = (path: string): string => `${RIG_ASSET_ROOT}${path}`

export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load ${source}`))
    image.src = source
  })
}

/**
 * A decoded-image cache keyed by asset path. Failed loads are remembered as
 * misses rather than retried on every frame, because a missing PNG during
 * authoring is normal and a render loop must not hammer the server for it.
 */
export class ImageCache {
  private readonly images = new Map<string, LayerImage>()
  private readonly pending = new Map<string, Promise<void>>()
  private readonly missing = new Set<string>()

  get(path: string): LayerImage | null {
    return this.images.get(path) ?? null
  }

  has(path: string): boolean {
    return this.images.has(path)
  }

  get size(): number {
    return this.images.size
  }

  /** Load every path that is not already cached or known to be missing. */
  async loadAll(paths: Iterable<string>): Promise<void> {
    const wanted = [...new Set(paths)].filter(
      (path) => !this.images.has(path) && !this.missing.has(path),
    )
    await Promise.all(wanted.map((path) => this.load(path)))
  }

  private load(path: string): Promise<void> {
    const existing = this.pending.get(path)
    if (existing) return existing
    const request = loadImage(assetURL(path))
      .then((image) => {
        this.images.set(path, image)
      })
      .catch(() => {
        this.missing.add(path)
      })
      .finally(() => {
        this.pending.delete(path)
      })
    this.pending.set(path, request)
    return request
  }
}
