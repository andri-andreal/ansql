// useActionJournal — the "Time Machine" undo stack.
//
// Persists every reversible action (its forward + inverse statements) to the
// local SQLite journal and replays the inverse/forward batch against a live
// session to undo/redo. The stack is LIFO: undoLast() rewinds the most recent
// still-applied action for a connection.
//
// recordAction is exposed to deep mutation sites (the data grid, importers,
// sync) through JournalRecorderContext so they don't need prop-drilling.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { journalCommands } from "../lib/tauri-commands";
import { useToast } from "../components/ui";
import type {
  ActionJournalEntry,
  NewActionJournalEntry,
  QueryResult,
  Statement,
} from "../types";

export type RecordAction = (
  spec: NewActionJournalEntry,
) => Promise<ActionJournalEntry | null>;

/** Outcome of replaying an inverse (undo) or forward (redo) batch. */
export interface JournalRunResult {
  ok: boolean;
  reason?: "no-session" | "wrong-status" | "parse" | "error";
  error?: string;
  /** Statements that matched 0 rows — a conflict signal (row changed elsewhere). */
  noop?: number;
  total?: number;
}

interface Deps {
  commitChanges: (sessionId: string, statements: Statement[]) => Promise<QueryResult[]>;
  /** Resolve a live session for a journal entry's connection (null if none open). */
  resolveSessionId: (
    connectionId: string | undefined,
    database: string | undefined,
  ) => string | null;
}

