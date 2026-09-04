/**
 * The facial expression catalogue.
 *
 * Face artwork is a stepped track: eyes and mouths are complete replacement
 * drawings, so the expression at a moment names which PNG the eye and mouth
 * layers show rather than a value to interpolate.
 */
import { isJsonObject, object, safeAsset, string, type JsonValue } from "../rig/json.ts"
import { type ByProfile, type EyeExpression, type MouthExpression, type ProfileID } from "../rig/types.ts"

export interface ExpressionProfile {
  faceMask: string
  eyes: Partial<Record<EyeExpression, { left: string; right: string }>>
  mouths: Partial<Record<MouthExpression, string>>
}

export interface ExpressionCatalog {
  profiles: ByProfile<ExpressionProfile>
}

export const EXPRESSION_CATALOG_PATH = "/assets/facial-expression-assets-v1.json"

function readProfile(value: JsonValue | undefined, label: string): ExpressionProfile {
  const source = object(value, label)
  const eyes: ExpressionProfile["eyes"] = {}
  for (const [name, pair] of Object.entries(isJsonObject(source.eyes) ? source.eyes : {})) {
    const entry = object(pair, `${label}.eyes.${name}`)
    eyes[name as EyeExpression] = {
      left: safeAsset(entry.left, `${label}.eyes.${name}.left`),
      right: safeAsset(entry.right, `${label}.eyes.${name}.right`),
    }
  }
  const mouths: ExpressionProfile["mouths"] = {}
  for (const [name, asset] of Object.entries(isJsonObject(source.mouths) ? source.mouths : {})) {
    mouths[name as MouthExpression] = safeAsset(asset, `${label}.mouths.${name}`)
  }
  return { faceMask: string(source.faceMask, `${label}.faceMask`), eyes, mouths }
}

export function parseExpressionCatalog(value: JsonValue): ExpressionCatalog {
  const source = object(value, "expressionCatalog")
  const profiles = object(source.profiles, "expressionCatalog.profiles")
  return {
    profiles: {
      maleV1: readProfile(profiles.maleV1, "expressionCatalog.profiles.maleV1"),
      femaleV1: readProfile(profiles.femaleV1, "expressionCatalog.profiles.femaleV1"),
    },
  }
}

export async function loadExpressionCatalog(): Promise<ExpressionCatalog> {
  const response = await fetch(EXPRESSION_CATALOG_PATH)
  if (!response.ok) throw new Error(`Could not load the facial expression catalogue (${response.status})`)
  const value: JsonValue = await response.json()
  return parseExpressionCatalog(value)
}

/** Which PNG a face layer shows for an expression, or null if it is unchanged. */
export function expressionAssetPath(
  catalog: ExpressionCatalog | null,
  profile: ProfileID,
  layerID: string,
  expression: { eyes: EyeExpression; mouth: MouthExpression },
): string | null {
  const entry = catalog?.profiles[profile]
  if (!entry) return null
  if (layerID === "eyeL") return entry.eyes[expression.eyes]?.left ?? null
  if (layerID === "eyeR") return entry.eyes[expression.eyes]?.right ?? null
  // A neutral mouth is the layer's own artwork, not a replacement drawing.
  if (layerID === "mouth" && expression.mouth !== "neutral") {
    return entry.mouths[expression.mouth] ?? null
  }
  return null
}

/** Every expression PNG a profile can show, for preloading. */
export function expressionAssets(catalog: ExpressionCatalog | null, profile: ProfileID): string[] {
  const entry = catalog?.profiles[profile]
  if (!entry) return []
  return [
    ...Object.values(entry.eyes).flatMap((pair) => [pair.left, pair.right]),
    ...Object.values(entry.mouths),
  ]
}
