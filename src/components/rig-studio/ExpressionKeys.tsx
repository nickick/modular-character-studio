/** The rig studio's face keys: the shared panel, bound to its store. */
import { useShallow } from "zustand/react/shallow"
import { ExpressionKeysPanel } from "@/components/shared/ExpressionKeysPanel.tsx"
import { useRigEditor } from "@/stores/rig-editor.ts"
import { useTracks } from "@/hooks/use-rig-frame.ts"

export function ExpressionKeys() {
  const tracks = useTracks()
  const { scene, animation, phase } = useRigEditor(
    useShallow((state) => ({
      scene: state.scene,
      animation: state.animation,
      phase: state.phase,
    })),
  )
  const editScene = useRigEditor((state) => state.editScene)
  const setPhase = useRigEditor((state) => state.setPhase)
  if (!scene) return null
  return (
    <ExpressionKeysPanel
      scene={scene}
      tracks={tracks}
      animation={animation}
      phase={phase}
      editScene={editScene}
      setPhase={setPhase}
    />
  )
}
