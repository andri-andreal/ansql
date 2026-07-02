/**
 * ViewDesigner — host pane for creating/editing a database view.
 *
 * Mirrors TableDesigner's shell (header with name + Save/Cancel + inline error,
 * a body, a live useMemo → Statement[], SqlPreviewPane, confirm-on-apply). The
 * body is a Monaco SQL editor bound to the view's SELECT.
 *
 * A toolbar above the editor adds working aids:
 *  - Preview: runs the SELECT body and shows the returned rows below.
 *  - Explain: prefixes the body with EXPLAIN (via ../../lib/explain) and runs it.
 *  - Beautify: pretty-prints the body with sql-formatter in the active dialect.
 *  - WITH CHECK OPTION: threads into buildCreateView (MySQL/Postgres).
 *  - Materialized (Postgres only): switches the apply path to the materialized-
 *    view builders, and surfaces a Refresh action in edit mode.
 *
 * No Tauri imports — fully presentational + state. The parent supplies the DB
 * apply function via `onApply`, and an optional single-statement `executeQuery`
 * used by Preview/Explain/Refresh (those affordances are disabled without it).
 */

import { useMemo, useState } from "react";
import Editor, { type OnChange } from "@monaco-editor/react";
import { format } from "sql-formatter";
import {
  Loader2,
  AlertTriangle,
  X,
  CheckCircle,
  Code,
  Play,
  FileSearch,
  Wand2,
  RefreshCw,
  Layers,
} from "lucide-react";

