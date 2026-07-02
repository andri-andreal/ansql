import { useState, useCallback, useEffect } from "react";
import {
  getQueryHistory,
  clearQueryHistory,
  type QueryHistoryEntry,
} from "../lib/queryPanelCommands";

const DEFAULT_LIMIT = 100;

/**
 * Loads query history for a given connection. Re-fetches whenever the
 * connection changes; exposes `refresh` so callers can reload after a query
 * runs, and `clear` to wipe the connection's history.
 */
export function useHistory(connectionId: string | null, limit = DEFAULT_LIMIT) {
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!connectionId) {
      setHistory([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await getQueryHistory(connectionId, limit);
      setHistory(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [connectionId, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clear = useCallback(async () => {
    if (!connectionId) return;
    try {
      await clearQueryHistory(connectionId);
      setHistory([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [connectionId]);

  return { history, loading, error, refresh, clear };
}
