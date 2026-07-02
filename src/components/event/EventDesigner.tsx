/**
 * EventDesigner — workspace-hosted designer for creating/editing a MySQL EVENT
 * (the MySQL/MariaDB scheduler).
 *
 * Mirrors TriggerDesigner/ViewDesigner's shell (header with name + Save/Cancel +
 * inline error, a structured Schedule form, a Monaco body editor, a live
 * useMemo → Statement[] feeding SqlPreviewPane, and a confirm-on-apply modal).
 *
 * An event has structured scheduling metadata (AT one-shot vs EVERY interval,
 * an ENABLE/DISABLE status, a comment) alongside the free-text `DO` body, so the
 * form drives the dialect-correct statement assembly via `buildCreateEvent`. The
 * body Monaco holds just the statement(s) that follow `DO`.
 *
 * No Tauri imports — fully presentational + state. The parent supplies
 * `executeQuery`, which runs a single SQL string; Apply runs each built statement
 * sequentially, then calls `onApplied`. Events are MySQL-only; the explorer only
 * opens this designer on a MySQL session.
 */

import { useMemo, useState } from "react";
import Editor, { type OnChange } from "@monaco-editor/react";
import { Loader2, AlertTriangle, X, CheckCircle, CalendarClock } from "lucide-react";

import type { Statement } from "../../types";
import {
  buildCreateEvent,
  buildAlterEvent,
  eventTemplate,
  type EventSpec,
  type EventScheduleKind,
  type EventIntervalUnit,
} from "../../lib/eventBuilder";
import { SqlPreviewPane } from "../table/SqlPreviewPane";
import { useTheme } from "../../hooks/useTheme";
import { useTranslation } from "../../i18n";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EventDesignerProps {
  mode: "create" | "edit";
  sessionId: string;
  database: string;
  /** edit-mode seed: the existing event as discovered by the explorer. */
  existing?: {
    name: string;
    /** Verbatim CREATE EVENT text (or definition) when known. */
    statement?: string;
  };
  /** Runs a single SQL string. Throws on failure. */
  executeQuery: (sql: string) => Promise<unknown>;
  /** Called after a successful apply (so the explorer can refresh). */
  onApplied?: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEDULE_KINDS: { value: EventScheduleKind; label: string }[] = [
  { value: "at", label: "At (one-time)" },
  { value: "every", label: "Every (recurring)" },
];

const INTERVAL_UNITS: EventIntervalUnit[] = [
  "SECOND",
  "MINUTE",
  "HOUR",
  "DAY",
  "WEEK",
  "MONTH",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventDesigner({
  mode,
  database,
  existing,
  executeQuery,
  onApplied,
  onClose,
}: EventDesignerProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();

  // ---------- structured state ----------
  const [name, setName] = useState<string>(mode === "edit" ? (existing?.name ?? "") : "");
  const [scheduleKind, setScheduleKind] = useState<EventScheduleKind>("every");
  // `at` holds the one-shot timestamp; `intervalValue`/`intervalUnit` the recurrence.
  const [at, setAt] = useState<string>("");
  const [intervalValue, setIntervalValue] = useState<string>("1");
  const [intervalUnit, setIntervalUnit] = useState<EventIntervalUnit>("DAY");
  const [enabled, setEnabled] = useState<boolean>(true);
  const [comment, setComment] = useState<string>("");

  // In edit mode we show the verbatim definition (if the explorer handed it to
  // us) in the body editor as a pragmatic fallback; otherwise seed the template.
  const [body, setBody] = useState<string>(
    mode === "edit" && existing?.statement ? existing.statement : eventTemplate(),
  );

  // ---------- UI state ----------
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // ---------- spec + live preview (useMemo) ----------
  const spec = useMemo<EventSpec>(
    () => ({
      name: name.trim() || "new_event",
      scheduleKind,
      at: at.trim() ? at.trim() : undefined,
      everyValue: Number.parseInt(intervalValue, 10) || 1,
      everyUnit: intervalUnit,
      enabled,
      comment: comment.trim() ? comment.trim() : null,
      body,
    }),
    [
      name,
      scheduleKind,
      at,
      intervalValue,
      intervalUnit,
      enabled,
      comment,
      body,
    ],
  );

  // create → CREATE EVENT IF NOT EXISTS; edit → ALTER EVENT (full restatement).
  const statements = useMemo<Statement[]>(
    () => (mode === "edit" ? buildAlterEvent(spec) : buildCreateEvent(spec)),
    [mode, spec],
  );

  // ---------- derived ----------
  const nameEmpty = name.trim() === "";
  const atEmpty = scheduleKind === "at" && at.trim() === "";
  const bodyEmpty = body.trim() === "";
  const canApply = !nameEmpty && !atEmpty && !bodyEmpty && !applying;

  const warnings = useMemo<string[]>(() => {
    const w: string[] = [];
    if (nameEmpty) w.push("Event name is empty.");
    if (atEmpty) w.push("Provide the AT timestamp (e.g. 2026-07-01 00:00:00).");
    if (bodyEmpty) w.push("Event body is empty — add the statement(s) to run.");
    return w;
  }, [nameEmpty, atEmpty, bodyEmpty]);

  // ---------- event handlers ----------
  const handleBodyChange: OnChange = (value) => {
    setBody(value ?? "");
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
      ? t("table.newObject", { object: t("table.eventNoun") })
      : t("table.editObjectNamed", { object: t("table.eventNoun"), name: existing?.name ?? "" });
  const targetLabel = name.trim() || existing?.name || "new_event";

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
              placeholder={t("table.eventNamePlaceholder")}
              aria-label="Event name"
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
          {/* Schedule kind */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("table.schedule")}</span>
            <select
              value={scheduleKind}
              onChange={(e) => setScheduleKind(e.target.value as EventScheduleKind)}
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {SCHEDULE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>

          {/* AT timestamp (one-shot) */}
          {scheduleKind === "at" ? (
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">{t("table.atTimestamp")}</span>
              <input
                type="text"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                placeholder="2026-07-01 00:00:00"
                className="rounded border border-border bg-background px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          ) : (
            <>
              {/* EVERY value */}
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("table.every")}</span>
                <input
                  type="number"
                  min={1}
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(e.target.value)}
                  className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>

              {/* EVERY unit */}
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("table.unit")}</span>
                <select
                  value={intervalUnit}
                  onChange={(e) => setIntervalUnit(e.target.value as EventIntervalUnit)}
                  className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {INTERVAL_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {/* Enable toggle */}
          <label className="flex items-center gap-2 self-end pb-1.5">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span className="text-sm">{t("table.enabled")}</span>
          </label>

          {/* Comment */}
          <label className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t("table.comment")} <span className="font-normal">{t("table.optional")}</span>
            </span>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("table.eventCommentPlaceholder")}
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
        </div>

        {/* Body editor */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-mono">DO</span> {t("table.bodyLabel")} {t("table.forLabel")}{" "}
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
            aria-labelledby="confirm-event-title"
            className="flex w-[32rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-event-title" className="text-base font-semibold leading-tight">
                  {mode === "create"
                    ? t("table.confirmCreateObject", { object: t("table.eventNoun").toLowerCase() })
                    : t("table.confirmUpdateObject", { object: t("table.eventNoun").toLowerCase() })}{" "}
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
