/**
 * Reading and writing the active project scene, with the revision lock.
 *
 * A studio holds its own copy of the scene and writes all of it back on save,
 * so every save has to carry the revision it loaded. Missing revisions identify
 * pre-locking tabs; mismatches mean a builder, another tab, or another process
 * changed the scene after this tab loaded it. Neither is allowed to overwrite
 * the newer file.
 */
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { validateModularCharacterScene } from "../rig/schema.ts"
import type { JsonValue } from "../rig/json.ts"
import type { RigScene } from "../rig/types.ts"

export class SceneSavePreconditionError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "SceneSavePreconditionError"
    this.status = status
  }
}

export interface SceneSnapshot {
  scene: RigScene
  revision: string
}

/** Strong ETag for the exact scene bytes currently on disk. */
export function sceneRevision(source: string | Uint8Array): string {
  return `"${createHash("sha256").update(source).digest("hex")}"`
}

export async function loadSceneSnapshot(scenePath: string): Promise<SceneSnapshot> {
  const source = await readFile(scenePath)
  const parsed: JsonValue = JSON.parse(source.toString("utf8"))
  return { scene: validateModularCharacterScene(parsed), revision: sceneRevision(source) }
}

export interface SaveSceneRequest {
  scenePath: string
  historyRoot: string
  value: JsonValue
  expectedRevision: string | null
}

/**
 * Atomically save only when the caller edited the exact revision still on disk.
 * The previous bytes are copied into the ignored history folder first, so a
 * mistaken save is always recoverable.
 */
export async function saveSceneSnapshot({
  scenePath,
  historyRoot,
  value,
  expectedRevision,
}: SaveSceneRequest): Promise<SceneSnapshot> {
  if (!expectedRevision) {
    throw new SceneSavePreconditionError(
      428,
      "This editor tab predates save protection. Reload it before saving; nothing was overwritten.",
    )
  }

  const currentSource = await readFile(scenePath)
  const currentRevision = sceneRevision(currentSource)
  if (expectedRevision !== currentRevision) {
    throw new SceneSavePreconditionError(
      412,
      "The character scene changed after this tab loaded it. Reload before saving; your stale tab was not allowed to overwrite the newer scene.",
    )
  }

  const scene = validateModularCharacterScene(value)
  const serialized = `${JSON.stringify(scene, null, 2)}\n`
  await mkdir(historyRoot, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(":", "-")
  const backupPath = join(historyRoot, `scene.${stamp}.${randomUUID()}.pre-save.json`)
  await writeFile(backupPath, currentSource, { flag: "wx" })
  const temporaryPath = `${scenePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" })
  await rename(temporaryPath, scenePath)
  return { scene, revision: sceneRevision(serialized) }
}
