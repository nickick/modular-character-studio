/**
 * Loading and saving the project scene, with the revision lock.
 *
 * The browser holds its own copy of the scene and writes all of it back on
 * save. Every save therefore carries the revision it loaded, so a stale tab is
 * rejected instead of overwriting newer work.
 */
import { validateModularCharacterScene } from "../rig/schema.ts"
import type { JsonValue } from "../rig/json.ts"
import type { RigScene } from "../rig/types.ts"

export const SCENE_ENDPOINT = "/api/scene"

/** A scene together with the exact revision of the bytes it came from. */
export interface SceneSnapshot {
  scene: RigScene
  revision: string
}

/**
 * The server sends the revision as a strong ETag. Its absence means the editor
 * server predates save protection and has to be restarted before this tab can
 * safely load or save anything.
 */
const MISSING_REVISION =
  "Studio server must be restarted before this protected editor can load or save scenes"

interface ErrorBody {
  error?: string
}

async function readSnapshot(response: Response): Promise<SceneSnapshot> {
  const value: JsonValue = await response.json()
  if (!response.ok) {
    const body: ErrorBody =
      typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.error === "string"
        ? { error: value.error }
        : {}
    throw new Error(body.error ?? `Request failed (${response.status})`)
  }
  const revision = response.headers.get("ETag")
  if (!revision) throw new Error(MISSING_REVISION)
  return { scene: validateModularCharacterScene(value), revision }
}

export async function loadScene(): Promise<SceneSnapshot> {
  return readSnapshot(await fetch(SCENE_ENDPOINT))
}

export async function saveScene(scene: RigScene, revision: string): Promise<SceneSnapshot> {
  return readSnapshot(
    await fetch(SCENE_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": revision },
      body: JSON.stringify(scene),
    }),
  )
}
