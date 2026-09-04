import { createFileRoute } from '@tanstack/react-router'
import { StudioFrame } from '../components/studio-frame'

export const Route = createFileRoute('/rig')({
  component: () => <StudioFrame title="Rig Studio" src="/studio/rig/" />,
})
