/**
 * Parsed-JSON input and the narrowing helpers every validator shares.
 *
 * A validator's input is by definition untrusted, but it is not untyped: it is
 * whatever `JSON.parse` can produce. Naming that shape keeps the schema honest
 * without reaching for `any`, and makes each narrowing step an explicit,
 * checked conversion rather than a cast.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject

export interface JsonObject {
  [key: string]: JsonValue | undefined
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function object(value: JsonValue | undefined, label: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`${label} must be an object`)
  return value
}

export function array(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

/** A bounded number, rounded to the precision the scene file stores. */
export function finite(
  value: JsonValue | undefined,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`)
  }
  return Math.round(value * 10000) / 10000
}

export function string(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

/** A relative PNG path that cannot escape the art root. */
export function safeAsset(value: JsonValue | undefined, label: string): string {
  const asset = string(value, label)
  if (asset.startsWith("/") || asset.includes("..") || !asset.endsWith(".png")) {
    throw new Error(`${label} must be a relative PNG path`)
  }
  return asset
}

/** Entries of a JSON object, with each value already known to be present. */
export function entries(value: JsonObject): Array<[string, JsonValue]> {
  const out: Array<[string, JsonValue]> = []
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out.push([key, entry])
  }
  return out
}
