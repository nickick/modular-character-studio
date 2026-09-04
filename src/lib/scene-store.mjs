import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateModularCharacterScene } from "../../public/studio/rig/schema.mjs";

export class SceneSavePreconditionError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SceneSavePreconditionError";
    this.status = status;
  }
}

/** Strong ETag for the exact scene bytes currently on disk. */
export function sceneRevision(source) {
  return `"${createHash("sha256").update(source).digest("hex")}"`;
}

export async function loadModularCharacterSnapshot(scenePath) {
  const source = await readFile(scenePath);
  return {
    scene: validateModularCharacterScene(JSON.parse(source.toString("utf8"))),
    revision: sceneRevision(source),
  };
}

/**
 * Atomically save only when the caller edited the exact revision still on
 * disk. Missing revisions identify pre-locking browser tabs; mismatches mean a
 * builder, another tab, or another process changed the scene after this tab
 * loaded it. Neither case is allowed to overwrite the newer file.
 */
export async function saveModularCharacterSnapshot({ scenePath, historyRoot, value, expectedRevision }) {
  if (!expectedRevision) {
    throw new SceneSavePreconditionError(
      428,
      "This editor tab predates save protection. Reload it before saving; nothing was overwritten."
    );
  }

  const currentSource = await readFile(scenePath);
  const currentRevision = sceneRevision(currentSource);
  if (expectedRevision !== currentRevision) {
    throw new SceneSavePreconditionError(
      412,
      "The character scene changed after this tab loaded it. Reload before saving; your stale tab was not allowed to overwrite the newer scene."
    );
  }

  const scene = validateModularCharacterScene(value);
  const serialized = `${JSON.stringify(scene, null, 2)}\n`;
  await mkdir(historyRoot, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = join(historyRoot, `editor-scene-v2.${stamp}.${randomUUID()}.pre-save.json`);
  await writeFile(backupPath, currentSource, { flag: "wx" });
  const temporaryPath = `${scenePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, scenePath);
  return { scene, revision: sceneRevision(serialized) };
}
