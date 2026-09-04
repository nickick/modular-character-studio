import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolve } from 'node:path'
import { validateModularCharacterScene } from '../public/studio/rig/schema.mjs'

const root = resolve(import.meta.dirname, '..')
const scene = validateModularCharacterScene(
  JSON.parse(await readFile(resolve(root, 'project/scene.json'), 'utf8')),
)
const catalog = JSON.parse(await readFile(resolve(root, 'project/equipment-catalog.json'), 'utf8'))

test('bundled scene carries the public project format', () => {
  assert.equal(scene.format, 'modular-character-studio-scene-v1')
  assert.equal(scene.chestOptions.length, 3)
  assert.equal(scene.armOptions.length, 3)
  assert.equal(scene.bootOptions.length, 3)
  assert.equal(scene.weaponOptions.length, 2)
  assert.equal(scene.staffOptions.length, 1)
  assert.equal(scene.bowOptions.length, 1)
  assert.equal(scene.shieldOptions.length, 1)
})

test('demo catalogue contains the requested armor and held-item families', () => {
  const names = new Set(catalog.items.map((item) => item.name))
  for (const name of [
    'Scout Leathers', 'Arcane Robes', 'Vanguard Plate',
    'Arming Sword', 'Bearded Axe', 'Oak Staff', 'Hunting Bow', 'Round Shield',
  ]) assert.ok(names.has(name), `missing ${name}`)
})
