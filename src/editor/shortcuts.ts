/**
 * The studios' keyboard shortcuts.
 *
 * The ordering matters. Undo and redo are handled *before* the check for
 * whether focus is in a field, and blur that field first: an author is
 * typically mid-edit in a numeric input when they reach for Cmd-Z, and bailing
 * out because a field has focus is the same as having no shortcut at all.
 * Everything else does defer to the field, so typing an "l" into a search box
 * cannot flip the stage into layer mode.
 */

export interface EditorShortcuts {
  undo: () => void
  redo: () => void
  save?: () => void
  togglePlayback?: () => void
  setMode?: (mode: "bone" | "layer") => void
  onEscape?: () => void
}

/** Just enough of an element for this module to decide about it. */
interface FocusTarget {
  tagName?: string
  isContentEditable?: boolean
  blur?: () => void
}

const asTarget = (node: EventTarget | null): FocusTarget | null =>
  node && typeof node === "object" ? (node as FocusTarget) : null

/**
 * Whether a key press belongs to something the author is typing into.
 *
 * Shape-checked rather than `instanceof HTMLElement`: that global does not
 * exist when this runs headlessly, and it is the wrong answer anyway for an
 * element belonging to another document.
 */
function isField(node: EventTarget | FocusTarget | null): boolean {
  const target = node && typeof node === "object" ? (node as FocusTarget) : null
  if (!target) return false
  const tag = target.tagName
  return (
    tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable === true
  )
}

/**
 * Handle one key press. Exported on its own so the behaviour can be checked
 * without a window, and returns which shortcut fired.
 */
export function handleShortcut(event: KeyboardEvent, handlers: EditorShortcuts): string | null {
  const key = event.key.toLowerCase()
  const command = event.metaKey || event.ctrlKey


  if (key === "escape") {
    handlers.onEscape?.()
    return handlers.onEscape ? "escape" : null
  }

  const undo = command && key === "z" && !event.shiftKey
  // Cmd-Y is the other redo people reach for, and costs nothing to accept.
  const redo = command && ((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey))
  if (undo || redo) {
    event.preventDefault()
    // Commit and leave whatever field has focus, so the edit being undone is
    // the one the author can see rather than one still being typed. Guarded so
    // the handler can be exercised without a DOM.
    const focused = asTarget(typeof document === "undefined" ? null : document.activeElement)
    if (focused && isField(focused)) focused.blur?.()
    if (redo) handlers.redo()
    else handlers.undo()
    return redo ? "redo" : "undo"
  }

  if (command && key === "s" && handlers.save) {
    event.preventDefault()
    handlers.save()
    return "save"
  }

  // Past this point a shortcut is a bare letter, so a field keeps its keys.
  if (isField(event.target)) return null

  if (event.code === "Space" && handlers.togglePlayback) {
    event.preventDefault()
    handlers.togglePlayback()
    return "playback"
  }
  if (key === "b" && handlers.setMode) {
    handlers.setMode("bone")
    return "bone"
  }
  if (key === "l" && handlers.setMode) {
    handlers.setMode("layer")
    return "layer"
  }
  return null
}
