/** Export a standalone plate-loadout iOS demo using the editor's actual rig solver. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile, readdir, cp } from 'node:fs/promises'
import { resolve, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateModularCharacterScene } from '../src/rig/schema.ts'
import { resolveProfile } from '../src/rig/skeleton.ts'
import { RigTracks } from '../src/rig/tracks.ts'
import { animationDurations, animationLoops, animationHandPose, layerMatchesHandPose, layerMatchesAnimationEquipment } from '../src/rig/clips.ts'
import { constrainForearmPose } from '../src/rig/ik.ts'
import { solveFrames, posedGripLayer } from '../src/canvas/paint.ts'
import { deformWeightedMesh, rigidLayerMatrix, planeStrips, layerLocalMatrix } from '../src/rig/mesh.ts'
import { multiply, transformPoint } from '../src/rig/matrix.ts'
import { parseExpressionCatalog, expressionAssetPath, expressionAssets } from '../src/editor/expressions.ts'
import { bakeAnimationLibrary } from './bake-animation-library.mjs'
import { xcodeProject } from './ios-demo-project.mjs'

export const PLATE_LOADOUT = {
  activeChest: ['chestOptions', 'vanguardPlate'],
  activeArmSet: ['armOptions', 'heavyPlateV1'],
  activeBootSet: ['bootOptions', 'ironGuardV1'],
  activeHeadgear: ['headgearOptions', 'bandedIronV1'],
  activeWeapon: ['weaponOptions', 'ironLongsword'],
  activeShield: ['shieldOptions', 'roundShield'],
  activeBow: ['bowOptions', 'simpleWoodenBow'],
  activeQuiver: ['quiverOptions', 'normal_quiver'],
  activeNecklace: ['necklaceOptions', 'simplePendant'],
  activeRing: ['ringOptions', 'veilstepRing'],
}
export const DEMO_CLIPS = ['idle', 'run', 'swordSwing', 'shieldUp', 'shieldMoveForward',
  'dodgeForward', 'dodgeBackward', 'bowIdle', 'bowRunForward', 'bowDraw', 'bowDodgeForward']
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const round = value => {
  if (!Number.isFinite(value)) throw new Error('Non-finite geometry in exported rig')
  return Math.round(value * 10000) / 10000
}
const matrixValues = matrix => ['a', 'b', 'c', 'd', 'e', 'f'].map(key => round(matrix[key]))
const flatten = points => points.flatMap(point => [round(point.x), round(point.y)])

function inside(root, path) {
  const candidate = resolve(root, path)
  if (!candidate.startsWith(root + sep)) throw new Error(`Asset escapes project: ${path}`)
  return candidate
}

export async function exportIOSDemo({ project = resolve(repoRoot, 'project'), output = resolve(repoRoot, 'output/ios-plate-demo'), profile = 'maleV1', fps = 30 } = {}) {
  project = resolve(project); output = resolve(output)
  if (!['maleV1', 'femaleV1'].includes(profile)) throw new Error('Profile must be maleV1 or femaleV1')
  if (!Number.isInteger(fps) || fps < 15 || fps > 120) throw new Error('FPS must be an integer from 15 to 120')
  if (output === project || project.startsWith(output + sep) || output.startsWith(project + sep)) throw new Error('Output must be separate from the authored project')
  const existing = await readdir(output).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  if (existing.length) {
    const marker = await readFile(resolve(output, '.mcs-ios-demo'), 'utf8').catch(() => '')
    if (marker !== 'modular-character-studio-ios-demo-v1\n') throw new Error('Refusing to overwrite a directory that is not an exported iOS demo')
  }
  const sourceBytes = await readFile(resolve(project, 'scene.json'))
  const scene = validateModularCharacterScene(JSON.parse(sourceBytes))
  const loadout = {}
  for (const [active, [catalogue, id]] of Object.entries(PLATE_LOADOUT)) {
    const option = scene[catalogue]?.find(option => option.id === id)
    if (!option) throw new Error(`Missing demo equipment: ${catalogue}/${id}`)
    scene[active] = id
    loadout[active] = { id, label: option.label }
  }
  scene.activeProfile = profile
  // The demo deliberately has no staff alternative, and always wears its helm.
  for (const layer of scene.layers) {
    if (['headgear', 'quiver', 'necklace', 'ring', 'weapon', 'shield', 'bow'].includes(layer.id)) layer.visible = true
    if (layer.id === 'staff') layer.visible = false
  }
  const rig = resolveProfile(scene, profile)
  const tracks = RigTracks.fromScene(scene)
  const face = parseExpressionCatalog(JSON.parse(await readFile(resolve(project, 'assets/facial-expression-assets-v1.json'), 'utf8')))
  const assetsRoot = resolve(project, 'assets')
  const assets = [], assetIndices = new Map(), assetBytes = new Map()
  const attachments = [], attachmentIndices = new Map()
  const fingerIDs = rig.layers.filter(layer => layer.gripFinger).map(layer => layer.id)

  async function assetFor(path) {
    if (assetIndices.has(path)) return assetIndices.get(path)
    const data = await readFile(inside(assetsRoot, path))
    if (data.length < 24 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Expected PNG: ${path}`)
    const index = assets.length
    assets.push({ path: `assets/${path}`, width: data.readUInt32BE(16), height: data.readUInt32BE(20) })
    assetIndices.set(path, index); assetBytes.set(path, data)
    return index
  }
  const clips = {}
  for (const name of DEMO_CLIPS) {
    const duration = animationDurations[name]
    const samples = Math.ceil(duration * fps)
    const layers = rig.layers.filter(layer => layer.visible && layerMatchesHandPose(layer, animationHandPose[name]) && layerMatchesAnimationEquipment(layer, name))
      .sort((a, b) => a.drawOrder - b.drawOrder)
    const frames = [], boneFrames = []
    for (let sample = 0; sample <= samples; sample++) {
      const phase = sample / samples
      const pose = constrainForearmPose(rig.bones, tracks.pose(name, phase))
      for (const id of ['handL', 'handR']) {
        const limit = name.startsWith('bow') && id === 'handL' ? 5 : 30
        const rotation = pose[id]?.rotation ?? 0
        const normalized = ((rotation + 180) % 360 + 360) % 360 - 180
        pose[id] = { ...pose[id], rotation: Math.min(limit, Math.max(-limit, normalized)) }
      }
      const solved = solveFrames(rig, { authored: pose })
      boneFrames.push(Object.fromEntries(Object.entries(solved.currentWorld).map(([id, matrix]) => [id, matrixValues(matrix)])))
      const context = { rig, heldLayer: rig.layers.find(layer => layer.id === (name.startsWith('bow') ? 'bow' : 'weapon')) }
      const frame = []
      for (const layer of layers) {
        const controls = tracks.gripControlsAt(name, layer.bone.endsWith('R') ? 'R' : 'L', phase, fingerIDs)
        const posed = posedGripLayer(layer, context, controls)
        const path = expressionAssetPath(face, profile, layer.id, tracks.expressionAt(name, phase)) ?? layer.asset
        const assetIndex = await assetFor(path)
        const { width, height } = assets[assetIndex]
        const mesh = deformWeightedMesh(posed, width, height, solved.meshBindWorld, solved.currentWorld)
        const key = `${layer.id}:${assetIndex}`
        if (!attachmentIndices.has(key)) {
          const attachment = { id: layer.id, asset: assetIndex, bone: layer.bone }
          if (layer.id === 'bow') attachment.bowPivot = { x: posed.pivotX*width, y: posed.pivotY*height }
          if (mesh) {
            attachment.source = flatten(mesh.vertices.map(vertex => vertex.source))
            attachment.triangles = mesh.triangles.flat()
            const bindMatrix = multiply(solved.meshBindWorld[layer.bone], layerLocalMatrix(posed, width, height))
            attachment.aimMesh = { parent: posed.mesh.parentBone, child: posed.mesh.childBone,
              weights: mesh.vertices.map(vertex => vertex.sectionWeight),
              bindPoints: flatten(mesh.vertices.map(vertex => transformPoint(bindMatrix, vertex.source))) }
          } else {
            // Preserve the rigid finger cutout and projective plane strips too.
            if (layer.clipPath?.closed) attachment.clipPath = layer.clipPath
            const strips = planeStrips(posed, width, height)
            if (strips) attachment.strips = strips
          }
          attachmentIndices.set(key, attachments.length); attachments.push(attachment)
        }
        frame.push({ attachment: attachmentIndices.get(key), values: mesh ? flatten(mesh.points) : matrixValues(rigidLayerMatrix(posed, width, height, solved.bindWorld, solved.currentWorld)) })
      }
      frames.push(frame)
    }
    clips[name] = { duration, loops: animationLoops[name], endKeyed: tracks.hasEndKey(name), frames,
      ...(boneFrames.length ? { boneFrames } : {}) }
  }
  // Export a resolved rig, not stale default assets from the author's other outfits.
  const runtimeLayers = rig.layers.filter(layer => layer.visible).map(layer => {
    const { assetByProfile, bindByProfile, ...resolved } = layer
    return resolved
  })
  for (const layer of runtimeLayers) await assetFor(layer.asset)
  await assetFor(face.profiles[profile].faceMask)
  for (const path of expressionAssets(face, profile)) await assetFor(path)
  // Complete all source validation/baking before writing anything to the output.
  const poseLibrary = bakeAnimationLibrary(scene)
  const bindFrames = solveFrames(rig, { authored: {} })
  const manifest = { format: 'modular-character-studio-ios-demo-v1', profile, fps,
    aimRig: { parents: Object.fromEntries(rig.bones.map(bone => [bone.id, bone.parent ?? ''])),
      bindWorld: Object.fromEntries(Object.entries(bindFrames.meshBindWorld).map(([id, matrix]) => [id, matrixValues(matrix)])) },
    sourceSHA256: createHash('sha256').update(sourceBytes).digest('hex'),
    canvas: scene.canvas, baseline: scene.profileReference.canonicalTargetPixels.baseline, loadout, assets, attachments,
    clips: Object.fromEntries(DEMO_CLIPS.map(name => [name, `clips/${name}.json`])) }
  const resources = resolve(output, 'CharacterRuntime')
  await mkdir(resolve(resources, 'clips'), { recursive: true })
  for (const [path, data] of assetBytes) {
    const target = inside(resources, `assets/${path}`)
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, data)
  }
  for (const [name, clip] of Object.entries(clips)) await writeFile(resolve(resources, `clips/${name}.json`), JSON.stringify(clip) + '\n')
  await writeFile(resolve(resources, 'expressions.json'), JSON.stringify({ profiles: { [profile]: face.profiles[profile] } }, null, 2) + '\n')
  await writeFile(resolve(resources, 'pose-library-v1.json'), JSON.stringify(poseLibrary) + '\n')
  await writeFile(resolve(resources, 'runtime.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(resolve(resources, 'rig.json'), JSON.stringify({ format: 'modular-character-studio-resolved-rig-v1', profile, loadout, bones: rig.bones, layers: runtimeLayers }, null, 2) + '\n')
  for (const name of ['PlateDemo.swift', 'README.md', 'BAKING.md']) await copyFile(resolve(repoRoot, 'examples/ios', name), resolve(output, name))
  const swiftPackage = resolve(output, 'ModularCharacter')
  await mkdir(swiftPackage, { recursive: true })
  for (const name of ['Package.swift', 'LICENSE']) await copyFile(resolve(repoRoot, name), resolve(swiftPackage, name))
  for (const name of ['Sources', 'Tests']) await cp(resolve(repoRoot, name), resolve(swiftPackage, name), { recursive: true })
  await copyFile(resolve(repoRoot, 'docs/swift-runtime.md'), resolve(swiftPackage, 'README.md'))
  await copyFile(resolve(repoRoot, 'LICENSE'), resolve(output, 'LICENSE'))
  await copyFile(resolve(repoRoot, 'CC0-1.0.txt'), resolve(resources, 'CC0-1.0.txt'))
  await mkdir(resolve(output, 'PlateDemo.xcodeproj'), { recursive: true })
  await writeFile(resolve(output, 'PlateDemo.xcodeproj/project.pbxproj'), xcodeProject())
  await writeFile(resolve(output, '.mcs-ios-demo'), 'modular-character-studio-ios-demo-v1\n')
  return { output, manifest, clipCount: DEMO_CLIPS.length, assetCount: assets.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i], value = process.argv[i + 1]
    if (!['--project', '--output', '--profile', '--fps'].includes(flag) || !value) throw new Error('Usage: node scripts/export-ios-demo.mjs [--project PATH] [--output PATH] [--profile maleV1|femaleV1] [--fps 30]')
    options[flag.slice(2)] = flag === '--fps' ? Number(value) : value
  }
  options.project ??= process.env.MCS_PROJECT_ROOT
  const result = await exportIOSDemo(options)
  console.log(`Exported ${result.clipCount} clips and ${result.assetCount} textures to ${relative(process.cwd(), result.output)}. Open PlateDemo.xcodeproj.`)
}
