/** Binds the studios' shared keyboard shortcuts for as long as one is mounted. */
import { useEffect, useRef } from "react"
import { handleShortcut, type EditorShortcuts } from "@/editor/shortcuts.ts"

export function useEditorShortcuts(handlers: EditorShortcuts): void {
  // Held in a ref so the listener is bound once rather than on every render,
  // while still calling through to the latest handlers.
  const latest = useRef(handlers)
  latest.current = handlers
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleShortcut(event, latest.current)
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
