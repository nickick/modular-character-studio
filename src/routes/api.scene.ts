import { createFileRoute } from '@tanstack/react-router'
import { projectHistoryPath, projectScenePath } from '../lib/project-paths'
import { loadSceneSnapshot, saveSceneSnapshot } from '../server/scene-store.ts'

const jsonHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
}

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(`${JSON.stringify(value, null, 2)}\n`, {
    status,
    headers: { ...jsonHeaders, ...headers },
  })
}

export const Route = createFileRoute('/api/scene')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const snapshot = await loadSceneSnapshot(projectScenePath())
          return json(snapshot.scene, 200, { ETag: snapshot.revision })
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 400)
        }
      },
      PUT: async ({ request }) => {
        try {
          const contentLength = Number(request.headers.get('content-length') ?? 0)
          if (contentLength > 32 * 1024 * 1024) return json({ error: 'Request body exceeds 32 MB' }, 413)
          const source = await request.text()
          if (source.length > 32 * 1024 * 1024) return json({ error: 'Request body exceeds 32 MB' }, 413)
          const snapshot = await saveSceneSnapshot({
            scenePath: projectScenePath(),
            historyRoot: projectHistoryPath(),
            value: JSON.parse(source),
            expectedRevision: request.headers.get('if-match'),
          })
          return json(snapshot.scene, 200, { ETag: snapshot.revision })
        } catch (error) {
          const status = Number.isInteger((error as { status?: number })?.status)
            ? (error as { status: number }).status
            : 400
          return json({ error: error instanceof Error ? error.message : String(error) }, status)
        }
      },
    },
  },
})
