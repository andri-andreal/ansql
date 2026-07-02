/** Minimal shape needed to identify a tab. */
export interface ClosableTab {
  id: string;
}

/** Default cap on retained result tabs per query tab; oldest unpinned are dropped beyond this. */
export const MAX_RESULTS_PER_TAB = 10;

/**
 * A single executed-query result, shown as one result tab. Keeps the columns/
 * rows/affected-rows/timing plus a short SQL snippet and (when the run failed)
 * an error message.
 *
 * `pinned` results are never evicted by {@link capResults}; `customName`, when
 * set, overrides the auto-generated snippet as the result-tab label.
 */
export interface ResultEntry {
  id: string;
  /** Short SQL snippet for the result-tab label. */
  snippet: string;
  /**
   * Full source SQL that produced this result (unlike {@link snippet}, which is
   * truncated for the tab label). Lets the editable-results affordance recover
   * the original single-table SELECT via {@link detectSingleTableSelect}.
   */
  sourceSql?: string;
  columns: unknown[];
  rows: Record<string, unknown>[];
  affectedRows?: number;
  execTimeMs: number;
  error?: string;
  /** When true, this result is kept regardless of the cap. */
  pinned?: boolean;
  /** User-supplied label, shown instead of the snippet when present. */
  customName?: string;
}

/**
 * Cap a result list to at most `cap` entries by evicting the oldest *unpinned*
 * entries (oldest -> newest order preserved). Pinned entries are never dropped,
 * even if that means the returned list exceeds `cap`. Returns the original
 * reference when nothing needs to change.
 */
export function capResults(entries: ResultEntry[], cap = MAX_RESULTS_PER_TAB): ResultEntry[] {
  if (entries.length <= cap) return entries;

  // How many unpinned entries we must drop to get within the cap.
  let toDrop = entries.length - cap;
  if (toDrop <= 0) return entries;

  const next: ResultEntry[] = [];
  for (const entry of entries) {
    if (toDrop > 0 && !entry.pinned) {
      toDrop--;
      continue;
    }
    next.push(entry);
  }
  // If every droppable (unpinned) entry was already removed and we're still
  // over cap, the remainder are all pinned — keep them all.
  return next.length === entries.length ? entries : next;
}

/** Toggle the `pinned` flag on the entry with `id`; other entries are untouched. */
export function togglePinned(entries: ResultEntry[], id: string): ResultEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e));
}

/**
 * Set (or clear) the `customName` of the entry with `id`. A blank/whitespace-only
 * name clears the override so the snippet label is used again.
 */
export function renameResult(entries: ResultEntry[], id: string, name: string): ResultEntry[] {
  const trimmed = name.trim();
  return entries.map((e) =>
    e.id === id ? { ...e, customName: trimmed === "" ? undefined : trimmed } : e
  );
}

/**
 * Pure computation of the tab list + active tab after closing one tab.
 *
 * - Removes `tabId` from `tabs`.
 * - If the closed tab was NOT active, the active tab is unchanged.
 * - If it WAS active, activation moves to the previous neighbor (or the new
 *   first tab); when nothing remains, the active id becomes `null`.
 * - Closing the last tab yields an empty list — the panel is responsible for an
 *   empty state. (The previous behaviour silently recreated a tab, which made
 *   the final tab impossible to close.)
 * - An unknown `tabId` is a no-op.
 */
export function computeTabsAfterClose<T extends ClosableTab>(
  tabs: T[],
  activeTabId: string | null,
  tabId: string
): { tabs: T[]; activeTabId: string | null } {
  const closedIndex = tabs.findIndex((t) => t.id === tabId);
  if (closedIndex === -1) {
    return { tabs, activeTabId };
  }

  const nextTabs = tabs.filter((t) => t.id !== tabId);

  if (activeTabId !== tabId) {
    return { tabs: nextTabs, activeTabId };
  }

  if (nextTabs.length === 0) {
    return { tabs: nextTabs, activeTabId: null };
  }

  const neighborIndex = Math.min(Math.max(0, closedIndex - 1), nextTabs.length - 1);
  return { tabs: nextTabs, activeTabId: nextTabs[neighborIndex].id };
}
