import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, Table2, Eye, Copy, ArrowRightLeft, X, Trash2, AlertTriangle, Plus } from "lucide-react";
import type { TableInfo } from "../../types";

interface TableListViewProps {
  sessionId: string;
  database: string;
  getTables: (sessionId: string, database: string) => Promise<TableInfo[]>;
  /** Open a table's data (double-click a row). */
  onOpenTable: (table: string, schema?: string) => void;
  /** Copy the selected tables as a cross-DB clipboard source. */
  onCopyTables?: (tables: TableInfo[]) => void;
  /** Open the transfer wizard with the selected tables pre-selected. */
  onTransferTables?: (tables: TableInfo[]) => void;
  /**
   * Drop the selected tables/views. `force` ignores FK dependencies
   * (DROP … CASCADE on Postgres). Rejects with a message if any drop fails.
   */
  onDeleteTables?: (tables: TableInfo[], force: boolean) => Promise<void>;
  /** Open the table designer in create mode. */
  onNewTable?: () => void;
  /** Bumped by the parent to force a re-fetch (e.g. after a designer apply). */
  refreshKey?: number;
}

const isView = (t: TableInfo) => (t.table_type ?? "").toLowerCase().includes("view");
const keyOf = (t: TableInfo) => `${t.schema ?? ""}.${t.name}`;

/**
 * Right-panel object list: every table/view in a database, shown when the user
 * clicks the "Tables" node in the explorer tree. Rows are multi-selectable for
 * Copy (cross-DB clipboard) / Transfer; double-click a row opens its data.
 */
