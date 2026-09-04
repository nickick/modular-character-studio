import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  loadModularCharacterSnapshot,
  saveModularCharacterSnapshot,
} from '../src/lib/scene-store.mjs'

test('scene saves are revision checked and backed up', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcs-scene-store-'))
  const scenePath = join(root, 'scene.json')
  const historyRoot = join(root, '.history')
  const source = await readFile(new URL('../project/scene.json', import.meta.url))
  await import('node:fs/promises').then(({ writeFile }) => writeFile(scenePath, source))

  const before = await loadModularCharacterSnapshot(scenePath)
  const edited = structuredClone(before.scene)
  edited.activeProfile = edited.activeProfile === 'maleV1' ? 'femaleV1' : 'maleV1'
  const saved = await saveModularCharacterSnapshot({
    scenePath,
    historyRoot,
    value: edited,
    expectedRevision: before.revision,
  })
  assert.notEqual(saved.revision, before.revision)

  await assert.rejects(
    saveModularCharacterSnapshot({
      scenePath,
      historyRoot,
      value: before.scene,
      expectedRevision: before.revision,
    }),
    { status: 412 },
  )
})
