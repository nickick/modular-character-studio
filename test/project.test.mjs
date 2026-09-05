import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolve } from 'node:path'
import { validateModularCharacterScene } from '../src/rig/schema.ts'
import {
  animationNames,
  layerMatchesAnimationEquipment,
} from '../src/rig/clips.ts'
import { RigTracks } from '../src/rig/tracks.ts'
import { resolveProfile } from '../src/rig/skeleton.ts'
import { analyzeAlpha, decodePngAlpha } from '../scripts/png-alpha.mjs'

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

test('bundled boots deform both sides of both ankles through coordinated cages', () => {
  const byID = Object.fromEntries(scene.layers.map((layer) => [layer.id, layer]))
  const authoredMeshes = {
    lowerLegL: { parentBone: 'lowerLegL', childBone: 'footL', bendStart: { x: 0.4848, y: 0.6561 }, bendEnd: { x: 0.4206, y: 0.9683 } },
    footL: { parentBone: 'lowerLegL', childBone: 'footL', bendStart: { x: 0.7, y: 0.02 }, bendEnd: { x: 0.7, y: 0.2 } },
    lowerLegR: { parentBone: 'lowerLegR', childBone: 'footR', bendStart: { x: 0.5997, y: 0.4226 }, bendEnd: { x: 0.5, y: 0.98 } },
    footR: { parentBone: 'lowerLegR', childBone: 'footR', bendStart: { x: 0.6641, y: 0.1736 }, bendEnd: { x: 0.7164, y: 0.3781 } },
  }
  assert.deepEqual(
    scene.layers.filter((layer) => layer.mesh).map((layer) => layer.id),
    [
      'lowerLegL', 'footL', 'handOpenL', 'handClosedL', 'upperArmArmorL', 'forearmVambraceL',
      'lowerLegR', 'footR', 'handOpenR', 'handClosedR', 'upperArmArmorR', 'forearmVambraceR',
    ],
  )

  for (const side of ['L', 'R']) {
    const shaft = byID[`lowerLeg${side}`]
    const overlap = byID[`foot${side}`]
    assert.equal(shaft.mesh.parentBone, `lowerLeg${side}`)
    assert.equal(shaft.mesh.childBone, `foot${side}`)
    assert.equal(overlap.mesh.parentBone, `lowerLeg${side}`)
    assert.equal(overlap.mesh.childBone, `foot${side}`)
  }

  for (const [layerID, expected] of Object.entries(authoredMeshes)) {
    assert.deepEqual(byID[layerID].mesh, {
      type: 'weightedStripV2',
      parentBone: expected.parentBone,
      childBone: expected.childBone,
      bendStops: [0, 0.25, 0.5, 0.75, 1],
      bendStart: expected.bendStart,
      bendEnd: expected.bendEnd,
    })
  }

  for (const option of scene.bootOptions) {
    for (const profile of ['maleV1', 'femaleV1']) {
      const resolved = Object.fromEntries(resolveProfile(
        scene,
        profile,
        scene.activeChest,
        scene.activeArmSet,
        scene.activeHeadgear,
        option.id,
      ).layers.map((layer) => [layer.id, layer]))
      for (const id of ['lowerLegL', 'footL', 'lowerLegR', 'footR']) {
        assert.strictEqual(resolved[id].mesh, byID[id].mesh, `${option.id} reuses ${id}'s ankle cage`)
      }
    }
  }
})

test('bundled boots preserve their authored segment placements for both profiles', () => {
  const fields = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'pivotX', 'pivotY']
  const expected = {
    leather_boots: {
      lowerLegL: [0, 0, 0, 0.5771, 0.48, 0.5, 0.2],
      footL: [-3.76, -3.5, 0, 0.6, 0.425, 0.7, 0.17],
      lowerLegR: [0.02, -0.29, -3, 0.5771, 0.54, 0.5, 0.2],
      footR: [4, 1, 12, 0.66, 0.53, 0.7, 0.17],
    },
    frostweaveV1: {
      lowerLegL: [0, -2, 0, 0.5771, 0.5, 0.5, 0.2],
      footL: [-3.76, 1.78, 0, 0.6, 0.3915, 0.7, 0.17],
      lowerLegR: [0, 0, 0, 0.59, 0.55, 0.5, 0.2],
      footR: [-3, 6.96, 5, 0.74, 0.5, 0.7, 0.17],
    },
    ironGuardV1: {
      lowerLegL: [0, -8, 0, 0.5771, 0.5, 0.5, 0.2],
      footL: [-3.76, 1.78, 0, 0.6, 0.3915, 0.7, 0.17],
      lowerLegR: [0, 0, 0, 0.5771, 0.4973, 0.5, 0.2],
      footR: [-3, 6.96, 5, 0.74, 0.5, 0.7, 0.17],
    },
  }

  for (const option of scene.bootOptions) {
    for (const [layerID, values] of Object.entries(expected[option.id])) {
      for (const profile of ['maleV1', 'femaleV1']) {
        assert.deepEqual(
          fields.map((field) => option.bindByLayer[layerID][profile][field]),
          values,
          `${option.id} ${layerID} ${profile}`,
        )
      }
    }
  }
})

