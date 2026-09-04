/**
 * The studio's decoded artwork: every worn layer, the face expression drawings,
 * and the profile reference photograph.
 */
import { useEffect, useMemo, useState } from "react"
import { ImageCache, assetURL, loadImage } from "@/editor/images.ts"
import {
  expressionAssetPath,
  expressionAssets,
  loadExpressionCatalog,
  type ExpressionCatalog,
} from "@/editor/expressions.ts"
import type { RigTracks } from "@/rig/tracks.ts"
import type { LayerImage } from "@/canvas/paint.ts"
import type { ProfileID, ResolvedLayer, ResolvedRig, RigScene } from "@/rig/types.ts"

/** Resolves the art a layer shows at a moment, expressions included. */
export type LayerImageResolver = (
  layer: ResolvedLayer,
  animation: string,
  phase: number,
) => LayerImage | null

export interface RigImages {
  resolve: LayerImageResolver
  reference: LayerImage | null
  /** True once every worn layer has art, so the stage has something to draw. */
  ready: boolean
}

export function useRigImages(
  scene: RigScene | null,
  rig: ResolvedRig,
  tracks: RigTracks,
  profile: ProfileID,
): RigImages {
  const cache = useMemo(() => new ImageCache(), [])
  const [catalog, setCatalog] = useState<ExpressionCatalog | null>(null)
  const [reference, setReference] = useState<LayerImage | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadExpressionCatalog()
      .then((loaded) => {
        if (!cancelled) setCatalog(loaded)
      })
      .catch(() => {
        // Expression art is optional: the face falls back to its own layers.
        if (!cancelled) setCatalog(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const layerAssets = useMemo(() => rig.layers.map((layer) => layer.asset), [rig.layers])
  const faceAssets = useMemo(() => expressionAssets(catalog, profile), [catalog, profile])

  useEffect(() => {
    let cancelled = false
    cache
      .loadAll([...layerAssets, ...faceAssets])
      .then(() => {
        if (!cancelled) setGeneration((value) => value + 1)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [cache, layerAssets, faceAssets])

  const referencePath = scene?.referenceByProfile[profile] ?? null
  useEffect(() => {
    if (!referencePath) {
      setReference(null)
      return
    }
    let cancelled = false
    loadImage(assetURL(referencePath))
      .then((image) => {
        if (!cancelled) setReference(image)
      })
      .catch(() => {
        if (!cancelled) setReference(null)
      })
    return () => {
      cancelled = true
    }
  }, [referencePath])

  const resolve = useMemo<LayerImageResolver>(() => {
    // `generation` is read so the resolver identity changes once more art has
    // decoded, which is what tells the stage to repaint.
    void generation
    return (layer, animation, phase) => {
      const face = expressionAssetPath(catalog, profile, layer.id, tracks.expressionAt(animation, phase))
      return cache.get(face ?? layer.asset)
    }
  }, [cache, catalog, profile, tracks, generation])

  const ready = layerAssets.length > 0 && cache.size > 0
  return { resolve, reference, ready }
}