export function TableListView({
  sessionId,
  database,
  getTables,
  onOpenTable,
  onCopyTables,
  onTransferTables,
  onDeleteTables,
  onNewTable,
  refreshKey,
}: TableListViewProps) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Pending delete confirmation: the objects the user asked to drop.
  const [confirmDelete, setConfirmDelete] = useState<TableInfo[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Force = ignore FK dependencies (DROP … CASCADE). Off by default since CASCADE
  // can also drop dependent objects (views, FKs) outside the selection.
  const [forceDelete, setForceDelete] = useState(false);

  const openDeleteConfirm = () => {
    setDeleteError(null);
    setForceDelete(false);
    setConfirmDelete(selectedTables);
  };

  const runDelete = async () => {
    if (!confirmDelete || !onDeleteTables) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteTables(confirmDelete, forceDelete);
      setConfirmDelete(null);
      setSelected(new Set());
      setReloadKey((k) => k + 1);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    getTables(sessionId, database)
      .then((t) => {
        if (!ignore) setTables(t);
      })
      .catch((e) => {
        if (!ignore) setError(String(e));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [sessionId, database, getTables, reloadKey, refreshKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? tables.filter((t) => t.name.toLowerCase().includes(q)) : tables;
  }, [tables, search]);

  const selectedTables = useMemo(
    () => tables.filter((t) => selected.has(keyOf(t))),
    [tables, selected]
  );

  const deleteSummary = useMemo(() => {
    const items = confirmDelete ?? [];
    const tableCount = items.filter((t) => !isView(t)).length;
    return { total: items.length, tables: tableCount, views: items.length - tableCount };
  }, [confirmDelete]);

  // Escape closes the delete dialog (unless a drop is in progress).
  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) setConfirmDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, deleting]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((t) => selected.has(keyOf(t)));

  const toggle = (t: TableInfo) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(t);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((t) => next.delete(keyOf(t)));
      else filtered.forEach((t) => next.add(keyOf(t)));
      return next;
    });

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Table2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{database}</span>
        <span className="text-xs text-muted-foreground">
          {loading ? "loading…" : `${filtered.length} object${filtered.length === 1 ? "" : "s"}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter…"
              className="w-40 rounded border border-border bg-background py-1 pl-7 pr-2 text-sm"
            />
          </div>
          {onNewTable && (
            <button
              onClick={onNewTable}
              className="flex items-center gap-1.5 rounded px-2 py-1.5 text-sm hover:bg-secondary"
              title="New Table"
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">New Table</span>
            </button>
          )}
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded p-1.5 hover:bg-secondary"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-4 py-1.5 text-sm">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <button
            onClick={() => onCopyTables?.(selectedTables)}
            className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-accent"
            title="Copy as a cross-DB transfer source (paste into another database)"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
          <button
            onClick={() => onTransferTables?.(selectedTables)}
            className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-accent"
            title="Open the data transfer wizard with these tables"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Transfer…
          </button>
          {onDeleteTables && (
            <button
              onClick={openDeleteConfirm}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-destructive hover:bg-destructive/10"
              title="Drop the selected tables/views (permanent)"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete…
            </button>
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-accent"
            title="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading tables…
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {tables.length === 0 ? "No tables in this database" : "No objects match the filter"}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-secondary/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    title="Select all"
                  />
                </th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Rows</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const k = keyOf(t);
                const isSel = selected.has(k);
                return (
                  <tr
                    key={k}
                    onDoubleClick={() => onOpenTable(t.name, t.schema ?? undefined)}
                    className={`cursor-pointer border-b border-border/50 hover:bg-accent ${
                      isSel ? "bg-primary/10" : ""
                    }`}
                    title="Double-click to open"
                  >
                    <td className="px-2 py-1.5" onDoubleClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(t)} />
                    </td>
                    <td className="px-4 py-1.5">
                      <span className="flex items-center gap-2">
                        {isView(t) ? (
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {t.name}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 text-muted-foreground">{t.table_type ?? "table"}</td>
                    <td className="px-4 py-1.5 text-right text-muted-foreground">
                      {t.row_count == null ? "—" : t.row_count.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirmation (destructive — DROP cannot be undone) */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in"
          onClick={() => !deleting && setConfirmDelete(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="flex max-h-[85vh] w-[32rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold leading-tight">
                  Delete {deleteSummary.total} {deleteSummary.total === 1 ? "object" : "objects"}?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Permanently dropped from{" "}
                  <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
                    {database}
                  </span>
                  . This can&apos;t be undone.
                </p>
              </div>
              <button
                onClick={() => !deleting && setConfirmDelete(null)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title="Close (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto p-5">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Objects
                </span>
                <span className="text-xs text-muted-foreground/70">
                  {[
                    deleteSummary.tables > 0 &&
                      `${deleteSummary.tables} table${deleteSummary.tables === 1 ? "" : "s"}`,
                    deleteSummary.views > 0 &&
                      `${deleteSummary.views} view${deleteSummary.views === 1 ? "" : "s"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <ul className="max-h-48 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                {confirmDelete.map((t) => (
                  <li key={keyOf(t)} className="flex items-center gap-2.5 px-3 py-2">
                    {isView(t) ? (
                      <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Table2 className="h-4 w-4 shrink-0 text-primary/70" />
                    )}
                    <span className="truncate font-mono text-[13px]">
                      {t.schema ? `${t.schema}.${t.name}` : t.name}
                    </span>
                    <span className="ml-auto shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {isView(t) ? "view" : "table"}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Force / CASCADE option */}
              <label
                className={`mt-4 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  forceDelete
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border hover:bg-secondary/50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={forceDelete}
                  onChange={(e) => setForceDelete(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-destructive"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">Ignore foreign-key dependencies</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Use{" "}
                    <code className="rounded bg-secondary px-1 py-0.5 font-mono">DROP … CASCADE</code>{" "}
                    so tables referenced by others can still be dropped.
                  </p>
                  {forceDelete && (
                    <div className="mt-2 flex items-start gap-1.5 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Also drops dependent objects (views, foreign keys) outside this selection.
                      </span>
                    </div>
                  )}
                </div>
              </label>

              {/* Errors */}
              {deleteError && (
                <div className="mt-4 overflow-hidden rounded-lg border border-destructive/40">
                  <div className="flex items-center gap-1.5 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Some objects couldn&apos;t be dropped
                  </div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {deleteError}
                  </pre>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="rounded-lg px-3.5 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runDelete}
                disabled={deleting}
                className="flex items-center gap-2 rounded-lg bg-destructive px-3.5 py-2 text-sm font-medium text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90 disabled:opacity-60"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {deleting ? "Deleting…" : `Delete ${deleteSummary.total}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
