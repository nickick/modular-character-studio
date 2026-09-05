/**
 * Standalone port of Den Hunter's bake_three_quarter_pose_library.mjs.
 * Author once in the rig core + saved scene; consume sampled data in Swift.
 * Runtime input (aim IK, movement, transitions) is deliberately not baked.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RigTracks, animationNames, animationDurations, animationLoops, animationHandPose, animationEquipment } from '../src/rig/index.ts'
import { validateModularCharacterScene } from '../src/rig/schema.ts'

const DEFAULTS = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
const EPSILON = 0.0005

/** Port this small sampler to another client before adding its bone solver. */
export function sampleBakedPose(clip, phase) {
  phase = Math.max(0, Math.min(1, phase))
  const position = phase * clip.samples
  const low = Math.floor(position), high = Math.min(clip.samples, low + 1)
  // An unkeyed last sample is a reset. Hold the preceding sample until phase 1.
  const mix = !clip.endKeyed && high === clip.samples ? 0 : position - low
  return Object.fromEntries(Object.entries(clip.bones).map(([bone, fields]) => [bone,
    Object.fromEntries(Object.entries(fields).map(([field, values]) => [field, values[low] + (values[high] - values[low]) * mix])),
  ]))
}

export function bakeAnimationLibrary(scene, { samples = 120, names = animationNames } = {}) {
  if (!Number.isInteger(samples) || samples < 2 || samples > 1000) throw new Error('Samples must be an integer from 2 to 1000')
  const tracks = RigTracks.fromScene(scene)
  const clips = {}
  let worstError = 0, worstAt = ''
  for (const name of names) {
    if (!animationNames.includes(name)) throw new Error(`Unknown animation: ${name}`)
    const frames = Array.from({ length: samples + 1 }, (_, index) => tracks.pose(name, index / samples))
    const bones = {}
    for (const frame of frames) for (const [bone, delta] of Object.entries(frame)) {
      for (const [field, value] of Object.entries(delta)) {
        if (!Number.isFinite(value)) throw new Error(`Invalid pose: ${name}/${bone}.${field}`)
        if (Math.abs(value - DEFAULTS[field]) >= EPSILON) (bones[bone] ??= {})[field] = []
      }
    }
    for (const [bone, fields] of Object.entries(bones)) for (const field of Object.keys(fields)) {
      fields[field] = frames.map(frame => Number((frame[bone]?.[field] ?? DEFAULTS[field]).toFixed(4)))
    }
    const clip = { samples, bones, endKeyed: tracks.hasEndKey(name), duration: animationDurations[name],
      loops: animationLoops[name], handPose: animationHandPose[name], equipment: animationEquipment[name] }
    clips[name] = clip
    // Check between samples, not just at the instants that were baked.
    for (let step = 0; step < samples; step++) for (const fraction of [0.25, 0.5, 0.75]) {
      const phase = (step + fraction) / samples
      const truth = tracks.pose(name, phase), baked = sampleBakedPose(clip, phase)
      for (const bone of new Set([...Object.keys(truth), ...Object.keys(baked)])) {
        for (const field of Object.keys(DEFAULTS)) {
          const error = Math.abs((truth[bone]?.[field] ?? DEFAULTS[field]) - (baked[bone]?.[field] ?? DEFAULTS[field]))
          if (error > worstError) { worstError = error; worstAt = `${name}/${bone}.${field} @ ${phase.toFixed(5)}` }
        }
      }
    }
  }
  return {
    format: 'modular-character-studio-pose-library-v1',
    note: 'Generated from RigTracks. Bone deltas already include bone, wrist-angle, and clip-wide corrections. Do not apply those twice.',
    clips,
    // Retain keyed grip and expression data for renderers that resolve attachments
    // at runtime. They are not bone transforms and cannot be recovered from poses.
    wristKeyframes: scene.wristKeyframes,
    expressionKeyframes: scene.expressionKeyframes,
    validation: { worstError: Number(worstError.toFixed(6)), worstAt },
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = { project: process.env.MCS_PROJECT_ROOT ?? resolve(root, 'project'), output: resolve(root, 'output/pose-library-v1.json'), samples: 120 }
  let check = false
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--check') { check = true; continue }
    const flag = process.argv[i], value = process.argv[++i]
    if (!['--project', '--output', '--samples'].includes(flag) || !value) throw new Error('Usage: npm run bake:poses -- [--project PATH] [--output FILE] [--samples 120] [--check]')
    options[flag.slice(2)] = flag === '--samples' ? Number(value) : value
  }
  const scene = validateModularCharacterScene(JSON.parse(await readFile(resolve(options.project, 'scene.json'), 'utf8')))
  const library = bakeAnimationLibrary(scene, options)
  const serialized = JSON.stringify(library) + '\n'
  if (check) {
    const existing = await readFile(resolve(options.output), 'utf8').catch(() => '')
    if (existing !== serialized) throw new Error(`${options.output} is stale or missing. Re-run bake:poses with the same options.`)
  } else {
    await mkdir(dirname(resolve(options.output)), { recursive: true })
    await writeFile(resolve(options.output), serialized)
  }
  console.log(`${check ? 'Verified' : 'Baked'} ${Object.keys(library.clips).length} clips; worst interpolation error ${library.validation.worstError} at ${library.validation.worstAt}`)
}
