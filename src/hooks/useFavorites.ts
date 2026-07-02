import { useState, useCallback, useEffect } from "react";
import {
  getFavoriteQueries,
  saveFavoriteQuery,
  deleteFavoriteQuery,
  type FavoriteQueryEntry,
} from "../lib/queryPanelCommands";

/**
 * Loads and mutates saved/favorite queries. When `connectionId` is provided the
 * list is fetched scoped to that connection; the panel still filters client-side
 * as a defensive measure in case the backend ignores the filter.
 */
export function useFavorites(connectionId: string | null) {
  const [favorites, setFavorites] = useState<FavoriteQueryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await getFavoriteQueries(connectionId ?? undefined);
      setFavorites(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFavorites([]);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (favorite: {
      name: string;
      description?: string;
      connection_id?: string;
      database?: string;
      query: string;
    }) => {
      setError(null);
      const created = await saveFavoriteQuery(favorite);
      await refresh();
      return created;
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await deleteFavoriteQuery(id);
        setFavorites((prev) => prev.filter((f) => f.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    []
  );

  return { favorites, loading, error, refresh, save, remove };
}
