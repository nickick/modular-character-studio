import { readFile, stat } from 'node:fs/promises'
import { extname, normalize, resolve, sep } from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { projectRoot } from '../lib/project-paths'

const contentTypes = new Map([
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
])

function resolveProjectFile(relative: string) {
  const root = projectRoot()
  const metadata = new Set(['equipment-catalog.json', 'equipment-matrix.json'])
  const mount = metadata.has(relative) ? root : resolve(root, 'assets')
  const candidate = resolve(mount, normalize(relative))
  if (candidate !== mount && !candidate.startsWith(`${mount}${sep}`)) return null
  return candidate
}

export const Route = createFileRoute('/assets/$')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const relative = params._splat ?? ''
          const filePath = resolveProjectFile(relative)
          if (!filePath) return Response.json({ error: 'Forbidden path' }, { status: 403 })
          const extension = extname(filePath).toLowerCase()
          const type = contentTypes.get(extension)
          if (!type) return Response.json({ error: 'Unsupported asset type' }, { status: 415 })
          const info = await stat(filePath)
          if (!info.isFile()) return Response.json({ error: 'Not found' }, { status: 404 })
          return new Response(await readFile(filePath), {
            headers: {
              'Cache-Control': 'no-store',
              'Content-Type': type,
              'X-Content-Type-Options': 'nosniff',
            },
          })
        } catch (error) {
          const code = (error as NodeJS.ErrnoException)?.code
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: code === 'ENOENT' ? 404 : 400 },
          )
        }
      },
    },
  },
})
