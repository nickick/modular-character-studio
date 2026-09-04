import { createFileRoute } from '@tanstack/react-router'
import { StudioFrame } from '../components/studio-frame'

export const Route = createFileRoute('/equipment')({
  component: () => <StudioFrame title="Equipment Studio" src="/studio/equipment/" />,
})
