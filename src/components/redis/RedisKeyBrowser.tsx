import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Database,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type { RedisApi, RedisKeyInfo, RedisValue } from "./types";

export interface RedisKeyBrowserProps {
  api: RedisApi;
  /** Number of selectable databases (0 .. dbCount-1). Defaults to 16. */
  dbCount?: number;
  onClose?: () => void;
}

/** How many keys to request per SCAN round-trip. */
const SCAN_COUNT = 200;

/** One line in the raw-command console. */
interface ConsoleLine {
  kind: "command" | "reply" | "error";
  text: string;
}

/** Color a Redis type badge by family. */
function typeBadgeClass(type: string): string {
  switch (type) {
    case "string":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
    case "hash":
      return "bg-purple-500/15 text-purple-600 dark:text-purple-400";
    case "list":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    case "set":
      return "bg-green-500/15 text-green-600 dark:text-green-400";
    case "zset":
      return "bg-pink-500/15 text-pink-600 dark:text-pink-400";
    default:
      return "bg-secondary text-muted-foreground";
  }
}

/** Human-readable TTL: -1 = no expiry, -2 = missing, else "Ns". */
function formatTtl(ttl: number): string {
  if (ttl === -1) return "no expiry";
  if (ttl === -2) return "—";
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m ${ttl % 60}s`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}h ${Math.floor((ttl % 3600) / 60)}m`;
  return `${Math.floor(ttl / 86400)}d ${Math.floor((ttl % 86400) / 3600)}h`;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function RedisKeyBrowser(props: RedisKeyBrowserProps) {
  const { api } = props;
  const dbCount = props.dbCount && props.dbCount > 0 ? props.dbCount : 16;

  const [db, setDb] = useState(0);
  const [pattern, setPattern] = useState("*");

  // ── key list / scan state ──
  const [keys, setKeys] = useState<RedisKeyInfo[]>([]);
  const [cursor, setCursor] = useState("0");
  /** "0" cursor after at least one scan means we have reached the end. */
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // ── selected-key detail state ──
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [value, setValue] = useState<RedisValue | null>(null);
  const [loadingValue, setLoadingValue] = useState(false);
  const [valueError, setValueError] = useState<string | null>(null);
  /** Working copy of the value, edited before Save. */
  const [draft, setDraft] = useState<RedisValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── ttl control ──
  const [ttlInput, setTtlInput] = useState("");
  const [settingTtl, setSettingTtl] = useState(false);
  const selectedInfo = useMemo(
    () => keys.find((k) => k.key === selectedKey) ?? null,
    [keys, selectedKey]
  );

  // ── raw command console ──
  const [showConsole, setShowConsole] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [runningCommand, setRunningCommand] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  const reachedEnd = scanned && cursor === "0";

  /** Run SCAN. `reset` clears the accumulated list (new pattern / db / db change). */
  const runScan = useCallback(
    async (reset: boolean) => {
      setScanning(true);
      setScanError(null);
      const startCursor = reset ? "0" : cursor;
      try {
        const res = await api.scan(db, pattern || "*", startCursor, SCAN_COUNT);
        setKeys((prev) => (reset ? res.keys : [...prev, ...res.keys]));
        setCursor(res.cursor);
        setScanned(true);
      } catch (e) {
        setScanError(errText(e));
      } finally {
        setScanning(false);
      }
    },
    [api, db, pattern, cursor]
  );

  // Changing the database resets the whole view.
  useEffect(() => {
    setKeys([]);
    setCursor("0");
    setScanned(false);
    setScanError(null);
    setSelectedKey(null);
    setValue(null);
    setDraft(null);
    setValueError(null);
  }, [db]);

  // Load the value of the selected key.
  useEffect(() => {
    if (selectedKey == null) return;
    let cancelled = false;
    setLoadingValue(true);
    setValueError(null);
    setValue(null);
    setDraft(null);
    api
      .get(db, selectedKey)
      .then((v) => {
        if (cancelled) return;
        setValue(v);
        setDraft(v);
      })
      .catch((e) => {
        if (!cancelled) setValueError(errText(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingValue(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, db, selectedKey]);

  // Keep the TTL input in sync with the selected key's current TTL.
  useEffect(() => {
    if (selectedInfo && selectedInfo.ttl >= 0) setTtlInput(String(selectedInfo.ttl));
    else setTtlInput("");
  }, [selectedInfo]);

  // Auto-scroll the console to the latest reply.
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ block: "end" });
  }, [consoleLines]);

  function onScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    void runScan(true);
  }

  /** Refresh the selected key's value + TTL by re-scanning its exact key. */
  const refreshSelected = useCallback(
    async (key: string) => {
      try {
        const res = await api.scan(db, key, "0", 1);
        const found = res.keys.find((k) => k.key === key) ?? res.keys[0];
        if (found) {
          setKeys((prev) => prev.map((k) => (k.key === key ? found : k)));
        }
      } catch {
        // Non-fatal: the value reload below is what matters.
      }
    },
    [api, db]
  );

  async function handleSave() {
    if (selectedKey == null || draft == null || draft.type === "none") return;
    setSaving(true);
    setValueError(null);
    try {
      await api.set(db, selectedKey, draft);
      const fresh = await api.get(db, selectedKey);
      setValue(fresh);
      setDraft(fresh);
      await refreshSelected(selectedKey);
    } catch (e) {
      setValueError(errText(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (selectedKey == null) return;
    setDeleting(true);
    setValueError(null);
    try {
      await api.del(db, selectedKey);
      setKeys((prev) => prev.filter((k) => k.key !== selectedKey));
      setSelectedKey(null);
      setValue(null);
      setDraft(null);
    } catch (e) {
      setValueError(errText(e));
    } finally {
      setDeleting(false);
    }
  }

  async function handleSetTtl() {
    if (selectedKey == null) return;
    const secs = Number(ttlInput);
    if (!Number.isFinite(secs)) return;
    setSettingTtl(true);
    setValueError(null);
    try {
      await api.expire(db, selectedKey, Math.trunc(secs));
      await refreshSelected(selectedKey);
    } catch (e) {
      setValueError(errText(e));
    } finally {
      setSettingTtl(false);
    }
  }

  async function handleRunCommand(e: React.FormEvent) {
    e.preventDefault();
    const raw = commandInput.trim();
    if (!raw || runningCommand) return;
    const args = tokenizeCommand(raw);
    setConsoleLines((prev) => [...prev, { kind: "command", text: raw }]);
    setCommandInput("");
    setRunningCommand(true);
    try {
      const reply = await api.command(db, args);
      setConsoleLines((prev) => [
        ...prev,
        { kind: "reply", text: stringifyReply(reply) },
      ]);
    } catch (err) {
      setConsoleLines((prev) => [...prev, { kind: "error", text: errText(err) }]);
    } finally {
      setRunningCommand(false);
    }
  }

  const dirty = useMemo(
    () => draft != null && value != null && !valuesEqual(draft, value),
    [draft, value]
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* ── Top bar: db selector + pattern + scan ── */}
      <form
        onSubmit={onScanSubmit}
        className="flex flex-wrap items-center gap-2 border-b border-border p-3"
      >
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Database className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">DB</span>
        </div>
        <select
          value={db}
          onChange={(e) => setDb(Number(e.target.value))}
          className="h-9 rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          title="Select database"
        >
          {Array.from({ length: dbCount }, (_, i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>

        <div className="relative ml-1 flex min-w-[180px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="key pattern, e.g. user:*"
            spellCheck={false}
            className="h-9 w-full rounded border border-border bg-background pl-8 pr-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <button
          type="submit"
          disabled={scanning}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Scan
        </button>

        <button
          type="button"
          onClick={() => setShowConsole((v) => !v)}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
            showConsole
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary"
          }`}
          title="Toggle command console"
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
      </form>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT: key list */}
        <div className="flex w-[40%] min-w-[280px] flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              Keys
              {scanned && (
                <span className="font-normal text-muted-foreground">
                  ({keys.length}
                  {reachedEnd ? "" : "+"})
                </span>
              )}
            </h3>
            {scanned && (
              <button
                onClick={() => void runScan(true)}
                disabled={scanning}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                title="Re-scan from the start"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
                Refresh
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            {scanError && (
              <div className="m-3 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{scanError}</span>
              </div>
            )}

            {!scanned && !scanning && !scanError && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                <Search className="h-8 w-8 opacity-40" />
                <p>Enter a pattern and press Scan to browse keys.</p>
              </div>
            )}

            {scanned && keys.length === 0 && !scanning && !scanError && (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No keys</p>
                <p>Nothing in db {db} matches this pattern.</p>
              </div>
            )}

            {keys.length > 0 && (
              <ul className="py-1">
                {keys.map((k) => {
                  const active = k.key === selectedKey;
                  return (
                    <li key={k.key}>
                      <button
                        onClick={() => setSelectedKey(k.key)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                          active ? "bg-accent" : "hover:bg-accent/40"
                        }`}
                      >
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${typeBadgeClass(
                            k.type
                          )}`}
                        >
                          {k.type}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-sm">
                          {k.key}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                          {formatTtl(k.ttl)}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {keys.length > 0 && !reachedEnd && (
              <div className="px-3 pb-3 pt-1">
                <button
                  onClick={() => void runScan(false)}
                  disabled={scanning}
                  className="flex w-full items-center justify-center gap-2 rounded border border-border py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                >
                  {scanning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Load more
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: detail panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedKey == null ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <KeyRound className="h-8 w-8 opacity-40" />
              <p>Select a key to inspect and edit its value.</p>
            </div>
          ) : (
            <>
              {/* Detail header */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                {selectedInfo && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${typeBadgeClass(
                      selectedInfo.type
                    )}`}
                  >
                    {selectedInfo.type}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
                  {selectedKey}
                </span>
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || !dirty || draft?.type === "none"}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                  title="Save value"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save
                </button>
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
                  title="Delete key"
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Delete
                </button>
              </div>

              {/* TTL control */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/40 px-4 py-2 text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  TTL
                </span>
                <span className="tabular-nums text-foreground">
                  {selectedInfo ? formatTtl(selectedInfo.ttl) : "—"}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <input
                    type="number"
                    min={-1}
                    value={ttlInput}
                    onChange={(e) => setTtlInput(e.target.value)}
                    placeholder="seconds"
                    className="h-7 w-24 rounded border border-border bg-background px-2 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                    title="-1 to persist (remove expiry)"
                  />
                  <button
                    onClick={() => void handleSetTtl()}
                    disabled={settingTtl || ttlInput.trim() === ""}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                  >
                    {settingTtl ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Clock className="h-3.5 w-3.5" />
                    )}
                    Set TTL
                  </button>
                </div>
              </div>

              {/* Value body */}
              <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-4">
                {loadingValue && (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading value…
                  </div>
                )}

                {!loadingValue && valueError && (
                  <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="break-words">{valueError}</span>
                  </div>
                )}

                {!loadingValue && !valueError && draft && (
                  <ValueEditor value={draft} onChange={setDraft} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Raw command console ── */}
      {showConsole && (
        <div className="flex h-56 shrink-0 flex-col border-t border-border bg-card/40">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              Command console
              <span className="font-normal text-muted-foreground">· db {db}</span>
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
                Type a command (e.g. <span className="text-foreground">PING</span> or{" "}
                <span className="text-foreground">GET mykey</span>) and press Enter.
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
            className="flex items-center gap-2 border-t border-border px-3 py-2"
          >
            <span className="select-none font-mono text-sm text-muted-foreground">&gt;</span>
            <input
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="raw command"
              spellCheck={false}
              autoComplete="off"
              className="h-8 flex-1 rounded border border-border bg-background px-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={runningCommand || commandInput.trim() === ""}
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

/** Type-aware editor for the selected value's draft. */
function ValueEditor({
  value,
  onChange,
}: {
  value: RedisValue;
  onChange: (v: RedisValue) => void;
}) {
  switch (value.type) {
    case "string":
      return (
        <textarea
          value={value.value}
          onChange={(e) => onChange({ type: "string", value: e.target.value })}
          spellCheck={false}
          className="h-full min-h-[160px] w-full resize-none rounded border border-border bg-background p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      );

    case "hash":
      return (
        <EntriesTable
          rows={value.entries}
          leftLabel="Field"
          rightLabel="Value"
          rightType="text"
          onChange={(entries) => onChange({ type: "hash", entries })}
        />
      );

    case "zset":
      return (
        <EntriesTable
          rows={value.entries.map(([m, s]) => [m, String(s)])}
          leftLabel="Member"
          rightLabel="Score"
          rightType="number"
          onChange={(rows) =>
            onChange({
              type: "zset",
              entries: rows.map(([m, s]) => [m, Number(s) || 0]),
            })
          }
        />
      );

    case "list":
      return (
        <ItemsList
          items={value.items}
          label="Items"
          ordered
          onChange={(items) => onChange({ type: "list", items })}
        />
      );

    case "set":
      return (
        <ItemsList
          items={value.members}
          label="Members"
          ordered={false}
          onChange={(members) => onChange({ type: "set", members })}
        />
      );

    default:
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          This key has no value (it may have expired).
        </div>
      );
  }
}

/** Editable two-column table for hash fields and zset members. */
function EntriesTable({
  rows,
  leftLabel,
  rightLabel,
  rightType,
  onChange,
}: {
  rows: [string, string][];
  leftLabel: string;
  rightLabel: string;
  rightType: "text" | "number";
  onChange: (rows: [string, string][]) => void;
}) {
  function update(i: number, side: 0 | 1, v: string) {
    const next = rows.map((r) => [...r] as [string, string]);
    next[i][side] = v;
    onChange(next);
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...rows, ["", ""]]);
  }

  return (
    <div className="overflow-hidden rounded border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-secondary/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="border-b border-border px-3 py-1.5">{leftLabel}</th>
            <th className="border-b border-border px-3 py-1.5">{rightLabel}</th>
            <th className="w-9 border-b border-border px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-3 text-center text-xs text-muted-foreground">
                Empty
              </td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-accent/30">
              <td className="border-b border-border px-2 py-1">
                <input
                  value={row[0]}
                  onChange={(e) => update(i, 0, e.target.value)}
                  spellCheck={false}
                  className="w-full rounded bg-transparent px-1 py-1 font-mono text-sm focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </td>
              <td className="border-b border-border px-2 py-1">
                <input
                  type={rightType}
                  value={row[1]}
                  onChange={(e) => update(i, 1, e.target.value)}
                  spellCheck={false}
                  className="w-full rounded bg-transparent px-1 py-1 font-mono text-sm focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </td>
              <td className="border-b border-border px-2 py-1 text-center">
                <button
                  onClick={() => remove(i)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Remove row"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={add}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary"
      >
        <Plus className="h-3.5 w-3.5" />
        Add row
      </button>
    </div>
  );
}

/** Editable list of strings for list (ordered) and set (unordered) values. */
function ItemsList({
  items,
  label,
  ordered,
  onChange,
}: {
  items: string[];
  label: string;
  ordered: boolean;
  onChange: (items: string[]) => void;
}) {
  function update(i: number, v: string) {
    const next = [...items];
    next[i] = v;
    onChange(next);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, ""]);
  }

  return (
    <div className="overflow-hidden rounded border border-border">
      <div className="flex items-center justify-between bg-secondary/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        <span className="font-normal lowercase tabular-nums text-muted-foreground/70">
          {items.length} {items.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      <ul>
        {items.length === 0 && (
          <li className="px-3 py-3 text-center text-xs text-muted-foreground">Empty</li>
        )}
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 border-b border-border px-2 py-1 hover:bg-accent/30">
            {ordered && (
              <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground/60">
                {i}
              </span>
            )}
            <input
              value={item}
              onChange={(e) => update(i, e.target.value)}
              spellCheck={false}
              className="flex-1 rounded bg-transparent px-1 py-1 font-mono text-sm focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={() => remove(i)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="Remove item"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={add}
        className="flex w-full items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary"
      >
        <Plus className="h-3.5 w-3.5" />
        Add {ordered ? "item" : "member"}
      </button>
    </div>
  );
}

// ── helpers ──

/** Structural equality for two Redis values (cheap; values are small in the UI). */
function valuesEqual(a: RedisValue, b: RedisValue): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "string":
      return a.value === (b as { value: string }).value;
    case "list":
      return arrEq(a.items, (b as { items: string[] }).items);
    case "set":
      return arrEq(a.members, (b as { members: string[] }).members);
    case "hash":
      return pairsEq(a.entries, (b as { entries: [string, string][] }).entries);
    case "zset":
      return pairsEq(a.entries, (b as { entries: [string, number][] }).entries);
    default:
      return true;
  }
}

function arrEq(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function pairsEq<T extends string | number>(
  a: [string, T][],
  b: [string, T][]
): boolean {
  return a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
}

/**
 * Split a raw command line into argv, honoring single/double quotes so values
 * with spaces survive (e.g. `SET k "hello world"`).
 */
function tokenizeCommand(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === " " || ch === "\t") {
      if (has) {
        out.push(cur);
        cur = "";
        has = false;
      }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/** Render a raw command reply (any JSON-ish value) as readable text. */
function stringifyReply(reply: unknown): string {
  if (reply == null) return "(nil)";
  if (typeof reply === "string") return reply;
  if (typeof reply === "number" || typeof reply === "boolean") return String(reply);
  try {
    return JSON.stringify(reply, null, 2);
  } catch {
    return String(reply);
  }
}
