// TimelinePanel — the "Time Machine" UI. Lists journaled actions newest-first
// with per-entry Undo (applied → undone) / Redo (undone → applied). Each entry
// shows whether it is exactly reversible (Tier 1) or best-effort (Tier 2), and
// a conflict warning is surfaced when an inverse/forward batch matches no rows
// (the data changed since the action ran).

import { useEffect, useMemo, useState } from "react";
import { History, Undo2, Redo2, Trash2, ShieldCheck, ShieldAlert, Filter } from "lucide-react";
import { Modal, Tooltip, ConfirmDialog, useToast, Dropdown, DropdownItem } from "../ui";
import type { ActionJournalApi, JournalRunResult } from "../../hooks/useActionJournal";
import type { ActionJournalEntry, Connection } from "../../types";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const ALL = "__all__" as const;

export function TimelinePanel({
  open,
  onClose,
  journal,
  connections,
  activeConnectionId,
}: {
  open: boolean;
  onClose: () => void;
  journal: ActionJournalApi;
  connections: Connection[];
  activeConnectionId: string | null;
}) {
  const toast = useToast();
  const [clearRequested, setClearRequested] = useState(false);
  const [filter, setFilter] = useState<string>(ALL);

  // Reset filter to "all" when the panel is reopened (don't carry a stale
  // filter from a previous session that no longer exists).
  useEffect(() => {
    if (open) {
      setFilter(ALL);
      void journal.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Apply the connection filter locally. The backend already returns every
  // entry; filtering here avoids a round-trip on each dropdown change.
  const filteredEntries = useMemo(() => {
    if (filter === ALL) return journal.entries;
    return journal.entries.filter((e) => e.connection_id === filter);
  }, [journal.entries, filter]);

  const filterLabel = useMemo(() => {
    if (filter === ALL) return "All connections";
    const conn = connections.find((c) => c.id === filter);
    return conn?.name ?? "Unknown";
  }, [filter, connections]);

  const report = (r: JournalRunResult, verb: "Undone" | "Redone") => {
    if (r.ok) {
      if (r.noop && r.noop > 0) {
        toast.warning(`${verb}, but ${r.noop} statement(s) matched no rows — the data may have changed since.`);
      } else {
        toast.success(`${verb} successfully`);
      }
    } else if (r.reason === "no-session") {
      toast.error("Open a connection to that database first.");
    } else if (r.reason === "wrong-status") {
      toast.info("That action's state changed — refresh the timeline.");
    } else {
      toast.error(`Failed: ${r.error ?? r.reason}`);
    }
  };

  const onUndo = async (entry: ActionJournalEntry) => report(await journal.undo(entry), "Undone");
  const onRedo = async (entry: ActionJournalEntry) => report(await journal.redo(entry), "Redone");

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          Time Machine
        </span>
      }
      headerActions={
        <>
          {/* Connection filter — keeps the list focused on what the user is
              currently working on, or "all" for cross-connection audit. */}
          <Dropdown
            placement="bottom-end"
            trigger={
              <button
                type="button"
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                aria-label={`Filter by connection: ${filterLabel}`}
              >
                <Filter className="w-3.5 h-3.5" />
                <span className="max-w-[140px] truncate">{filterLabel}</span>
              </button>
            }
          >
            {(close) => (
              <>
                <DropdownItem
                  onClick={() => {
                    setFilter(ALL);
                    close();
                  }}
                >
                  <span className={filter === ALL ? "font-semibold text-primary" : ""}>
                    All connections
                  </span>
                </DropdownItem>
                {connections.length > 0 && (
                  <div className="my-1 border-t border-border" />
                )}
                {connections.map((c) => (
                  <DropdownItem
                    key={c.id}
                    onClick={() => {
                      setFilter(c.id);
                      close();
                    }}
                  >
                    <span className={filter === c.id ? "font-semibold text-primary" : ""}>
                      {c.name}
                      {c.id === activeConnectionId && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          active
                        </span>
                      )}
                    </span>
                  </DropdownItem>
                ))}
              </>
            )}
          </Dropdown>
          {journal.entries.length > 0 && (
            <button
              type="button"
              onClick={() => setClearRequested(true)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </>
      }
    >
      {filteredEntries.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {journal.entries.length === 0
            ? "No reversible actions yet. Edits you commit in the data grid, and single-table raw UPDATE / DELETE in the query editor, will appear here and can be rolled back."
            : "No actions on this connection. Switch the filter to see entries from other connections."}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filteredEntries.map((entry) => {
            const undone = entry.status === "undone";
            return (
              <li
                key={entry.id}
                className={`flex items-center gap-3 rounded-md border border-border px-3 py-2 ${
                  undone ? "opacity-60" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium truncate ${undone ? "line-through" : ""}`}>
                      {entry.label}
                    </span>
                    <TierBadge tier={entry.tier} />
                    {undone && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">undone</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatTime(entry.created_at)}
                    {typeof entry.affected_rows === "number" && ` · ${entry.affected_rows} row(s)`}
                    {entry.database && ` · ${entry.database}`}
                    {filter === ALL && entry.connection_id && (
                      <ConnectionTag connectionId={entry.connection_id} connections={connections} />
                    )}
                  </div>
                </div>
                {undone ? (
                  <button
                    type="button"
                    disabled={journal.busy}
                    onClick={() => void onRedo(entry)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-primary hover:bg-primary/10 disabled:opacity-40 transition-colors"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                    Redo
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={journal.busy}
                    onClick={() => void onUndo(entry)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-foreground hover:bg-accent disabled:opacity-40 transition-colors"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    Undo
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={clearRequested}
        title="Clear Time Machine history?"
        message="This permanently deletes every recorded action. You won't be able to undo or redo anything on the timeline anymore."
        confirmLabel="Clear history"
        cancelLabel="Keep"
        danger
        onConfirm={() => {
          setClearRequested(false);
          void journal.clear();
        }}
        onCancel={() => setClearRequested(false)}
      />
    </Modal>
  );
}

function ConnectionTag({
  connectionId,
  connections,
}: {
  connectionId: string;
  connections: Connection[];
}) {
  const conn = connections.find((c) => c.id === connectionId);
  if (!conn) return null;
  return <> · {conn.name}</>;
}

function TierBadge({ tier }: { tier: number }) {
  if (tier === 1) {
    return (
      <Tooltip content="Tier 1 — exactly reversible: every change is journaled with its inverse and can be rolled back precisely.">
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-green-500/15 text-green-600 dark:text-green-400">
          <ShieldCheck className="w-3 h-3" />
          Reversible
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Tier 2 — best-effort: the rows this statement would touch were snapshotted (capped at 1,000) and used to build a restore batch. Aliased or multi-table statements are skipped.">
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <ShieldAlert className="w-3 h-3" />
        Best-effort
      </span>
    </Tooltip>
  );
}
