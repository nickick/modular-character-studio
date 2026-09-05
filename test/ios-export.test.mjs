import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { exportIOSDemo, PLATE_LOADOUT } from '../scripts/export-ios-demo.mjs'
import { bakeAnimationLibrary, sampleBakedPose } from '../scripts/bake-animation-library.mjs'
import { RigTracks } from '../src/rig/tracks.ts'
import { validateModularCharacterScene } from '../src/rig/schema.ts'

const project = resolve(import.meta.dirname, '../project')
const scene = validateModularCharacterScene(JSON.parse(await readFile(resolve(project, 'scene.json'), 'utf8')))

test('baked poses include authored corrections and preserve endpoint rules', () => {
  const draft = structuredClone(scene)
  draft.clipPoseOffsets = { ...draft.clipPoseOffsets, idle: { chest: { rotation: 7 } } }
  const library = bakeAnimationLibrary(draft, { names: ['idle', 'bowDraw'], samples: 120 })
  const tracks = RigTracks.fromScene(draft)
  for (const [name, clip] of Object.entries(library.clips)) {
    for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
      const actual = sampleBakedPose(clip, phase), expected = tracks.pose(name, phase)
      for (const [bone, fields] of Object.entries(actual)) for (const [field, value] of Object.entries(fields)) {
        assert.ok(Math.abs(value - (expected[bone]?.[field] ?? (field.startsWith('scale') ? 1 : 0))) < 0.0006, `${name} ${bone}.${field}`)
      }
    }
    assert.equal(clip.endKeyed, tracks.hasEndKey(name))
  }
  assert.deepEqual(library.wristKeyframes, draft.wristKeyframes)
  assert.deepEqual(library.expressionKeyframes, draft.expressionKeyframes)
  assert.ok(Number.isFinite(library.validation.worstError))
  assert.throws(() => bakeAnimationLibrary(scene, { samples: 0 }), /Samples/)
})

test('plate export is self-contained and retains mesh, cutout, and equipment visibility', async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'mcs-ios-export-'))
  try {
    const output = resolve(temp, 'demo')
    const result = await exportIOSDemo({ project, output, fps: 15 })
    const app = await readFile(resolve(output, 'PlateDemo.swift'), 'utf8')
    assert.match(app, /import ModularCharacter/)
    assert.doesNotMatch(app, /func triangleTransform|class DemoLibrary/)
    const xcode = await readFile(resolve(output, 'PlateDemo.xcodeproj/project.pbxproj'), 'utf8')
    assert.match(xcode, /XCLocalSwiftPackageReference; relativePath = ModularCharacter/)
    assert.match(xcode, /packageProductDependencies/)
    for (const path of ['Package.swift', 'Sources/ModularCharacter/CharacterLibrary.swift', 'Tests/ModularCharacterTests/CharacterRuntimeTests.swift', 'README.md', 'LICENSE']) {
      assert.ok((await readFile(resolve(output, 'ModularCharacter', path))).length)
    }
    const manifest = result.manifest
    assert.equal(manifest.format, 'modular-character-studio-ios-demo-v1')
    for (const [key, [, id]] of Object.entries(PLATE_LOADOUT)) assert.equal(manifest.loadout[key].id, id)
    for (const asset of manifest.assets) {
      const bytes = await readFile(resolve(output, 'CharacterRuntime', asset.path))
      assert.equal(bytes.readUInt32BE(16), asset.width)
      assert.equal(bytes.readUInt32BE(20), asset.height)
    }
    for (const id of ['upperArmArmorL', 'forearmVambraceL', 'lowerLegL', 'footL', 'upperArmArmorR', 'forearmVambraceR', 'lowerLegR', 'footR']) {
      assert.ok(manifest.attachments.find(attachment => attachment.id === id)?.triangles.length, `${id} exports a cage`)
    }
    assert.ok(manifest.attachments.find(attachment => attachment.id === 'handClosedLIndex')?.clipPath.closed)
    for (const [name, path] of Object.entries(manifest.clips)) {
      const clip = JSON.parse(await readFile(resolve(output, 'CharacterRuntime', path), 'utf8'))
      for (const frame of clip.frames) {
        const ids = frame.map(layer => manifest.attachments[layer.attachment].id)
        assert.ok(ids.includes('quiver'))
        assert.ok(ids.includes('headgear'))
        assert.ok(!ids.includes('hairFront'))
        assert.ok(!ids.includes('staff'))
        if (name.startsWith('bow')) {
          assert.ok(ids.includes('bow')); assert.ok(!ids.includes('weapon')); assert.ok(!ids.includes('shield'))
        } else { assert.ok(ids.includes('weapon')); assert.ok(ids.includes('shield')); assert.ok(!ids.includes('bow')) }
        for (const layer of frame) assert.ok(layer.values.every(Number.isFinite))
      }
    }
    const baked = JSON.parse(await readFile(resolve(output, 'CharacterRuntime/pose-library-v1.json'), 'utf8'))
    assert.deepEqual(baked.wristKeyframes, scene.wristKeyframes)
    assert.deepEqual(baked.expressionKeyframes, scene.expressionKeyframes)
    const rig = JSON.parse(await readFile(resolve(output, 'CharacterRuntime/rig.json'), 'utf8'))
    for (const layer of rig.layers) await readFile(resolve(output, 'CharacterRuntime/assets', layer.asset))
    const plateArm = scene.armOptions.find(option => option.id === 'heavyPlateV1')
    const arm = rig.layers.find(layer => layer.id === 'forearmVambraceL')
    assert.equal(arm.pivotX, plateArm.bindByLayer.forearmVambraceL.maleV1.pivotX)
    const before = await readFile(resolve(output, 'CharacterRuntime/runtime.json'), 'utf8')
    await exportIOSDemo({ project, output, fps: 15 })
    assert.equal(await readFile(resolve(output, 'CharacterRuntime/runtime.json'), 'utf8'), before, 'same input exports deterministically')
    const editedProject = resolve(temp, 'edited'); await mkdir(editedProject)
    await symlink(resolve(project, 'assets'), resolve(editedProject, 'assets'))
    const edited = structuredClone(scene)
    edited.armOptions.find(option => option.id === 'heavyPlateV1').bindByLayer.forearmVambraceL.maleV1.x += 12
    edited.layers.find(layer => layer.id === 'forearmVambraceL').mesh.bendEnd.x += 0.02
    await writeFile(resolve(editedProject, 'scene.json'), JSON.stringify(edited))
    const changed = await exportIOSDemo({ project: editedProject, output: resolve(temp, 'changed'), fps: 15 })
    const changedRig = JSON.parse(await readFile(resolve(temp, 'changed/CharacterRuntime/rig.json'), 'utf8'))
    assert.equal(changedRig.layers.find(layer => layer.id === 'forearmVambraceL').x, arm.x + 12)
    assert.notDeepEqual(changed.manifest.attachments.find(layer => layer.id === 'forearmVambraceL').source,
      manifest.attachments.find(layer => layer.id === 'forearmVambraceL').source, 'authored cage edits reach the export')
    const occupied = resolve(temp, 'occupied'); await mkdir(occupied); await writeFile(resolve(occupied, 'keep.txt'), 'mine')
    await assert.rejects(exportIOSDemo({ project, output: occupied }), /Refusing to overwrite/)
    assert.equal(await readFile(resolve(occupied, 'keep.txt'), 'utf8'), 'mine')
    await assert.rejects(exportIOSDemo({ project, output: project }), /separate/)
    await assert.rejects(exportIOSDemo({ project, output, profile: 'other' }), /Profile/)
  } finally { await rm(temp, { recursive: true, force: true }) }
})
