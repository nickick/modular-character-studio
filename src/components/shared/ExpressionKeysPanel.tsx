/**
 * Face keys, for whichever studio is showing them.
 *
 * Eyes and mouths are complete replacement drawings rather than values to
 * blend, so this track is stepped: a key names which drawing is showing from
 * that moment until the next key. Both studios author it, so the panel takes
 * its scene and playhead as props rather than reaching into one studio's store.
 */
import { SelectField } from "@/components/SelectField.tsx"
import {
  adjacentKey,
  deleteExpressionKey,
  ensureExpressionKey,
  expressionKeys,
  setExpressionChannel,
} from "@/editor/keyframes.ts"
import { eyeExpressionNames, mouthExpressionNames, type RigTracks } from "@/rig/tracks.ts"
import type { EyeExpression, MouthExpression, RigScene } from "@/rig/types.ts"

export interface ExpressionKeysPanelProps {
  scene: RigScene
  tracks: RigTracks
  animation: string
  phase: number
  editScene: (mutate: (scene: RigScene) => void) => void
  setPhase: (phase: number) => void
}

export function ExpressionKeysPanel({
  scene,
  tracks,
  animation,
  phase,
  editScene,
  setPhase,
}: ExpressionKeysPanelProps) {
  const keys = expressionKeys(scene, animation)
  const sampled = tracks.expressionAt(animation, phase)
  const jump = (direction: number) => {
    const next = adjacentKey(keys, phase, direction)
    if (next) setPhase(next.phase)
  }

  return (
    <section className="panel-section">
      <div className="section-heading">
        <span className="eyebrow">Face</span>
        <strong>Expression keys</strong>
      </div>
      <div className="expression-fields">
        <SelectField
          id="expressionEyes"
          label="Eyes"
          value={sampled.eyes}
          options={eyeExpressionNames.map((name) => ({ id: name, label: name }))}
          onChange={(next) =>
            editScene((draft) =>
              setExpressionChannel(draft, animation, phase, "eyes", next as EyeExpression, tracks),
            )
          }
        />
        <SelectField
          id="expressionMouth"
          label="Mouth"
          value={sampled.mouth}
          options={mouthExpressionNames.map((name) => ({ id: name, label: name }))}
          onChange={(next) =>
            editScene((draft) =>
              setExpressionChannel(draft, animation, phase, "mouth", next as MouthExpression, tracks),
            )
          }
        />
      </div>
      <div className="wrist-key-actions">
        <button
          id="setExpressionKey"
          type="button"
          className="primary"
          onClick={() => editScene((draft) => void ensureExpressionKey(draft, animation, phase, tracks))}
        >
          Set face key
        </button>
        <button
          id="deleteExpressionKey"
          type="button"
          onClick={() => editScene((draft) => void deleteExpressionKey(draft, animation, phase))}
        >
          Delete key
        </button>
        <button id="previousExpressionKey" type="button" onClick={() => jump(-1)}>
          Previous key
        </button>
        <button id="nextExpressionKey" type="button" onClick={() => jump(1)}>
          Next key
        </button>
      </div>
      <p className="hint">
        {keys.length === 0
          ? "No face keys in this clip."
          : `${keys.length} key${keys.length === 1 ? "" : "s"} in this clip.`}
      </p>
    </section>
  )
}
