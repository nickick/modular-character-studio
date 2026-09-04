/**
 * Decoded artwork for both bodies at once.
 *
 * The equipment studio draws the male and the female side by side, so one cache
 * holds the union of what both wear. Two caches — one per body — would decode
 * every shared sprite twice and, worse, leave whichever body was not the
 * "primary" one drawing from a cache that had never been told about its art.
 */
import { useEffect, useMemo, useState } from "react"
import { ImageCache } from "@/editor/images.ts"
import {
  expressionAssetPath,
  expressionAssets,
  loadExpressionCatalog,
  type ExpressionCatalog,
} from "@/editor/expressions.ts"
import type { RigTracks } from "@/rig/tracks.ts"
import type { LayerImage } from "@/canvas/paint.ts"
import type { ProfileID, ResolvedLayer, ResolvedRig } from "@/rig/types.ts"

/** Resolves art for a layer on a named body. */
export type ProfileImageResolver = (
  profile: ProfileID,
  layer: ResolvedLayer,
  animation: string,
  phase: number,
) => LayerImage | null

export function useEquipmentImages(
  rigs: Record<ProfileID, ResolvedRig>,
  tracks: RigTracks,
): { resolve: ProfileImageResolver; ready: boolean } {
  const cache = useMemo(() => new ImageCache(), [])
  const [catalog, setCatalog] = useState<ExpressionCatalog | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadExpressionCatalog()
      .then((loaded) => {
        if (!cancelled) setCatalog(loaded)
      })
      .catch(() => {
        if (!cancelled) setCatalog(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const assets = useMemo(
    () => [
      ...rigs.maleV1.layers.map((layer) => layer.asset),
      ...rigs.femaleV1.layers.map((layer) => layer.asset),
      ...expressionAssets(catalog, "maleV1"),
      ...expressionAssets(catalog, "femaleV1"),
    ],
    [rigs, catalog],
  )

  useEffect(() => {
    let cancelled = false
    cache
      .loadAll(assets)
      .then(() => {
        if (!cancelled) setGeneration((value) => value + 1)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [cache, assets])

  const resolve = useMemo<ProfileImageResolver>(() => {
    // Read so the resolver's identity changes once more art has decoded, which
    // is what tells the stages to repaint.
    void generation
    return (profile, layer, animation, phase) => {
      const face = expressionAssetPath(catalog, profile, layer.id, tracks.expressionAt(animation, phase))
      return cache.get(face ?? layer.asset)
    }
  }, [cache, catalog, tracks, generation])

  return { resolve, ready: cache.size > 0 }
}