test('ankle cages must join the two endpoints of their direct bone joint', () => {
  const invalid = structuredClone(scene)
  invalid.layers.find((layer) => layer.id === 'lowerLegL').mesh.parentBone = 'upperLegL'
  assert.throws(() => validateModularCharacterScene(invalid), /direct bone joint/)
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
  assert.deepEqual(bowAnimations, [
    'bowIdle', 'bowWalkForward', 'bowWalkBackward', 'bowRunForward', 'bowRunBackward',
    'bowDraw', 'bowReload', 'bowMoveForward', 'bowMoveBackward', 'bowDodgeForward', 'bowDodgeBackward',
  ])

  for (const animation of bowAnimations) {
    const visible = equipment.filter((id) => layerMatchesAnimationEquipment({ id }, animation))
    assert.deepEqual(visible, ['bow'], `${animation} leaked another held item`)
  }
})

test('corrected bundled PNGs retain complete and clean alpha bounds', async () => {
  const inspect = async (relative) => analyzeAlpha(decodePngAlpha(
    await readFile(resolve(root, 'project/assets', relative)),
  ))

  const forearm = await inspect(
    'Layers/GeneratedMatrix/Arms/Shortbow/trail-bracers/forearmInside.png',
  )
  assert.deepEqual(forearm.bounds, [8, 17, 230, 425])

  const quiver = await inspect('Layers/Equipment/Quivers/normalQuiver.png')
  assert.deepEqual(quiver.bounds, [442, 71, 815, 1251])

  const blank = decodePngAlpha(await readFile(resolve(root, 'project/assets/reference/blank.png')))
  assert.deepEqual([blank.width, blank.height, ...blank.alpha], [1, 1, 0])
})

test("ranged carry cycles retain family grips and reverse their grounded gait", async () => {
  const carryTracks = RigTracks.fromScene(scene);
  const fingerIDs = scene.layers.filter(layer => layer.gripFinger).map(layer => layer.id);
  for (const family of ["bow", "spell", "staffSpell"]) {
    const reference = family === "bow" ? "bowDraw" : family === "staffSpell" ? "staffIdle" : "spellCast";
    for (const motion of ["Idle", "WalkForward", "WalkBackward", "RunForward", "RunBackward"]) {
      const name = family + motion;
      for (const side of family === "spell" ? [] : ["L", "R"]) for (const phase of [0, .25, .5, .75]) {
        assert.deepEqual(carryTracks.gripControlsAt(name, side, phase, fingerIDs),
          carryTracks.gripControlsAt(reference, side, phase, fingerIDs), `${name} retains ${side} ${reference} grip`);
      }
      // The grip is kept near the torso; it must not inherit a runner's large arm swing.
      const angles = [0, .25, .5, .75].map(t => carryTracks.pose(name, t).upperArmL.rotation);
      assert.ok(Math.max(...angles) - Math.min(...angles) < 5, `${name} carries steadily`);
    }
    for (const gait of ["Walk", "Run"]) {
      const forward = family + gait + "Forward", backward = family + gait + "Backward";
      for (const phase of [.13, .37, .61, .89]) {
        const a = carryTracks.pose(forward, phase), b = carryTracks.pose(backward, 1 - phase);
        for (const bone of ["root", "upperLegL", "lowerLegL", "upperLegR", "lowerLegR", "footL", "footR"]) {
          for (const field of ["x", "y", "rotation"]) {
            assert.ok(Math.abs((a[bone]?.[field] ?? 0) - (b[bone]?.[field] ?? 0)) < .001,
              `${family} ${gait} backward retraces ${bone}.${field}`);
          }
        }
      }
    }
  }
});
