/**
 * RoutineEditor — host pane for creating/editing a stored function or procedure.
 *
 * Mirrors ViewDesigner's shell (header with name + Save/Cancel + inline error, a
 * Monaco body, a confirm-on-apply modal). The key differences:
 *  - The editor holds the FULL `CREATE …` statement (signature + body), because
 *    routine bodies use `$$` / `DELIMITER` and don't fit the parameter-batch
 *    model. There is no "wrapping" — the body IS the SQL.
 *  - Apply runs the verbatim statement through `runQuery` (a single
 *    `executeQuery`), not `commitChanges`.
 *  - In create mode a kind toggle (function / procedure) re-seeds the template.
 *
 * A structured parameter grid sits above the body editor: rows of
 * { Mode, Name, Type } plus a Return Type (functions only). "Scaffold from
 * parameters" regenerates the CREATE header (via scaffoldRoutineBody) into the
 * body, which stays hand-editable. In edit mode an "Execute" action prompts for
 * the IN/INOUT parameter values and runs the routine (CALL / SELECT).
 *
 * No Tauri imports — fully presentational + state. The parent supplies the DB
 * apply function via `runQuery`. SQLite never opens this editor (disabled upstream).
 */

import { useState } from "react";
import Editor, { type OnChange } from "@monaco-editor/react";
import {
  Loader2,
  AlertTriangle,
  X,
  CheckCircle,
  FunctionSquare,
  Plus,
  Trash2,
  Wand2,
  Play,
} from "lucide-react";

import type { Dialect, QueryResult } from "../../types";
import {
  routineTemplate,
  scaffoldRoutineBody,
  type RoutineKind,
  type RoutineParam,
} from "../../lib/routineBuilder";
import { quoteIdent } from "../../lib/mutationBuilder";
import { quoteStringLiteral } from "../../lib/ddlBuilder";
import { useTheme } from "../../hooks/useTheme";
import ResultsGrid from "../results/ResultsGrid";
import { useTranslation } from "../../i18n";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RoutineEditorProps {
  mode: "create" | "edit";
  dialect: Dialect;
  database: string;
  schema?: string | null;
  kind: RoutineKind;
  /** Display name (edit mode). Optional in create mode. */
  routineName?: string;
  /** Seed for the editor: full CREATE statement (edit). Create mode falls back
   *  to `routineTemplate`. */
  initialBody?: string;
  /** Runs the verbatim statement (single executeQuery). Throws on failure. */
  runQuery: (sql: string) => Promise<unknown>;
  /** Called after a successful apply, so the parent can refresh stale lists. */
  onApplied?: () => void;
  onClose: () => void;
}

const MODES: RoutineParam["mode"][] = ["IN", "OUT", "INOUT"];

/** A blank parameter row for the grid. */
function emptyParam(): RoutineParam {
  return { mode: "IN", name: "", type: "" };
}

/** Quote a routine name with the schema/database qualifier, dialect-correct. */
function qualifiedName(
  dialect: Dialect,
  qualifier: string | null,
  name: string,
): string {
  const ident = quoteIdent(dialect, name);
  return qualifier ? `${quoteIdent(dialect, qualifier)}.${ident}` : ident;
}

