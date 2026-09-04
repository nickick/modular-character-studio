import { createFileRoute } from "@tanstack/react-router"
import { RigStudio } from "@/components/rig-studio/RigStudio.tsx"
import studioCss from "@/styles/rig-studio.css?url"

export const Route = createFileRoute("/rig")({
  head: () => ({
    meta: [{ title: "Rig Studio · Modular Character Studio" }],
    links: [{ rel: "stylesheet", href: studioCss }],
  }),
  component: RigStudio,
})
