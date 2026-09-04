import { Toaster as Sonner, type ToasterProps } from "sonner"

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      toastOptions={{
        classNames: {
          toast: "bg-card text-card-foreground border-border",
          description: "text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}