import type { Dialect, QueryResult, Statement } from "../../types";
import {
  buildCreateView,
  buildCreateMaterializedView,
  buildRefreshMaterializedView,
} from "../../lib/viewBuilder";
import { buildExplain } from "../../lib/explain";
import { SqlPreviewPane } from "../table/SqlPreviewPane";
import { useTheme } from "../../hooks/useTheme";
import ResultsGrid from "../results/ResultsGrid";
import { useTranslation } from "../../i18n";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ViewDesignerProps {
  mode: "create" | "edit";
  dialect: Dialect;
  database: string;
  schema?: string | null;
  /** Required in "edit" mode. */
  viewName?: string;
  /** edit: the bare SELECT body to seed the editor. */
  initialBody?: string;
  /** edit: whether the existing object is a materialized view (Postgres). */
  initialMaterialized?: boolean;
  /**
   * Throws on failure. The parent runs the statements atomically (commitChanges).
   */
  onApply: (statements: Statement[]) => Promise<void>;
  /**
   * Runs a single ad-hoc statement (Preview / Explain / Refresh). When omitted
   * those toolbar affordances are disabled. Mirrors RoutineEditor.runQuery.
   */
  executeQuery?: (sql: string) => Promise<QueryResult>;
  /** Called after a successful apply, so the parent can refresh stale views. */
  onApplied?: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function formatterLanguage(dialect: Dialect): "postgresql" | "mysql" | "sqlite" {
  return dialect === "postgres" ? "postgresql" : dialect === "sqlite" ? "sqlite" : "mysql";
}

export function ViewDesigner({
  mode,
  dialect,
  database,
  schema,
  viewName,
  initialBody,
  initialMaterialized,
  onApply,
  executeQuery,
  onApplied,
  onClose,
}: ViewDesignerProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  // Editable view name (create-only; read-only label in edit).
  const [name, setName] = useState<string>(mode === "create" ? "" : (viewName ?? ""));
  // The view body (SELECT statement).
  const [body, setBody] = useState<string>(initialBody ?? "");

  // ---------- builder toggles ----------
  const [withCheckOption, setWithCheckOption] = useState(false);
  // Materialized views are Postgres-only. Seed from the edited object's kind.
  const supportsMaterialized = dialect === "postgres";
  const [materialized, setMaterialized] = useState<boolean>(
    supportsMaterialized ? (initialMaterialized ?? false) : false,
  );

  // ---------- UI state ----------
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // ---------- ad-hoc run (preview / explain) ----------
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<QueryResult | null>(null);
  const [runLabel, setRunLabel] = useState<string | null>(null);

  // ---------- live preview (useMemo) ----------
  const qualifier = dialect === "mysql" ? database : (schema ?? null);

  const statements = useMemo<Statement[]>(() => {
    const viewNameForSql = name.trim() || "new_view";
    if (materialized) {
      return buildCreateMaterializedView(dialect, qualifier, viewNameForSql, body);
    }
    return buildCreateView(dialect, qualifier, viewNameForSql, body, withCheckOption);
  }, [dialect, qualifier, name, body, materialized, withCheckOption]);

  // ---------- derived ----------
  const nameEmpty = name.trim() === "";
  const bodyEmpty = body.trim() === "";
  const canApply = !nameEmpty && !bodyEmpty && !applying;
  const canRun = !bodyEmpty && !running && !!executeQuery;

  // ---------- apply flow ----------
  const handleSaveClick = () => {
    if (!canApply) return;
    setApplyError(null);
    setConfirmOpen(true);
  };

  const runApply = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      await onApply(statements);
      onApplied?.();
      onClose();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
      setConfirmOpen(false);
    } finally {
      setApplying(false);
    }
  };

  const handleConfirmApply = () => {
    void runApply();
  };

  const handleCloseConfirm = () => {
    if (!applying) setConfirmOpen(false);
  };

  const handleBodyChange: OnChange = (value) => {
    setBody(value ?? "");
  };

  // ---------- toolbar actions ----------
  const runAdHoc = async (sql: string, label: string) => {
    if (!executeQuery) return;
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    setRunLabel(label);
    try {
      const result = await executeQuery(sql);
      setRunResult(result);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handlePreview = () => {
    if (!canRun) return;
    void runAdHoc(body, "Preview");
  };

  const handleExplain = () => {
    if (!canRun) return;
    void runAdHoc(buildExplain(body, dialect, "text"), "Explain");
  };

  const handleRefresh = () => {
    if (!executeQuery || !viewName) return;
    const stmt = buildRefreshMaterializedView(dialect, qualifier, viewName);
    void runAdHoc(stmt.sql, "Refresh");
  };

  const handleBeautify = () => {
    if (bodyEmpty) return;
    try {
      const formatted = format(body, {
        language: formatterLanguage(dialect),
        tabWidth: 2,
        keywordCase: "upper",
        indentStyle: "standard",
      });
      setBody(formatted);
    } catch (err) {
      console.error("Beautify failed:", err);
    }
  };

  const closeResults = () => {
    setRunResult(null);
    setRunError(null);
    setRunLabel(null);
  };

  // ---------- title ----------
  const objectNoun = materialized ? t("table.materializedView") : t("table.view");
  const title =
    mode === "create"
      ? t("table.newObject", { object: objectNoun })
      : t("table.editObjectNamed", { object: objectNoun, name: viewName ?? "" });
  const targetLabel = (name.trim() || viewName) ?? "new_view";

  // ---------- render ----------
  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h2 className="shrink-0 text-base font-semibold text-foreground">{title}</h2>

          {mode === "create" ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("table.viewNamePlaceholder")}
              aria-label="View name"
              className="min-w-0 max-w-xs rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <span className="truncate font-mono text-sm text-muted-foreground">{viewName}</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {applyError && (
            <span className="max-w-xs truncate text-xs text-destructive" title={applyError}>
              {applyError}
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            {t("table.cancel")}
          </button>

          <button
            type="button"
            onClick={handleSaveClick}
            disabled={!canApply}
            className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            {applying ? t("table.applying") : t("table.save")}
          </button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={handlePreview}
          disabled={!canRun}
          title={executeQuery ? t("table.runSelectBody") : t("table.previewUnavailable")}
          className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running && runLabel === "Preview" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {t("table.preview")}
        </button>

        <button
          type="button"
          onClick={handleExplain}
          disabled={!canRun}
          title={executeQuery ? t("table.runExplainOnBody") : t("table.explainUnavailable")}
          className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running && runLabel === "Explain" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileSearch className="h-3.5 w-3.5" />
          )}
          {t("table.explain")}
        </button>

        <button
          type="button"
          onClick={handleBeautify}
          disabled={bodyEmpty}
          title={t("table.prettyPrintSqlBody")}
          className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Wand2 className="h-3.5 w-3.5" />
          {t("table.beautify")}
        </button>

        {/* Refresh — edit mode, materialized only */}
        {mode === "edit" && materialized && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={!executeQuery || running}
            title={executeQuery ? "REFRESH MATERIALIZED VIEW" : t("table.refreshUnavailable")}
            className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running && runLabel === "Refresh" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("table.refresh")}
          </button>
        )}

        <div className="mx-1 h-5 w-px bg-border" />

        {/* WITH CHECK OPTION — not meaningful for materialized views */}
        <label
          className={[
            "flex items-center gap-1.5 text-xs",
            materialized ? "text-muted-foreground/50" : "text-muted-foreground",
          ].join(" ")}
          title={
            dialect === "sqlite"
              ? t("table.sqliteViewsReadOnly")
              : t("table.appendWithCheckOption")
          }
        >
          <input
            type="checkbox"
            checked={withCheckOption}
            disabled={materialized}
            onChange={(e) => setWithCheckOption(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border"
          />
          WITH CHECK OPTION
        </label>

        {/* Materialized toggle — Postgres only, create mode (kind is fixed in edit) */}
        {supportsMaterialized && (
          <label
            className={[
              "flex items-center gap-1.5 text-xs",
              mode === "edit" ? "text-muted-foreground/50" : "text-muted-foreground",
            ].join(" ")}
            title={
              mode === "edit"
                ? t("table.objectKindFixed")
                : t("table.createAsMaterialized")
            }
          >
            <input
              type="checkbox"
              checked={materialized}
              disabled={mode === "edit"}
              onChange={(e) => setMaterialized(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border"
            />
            <Layers className="h-3.5 w-3.5" />
            {t("table.materialized")}
          </label>
        )}
      </div>

      {/* ── Body: SQL editor + live preview ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Code className="h-3.5 w-3.5 shrink-0" />
          <span>
            {t("table.definitionLabel")} (<span className="font-mono">SELECT …</span>) {t("table.forLabel")}{" "}
            <span className="font-mono text-foreground">{targetLabel}</span>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded border border-border">
          <Editor
            height="100%"
            defaultLanguage="sql"
            value={body}
            onChange={handleBodyChange}
            theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: "on",
              renderWhitespace: "selection",
              bracketPairColorization: { enabled: true },
            }}
          />
        </div>

        {/* Results panel (Preview / Explain / Refresh) */}
        {(runResult || runError) && (
          <div className="flex h-56 shrink-0 flex-col overflow-hidden rounded border border-border">
            <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-3 py-1.5">
              <span className="text-xs font-medium text-foreground">{t("table.runResultLabel", { label: runLabel ?? "" })}</span>
              <button
                type="button"
                onClick={closeResults}
                className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title={t("table.closeResults")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {runError ? (
                <pre className="whitespace-pre-wrap p-3 font-mono text-xs text-destructive">
                  {runError}
                </pre>
              ) : runResult ? (
                <ResultsGrid result={runResult} />
              ) : null}
            </div>
          </div>
        )}

        <div className="shrink-0">
          <SqlPreviewPane
            statements={statements}
            warnings={bodyEmpty ? [t("table.viewBodyEmptyWarning")] : undefined}
          />
        </div>
      </div>

      {/* ── Confirmation modal ── */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={handleCloseConfirm}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-view-title"
            className="flex w-[32rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Code className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-view-title" className="text-base font-semibold leading-tight">
                  {mode === "create"
                    ? t("table.confirmCreateObject", { object: objectNoun.toLowerCase() })
                    : t("table.confirmUpdateObject", { object: objectNoun.toLowerCase() })}{" "}
                  <span className="font-mono text-sm">{targetLabel}</span>?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {materialized
                    ? t("table.runsAsMaterialized")
                    : dialect === "sqlite"
                      ? t("table.sqliteViewDropRecreate")
                      : t("table.runsAsCreateOrReplace")}{" "}
                  {t("table.appliedToLabel")}{" "}
                  <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
                    {database}
                  </span>
                  .
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseConfirm}
                disabled={applying}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title={t("table.cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* SQL preview */}
            <div className="max-h-64 overflow-auto p-5">
              <pre className="rounded border border-border bg-secondary/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
                {statements.map((s) => s.sql).join("\n\n")}
              </pre>
            </div>

            {/* Error */}
            {applyError && (
              <div className="mx-5 mb-2 overflow-hidden rounded-lg border border-destructive/40">
                <div className="flex items-center gap-1.5 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {t("table.applyFailed")}
                </div>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {applyError}
                </pre>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3">
              <button
                type="button"
                onClick={handleCloseConfirm}
                disabled={applying}
                className="rounded-lg px-3.5 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
              >
                {t("table.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmApply}
                disabled={applying}
                className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                {applying ? t("table.applying") : mode === "create" ? t("table.create") : t("table.update")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
