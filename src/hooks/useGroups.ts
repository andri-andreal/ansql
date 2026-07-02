import { useState, useEffect, useCallback } from "react";
import { groupCommands } from "../lib/tauri-commands";
import type { ConnectionGroup } from "../types";

interface UseGroupsOptions {
  enabled?: boolean;
}

export function useGroups(options: UseGroupsOptions = {}) {
  const { enabled = true } = options;
  const [groups, setGroups] = useState<ConnectionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError(null);

    try {
      const data = await groupCommands.getGroups();
      setGroups(data);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error("Failed to load groups:", errorMsg);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const createGroup = useCallback(
    async (group: Omit<ConnectionGroup, "id" | "created_at" | "updated_at">) => {
      setError(null);

      try {
        const created = await groupCommands.createGroup(group);
        setGroups((prev) => [...prev, created]);
        return created;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        throw err;
      }
    },
    []
  );

  const updateGroup = useCallback(
    async (
      id: string,
      updates: Partial<Omit<ConnectionGroup, "id" | "created_at" | "updated_at">>
    ) => {
      setError(null);

      try {
        const updated = await groupCommands.updateGroup(id, updates);
        setGroups((prev) =>
          prev.map((group) => (group.id === id ? updated : group))
        );
        return updated;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        throw err;
      }
    },
    []
  );

  const deleteGroup = useCallback(async (id: string) => {
    setError(null);

    try {
      await groupCommands.deleteGroup(id);
      setGroups((prev) => prev.filter((group) => group.id !== id));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      throw err;
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  return {
    groups,
    loading,
    error,
    loadGroups,
    createGroup,
    updateGroup,
    deleteGroup,
  };
}