export function useActionJournal({ commitChanges, resolveSessionId }: Deps) {
  const toast = useToast();
  const [entries, setEntries] = useState<ActionJournalEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // Always read the latest entries from this ref so recordAction's supersede
  // logic doesn't race with concurrent state updates.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const refresh = useCallback(async (connectionId?: string) => {
    try {
      // The backend returns every entry; we hide "superseded" ones in the UI.
      setEntries(await journalCommands.list(connectionId));
    } catch (err) {
      console.error("Failed to load action journal:", err);
    }
  }, []);

  /**
   * Record a new reversible action. Surfaces a confirmation toast with an
   * "Undo" affordance, and supersedes any "undone" entries on the same
   * connection so the standard editor behavior (new edit clears redo) holds.
   */
  const recordAction = useCallback<RecordAction>(async (spec) => {
    let entry: ActionJournalEntry;
    try {
      entry = await journalCommands.record(spec);
    } catch (err) {
      console.error("Failed to record action:", err);
      toast.error("Time Machine: could not record this action (storage error).");
      return null;
    }

    // Compute which existing entries to supersede from the latest state.
    const toSupersede = entry.connection_id
      ? entriesRef.current.filter(
          (e) =>
            e.status === "undone" &&
            e.connection_id === entry.connection_id,
        )
      : [];
    const supersedeIds = new Set(toSupersede.map((e) => e.id));

    setEntries((prev) => {
      const withoutDup = prev.filter((e) => e.id !== entry.id);
      return [
        entry,
        ...withoutDup.map((e) =>
          supersedeIds.has(e.id)
            ? { ...e, status: "superseded" as const }
            : e,
        ),
      ];
    });

    // Fire-and-forget; the DB catches up. Failures are logged but not surfaced
    // because the local UI has already moved on.
    if (toSupersede.length > 0) {
      void Promise.all(
        toSupersede.map((e) =>
          journalCommands.setStatus(e.id, "superseded").catch((err) => {
            console.error("Failed to supersede old journal entry:", err);
          }),
        ),
      );
    }

    // Confirmation toast — short, with the shortcut hint. Stays out of the
    // way but tells the user the change is reversible.
    toast.success(`Time Machine · ${entry.label}  (Ctrl+Alt+Z to undo)`);
    return entry;
  }, [toast]);

  const run = useCallback(
    async (entry: ActionJournalEntry, direction: "undo" | "redo"): Promise<JournalRunResult> => {
      const expected = direction === "undo" ? "applied" : "undone";
      if (entry.status !== expected) return { ok: false, reason: "wrong-status" };

      const sessionId = resolveSessionId(entry.connection_id, entry.database);
      if (!sessionId) return { ok: false, reason: "no-session" };

      let statements: Statement[];
      try {
        statements = JSON.parse(direction === "undo" ? entry.inverse_sql : entry.forward_sql);
      } catch {
        return { ok: false, reason: "parse" };
      }

      setBusy(true);
      try {
        const results = statements.length ? await commitChanges(sessionId, statements) : [];
        const noop = results.filter((r) => r.affected_rows === 0).length;
        const newStatus = direction === "undo" ? "undone" : "applied";
        await journalCommands.setStatus(entry.id, newStatus);
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, status: newStatus } : e)),
        );
        // Nudge any open data grid for this session+table to reload from the DB.
        // Scoping by table is critical: an undo on Table A must NOT wipe the
        // user's unsaved edits on Table B in the same session.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("ansql:data-changed", {
              detail: { sessionId, table: entry.table ?? undefined },
            }),
          );
        }
        return { ok: true, noop, total: statements.length };
      } catch (err) {
        return { ok: false, reason: "error", error: err instanceof Error ? err.message : String(err) };
      } finally {
        setBusy(false);
      }
    },
    [commitChanges, resolveSessionId],
  );

  const undo = useCallback((entry: ActionJournalEntry) => run(entry, "undo"), [run]);
  const redo = useCallback((entry: ActionJournalEntry) => run(entry, "redo"), [run]);

  /** Undo the most recent still-applied action (optionally scoped to a connection). */
  const undoLast = useCallback(
    (connectionId?: string): Promise<JournalRunResult> | null => {
      // `entries` is created_at DESC, so the first applied match is the newest.
      const target = entries.find(
        (e) => e.status === "applied" && (!connectionId || e.connection_id === connectionId),
      );
      return target ? run(target, "undo") : null;
    },
    [entries, run],
  );

  /** Redo the most recent still-undone action (optionally scoped to a connection). */
  const redoLast = useCallback(
    (connectionId?: string): Promise<JournalRunResult> | null => {
      // `entries` is created_at DESC, so the first undone match is the newest.
      const target = entries.find(
        (e) => e.status === "undone" && (!connectionId || e.connection_id === connectionId),
      );
      return target ? run(target, "redo") : null;
    },
    [entries, run],
  );

  const clear = useCallback(async (connectionId?: string) => {
    try {
      await journalCommands.clear(connectionId);
      setEntries((prev) =>
        connectionId ? prev.filter((e) => e.connection_id !== connectionId) : [],
      );
    } catch (err) {
      console.error("Failed to clear action journal:", err);
    }
  }, []);

  // Visible entries: hide "superseded" (dead redo) from the timeline UI. The
  // underlying data is still in storage; we just don't surface it.
  const visibleEntries = useMemo(
    () => entries.filter((e) => e.status !== "superseded"),
    [entries],
  );

  // Count of currently undoable entries (for the header badge).
  const undoableCount = useMemo(
    () => entries.filter((e) => e.status === "applied").length,
    [entries],
  );

  return {
    entries: visibleEntries,
    rawEntries: entries,
    undoableCount,
    busy,
    refresh,
    recordAction,
    undo,
    redo,
    undoLast,
    redoLast,
    clear,
  };
}

export type ActionJournalApi = ReturnType<typeof useActionJournal>;

// --- Recorder context (for deep mutation sites) ---------------------------

const JournalRecorderContext = createContext<RecordAction | null>(null);

export const JournalRecorderProvider = JournalRecorderContext.Provider;

/**
 * Record-only handle for components deep in the tree (data grid, importers).
 * Returns null when no provider is mounted, so callers stay back-compatible.
 */
export function useJournalRecorder(): RecordAction | null {
  return useContext(JournalRecorderContext);
}
