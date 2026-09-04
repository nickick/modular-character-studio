import { createFileRoute, Link } from "@tanstack/react-router"
import { ExternalLink, Shield, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/")({ component: StudioHome })

const studios = [
  {
    to: "/rig" as const,
    title: "Rig Studio",
    description: "Pose the modular character, tune bones and layers, and preview animation clips.",
    icon: Sparkles,
  },
  {
    to: "/equipment" as const,
    title: "Equipment Studio",
    description: "Place armor, weapons, shields, and accessories against the live shared rig.",
    icon: Shield,
  },
]

function StudioHome() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-14 lg:px-8 lg:py-20">
        <header className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_12px_theme(colors.emerald.400)]" />
            Local-first character authoring
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Modular Character Studio
          </h1>
          <p className="text-pretty text-lg leading-8 text-muted-foreground">
            Pose a layered 2D character, tune animation and deformation, then fit armor and held
            equipment against the same scene.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2" aria-label="Available studios">
          {studios.map((studio) => {
            const Icon = studio.icon
            return (
              <Card key={studio.to} className="flex flex-col transition-colors hover:border-primary/60">
                <CardHeader>
                  <Icon className="mb-3 size-7 text-primary" aria-hidden="true" />
                  <CardTitle>{studio.title}</CardTitle>
                  <CardDescription className="min-h-12 leading-6">{studio.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <Link
                    to={studio.to}
                    className={cn(buttonVariants({ variant: "outline" }), "w-full")}
                    onClick={() => toast(`Opening ${studio.title}`)}
                  >
                    Open studio <ExternalLink className="size-4" aria-hidden="true" />
                  </Link>
                </CardContent>
              </Card>
            )
          })}
        </section>

        <footer className="border-t pt-6 text-sm text-muted-foreground">
          MIT code · CC0 bundled demo art · <code>npm run dev</code>
        </footer>
      </div>
    </main>
  )
}