/** Format a literal call argument: numeric values raw, NULL bare, else a quoted string. */
function literalArg(dialect: Dialect, raw: string, isNull: boolean): string {
  if (isNull) return "NULL";
  const trimmed = raw.trim();
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return trimmed;
  return quoteStringLiteral(dialect, raw);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RoutineEditor({
  mode,
  dialect,
  database,
  schema,
  kind: initialKind,
  routineName,
  initialBody,
  runQuery,
  onApplied,
  onClose,
}: RoutineEditorProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  // Kind is only switchable in create mode (an existing routine's kind is fixed).
  const [kind, setKind] = useState<RoutineKind>(initialKind);

  // Routine name — drives scaffolding/execution. Create mode is editable; edit
  // mode is fixed to the existing routine's name.
  const [name, setName] = useState<string>(mode === "create" ? "" : (routineName ?? ""));

  // Structured parameters for the scaffold/execute helpers. The verbatim body
  // remains the source of truth for what is applied.
  const [params, setParams] = useState<RoutineParam[]>([]);
  const [returnType, setReturnType] = useState<string>("");

  // The full CREATE statement. Create mode seeds from the template; edit mode
  // from the fetched definition.
  const [body, setBody] = useState<string>(
    initialBody ?? (mode === "create" ? routineTemplate(dialect, initialKind) : ""),
  );

  // Tracks whether the user has hand-edited the body. While untouched in create
  // mode, flipping the kind toggle re-seeds the template; once edited we never
  // clobber their work.
  const [bodyTouched, setBodyTouched] = useState(false);

  // ---------- UI state ----------
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // ---------- execute flow (edit mode) ----------
  const [execOpen, setExecOpen] = useState(false);
  const [execValues, setExecValues] = useState<Record<number, { value: string; isNull: boolean }>>(
    {},
  );
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [execResult, setExecResult] = useState<QueryResult | null>(null);

  // ---------- derived ----------
  const bodyEmpty = body.trim() === "";
  const canApply = !bodyEmpty && !applying;
  const qualifier = dialect === "mysql" ? database : (schema ?? null);
  // Args a caller supplies a value for (OUT params are not passed in).
  const callableParams = params.filter((p) => p.mode === "IN" || p.mode === "INOUT");

  // ---------- kind toggle (create only) ----------
  const handleKindChange = (next: RoutineKind) => {
    if (next === kind) return;
    setKind(next);
    if (!bodyTouched) {
      setBody(routineTemplate(dialect, next));
    }
  };

  // ---------- parameter grid ----------
  const addParam = () => setParams((prev) => [...prev, emptyParam()]);
  const removeParam = (index: number) =>
    setParams((prev) => prev.filter((_, i) => i !== index));
  const patchParam = (index: number, patch: Partial<RoutineParam>) =>
    setParams((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const handleScaffold = () => {
    const scaffoldName = name.trim() || (kind === "procedure" ? "procedure_name" : "function_name");
    const next = scaffoldRoutineBody(dialect, kind, scaffoldName, params, returnType || undefined);
    setBody(next);
    // The scaffold replaced the body deliberately; treat as authored content so
    // subsequent kind-toggles don't clobber it.
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
      await runQuery(body);
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
    setBodyTouched(true);
  };

  // ---------- execute flow ----------
  const openExecute = () => {
    setExecError(null);
    setExecResult(null);
    setExecOpen(true);
  };

  const buildCallSql = (): string => {
    const target = qualifiedName(dialect, qualifier, name.trim() || routineName || "");
    const args = callableParams
      .map((_, i) => {
        const entry = execValues[i] ?? { value: "", isNull: false };
        return literalArg(dialect, entry.value, entry.isNull);
      })
      .join(", ");
    return kind === "procedure"
      ? `CALL ${target}(${args})`
      : `SELECT ${target}(${args})`;
  };

  const runExecute = async () => {
    setExecuting(true);
    setExecError(null);
    setExecResult(null);
    try {
      const result = (await runQuery(buildCallSql())) as QueryResult;
      // runQuery is typed Promise<unknown>; the parent always returns QueryResult.
      setExecResult(result ?? null);
    } catch (e) {
      setExecError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  };

  // ---------- labels ----------
  const kindLabel = kind === "procedure" ? t("table.procedure") : t("table.function");
  const title =
    mode === "create"
      ? t("table.newObject", { object: kindLabel })
      : t("table.editObjectNamed", { object: kindLabel, name: routineName ?? "" });

  // ---------- render ----------
  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h2 className="shrink-0 text-base font-semibold text-foreground">{title}</h2>

          {mode === "create" ? (
            <>
              <div
                className="flex shrink-0 overflow-hidden rounded border border-border"
                role="group"
                aria-label="Routine kind"
              >
                {(["function", "procedure"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleKindChange(k)}
                    className={[
                      "px-3 py-1 text-sm capitalize transition-colors",
                      kind === k
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-secondary",
                    ].join(" ")}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${kind}_name`}
                aria-label="Routine name"
                className="min-w-0 max-w-xs rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </>
          ) : (
            <span className="truncate font-mono text-sm text-muted-foreground">
              {routineName}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {applyError && (
            <span className="max-w-xs truncate text-xs text-destructive" title={applyError}>
              {applyError}
            </span>
          )}

          {mode === "edit" && (
            <button
              type="button"
              onClick={openExecute}
              disabled={applying}
              className="flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50"
              title={t("table.runRoutineWithParams")}
            >
              <Play className="h-4 w-4" />
              {t("table.execute")}
            </button>
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

      {/* ── Parameter grid ── */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{t("table.parameters")}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addParam}
              className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("table.addParameter")}
            </button>
            <button
              type="button"
              onClick={handleScaffold}
              className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary"
              title={t("table.scaffoldTooltip")}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {t("table.scaffoldFromParameters")}
            </button>
          </div>
        </div>

        {params.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">
            {t("table.noParameters")}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {params.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={p.mode}
                  onChange={(e) => patchParam(i, { mode: e.target.value as RoutineParam["mode"] })}
                  aria-label={`Parameter ${i + 1} mode`}
                  className="w-24 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => patchParam(i, { name: e.target.value })}
                  placeholder={t("table.paramNamePlaceholder")}
                  aria-label={`Parameter ${i + 1} name`}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <input
                  type="text"
                  value={p.type}
                  onChange={(e) => patchParam(i, { type: e.target.value })}
                  placeholder={t("table.paramTypePlaceholder")}
                  aria-label={`Parameter ${i + 1} type`}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => removeParam(i)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive"
                  aria-label={`Remove parameter ${i + 1}`}
                  title={t("table.remove")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {kind === "function" && (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="routine-return-type">
              Return type
            </label>
            <input
              id="routine-return-type"
              type="text"
              value={returnType}
              onChange={(e) => setReturnType(e.target.value)}
              placeholder={dialect === "postgres" ? "void" : "INT"}
              className="w-48 rounded border border-border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}
      </div>

      {/* ── Body: full CREATE statement editor ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FunctionSquare className="h-3.5 w-3.5 shrink-0" />
          <span>
            Full <span className="font-mono">CREATE {kindLabel.toUpperCase()}</span> statement —
            applied verbatim to{" "}
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
              {database}
            </span>
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

        {bodyEmpty && (
          <div className="shrink-0 text-xs text-amber-500">
            Routine body is empty — add a CREATE statement.
          </div>
        )}
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
            aria-labelledby="confirm-routine-title"
            className="flex w-[32rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <FunctionSquare className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-routine-title" className="text-base font-semibold leading-tight">
                  {mode === "create"
                    ? t("table.confirmCreateObject", { object: kindLabel.toLowerCase() })
                    : t("table.confirmUpdateObject", { object: kindLabel.toLowerCase() })}
                  {routineName ? (
                    <>
                      {" "}
                      <span className="font-mono text-sm">{routineName}</span>
                    </>
                  ) : null}
                  ?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("table.runsStatementAsWritten")}{" "}
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

            {/* SQL preview (the body IS the SQL) */}
            <div className="max-h-64 overflow-auto p-5">
              <pre className="whitespace-pre-wrap rounded border border-border bg-secondary/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
                {body}
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

      {/* ── Execute modal (edit mode) ── */}
      {execOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!executing) setExecOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="exec-routine-title"
            className="flex max-h-[80vh] w-[42rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Play className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="exec-routine-title" className="text-base font-semibold leading-tight">
                  {t("table.execute")} <span className="font-mono text-sm">{routineName}</span>
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {callableParams.length === 0
                    ? t("table.defineInParamsHint")
                    : t("table.provideInputValuesHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!executing) setExecOpen(false);
                }}
                disabled={executing}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title={t("table.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Inputs */}
            <div className="min-h-0 flex-1 overflow-auto p-5">
              {callableParams.length > 0 && (
                <div className="mb-4 flex flex-col gap-2">
                  {callableParams.map((p, i) => {
                    const entry = execValues[i] ?? { value: "", isNull: false };
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <label
                          className="w-40 shrink-0 truncate font-mono text-xs text-foreground"
                          title={`${p.mode} ${p.name} ${p.type}`}
                        >
                          {p.name || `arg${i + 1}`}{" "}
                          <span className="text-muted-foreground/70">{p.type}</span>
                        </label>
                        <input
                          type="text"
                          value={entry.value}
                          disabled={entry.isNull}
                          onChange={(e) =>
                            setExecValues((prev) => ({
                              ...prev,
                              [i]: { value: e.target.value, isNull: false },
                            }))
                          }
                          placeholder={t("table.valuePlaceholderShort")}
                          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                        />
                        <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={entry.isNull}
                            onChange={(e) =>
                              setExecValues((prev) => ({
                                ...prev,
                                [i]: { value: entry.value, isNull: e.target.checked },
                              }))
                            }
                            className="h-3.5 w-3.5 rounded border-border"
                          />
                          NULL
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* SQL preview */}
              <pre className="rounded border border-border bg-secondary/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
                {buildCallSql()}
              </pre>

              {/* Error */}
              {execError && (
                <div className="mt-3 overflow-hidden rounded-lg border border-destructive/40">
                  <div className="flex items-center gap-1.5 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {t("table.executionFailed")}
                  </div>
                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {execError}
                  </pre>
                </div>
              )}

              {/* Result */}
              {execResult && (
                <div className="mt-3 h-56 overflow-hidden rounded border border-border">
                  <ResultsGrid result={execResult} />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  if (!executing) setExecOpen(false);
                }}
                disabled={executing}
                className="rounded-lg px-3.5 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
              >
                {t("table.close")}
              </button>
              <button
                type="button"
                onClick={() => void runExecute()}
                disabled={executing}
                className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {executing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {executing ? t("table.running") : t("table.run")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
