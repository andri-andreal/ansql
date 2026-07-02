import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  Folder,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type { MongoApi } from "./types";

export interface MongoBrowserProps {
  api: MongoApi;
  onClose?: () => void;
}

/** Default page size for find queries. */
const DEFAULT_LIMIT = 20;

/** One line in the raw runCommand console. */
interface ConsoleLine {
  kind: "command" | "reply" | "error";
  text: string;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Pretty-print a parsed document; falls back to String on any failure. */
function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Validate a JSON string, returning a parse error message or null when valid. */
function jsonError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return errText(e);
  }
}

/** Extract a document's `_id` (raw, possibly extended JSON) for replace/delete filters. */
function docId(doc: unknown): unknown {
  if (doc && typeof doc === "object" && "_id" in doc) {
    return (doc as Record<string, unknown>)._id;
  }
  return undefined;
}

/** Build a filter JSON string that matches a single document by its `_id`. */
function idFilter(doc: unknown): string | null {
  const id = docId(doc);
  if (id === undefined) return null;
  return JSON.stringify({ _id: id });
}

export function MongoBrowser(props: MongoBrowserProps) {
  const { api } = props;

  // ── database list ──
  const [databases, setDatabases] = useState<string[]>([]);
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [dbsError, setDbsError] = useState<string | null>(null);
  const [db, setDb] = useState<string | null>(null);

  // ── collection list ──
  const [collections, setCollections] = useState<string[]>([]);
  const [loadingColls, setLoadingColls] = useState(false);
  const [collsError, setCollsError] = useState<string | null>(null);
  const [coll, setColl] = useState<string | null>(null);

  // ── query bar ──
  const [filter, setFilter] = useState("{}");
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [skip, setSkip] = useState(0);

  // ── find results ──
  const [docs, setDocs] = useState<unknown[]>([]);
  const [total, setTotal] = useState(0);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [hasQueried, setHasQueried] = useState(false);

  // ── document editor ──
  const [editorOpen, setEditorOpen] = useState(false);
  /** null = inserting a new document; otherwise editing an existing one. */
  const [editingDoc, setEditingDoc] = useState<unknown | null>(null);
  const [editorText, setEditorText] = useState("{}");
  const [savingDoc, setSavingDoc] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  // ── raw runCommand console ──
  const [showConsole, setShowConsole] = useState(false);
  const [commandInput, setCommandInput] = useState('{ "ping": 1 }');
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [runningCommand, setRunningCommand] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  const filterParseError = useMemo(() => jsonError(filter), [filter]);
  const editorParseError = useMemo(() => jsonError(editorText), [editorText]);
  const commandParseError = useMemo(() => jsonError(commandInput), [commandInput]);

  // Load databases on mount.
  const loadDatabases = useCallback(async () => {
    setLoadingDbs(true);
    setDbsError(null);
    try {
      const list = await api.listDatabases();
      setDatabases(list);
    } catch (e) {
      setDbsError(errText(e));
    } finally {
      setLoadingDbs(false);
    }
  }, [api]);

  useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  // Load collections whenever the selected database changes.
  const loadCollections = useCallback(
    async (database: string) => {
      setLoadingColls(true);
      setCollsError(null);
      try {
        const list = await api.listCollections(database);
        setCollections(list);
      } catch (e) {
        setCollsError(errText(e));
      } finally {
        setLoadingColls(false);
      }
    },
    [api]
  );

  useEffect(() => {
    if (db == null) {
      setCollections([]);
      return;
    }
    void loadCollections(db);
  }, [db, loadCollections]);

  // Reset results when database or collection changes.
  useEffect(() => {
    setDocs([]);
    setTotal(0);
    setHasQueried(false);
    setFindError(null);
    setSkip(0);
    setEditorOpen(false);
  }, [db, coll]);

  // Auto-scroll the console to the latest reply.
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ block: "end" });
  }, [consoleLines]);

  const runFind = useCallback(
    async (nextSkip: number) => {
      if (db == null || coll == null) return;
      const filterText = filter.trim() === "" ? "{}" : filter;
      if (jsonError(filterText)) {
        setFindError("Filter is not valid JSON.");
        return;
      }
      setFinding(true);
      setFindError(null);
      try {
        const res = await api.find(db, coll, filterText, limit, nextSkip);
        setDocs(res.docs);
        setTotal(res.total);
        setSkip(nextSkip);
        setHasQueried(true);
      } catch (e) {
        setFindError(errText(e));
      } finally {
        setFinding(false);
      }
    },
    [api, db, coll, filter, limit]
  );

  function onFindSubmit(e: React.FormEvent) {
    e.preventDefault();
    void runFind(0);
  }

  function openInsert() {
    setEditingDoc(null);
    setEditorText("{\n  \n}");
    setEditorError(null);
    setEditorOpen(true);
  }

  function openEdit(doc: unknown) {
    setEditingDoc(doc);
    setEditorText(pretty(doc));
    setEditorError(null);
    setEditorOpen(true);
  }

  async function handleSaveDoc() {
    if (db == null || coll == null) return;
    if (jsonError(editorText)) {
      setEditorError("Document is not valid JSON.");
      return;
    }
    setSavingDoc(true);
    setEditorError(null);
    try {
      if (editingDoc == null) {
        await api.insertOne(db, coll, editorText);
      } else {
        const filterForId = idFilter(editingDoc);
        if (filterForId == null) {
          throw new Error("Cannot replace a document without an _id field.");
        }
        await api.replaceOne(db, coll, filterForId, editorText);
      }
      setEditorOpen(false);
      setEditingDoc(null);
      await runFind(skip);
    } catch (e) {
      setEditorError(errText(e));
    } finally {
      setSavingDoc(false);
    }
  }

  async function handleDeleteDoc(doc: unknown, index: number) {
    if (db == null || coll == null) return;
    const filterForId = idFilter(doc);
    if (filterForId == null) {
      setFindError("Cannot delete a document without an _id field.");
      return;
    }
    setDeletingIndex(index);
    setFindError(null);
    try {
      await api.deleteOne(db, coll, filterForId);
      await runFind(skip);
    } catch (e) {
      setFindError(errText(e));
    } finally {
      setDeletingIndex(null);
    }
  }

  async function handleRunCommand(e: React.FormEvent) {
    e.preventDefault();
    if (db == null || runningCommand) return;
    const raw = commandInput.trim();
    if (!raw) return;
    if (jsonError(raw)) {
      setConsoleLines((prev) => [
        ...prev,
        { kind: "command", text: raw },
        { kind: "error", text: "Command is not valid JSON." },
      ]);
      return;
    }
    setConsoleLines((prev) => [...prev, { kind: "command", text: raw }]);
    setRunningCommand(true);
    try {
      const reply = await api.command(db, raw);
      setConsoleLines((prev) => [...prev, { kind: "reply", text: pretty(reply) }]);
    } catch (err) {
      setConsoleLines((prev) => [...prev, { kind: "error", text: errText(err) }]);
    } finally {
      setRunningCommand(false);
    }
  }

  const pageStart = total === 0 ? 0 : skip + 1;
  const pageEnd = Math.min(skip + docs.length, total);
  const canPrev = skip > 0;
  const canNext = skip + limit < total;

  return (
    <div className="relative flex h-full flex-col bg-background text-foreground">
      {/* ── Top bar: database selector + console toggle ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Database className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">DB</span>
        </div>
        <select
          value={db ?? ""}
          onChange={(e) => {
            setDb(e.target.value || null);
            setColl(null);
          }}
          disabled={loadingDbs}
          className="h-9 min-w-[160px] rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          title="Select database"
        >
          <option value="">{loadingDbs ? "Loading…" : "Select database"}</option>
          {databases.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void loadDatabases()}
          disabled={loadingDbs}
          className="flex h-9 items-center gap-1.5 rounded border border-border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          title="Refresh databases"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingDbs ? "animate-spin" : ""}`} />
          Refresh
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowConsole((v) => !v)}
            disabled={db == null}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40 ${
              showConsole
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary"
            }`}
            title="Toggle runCommand console"
          >
            <Terminal className="h-4 w-4" />
            Console
          </button>

          {props.onClose && (
            <button
              type="button"
              onClick={props.onClose}
              className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {dbsError && (
        <div className="m-3 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{dbsError}</span>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT: collection list */}
        <div className="flex w-[260px] min-w-[200px] flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Folder className="h-4 w-4 text-muted-foreground" />
              Collections
              {db != null && !loadingColls && (
                <span className="font-normal text-muted-foreground">
                  ({collections.length})
                </span>
              )}
            </h3>
            {db != null && (
              <button
                onClick={() => void loadCollections(db)}
                disabled={loadingColls}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                title="Refresh collections"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingColls ? "animate-spin" : ""}`} />
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            {db == null && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                <Database className="h-8 w-8 opacity-40" />
                <p>Select a database to list its collections.</p>
              </div>
            )}

            {db != null && loadingColls && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}

            {collsError && (
              <div className="m-3 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{collsError}</span>
              </div>
            )}

            {db != null && !loadingColls && !collsError && collections.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No collections</p>
                <p>This database has no collections.</p>
              </div>
            )}

            {collections.length > 0 && (
              <ul className="py-1">
                {collections.map((name) => {
                  const active = name === coll;
                  return (
                    <li key={name}>
                      <button
                        onClick={() => setColl(name)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                          active ? "bg-accent" : "hover:bg-accent/40"
                        }`}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                        <span className="min-w-0 flex-1 truncate font-mono text-sm">
                          {name}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT: query bar + document results */}
        <div className="flex min-w-0 flex-1 flex-col">
          {coll == null ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <FileText className="h-8 w-8 opacity-40" />
              <p>Select a collection to query its documents.</p>
            </div>
          ) : (
            <>
              {/* Query bar */}
              <form
                onSubmit={onFindSubmit}
                className="flex flex-col gap-2 border-b border-border p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    {coll}
                  </span>
                  <button
                    type="button"
                    onClick={openInsert}
                    className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
                    title="Insert a new document"
                  >
                    <Plus className="h-4 w-4" />
                    Insert
                  </button>
                </div>

                <textarea
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder='{ } — a JSON filter, e.g. { "name": "Ada" }'
                  spellCheck={false}
                  rows={2}
                  className={`w-full resize-y rounded border bg-background px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
                    filter.trim() !== "" && filterParseError
                      ? "border-destructive/60 focus:ring-destructive"
                      : "border-border"
                  }`}
                />
                {filter.trim() !== "" && filterParseError && (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Invalid JSON: {filterParseError}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Limit
                    <input
                      type="number"
                      min={1}
                      value={limit}
                      onChange={(e) =>
                        setLimit(Math.max(1, Number(e.target.value) || DEFAULT_LIMIT))
                      }
                      className="h-8 w-20 rounded border border-border bg-background px-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Skip
                    <input
                      type="number"
                      min={0}
                      value={skip}
                      onChange={(e) => setSkip(Math.max(0, Number(e.target.value) || 0))}
                      className="h-8 w-20 rounded border border-border bg-background px-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={finding || (filter.trim() !== "" && !!filterParseError)}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                  >
                    {finding ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Find
                  </button>
                </div>
              </form>

              {/* Result list */}
              <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-3">
                {findError && (
                  <div className="mb-3 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="break-words">{findError}</span>
                  </div>
                )}

                {!hasQueried && !finding && !findError && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                    <Search className="h-8 w-8 opacity-40" />
                    <p>Enter a filter and press Find to query documents.</p>
                  </div>
                )}

                {hasQueried && docs.length === 0 && !finding && !findError && (
                  <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">No documents</p>
                    <p>Nothing in this collection matches the filter.</p>
                  </div>
                )}

                {docs.length > 0 && (
                  <ul className="space-y-2">
                    {docs.map((doc, i) => (
                      <li
                        key={i}
                        className="overflow-hidden rounded border border-border bg-card/40"
                      >
                        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                          <span className="font-mono text-xs text-muted-foreground">
                            {docIdLabel(doc, skip + i)}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openEdit(doc)}
                              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary"
                              title="Edit document"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              onClick={() => void handleDeleteDoc(doc, i)}
                              disabled={deletingIndex === i}
                              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
                              title="Delete document"
                            >
                              {deletingIndex === i ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                              Delete
                            </button>
                          </div>
                        </div>
                        <pre className="overflow-auto scrollbar-thin px-3 py-2 font-mono text-xs leading-relaxed">
                          {pretty(doc)}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Pager */}
              {hasQueried && (
                <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {total === 0
                      ? "0 documents"
                      : `${pageStart}–${pageEnd} of ${total}`}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void runFind(Math.max(0, skip - limit))}
                      disabled={!canPrev || finding}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 transition-colors hover:bg-secondary disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Prev
                    </button>
                    <button
                      onClick={() => void runFind(skip + limit)}
                      disabled={!canNext || finding}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 transition-colors hover:bg-secondary disabled:opacity-40"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Document editor overlay ── */}
      {editorOpen && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-6">
          <div className="flex max-h-full w-[42rem] max-w-[90vw] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                {editingDoc == null ? (
                  <>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                    Insert document
                  </>
                ) : (
                  <>
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                    Edit document
                  </>
                )}
              </h3>
              <button
                onClick={() => setEditorOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary"
                title="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              <textarea
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
                spellCheck={false}
                rows={14}
                className={`h-full min-h-[260px] w-full resize-none rounded border bg-background p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
                  editorParseError
                    ? "border-destructive/60 focus:ring-destructive"
                    : "border-border"
                }`}
              />
              {editorParseError && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Invalid JSON: {editorParseError}
                </p>
              )}
              {editorError && (
                <div className="mt-2 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-words">{editorError}</span>
                </div>
              )}
              {editingDoc != null && idFilter(editingDoc) == null && (
                <p className="mt-2 text-xs text-muted-foreground">
                  This document has no <code className="font-mono">_id</code>; it cannot be
                  replaced.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
              <button
                onClick={() => setEditorOpen(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSaveDoc()}
                disabled={
                  savingDoc ||
                  !!editorParseError ||
                  (editingDoc != null && idFilter(editingDoc) == null)
                }
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                {savingDoc ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {editingDoc == null ? "Insert" : "Replace"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Raw runCommand console ── */}
      {showConsole && (
        <div className="flex h-64 shrink-0 flex-col border-t border-border bg-card/40">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              runCommand console
              {db && <span className="font-normal text-muted-foreground">· {db}</span>}
            </h3>
            <div className="flex items-center gap-1">
              {consoleLines.length > 0 && (
                <button
                  onClick={() => setConsoleLines([])}
                  className="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setShowConsole(false)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary"
                title="Hide console"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin px-3 py-2 font-mono text-xs">
            {consoleLines.length === 0 ? (
              <p className="text-muted-foreground">
                Type a JSON command (e.g.{" "}
                <span className="text-foreground">{'{ "ping": 1 }'}</span>) and press Run.
              </p>
            ) : (
              <div className="space-y-1">
                {consoleLines.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.kind === "command"
                        ? "text-foreground"
                        : line.kind === "error"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    <span className="select-none text-muted-foreground/50">
                      {line.kind === "command" ? "> " : "  "}
                    </span>
                    <span className="whitespace-pre-wrap break-all">{line.text}</span>
                  </div>
                ))}
                <div ref={consoleEndRef} />
              </div>
            )}
          </div>

          <form
            onSubmit={handleRunCommand}
            className="flex items-end gap-2 border-t border-border px-3 py-2"
          >
            <textarea
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder='{ "ping": 1 }'
              spellCheck={false}
              autoComplete="off"
              rows={2}
              className={`flex-1 resize-y rounded border bg-background px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
                commandInput.trim() !== "" && commandParseError
                  ? "border-destructive/60 focus:ring-destructive"
                  : "border-border"
              }`}
            />
            <button
              type="submit"
              disabled={
                runningCommand ||
                commandInput.trim() === "" ||
                !!commandParseError ||
                db == null
              }
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {runningCommand ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Terminal className="h-4 w-4" />
              )}
              Run
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** Short label for a document card header: its `_id` (extended-JSON aware) or its index. */
function docIdLabel(doc: unknown, index: number): string {
  const id = docId(doc);
  if (id === undefined) return `#${index}`;
  if (id && typeof id === "object" && "$oid" in (id as Record<string, unknown>)) {
    return `_id: ${(id as Record<string, unknown>).$oid}`;
  }
  if (typeof id === "string" || typeof id === "number" || typeof id === "boolean") {
    return `_id: ${id}`;
  }
  try {
    return `_id: ${JSON.stringify(id)}`;
  } catch {
    return `#${index}`;
  }
}
