import { access, readFile, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { validateModularCharacterScene } from '../public/studio/rig/schema.mjs'
import { analyzeAlpha, decodePngAlpha, remoteAlphaComponents } from './png-alpha.mjs'

const projectRoot = resolve(process.env.MCS_PROJECT_ROOT ?? resolve(process.cwd(), 'project'))
const scene = validateModularCharacterScene(
  JSON.parse(await readFile(resolve(projectRoot, 'scene.json'), 'utf8')),
)
const catalog = JSON.parse(await readFile(resolve(projectRoot, 'equipment-catalog.json'), 'utf8'))
const matrix = JSON.parse(await readFile(resolve(projectRoot, 'equipment-matrix.json'), 'utf8'))

const referenced = new Set()
const collect = (value) => {
  if (typeof value === 'string' && value.endsWith('.png')) referenced.add(value)
  else if (value && typeof value === 'object') for (const child of Object.values(value)) collect(child)
}
collect(scene.layers)
for (const key of [
  'weaponOptions', 'staffOptions', 'bowOptions', 'shieldOptions', 'necklaceOptions',
  'quiverOptions', 'chestOptions', 'headgearOptions', 'ringOptions', 'armOptions', 'bootOptions',
]) collect(scene[key])
collect(JSON.parse(await readFile(resolve(projectRoot, 'assets/facial-expression-assets-v1.json'), 'utf8')))
collect(scene.referenceByProfile)

for (const relative of referenced) {
  const root = resolve(projectRoot, 'assets')
  const path = resolve(root, relative)
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`Unsafe asset path: ${relative}`)
  await access(path)
  if (!(await stat(path)).isFile()) throw new Error(`Not a file: ${relative}`)
  const alpha = analyzeAlpha(decodePngAlpha(await readFile(path)))
  if (remoteAlphaComponents(alpha).length) throw new Error(`Remote alpha fragment: ${relative}`)
}

if (!Array.isArray(catalog.items) || catalog.items.length < 1) throw new Error('Catalog is empty')
if (!matrix.applicability || typeof matrix.applicability !== 'object') throw new Error('Matrix is invalid')

console.log(`Validated ${referenced.size} assets and ${catalog.items.length} catalog items.`)
