import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "ansql.snippets";

/** A user-defined SQL snippet, stored in localStorage and offered by the
 * completion provider alongside the built-in snippets. */
export interface UserSnippet {
  id: string;
  name: string;
  body: string;
  description?: string;
}

/** Synchronous, module-level read of the persisted snippets. Used by the
 * completion provider (not a React component). Tolerates a missing key or
 * corrupt JSON by returning an empty array. */
export function getUserSnippets(): UserSnippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed entries so a partially-corrupt store stays usable.
    return parsed.filter(
      (s): s is UserSnippet =>
        s &&
        typeof s.id === "string" &&
        typeof s.name === "string" &&
        typeof s.body === "string"
    );
  } catch {
    return [];
  }
}

/** Generate a reasonably-unique id without pulling in a dependency. */
function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** localStorage-backed user snippet library. Mirrors useSettings/useTheme:
 * state initialised from storage, persisted on change. */
export function useSnippets() {
  const [snippets, setSnippets] = useState<UserSnippet[]>(getUserSnippets);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
  }, [snippets]);

  /** Append a new snippet, assigning it a fresh id. */
  const add = useCallback((s: Omit<UserSnippet, "id">) => {
    setSnippets((prev) => [...prev, { ...s, id: makeId() }]);
  }, []);

  /** Merge a partial patch over the snippet with the given id. */
  const update = useCallback(
    (id: string, patch: Partial<Omit<UserSnippet, "id">>) => {
      setSnippets((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
      );
    },
    []
  );

  /** Remove the snippet with the given id. */
  const remove = useCallback((id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { snippets, add, update, remove };
}
