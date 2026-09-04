/** The rig studio's clip picker: the shared dialog, bound to its store. */
import { AnimationPickerDialog } from "@/components/shared/AnimationPickerDialog.tsx"
import { useResolvedRig, useTracks } from "@/hooks/use-rig-frame.ts"
import { useRigEditor } from "@/stores/rig-editor.ts"
import type { LayerImageResolver } from "@/hooks/use-rig-images.ts"

export function AnimationPicker({
  open,
  onClose,
  images,
}: {
  open: boolean
  onClose: () => void
  images: LayerImageResolver
}) {
  const animation = useRigEditor((state) => state.animation)
  const mainHand = useRigEditor((state) => state.presentation.mainHand)
  const setAnimation = useRigEditor((state) => state.setAnimation)
  return (
    <AnimationPickerDialog
      open={open}
      onClose={onClose}
      images={images}
      rig={useResolvedRig()}
      tracks={useTracks()}
      animation={animation}
      onSelect={setAnimation}
      mainHand={mainHand}
    />
  )
}
