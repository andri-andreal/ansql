/**
 * TriggerDesigner — workspace-hosted designer for creating/editing a trigger.
 *
 * Mirrors ViewDesigner/RoutineEditor's shell (header with name + Save/Cancel +
 * inline error, a structured form, a Monaco body editor, a live useMemo →
 * Statement[] feeding SqlPreviewPane, and a confirm-on-apply modal).
 *
 * Unlike a view, a trigger has structured metadata (timing/event/when/for-each-
 * row) alongside the free-text body, so the form drives the dialect-correct
 * statement assembly via `buildCreateTrigger`. The body Monaco holds just the
 * trigger logic the user authors (for Postgres, the plpgsql function body).
 *
 * No Tauri imports — fully presentational + state. The parent supplies
 * `executeQuery`, which runs a single SQL string; Apply runs each built
 * statement sequentially, then calls `onApplied`.
 */

import { useMemo, useState } from "react";
import Editor, { type OnChange } from "@monaco-editor/react";
import { Loader2, AlertTriangle, X, CheckCircle, Zap } from "lucide-react";

import type { Dialect, Statement } from "../../types";
import {
  buildCreateTrigger,
  triggerTemplate,
  type TriggerSpec,
  type TriggerTiming,
  type TriggerEvent,
} from "../../lib/triggerBuilder";
import { SqlPreviewPane } from "../table/SqlPreviewPane";
import { useTheme } from "../../hooks/useTheme";
import { useTranslation } from "../../i18n";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TriggerDesignerProps {
  mode: "create" | "edit";
  database: string;
  schema?: string | null;
  dialect: Dialect;
  /** Preselected table (create from a table) or the owning table (edit). */
  table?: string;
  /** For the table picker in create mode (optional; can be []). */
  tables?: { name: string }[];
  /** edit-mode seed: the existing trigger as discovered by the explorer. */
  existing?: {
    name: string;
    table: string;
    timing?: string | null;
    event?: string | null;
    statement: string;
  };
  /** Called after a successful apply (so the explorer can refresh). */
  onApplied?: () => void;
  /** Runs a single SQL string. Throws on failure. */
  executeQuery: (sql: string) => Promise<unknown>;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const TIMINGS: TriggerTiming[] = ["BEFORE", "AFTER", "INSTEAD OF"];
const EVENTS: TriggerEvent[] = ["INSERT", "UPDATE", "DELETE"];

/** Coerce a free-form timing string from the explorer into a known timing. */
function parseTiming(raw?: string | null): TriggerTiming | null {
  if (!raw) return null;
  const u = raw.trim().toUpperCase();
  if (u.includes("INSTEAD")) return "INSTEAD OF";
  if (u.includes("BEFORE")) return "BEFORE";
  if (u.includes("AFTER")) return "AFTER";
  return null;
}

/** Coerce a free-form event string (possibly "INSERT OR UPDATE") into events. */
function parseEvents(raw?: string | null): TriggerEvent[] {
  if (!raw) return [];
  const u = raw.toUpperCase();
  return EVENTS.filter((e) => u.includes(e));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TriggerDesigner({
  mode,
  database,
  schema,
  dialect,
  table,
  tables,
  existing,
  onApplied,
  executeQuery,
  onClose,
}: TriggerDesignerProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();

  const isMysql = dialect === "mysql";
  const supportsWhen = dialect === "sqlite" || dialect === "postgres";

  // ---------- seeded structured state ----------
  const seededTiming = parseTiming(existing?.timing) ?? "BEFORE";
  const seededEvents = parseEvents(existing?.event);
  const seededTable = existing?.table ?? table ?? "";

  const [name, setName] = useState<string>(mode === "edit" ? (existing?.name ?? "") : "");
  const [tableName, setTableName] = useState<string>(seededTable);
  const [timing, setTiming] = useState<TriggerTiming>(seededTiming);
  const [events, setEvents] = useState<TriggerEvent[]>(
    seededEvents.length > 0 ? seededEvents : ["INSERT"],
  );
  const [forEachRow, setForEachRow] = useState<boolean>(true);
  const [when, setWhen] = useState<string>("");

  // In edit mode we show the full existing CREATE TRIGGER text in the body
  // editor as a pragmatic fallback (the explorer hands us the verbatim DDL).
  // In create mode we seed from the template for the owning table.
  const [body, setBody] = useState<string>(
    mode === "edit"
      ? (existing?.statement ?? "")
      : triggerTemplate(dialect, seededTable || "table_name"),
  );
  // Once the user hand-edits the body, we stop re-seeding it from the template.
  const [bodyTouched, setBodyTouched] = useState(false);

  // ---------- UI state ----------
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // ---------- spec + live preview (useMemo) ----------
  const spec = useMemo<TriggerSpec>(
    () => ({
      name: name.trim() || "new_trigger",
      table: tableName.trim() || "table_name",
      schema: dialect === "mysql" ? database : (schema ?? null),
      timing,
      events: isMysql ? events.slice(0, 1) : events,
      forEachRow: isMysql ? true : forEachRow,
      when: supportsWhen && when.trim() ? when.trim() : null,
      body,
    }),
    [
      name,
      tableName,
      dialect,
      database,
      schema,
      timing,
      events,
      isMysql,
      forEachRow,
      supportsWhen,
      when,
      body,
    ],
  );

  const statements = useMemo<Statement[]>(
    () => buildCreateTrigger(dialect, spec),
    [dialect, spec],
  );

  // ---------- derived ----------
  const nameEmpty = name.trim() === "";
  const tableEmpty = tableName.trim() === "";
  const eventsEmpty = events.length === 0;
  const bodyEmpty = body.trim() === "";
  const canApply = !nameEmpty && !tableEmpty && !eventsEmpty && !bodyEmpty && !applying;

  const warnings = useMemo<string[]>(() => {
    const w: string[] = [];
    if (nameEmpty) w.push("Trigger name is empty.");
    if (tableEmpty) w.push("Choose the table this trigger fires on.");
    if (eventsEmpty) w.push("Select at least one event (INSERT/UPDATE/DELETE).");
    if (bodyEmpty) w.push("Trigger body is empty — add the trigger logic.");
    return w;
  }, [nameEmpty, tableEmpty, eventsEmpty, bodyEmpty]);

  // ---------- table picker source (create mode) ----------
  const tableOptions = tables ?? [];

  // ---------- event handlers ----------
  const handleTableChange = (next: string) => {
    setTableName(next);
    // While the body is untouched in create mode, re-seed the template so it
    // references the freshly-chosen table (mirrors RoutineEditor's kind re-seed).
    if (mode === "create" && !bodyTouched) {
      setBody(triggerTemplate(dialect, next || "table_name"));
    }
  };

  const toggleEvent = (e: TriggerEvent) => {
    if (isMysql) {
      // MySQL: exactly one event — radio behaviour.
      setEvents([e]);
      return;
    }
    setEvents((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e],
    );
  };

  const handleBodyChange: OnChange = (value) => {
    setBody(value ?? "");
    setBodyTouched(true);
  };

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
      for (const stmt of statements) {
        await executeQuery(stmt.sql);
      }
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

  // ---------- labels ----------
  const title =
    mode === "create"
      ? t("table.newObject", { object: t("table.trigger") })
      : t("table.editObjectNamed", { object: t("table.trigger"), name: existing?.name ?? "" });
  const targetLabel = name.trim() || existing?.name || "new_trigger";
  const bodyLabel =
    dialect === "postgres"
      ? t("table.functionBodyPlpgsql")
      : t("table.triggerBody");

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
              placeholder={t("table.triggerNamePlaceholder")}
              aria-label="Trigger name"
              className="min-w-0 max-w-xs rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <span className="truncate font-mono text-sm text-muted-foreground">
              {existing?.name}
            </span>
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

      {/* ── Body: structured form + Monaco + live preview ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {/* Structured form */}
        <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Table */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("table.tableLabel")}</span>
            {mode === "create" && tableOptions.length > 0 ? (
              <select
                value={tableName}
                onChange={(e) => handleTableChange(e.target.value)}
                className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("table.selectATable")}</option>
                {tableOptions.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : mode === "create" ? (
              <input
                type="text"
                value={tableName}
                onChange={(e) => handleTableChange(e.target.value)}
                placeholder={t("table.tableNamePlaceholder")}
                className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <span className="rounded border border-border bg-secondary/40 px-2 py-1.5 font-mono text-sm text-muted-foreground">
                {tableName}
              </span>
            )}
          </label>

          {/* Timing */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("table.timing")}</span>
            <select
              value={timing}
              onChange={(e) => setTiming(e.target.value as TriggerTiming)}
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {TIMINGS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          {/* Events */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {isMysql ? t("table.event") : t("table.events")}
              {isMysql && (
                <span className="ml-1 text-[10px] font-normal lowercase">{t("table.oneOnly")}</span>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-3 py-0.5">
              {EVENTS.map((e) => {
                const checked = events.includes(e);
                return (
                  <label key={e} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <input
                      type={isMysql ? "radio" : "checkbox"}
                      name={isMysql ? "trigger-event" : undefined}
                      checked={checked}
                      onChange={() => toggleEvent(e)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <span className="font-mono text-xs">{e}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* FOR EACH ROW */}
          <label className="flex items-center gap-2 self-end pb-1.5">
            <input
              type="checkbox"
              checked={isMysql ? true : forEachRow}
              disabled={isMysql}
              onChange={(e) => setForEachRow(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary disabled:opacity-60"
            />
            <span className="text-sm">
              FOR EACH ROW
              {isMysql && (
                <span className="ml-1 text-[10px] text-muted-foreground">{t("table.required")}</span>
              )}
            </span>
          </label>

          {/* WHEN (sqlite/postgres only) */}
          {supportsWhen && (
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t("table.whenCondition")} <span className="font-normal">{t("table.optional")}</span>
              </span>
              <input
                type="text"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                placeholder="NEW.status <> OLD.status"
                className="rounded border border-border bg-background px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          )}
        </div>

        {/* Body editor */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Zap className="h-3.5 w-3.5 shrink-0" />
          <span>
            {bodyLabel} {t("table.forLabel")}{" "}
            <span className="font-mono text-foreground">{targetLabel}</span> {t("table.onLabel")}{" "}
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
              {database}
            </span>
          </span>
        </div>

        <div className="h-56 min-h-[12rem] shrink-0 overflow-hidden rounded border border-border">
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

        {/* Live preview */}
        <div className="shrink-0">
          <SqlPreviewPane
            statements={statements}
            warnings={warnings.length > 0 ? warnings : undefined}
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
            aria-labelledby="confirm-trigger-title"
            className="flex w-[32rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Zap className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-trigger-title" className="text-base font-semibold leading-tight">
                  {mode === "create"
                    ? t("table.confirmCreateObject", { object: t("table.trigger").toLowerCase() })
                    : t("table.confirmUpdateObject", { object: t("table.trigger").toLowerCase() })}{" "}
                  <span className="font-mono text-sm">{targetLabel}</span>?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {statements.length > 1
                    ? t("table.runsNStatements", { count: statements.length })
                    : t("table.runsStatementAsWritten")}{" "}
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
              <pre className="whitespace-pre-wrap rounded border border-border bg-secondary/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
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
