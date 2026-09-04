/**
 * A generic undo/redo stack.
 *
 * Both studios had their own copy, each snapshotting a hand-listed set of
 * fields and comparing them with `JSON.stringify`. Snapshots are still whole
 * values compared structurally -- these are small documents and the simplicity
 * is worth more than the diffing -- but there is one implementation, and what
 * a snapshot contains is the caller's business rather than this module's.
 */

/** How many steps back a studio can go before the oldest is dropped. */
export const DEFAULT_HISTORY_LIMIT = 60

export interface HistoryState<T> {
  undo: readonly T[]
  redo: readonly T[]
}

export const emptyHistory = <T,>(): HistoryState<T> => ({ undo: [], redo: [] })

const same = <T,>(left: T, right: T): boolean => JSON.stringify(left) === JSON.stringify(right)

/**
 * Record a step, given the snapshot taken before the edit began. An edit that
 * changed nothing -- a drag that ended where it started, a field retyped to the
 * same value -- is not a step, so undo never appears to do nothing.
 */
export function commit<T>(
  history: HistoryState<T>,
  before: T | null,
  after: T,
  limit: number = DEFAULT_HISTORY_LIMIT,
): HistoryState<T> {
  if (before === null || same(before, after)) return history
  const undo = [...history.undo, before]
  return { undo: undo.length > limit ? undo.slice(undo.length - limit) : undo, redo: [] }
}

/** The snapshot to restore, and the history that results from restoring it. */
export interface HistoryStep<T> {
  snapshot: T
  history: HistoryState<T>
}

export function undo<T>(history: HistoryState<T>, current: T): HistoryStep<T> | null {
  if (history.undo.length === 0) return null
  const snapshot = history.undo[history.undo.length - 1]
  return {
    snapshot,
    history: { undo: history.undo.slice(0, -1), redo: [...history.redo, current] },
  }
}

export function redo<T>(history: HistoryState<T>, current: T): HistoryStep<T> | null {
  if (history.redo.length === 0) return null
  const snapshot = history.redo[history.redo.length - 1]
  return {
    snapshot,
    history: { undo: [...history.undo, current], redo: history.redo.slice(0, -1) },
  }
}

export const canUndo = <T,>(history: HistoryState<T>): boolean => history.undo.length > 0
export const canRedo = <T,>(history: HistoryState<T>): boolean => history.redo.length > 0
