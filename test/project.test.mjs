import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolve } from 'node:path'
import { validateModularCharacterScene } from '../public/studio/rig/schema.mjs'
import {
  animationNames,
  layerMatchesAnimationPreview,
  resolveProfile,
} from '../public/studio/rig/rig-model.mjs'

const root = resolve(import.meta.dirname, '..')
const scene = validateModularCharacterScene(
  JSON.parse(await readFile(resolve(root, 'project/scene.json'), 'utf8')),
)
const catalog = JSON.parse(await readFile(resolve(root, 'project/equipment-catalog.json'), 'utf8'))
const promptManifest = JSON.parse(await readFile(resolve(root, 'prompts/manifest.json'), 'utf8'))
const promptGallery = await readFile(resolve(root, 'prompts/README.md'), 'utf8')

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
    'Cutthroat Hood',
    'Arming Sword', 'Bearded Axe', 'Oak Staff', 'Hunting Bow', 'Round Shield',
  ]) assert.ok(names.has(name), `missing ${name}`)
})

test('each bundled headgear option resolves its own asset and hides front hair', () => {
  const renderedAssets = new Set()

  for (const option of scene.headgearOptions) {
    const rig = resolveProfile(
      scene,
      scene.activeProfile,
      scene.activeChest,
      scene.activeArmSet,
      option.id,
      scene.activeBootSet,
      scene.activeNecklace,
    )
    const byID = Object.fromEntries(rig.layers.map((layer) => [layer.id, layer]))
    assert.equal(byID.headgear.asset, option.assetByProfile[scene.activeProfile])
    assert.equal(byID.headgear.visible, true)
    assert.equal(byID.hairFront.visible, false)
    renderedAssets.add(byID.headgear.asset)
  }

  assert.equal(renderedAssets.size, scene.headgearOptions.length)

  const bareHead = structuredClone(scene)
  bareHead.layers.find((layer) => layer.id === 'headgear').visible = false
  const rig = resolveProfile(bareHead, bareHead.activeProfile)
  assert.equal(rig.layers.find((layer) => layer.id === 'hairFront').visible, true)
})

test('prompt records map to visible bundled outputs', async () => {
  assert.equal(promptManifest.format, 'modular-character-studio-prompt-manifest-v1')
  assert.equal(promptManifest.records.length, 8)

  for (const entry of promptManifest.records) {
    await access(resolve(root, 'prompts', entry.record))
    assert.ok(entry.outputs.length > 0, `${entry.record} has no mapped outputs`)
    for (const output of entry.outputs) {
      await access(resolve(root, 'project/assets', output))
      assert.ok(
        promptGallery.includes(`../project/assets/${output}`),
        `${output} is absent from the rendered gallery`,
      )
    }
  }
})

test('bow animations never preview staff, weapon, or shield layers', () => {
  const equipment = ['weapon', 'staff', 'shield', 'bow']
  const bowAnimations = animationNames.filter((name) => name.startsWith('bow'))
  assert.deepEqual(bowAnimations, ['bowDraw', 'bowMoveForward', 'bowMoveBackward'])

  for (const animation of bowAnimations) {
    for (const selectedLayerID of equipment) {
      const visible = equipment.filter((id) => (
        layerMatchesAnimationPreview({ id }, animation, selectedLayerID)
      ))
      assert.deepEqual(visible, ['bow'], `${animation} leaked ${selectedLayerID}`)
    }
  }
})
