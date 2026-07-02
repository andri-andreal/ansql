import { useMemo, useState } from "react";
import { Loader2, X, FileUp } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { splitStatements } from "../../lib/statementSplitter";
import type { QueryResult } from "../../types";
import { useTranslation } from "../../i18n";

export interface ExecuteSqlFileModalProps {
  sessionId: string;
  executeQuery: (sessionId: string, sql: string) => Promise<QueryResult>;
  commitChanges: (
    sessionId: string,
    statements: { sql: string; params: unknown[] }[]
  ) => Promise<unknown>;
  onClose: () => void;
  /** "Execute SQL File" (default) or "Restore". */
  title?: string;
}

/** A single line in the streaming run log. */
interface LogLine {
  /** Visual marker glyph. */
  kind: "run" | "ok" | "error" | "info";
  text: string;
}

const MARKER: Record<LogLine["kind"], string> = {
  run: "▸",
  ok: "✓",
  error: "✗",
  info: "·",
};

const MARKER_CLASS: Record<LogLine["kind"], string> = {
  run: "text-muted-foreground",
  ok: "text-green-500",
  error: "text-destructive",
  info: "text-muted-foreground",
};

export function ExecuteSqlFileModal({
  sessionId,
  executeQuery,
  commitChanges,
  onClose,
  title,
}: ExecuteSqlFileModalProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("io.executeSqlFile");
  const [fileName, setFileName] = useState<string | null>(null);
  const [sql, setSql] = useState("");
  const [continueOnError, setContinueOnError] = useState(false);
  const [wrapInTransaction, setWrapInTransaction] = useState(true);

  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Split lazily as the buffer changes so "N statements" stays in sync with the
  // textarea (paste fallback) and the loaded file alike.
  const statements = useMemo(() => splitStatements(sql), [sql]);

  async function handleChooseFile() {
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "SQL", extensions: ["sql", "txt"] }],
      });
      const path = Array.isArray(selected) ? selected[0] ?? null : selected;
      if (!path) return;
      const text = await readTextFile(path);
      setSql(text);
      setFileName(path.split(/[\\/]/).pop() ?? path);
      setLog([]);
      setSummary(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRun() {
    if (statements.length === 0) return;
    setRunning(true);
    setError(null);
    setSummary(null);
    setLog([]);

    const total = statements.length;
    const started = performance.now();

    // Wrap in a single transaction → run the whole batch atomically.
    if (wrapInTransaction) {
      try {
        await commitChanges(
          sessionId,
          statements.map((s) => ({ sql: s.text, params: [] }))
        );
        const elapsed = ((performance.now() - started) / 1000).toFixed(2);
        setLog([
          {
            kind: "ok",
            text: t("io.committedInOneTransaction", { count: total }),
          },
        ]);
        setSummary(
          t("io.summarySucceededFailed", {
            succeeded: total,
            failed: 0,
            elapsed,
          })
        );
      } catch (e) {
        const elapsed = ((performance.now() - started) / 1000).toFixed(2);
        setLog([{ kind: "error", text: String(e) }]);
        setSummary(t("io.transactionRolledBack", { elapsed }));
      } finally {
        setRunning(false);
      }
      return;
    }

    // Sequential mode → stream a per-statement log.
    let succeeded = 0;
    let failed = 0;
    const lines: LogLine[] = [];

    for (let idx = 0; idx < total; idx++) {
      const stmt = statements[idx];
      const preview = stmt.text.replace(/\s+/g, " ").slice(0, 80);
      lines.push({
        kind: "run",
        text: t("io.stmtPreview", { index: idx + 1, total, preview }),
      });
      setLog([...lines]);
      try {
        const result = await executeQuery(sessionId, stmt.text);
        succeeded++;
        const affected =
          result.affected_rows != null
            ? t("io.rowsAffected", { count: result.affected_rows })
            : t("io.rowsReturned", { count: result.rows.length });
        lines.push({
          kind: "ok",
          text: t("io.okRowsAffected", {
            affected,
            ms: result.execution_time_ms,
          }),
        });
        setLog([...lines]);
      } catch (e) {
        failed++;
        lines.push({ kind: "error", text: String(e) });
        setLog([...lines]);
        if (!continueOnError) {
          lines.push({ kind: "info", text: t("io.stoppedContinueOff") });
          setLog([...lines]);
          break;
        }
      }
    }

    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    setSummary(
      t("io.summarySucceededFailed", { succeeded, failed, elapsed })
    );
    setRunning(false);
  }

  const canRun = statements.length > 0 && !running;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[85vh] w-[680px] flex-col overflow-hidden rounded-lg bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-sm font-semibold">{resolvedTitle}</h2>
          <button onClick={onClose} className="hover:opacity-70" title={t("io.close")} aria-label={t("io.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {/* 1. File picker + statement count */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <button
                onClick={handleChooseFile}
                disabled={running}
                className="flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-40"
              >
                <FileUp className="h-4 w-4" />
                {t("io.chooseSqlFile")}
              </button>
              {fileName && (
                <span className="truncate text-sm text-muted-foreground" title={fileName}>
                  {fileName}
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {t("io.statementsCount", { count: statements.length })}
              </span>
            </div>

            {/* Paste-into-textarea fallback (also reflects a loaded file). */}
            <textarea
              value={sql}
              onChange={(e) => {
                setSql(e.target.value);
                setSummary(null);
              }}
              disabled={running}
              spellCheck={false}
              placeholder={t("io.pasteSqlHere")}
              className="h-48 w-full resize-y rounded border border-border bg-background p-2 font-mono text-xs disabled:opacity-60"
            />
          </div>

          {/* 2. Options */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={wrapInTransaction}
                onChange={(e) => setWrapInTransaction(e.target.checked)}
                disabled={running}
              />
              {t("io.wrapInTransaction")}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={continueOnError}
                onChange={(e) => setContinueOnError(e.target.checked)}
                disabled={running || wrapInTransaction}
              />
              {t("io.continueOnError")}
            </label>
          </div>

          {wrapInTransaction && (
            <p className="text-xs text-muted-foreground">
              {t("io.mysqlDdlNote")}
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* 3. Run log */}
          {log.length > 0 && (
            <div className="max-h-64 overflow-auto rounded border border-border bg-background p-2 font-mono text-xs">
              {log.map((line, i) => (
                <div key={i} className="flex gap-2 whitespace-pre-wrap break-words">
                  <span className={MARKER_CLASS[line.kind]}>{MARKER[line.kind]}</span>
                  <span className={line.kind === "error" ? "text-destructive" : ""}>
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
          )}

          {summary && (
            <div className="rounded border border-border p-2 text-sm font-medium">{summary}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-secondary">
            {t("io.close")}
          </button>
          <button
            onClick={handleRun}
            disabled={!canRun}
            className="flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("io.run")}
          </button>
        </div>
      </div>
    </div>
  );
}
