import { useState, useCallback, useRef } from "react";
import { queryCommands } from "../lib/tauri-commands";
import { computeTabsAfterClose } from "../lib/queryTabs";
import type { ResultEntry } from "../lib/queryTabs";
import type { QueryTab, QueryResult } from "../types";

// Single source of truth for the result-entry shape (incl. pinned/customName).
export type { ResultEntry } from "../lib/queryTabs";

let tabCounter = 1;
let resultCounter = 1;

/** Max result tabs retained per query tab; oldest are dropped beyond this. */
export const MAX_RESULTS_PER_TAB = 10;

function createNewTab(): QueryTab {
  const id = `query-${Date.now()}-${tabCounter++}`;
  return {
    id,
    title: `Query ${tabCounter - 1}`,
    content: "",
    is_modified: false,
  };
}

/** Build a compact one-line snippet from a SQL string for use as a tab label. */
export function makeSnippet(sql: string, max = 40): string {
  const collapsed = sql.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed || "(empty)";
  return `${collapsed.slice(0, max - 1)}…`;
}

/** Adapt a raw {@link QueryResult} into a {@link ResultEntry} (with snippet). */
export function toResultEntry(result: QueryResult, sql: string): ResultEntry {
  return {
    id: `result-${Date.now()}-${resultCounter++}`,
    snippet: makeSnippet(sql),
    columns: result.columns,
    rows: result.rows,
    affectedRows: result.affected_rows,
    execTimeMs: result.execution_time_ms,
  };
}

/** Reconstruct a {@link QueryResult} from a {@link ResultEntry} for ResultsGrid. */
export function resultEntryToQueryResult(entry: ResultEntry): QueryResult {
  return {
    // ResultEntry.columns is typed as unknown[] (queryTabs); the entries we build
    // here always originate from a QueryResult, so narrow back to ColumnInfo[].
    columns: entry.columns as QueryResult["columns"],
    rows: entry.rows,
    affected_rows: entry.affectedRows,
    execution_time_ms: entry.execTimeMs,
  };
}

