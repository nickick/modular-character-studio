import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  loadSceneSnapshot,
  saveSceneSnapshot,
} from '../src/server/scene-store.ts'

test('scene saves are revision checked and backed up', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcs-scene-store-'))
  const scenePath = join(root, 'scene.json')
  const historyRoot = join(root, '.history')
  const source = await readFile(new URL('../project/scene.json', import.meta.url))
  await import('node:fs/promises').then(({ writeFile }) => writeFile(scenePath, source))

  const before = await loadSceneSnapshot(scenePath)
  const edited = structuredClone(before.scene)
  edited.activeProfile = edited.activeProfile === 'maleV1' ? 'femaleV1' : 'maleV1'
  const saved = await saveSceneSnapshot({
    scenePath,
    historyRoot,
    value: edited,
    expectedRevision: before.revision,
  })
  assert.notEqual(saved.revision, before.revision)

  await assert.rejects(
    saveSceneSnapshot({
      scenePath,
      historyRoot,
      value: before.scene,
      expectedRevision: before.revision,
    }),
    { status: 412 },
  )
})
