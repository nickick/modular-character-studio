/**
 * The layer list: every attachment on show, grouped as the scene groups them,
 * in draw order, with its visibility and its draw order beside it.
 */
import { useMemo, useState } from "react"
import { useRigEditor } from "@/stores/rig-editor.ts"
import { useVisibleLayers } from "@/hooks/use-rig-frame.ts"
import type { ResolvedLayer } from "@/rig/types.ts"

function groupLayers(layers: readonly ResolvedLayer[], search: string): Map<string, ResolvedLayer[]> {
  const needle = search.trim().toLowerCase()
  const groups = new Map<string, ResolvedLayer[]>()
  for (const layer of [...layers].sort((left, right) => left.drawOrder - right.drawOrder)) {
    if (needle && !`${layer.id} ${layer.group} ${layer.bone}`.toLowerCase().includes(needle)) continue
    const bucket = groups.get(layer.group)
    if (bucket) bucket.push(layer)
    else groups.set(layer.group, [layer])
  }
  return groups
}

export function LayerPanel() {
  const [search, setSearch] = useState("")
  const layers = useVisibleLayers()
  const selectedLayer = useRigEditor((state) => state.selectedLayer)
  const selectLayer = useRigEditor((state) => state.selectLayer)
  const editScene = useRigEditor((state) => state.editScene)
  const groups = useMemo(() => groupLayers(layers, search), [layers, search])

  return (
    <aside className="panel">
      <section className="panel-section">
        <div className="section-heading">
          <span className="eyebrow">Layers</span>
          <strong>Attachments</strong>
          <output id="layerCount">{layers.length}</output>
        </div>
        <input
          id="layerSearch"
          className="search"
          type="search"
          placeholder="Filter by id, group, or bone"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div id="layerGroups" className="layer-groups">
          {[...groups].map(([group, entries]) => (
            <section className="layer-group" key={group}>
              <h3>
                {group} · {entries.length}
              </h3>
              {entries.map((layer) => (
                <div className="layer-row" key={layer.id}>
                  <button
                    type="button"
                    className="visibility"
                    title={`${layer.visible ? "Hide" : "Show"} ${layer.id}`}
                    onClick={() =>
                      editScene((draft) => {
                        const target = draft.layers.find((candidate) => candidate.id === layer.id)
                        if (target) target.visible = !target.visible
                      })
                    }
                  >
                    {layer.visible ? "◉" : "○"}
                  </button>
                  <button
                    type="button"
                    className={layer.id === selectedLayer ? "selected" : undefined}
                    onClick={() => selectLayer(layer.id)}
                  >
                    {layer.id}
                  </button>
                  <small>{layer.drawOrder}</small>
                </div>
              ))}
            </section>
          ))}
        </div>
      </section>
    </aside>
  )
}
