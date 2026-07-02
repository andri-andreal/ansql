import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Skull,
  X,
} from "lucide-react";
import type { Dialect, QueryResult } from "../../types";
import {
  killQuery,
  processListQuery,
  statusQuery,
  variablesQuery,
} from "../../lib/serverMonitor";
import { useTranslation } from "../../i18n";

export interface ServerMonitorViewProps {
  sessionId: string;
  dialect: Dialect;
  executeQuery: (sessionId: string, sql: string) => Promise<QueryResult>;
  onClose?: () => void;
}

type Tab = "processes" | "status" | "variables";

const TABS: { id: Tab; labelKey: string }[] = [
  { id: "processes", labelKey: "io.processes" },
  { id: "status", labelKey: "io.status" },
  { id: "variables", labelKey: "io.variables" },
];

/** Column holding the killable id, per dialect. */
const ID_COLUMN: Record<Dialect, string> = {
  mysql: "Id",
  postgres: "pid",
  sqlite: "",
  sqlserver: "session_id",
};

/** Auto-refresh interval for the Processes tab (ms). */
const AUTO_REFRESH_MS = 3000;

/**
 * Server Monitor: a read-only window onto the connected server's live process
 * list plus its status counters and configuration variables. The Processes tab
 * can auto-refresh and offers a per-row Kill action; Status / Variables are
 * one-shot snapshots fetched on demand. SQLite has no server surface, so the
 * whole view renders a "not supported" notice.
 */
export function ServerMonitorView({
  sessionId,
  dialect,
  executeQuery,
  onClose,
}: ServerMonitorViewProps) {
  const { t } = useTranslation();
  const supported = dialect !== "sqlite";

  const [tab, setTab] = useState<Tab>("processes");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  /** Process id currently being killed (disables its row button). */
  const [killing, setKilling] = useState<string | null>(null);

  // Guards against an out-of-order fetch (a slow earlier request resolving after
  // a newer one) clobbering the displayed result.
  const reqRef = useRef(0);

  const queryForTab = useCallback(
    (which: Tab): string => {
      switch (which) {
        case "processes":
          return processListQuery(dialect);
        case "status":
          return statusQuery(dialect);
        case "variables":
          return variablesQuery(dialect);
      }
    },
    [dialect]
  );

  const load = useCallback(
    async (which: Tab, opts?: { silent?: boolean }) => {
      const sql = queryForTab(which);
      if (!sql) return;
      const req = ++reqRef.current;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const res = await executeQuery(sessionId, sql);
        if (req !== reqRef.current) return; // superseded
        setResult(res);
      } catch (e) {
        if (req !== reqRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setResult(null);
      } finally {
        if (req === reqRef.current && !opts?.silent) setLoading(false);
      }
    },
    [executeQuery, sessionId, queryForTab]
  );

  // Fetch when the active tab changes (or on mount). Clears the previous tab's
  // result so we don't briefly show stale columns from another query.
  useEffect(() => {
    if (!supported) return;
    setResult(null);
    void load(tab);
  }, [tab, supported, load]);

  // Auto-refresh only applies to the Processes tab (status/variables are static).
  useEffect(() => {
    if (!supported || !autoRefresh || tab !== "processes") return;
    const handle = setInterval(() => {
      void load("processes", { silent: true });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(handle);
  }, [autoRefresh, tab, supported, load]);

  const handleKill = useCallback(
    async (id: string) => {
      const sql = killQuery(dialect, id);
      if (!sql) return;
      setKilling(id);
      setError(null);
      try {
        await executeQuery(sessionId, sql);
        await load("processes", { silent: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setKilling((cur) => (cur === id ? null : cur));
      }
    },
    [dialect, executeQuery, sessionId, load]
  );

  const idColumn = ID_COLUMN[dialect];
  const showKill = tab === "processes" && !!idColumn;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t("io.serverMonitor")}</h2>
        <span className="text-xs text-muted-foreground">{dialect}</span>

        {supported && (
          <div className="ml-auto flex items-center gap-2">
            {tab === "processes" && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {t("io.autoRefresh")}
              </label>
            )}
            <button
              onClick={() => void load(tab)}
              disabled={loading}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
              title={t("io.refresh")}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t("io.refresh")}
            </button>
          </div>
        )}

        {onClose && (
          <button
            onClick={onClose}
            className={`rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${
              supported ? "" : "ml-auto"
            }`}
            title={t("io.close")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!supported ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          <Activity className="h-8 w-8 opacity-40" />
          <p className="font-medium text-foreground">
            {t("io.monitorNotSupportedSqlite")}
          </p>
          <p>{t("io.sqliteEmbeddedNote")}</p>
        </div>
      ) : (
        <>
          {/* ── Tabs ── */}
          <div className="flex items-center gap-1 border-b border-border px-2">
            {TABS.map((tabItem) => (
              <button
                key={tabItem.id}
                onClick={() => setTab(tabItem.id)}
                className={`border-b-2 px-3 py-2 text-sm transition-colors ${
                  tab === tabItem.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(tabItem.labelKey)}
              </button>
            ))}
          </div>

          {/* ── Body ── */}
          <div className="min-h-0 flex-1 overflow-auto">
            {error && (
              <div className="m-4 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            )}

            {loading && !result && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("io.loadingDots")}
              </div>
            )}

            {result && result.rows.length === 0 && !loading && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("io.noRows")}
              </div>
            )}

            {result && result.rows.length > 0 && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-secondary">
                  <tr>
                    {showKill && (
                      <th className="w-12 border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground" />
                    )}
                    {result.columns.map((col) => (
                      <th
                        key={col.name}
                        className="border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                      >
                        {col.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, rowIndex) => {
                    const rawId = idColumn ? row[idColumn] : undefined;
                    const id =
                      rawId === null || rawId === undefined
                        ? null
                        : String(rawId);
                    return (
                      <tr
                        key={rowIndex}
                        className="transition-colors hover:bg-accent/50"
                      >
                        {showKill && (
                          <td className="border-b border-border px-3 py-1.5">
                            {id !== null && (
                              <button
                                onClick={() => void handleKill(id)}
                                disabled={killing === id}
                                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                                title={t("io.killProcess", { id })}
                              >
                                {killing === id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Skull className="h-3.5 w-3.5" />
                                )}
                                {t("io.kill")}
                              </button>
                            )}
                          </td>
                        )}
                        {result.columns.map((col) => {
                          const value = row[col.name];
                          const isNull = value === null || value === undefined;
                          return (
                            <td
                              key={col.name}
                              className="max-w-[420px] truncate border-b border-border px-3 py-1.5"
                              title={isNull ? "NULL" : String(value)}
                            >
                              {isNull ? (
                                <span className="italic text-muted-foreground/50">
                                  NULL
                                </span>
                              ) : (
                                String(value)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
