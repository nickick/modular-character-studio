import { createFileRoute } from "@tanstack/react-router"
import { EquipmentStudio } from "@/components/equipment-studio/EquipmentStudio.tsx"
import studioCss from "@/styles/equipment-studio.css?url"

export const Route = createFileRoute("/equipment")({
  head: () => ({
    meta: [{ title: "Equipment Studio · Modular Character Studio" }],
    links: [{ rel: "stylesheet", href: studioCss }],
  }),
  component: EquipmentStudio,
})
