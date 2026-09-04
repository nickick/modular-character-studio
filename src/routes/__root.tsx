import type { ReactNode } from "react"
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import { Toaster } from "@/components/ui/sonner"
import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Modular Character Studio" },
      {
        name: "description",
        content: "Local-first tools for authoring modular 2D character rigs and equipment.",
      },
      { name: "theme-color", content: "#111820" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster richColors closeButton />
        <Scripts />
      </body>
    </html>
  )
}