export function useQueries() {
  const [tabs, setTabs] = useState<QueryTab[]>(() => [createNewTab()]);
  const [activeTabId, setActiveTabId] = useState<string | null>(() => tabs[0]?.id || null);
  // Per query tab: a capped list of executed results (newest last).
  const [results, setResults] = useState<Map<string, ResultEntry[]>>(new Map());
  // Per query tab: which result tab is currently selected.
  const [activeResultIds, setActiveResultIds] = useState<Map<string, string>>(new Map());
  const [executing, setExecuting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getActiveTab = useCallback(() => {
    return tabs.find((t) => t.id === activeTabId) || null;
  }, [tabs, activeTabId]);

  const createTab = useCallback(() => {
    const newTab = createNewTab();
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab;
  }, []);

  const closeTab = useCallback((tabId: string) => {
    // Pure computation, then plain setters — no setState inside an updater (which
    // StrictMode double-invokes). Closing the last tab leaves the list empty
    // rather than silently recreating a tab, so a tab can always be closed.
    const next = computeTabsAfterClose(tabs, activeTabId, tabId);
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);

    // Clean up results for the closed tab.
    setResults((prev) => {
      const updated = new Map(prev);
      updated.delete(tabId);
      return updated;
    });
    setActiveResultIds((prev) => {
      const updated = new Map(prev);
      updated.delete(tabId);
      return updated;
    });
  }, [tabs, activeTabId]);

  const updateTabContent = useCallback((tabId: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, content, is_modified: true }
          : t
      )
    );
  }, []);

  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, title } : t
      )
    );
  }, []);

  // Tracks the in-flight request id per tab so a running query can be cancelled.
  const requestIds = useRef<Map<string, string>>(new Map());

  /** Append a result entry to a tab's result list (capped, newest auto-selected). */
  const appendResult = useCallback((tabId: string, entry: ResultEntry) => {
    setResults((prev) => {
      const next = new Map(prev);
      const list = [...(next.get(tabId) ?? []), entry];
      // Drop oldest beyond the cap.
      if (list.length > MAX_RESULTS_PER_TAB) {
        list.splice(0, list.length - MAX_RESULTS_PER_TAB);
      }
      next.set(tabId, list);
      return next;
    });
    setActiveResultIds((prev) => {
      const next = new Map(prev);
      next.set(tabId, entry.id);
      return next;
    });
  }, []);

  const executeQuery = useCallback(async (sessionId: string, tabId?: string) => {
    const targetTabId = tabId || activeTabId;
    if (!targetTabId) return;

    const tab = tabs.find((t) => t.id === targetTabId);
    if (!tab || !tab.content.trim()) return;

    const requestId = crypto.randomUUID();
    requestIds.current.set(targetTabId, requestId);
    setExecuting(targetTabId);
    setError(null);

    try {
      const result = await queryCommands.executeQuery(sessionId, tab.content, requestId);
      appendResult(targetTabId, toResultEntry(result, tab.content));
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      // Record the failure as its own result tab so the run stays in history.
      appendResult(targetTabId, {
        id: `result-${Date.now()}-${resultCounter++}`,
        snippet: makeSnippet(tab.content),
        columns: [],
        rows: [],
        execTimeMs: 0,
        error: errorMsg,
      });
      throw err;
    } finally {
      requestIds.current.delete(targetTabId);
      setExecuting(null);
    }
  }, [activeTabId, tabs, appendResult]);

  const cancelQuery = useCallback(async (tabId?: string) => {
    const targetTabId = tabId || activeTabId;
    const requestId = targetTabId ? requestIds.current.get(targetTabId) : undefined;
    if (requestId) {
      try {
        await queryCommands.cancelQuery(requestId);
      } catch (err) {
        console.error("Failed to cancel query:", err);
      }
    }
    setExecuting(null);
  }, [activeTabId]);

  /** All result entries for a query tab (oldest -> newest). */
  const getResults = useCallback((tabId: string): ResultEntry[] => {
    return results.get(tabId) ?? [];
  }, [results]);

  /** The currently-selected result entry for a query tab (or null). */
  const getActiveResult = useCallback((tabId: string): ResultEntry | null => {
    const list = results.get(tabId);
    if (!list || list.length === 0) return null;
    const activeId = activeResultIds.get(tabId);
    return list.find((r) => r.id === activeId) ?? list[list.length - 1];
  }, [results, activeResultIds]);

  const getActiveResultId = useCallback((tabId: string): string | null => {
    return activeResultIds.get(tabId) ?? null;
  }, [activeResultIds]);

  const selectResult = useCallback((tabId: string, resultId: string) => {
    setActiveResultIds((prev) => {
      const next = new Map(prev);
      next.set(tabId, resultId);
      return next;
    });
  }, []);

  const closeResult = useCallback((tabId: string, resultId: string) => {
    setResults((prev) => {
      const list = prev.get(tabId);
      if (!list) return prev;
      const filtered = list.filter((r) => r.id !== resultId);
      const next = new Map(prev);
      next.set(tabId, filtered);
      // If we removed the selected one, re-point to the newest remaining.
      setActiveResultIds((sel) => {
        if (sel.get(tabId) !== resultId) return sel;
        const updated = new Map(sel);
        if (filtered.length > 0) {
          updated.set(tabId, filtered[filtered.length - 1].id);
        } else {
          updated.delete(tabId);
        }
        return updated;
      });
      return next;
    });
  }, []);

  /**
   * Backwards-compatible single-result accessor (returns the active result as a
   * plain {@link QueryResult}).
   */
  const getResult = useCallback((tabId: string): QueryResult | null => {
    const entry = getActiveResult(tabId);
    return entry && !entry.error ? resultEntryToQueryResult(entry) : null;
  }, [getActiveResult]);

  const clearResult = useCallback((tabId: string) => {
    setResults((prev) => {
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
    setActiveResultIds((prev) => {
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  return {
    tabs,
    activeTabId,
    activeTab: getActiveTab(),
    executing,
    error,
    createTab,
    closeTab,
    setActiveTabId,
    updateTabContent,
    updateTabTitle,
    executeQuery,
    cancelQuery,
    // Multi-result API
    getResults,
    getActiveResult,
    getActiveResultId,
    selectResult,
    closeResult,
    // Legacy single-result API (kept for compatibility)
    getResult,
    clearResult,
  };
}
