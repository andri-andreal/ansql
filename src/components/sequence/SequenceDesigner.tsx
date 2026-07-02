/**
 * SequenceDesigner — workspace-hosted designer for creating/editing a Postgres
 * SEQUENCE.
 *
 * Mirrors TriggerDesigner/ViewDesigner's shell (header with name + Save/Cancel +
 * inline error, a structured property form, a live useMemo → Statement[] feeding
 * SqlPreviewPane, and a confirm-on-apply modal). Unlike the other designers a
 * sequence is fully form-driven (Increment / Min / Max / Start / Cache / Cycle) —
 * there is no free-text body, so there is no Monaco editor here.
 *
 * No Tauri imports — fully presentational + state. The parent supplies
 * `executeQuery`, which runs a single SQL string; Apply runs each built statement
 * sequentially, then calls `onApplied`. Sequences are Postgres-only; the explorer
 * only opens this designer on a Postgres session.
 */

import { useMemo, useState } from "react";
import { Loader2, AlertTriangle, X, CheckCircle, ListOrdered } from "lucide-react";

import type { Statement } from "../../types";
import {
  buildCreateSequence,
  buildAlterSequence,
  type SequenceSpec,
} from "../../lib/sequenceBuilder";
import { SqlPreviewPane } from "../table/SqlPreviewPane";
import { useTranslation } from "../../i18n";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SequenceDesignerProps {
  mode: "create" | "edit";
  sessionId: string;
  database: string;
  /** Postgres schema (defaults to current_schema when null/undefined). */
  schema?: string | null;
  /** edit-mode seed: the existing sequence as discovered by the explorer. */
  existing?: {
    name: string;
  };
  /** Runs a single SQL string. Throws on failure. */
  executeQuery: (sql: string) => Promise<unknown>;
  /** Called after a successful apply (so the explorer can refresh). */
  onApplied?: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Parse an optional integer field; blank → null (omit the clause). */
function parseOptInt(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number.parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

export function SequenceDesigner({
  mode,
  database,
  schema,
  existing,
  executeQuery,
  onApplied,
  onClose,
}: SequenceDesignerProps) {
  const { t } = useTranslation();
  // ---------- structured state ----------
  const [name, setName] = useState<string>(mode === "edit" ? (existing?.name ?? "") : "");
  // Numeric properties are kept as strings so blank means "omit the clause".
  const [increment, setIncrement] = useState<string>("1");
  const [min, setMin] = useState<string>("");
  const [max, setMax] = useState<string>("");
  const [start, setStart] = useState<string>("");
  const [cache, setCache] = useState<string>("1");
  const [cycle, setCycle] = useState<boolean>(false);

  // ---------- UI state ----------
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // ---------- spec + live preview (useMemo) ----------
  const spec = useMemo<SequenceSpec>(
    () => ({
      name: name.trim() || "new_sequence",
      schema: schema ?? null,
      increment: parseOptInt(increment),
      minValue: parseOptInt(min),
      maxValue: parseOptInt(max),
      start: parseOptInt(start),
      cache: parseOptInt(cache),
      cycle,
    }),
    [name, schema, increment, min, max, start, cache, cycle],
  );

  // create → CREATE SEQUENCE IF NOT EXISTS; edit → ALTER SEQUENCE.
  const statements = useMemo<Statement[]>(
    () => (mode === "edit" ? buildAlterSequence(spec) : buildCreateSequence(spec)),
    [mode, spec],
  );

  // ---------- derived ----------
  const nameEmpty = name.trim() === "";
  const canApply = !nameEmpty && !applying;

  const warnings = useMemo<string[]>(() => {
    const w: string[] = [];
    if (nameEmpty) w.push("Sequence name is empty.");
    return w;
  }, [nameEmpty]);

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
      ? t("table.newObject", { object: t("table.sequence") })
      : t("table.editObjectNamed", { object: t("table.sequence"), name: existing?.name ?? "" });
  const targetLabel = name.trim() || existing?.name || "new_sequence";

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
              placeholder={t("table.sequenceNamePlaceholder")}
              aria-label="Sequence name"
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

      {/* ── Body: property form + live preview ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ListOrdered className="h-3.5 w-3.5 shrink-0" />
          <span>
            {t("table.propertiesLabel")} {t("table.forLabel")}{" "}
            <span className="font-mono text-foreground">{targetLabel}</span> {t("table.onLabel")}{" "}
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
              {database}
            </span>
          </span>
        </div>

        {/* Property form */}
        <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Increment */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("table.incrementBy")}</span>
            <input
              type="number"
              value={increment}
              onChange={(e) => setIncrement(e.target.value)}
              placeholder="1"
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          {/* Start */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("table.startWith")} <span className="font-normal">{t("table.optional")}</span>
            </span>
            <input
              type="number"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder={t("table.defaultPlaceholder")}
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          {/* Cache */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("table.cache")}</span>
            <input
              type="number"
              min={1}
              value={cache}
              onChange={(e) => setCache(e.target.value)}
              placeholder="1"
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          {/* Min */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("table.minValue")} <span className="font-normal">{t("table.optional")}</span>
            </span>
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              placeholder="NO MINVALUE"
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          {/* Max */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("table.maxValue")} <span className="font-normal">{t("table.optional")}</span>
            </span>
            <input
              type="number"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              placeholder="NO MAXVALUE"
              className="rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          {/* Cycle */}
          <label className="flex items-center gap-2 self-end pb-1.5">
            <input
              type="checkbox"
              checked={cycle}
              onChange={(e) => setCycle(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span className="text-sm">{t("table.cycle")}</span>
          </label>
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
            aria-labelledby="confirm-sequence-title"
            className="flex w-[32rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ListOrdered className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-sequence-title" className="text-base font-semibold leading-tight">
                  {mode === "create"
                    ? t("table.confirmCreateObject", { object: t("table.sequence").toLowerCase() })
                    : t("table.confirmUpdateObject", { object: t("table.sequence").toLowerCase() })}{" "}
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
