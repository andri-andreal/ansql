import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  AlertTriangle,
  ArrowRight,
  GitCompareArrows,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import type {
  ColumnDefinition,
  Dialect,
  MutationColumn,
  QueryResult,
  Statement,
  TableInfo,
} from "../../types";
import {
  buildSyncStatements,
  diffRows,
  type DataDiffResult,
  type RowDiffKind,
} from "../../lib/dataDiff";
import { quoteIdent } from "../../lib/mutationBuilder";
import { useTheme } from "../../hooks/useTheme";
import { useTranslation } from "../../i18n";

export interface DataSyncSession {
  id: string;
  label: string;
  databases: string[];
  dialect: Dialect;
}

export interface DataSyncViewProps {
  /** Connected sessions to choose source/target from. */
  sessions: DataSyncSession[];
  initialSourceSessionId?: string;
  initialSourceDatabase?: string;
  getTables: (
    s: string,
    db: string,
    schema?: string
  ) => Promise<TableInfo[]>;
  getColumns: (
    s: string,
    db: string,
    t: string,
    schema?: string
  ) => Promise<ColumnDefinition[]>;
  executeQuery: (sessionId: string, sql: string) => Promise<QueryResult>;
  /** Commit the generated statements to TARGET in one transaction (commitChanges). */
  runOnTarget: (
    sessionId: string,
    statements: { sql: string; params: unknown[] }[]
  ) => Promise<unknown>;
  onClose: () => void;
}

/** Where one side of the comparison points (session + database + table). */
interface SideSel {
  sessionId: string;
  database: string;
  table: string;
}

const KIND_ORDER: RowDiffKind[] = ["insert", "update", "delete"];

const KIND_META: Record<RowDiffKind, { labelKey: string; dot: string }> = {
  insert: { labelKey: "io.insertsLabel", dot: "bg-green-500" },
  update: { labelKey: "io.updatesLabel", dot: "bg-amber-500" },
  delete: { labelKey: "io.deletesLabel", dot: "bg-red-500" },
};

export function DataSyncView(props: DataSyncViewProps) {
  const { sessions } = props;
  const { resolvedTheme } = useTheme();
  const { t } = useTranslation();

  const firstSession = sessions[0];
  const initialSource: SideSel = {
    sessionId: props.initialSourceSessionId ?? firstSession?.id ?? "",
    database:
      props.initialSourceDatabase ??
      sessionById(sessions, props.initialSourceSessionId)?.databases[0] ??
      firstSession?.databases[0] ??
      "",
    table: "",
  };
  const initialTarget: SideSel = {
    sessionId: firstSession?.id ?? "",
    database: firstSession?.databases[0] ?? "",
    table: "",
  };

  const [source, setSource] = useState<SideSel>(initialSource);
  const [target, setTarget] = useState<SideSel>(initialTarget);

  // Tables available on each side (loaded lazily when a db is chosen).
  const [sourceTables, setSourceTables] = useState<string[]>([]);
  const [targetTables, setTargetTables] = useState<string[]>([]);
  const [loadingSourceTables, setLoadingSourceTables] = useState(false);
  const [loadingTargetTables, setLoadingTargetTables] = useState(false);

  // Key columns (default to the source table's PKs) and the union of columns.
  const [columns, setColumns] = useState<MutationColumn[]>([]);
  const [keyColumns, setKeyColumns] = useState<string[]>([]);

  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [diff, setDiff] = useState<DataDiffResult | null>(null);

  /** Ids of rows the user has UN-checked (default = every diff row checked). */
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  /** User-editable deployment script; null until first generated. */
  const [script, setScript] = useState<string | null>(null);
  const [scriptDirty, setScriptDirty] = useState(false);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);

  const sourceSession = sessionById(sessions, source.sessionId);
  const targetSession = sessionById(sessions, target.sessionId);

  // All diff rows across kinds, in display order.
  const allRows = useMemo(
    () =>
      diff
        ? [...diff.inserts, ...diff.updates, ...diff.deletes]
        : [],
    [diff]
  );

  const selectedIds = useMemo(
    () => allRows.filter((r) => !unchecked.has(r.id)).map((r) => r.id),
    [allRows, unchecked]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Pre-quoted, fully-qualified target table name for statement generation.
  const targetTableName = useMemo(() => {
    if (!targetSession || !target.table) return "";
    return quoteIdent(targetSession.dialect, target.table);
  }, [targetSession, target.table]);

  // Auto-generated statements for the current selection.
  const generatedStatements = useMemo<Statement[]>(() => {
    if (!diff || !targetSession || !targetTableName) return [];
    return buildSyncStatements(diff, selectedIdSet, {
      dialect: targetSession.dialect,
      tableName: targetTableName,
      columns,
      keyColumns,
    });
  }, [diff, targetSession, targetTableName, selectedIdSet, columns, keyColumns]);

  // The previewable SQL text of the generated statements (params inlined as comments).
  const generatedScript = useMemo(
    () => statementsToScript(generatedStatements),
    [generatedStatements]
  );

  const effectiveScript =
    scriptDirty && script != null ? script : generatedScript;

  const dialectMismatch =
    !!sourceSession &&
    !!targetSession &&
    sourceSession.dialect !== targetSession.dialect;

  const sameTable =
    source.sessionId === target.sessionId &&
    source.database === target.database &&
    !!source.table &&
    source.table === target.table;

  const canCompare =
    !!sourceSession &&
    !!targetSession &&
    !!source.database &&
    !!target.database &&
    !!source.table &&
    !!target.table &&
    keyColumns.length > 0 &&
    !comparing &&
    !sameTable;

  async function loadTables(side: "source" | "target", sel: SideSel) {
    if (!sel.sessionId || !sel.database) {
      if (side === "source") setSourceTables([]);
      else setTargetTables([]);
      return;
    }
    if (side === "source") setLoadingSourceTables(true);
    else setLoadingTargetTables(true);
    try {
      const tables = await props.getTables(sel.sessionId, sel.database);
      const names = tables.map((t) => t.name);
      if (side === "source") setSourceTables(names);
      else setTargetTables(names);
    } catch {
      if (side === "source") setSourceTables([]);
      else setTargetTables([]);
    } finally {
      if (side === "source") setLoadingSourceTables(false);
      else setLoadingTargetTables(false);
    }
  }

  function resetResults() {
    setDiff(null);
    setCompareError(null);
    setRunError(null);
    setRunSummary(null);
    setScript(null);
    setScriptDirty(false);
  }

  function onSourceChange(next: SideSel) {
    const dbOrTableChanged =
      next.sessionId !== source.sessionId ||
      next.database !== source.database;
    setSource(next);
    resetResults();
    if (dbOrTableChanged) {
      setColumns([]);
      setKeyColumns([]);
      void loadTables("source", next);
    }
  }

  function onTargetChange(next: SideSel) {
    const dbOrSessionChanged =
      next.sessionId !== target.sessionId ||
      next.database !== target.database;
    setTarget(next);
    resetResults();
    if (dbOrSessionChanged) {
      void loadTables("target", next);
    }
  }

  /** When the source table changes, load its columns and default key columns to PKs. */
  async function onSourceTableChange(table: string) {
    onSourceChange({ ...source, table });
    // Mirror the table on target when it exists there (convenience default).
    if (!target.table && targetTables.includes(table)) {
      setTarget((prev) => ({ ...prev, table }));
    }
    if (!source.sessionId || !source.database || !table) {
      setColumns([]);
      setKeyColumns([]);
      return;
    }
    try {
      const defs = await props.getColumns(source.sessionId, source.database, table);
      const cols: MutationColumn[] = defs.map((c) => ({
        name: c.name,
        data_type: c.data_type,
        is_primary_key: c.is_primary_key,
        is_auto_increment: c.is_auto_increment,
      }));
      setColumns(cols);
      const pks = cols.filter((c) => c.is_primary_key).map((c) => c.name);
      setKeyColumns(pks);
    } catch {
      setColumns([]);
      setKeyColumns([]);
    }
  }

  function toggleKeyColumn(name: string) {
    setKeyColumns((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
    resetResults();
  }

  async function handleCompare() {
    if (!sourceSession || !targetSession || !source.table || !target.table) return;
    setComparing(true);
    setCompareError(null);
    setDiff(null);
    setRunError(null);
    setRunSummary(null);
    setScript(null);
    setScriptDirty(false);
    try {
      const srcSql = `SELECT * FROM ${quoteIdent(sourceSession.dialect, source.table)}`;
      const tgtSql = `SELECT * FROM ${quoteIdent(targetSession.dialect, target.table)}`;
      const [srcRes, tgtRes] = await Promise.all([
        props.executeQuery(source.sessionId, srcSql),
        props.executeQuery(target.sessionId, tgtSql),
      ]);
      const result = diffRows({
        keyColumns,
        columns,
        sourceRows: srcRes.rows,
        targetRows: tgtRes.rows,
      });
      setDiff(result);
      setUnchecked(new Set());
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : String(e));
    } finally {
      setComparing(false);
    }
  }

  function toggleRow(id: string) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setScriptDirty(false);
  }

  function setKindRows(kind: RowDiffKind, checked: boolean) {
    if (!diff) return;
    const ids = rowsForKind(diff, kind).map((r) => r.id);
    setUnchecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    setScriptDirty(false);
  }

  async function handleRun() {
    if (!targetSession || generatedStatements.length === 0) return;
    setRunning(true);
    setRunError(null);
    setRunSummary(null);
    const started = performance.now();
    try {
      await props.runOnTarget(
        target.sessionId,
        generatedStatements.map((s) => ({ sql: s.sql, params: s.params }))
      );
      const elapsed = ((performance.now() - started) / 1000).toFixed(2);
      setRunSummary(
        t("io.statementsApplied", {
          count: generatedStatements.length,
          target: targetSession.label,
          elapsed,
        })
      );
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const counts = diff
    ? {
        insert: diff.inserts.length,
        update: diff.updates.length,
        delete: diff.deletes.length,
      }
    : { insert: 0, update: 0, delete: 0 };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* ── Top bar: source → target + Compare ── */}
      <div className="flex flex-wrap items-end gap-4 border-b border-border p-4">
        <SidePicker
          label={t("io.source")}
          caption={t("io.sourceRowsToCopy")}
          sessions={sessions}
          value={source}
          tables={sourceTables}
          loadingTables={loadingSourceTables}
          onChange={onSourceChange}
          onTableChange={onSourceTableChange}
        />

        <div className="flex h-9 items-center self-center pt-5 text-muted-foreground">
          <ArrowRight className="h-5 w-5" />
        </div>

        <SidePicker
          label={t("io.stepTarget")}
          caption={t("io.targetWillBeModified")}
          sessions={sessions}
          value={target}
          tables={targetTables}
          loadingTables={loadingTargetTables}
          onChange={onTargetChange}
          onTableChange={(table) => onTargetChange({ ...target, table })}
        />

        <button
          onClick={handleCompare}
          disabled={!canCompare}
          className="ml-auto flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          {comparing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GitCompareArrows className="h-4 w-4" />
          )}
          {t("io.compare")}
        </button>
      </div>

      {/* ── Key columns + warnings ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card/40 px-4 py-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          {t("io.keyColumns")}
        </span>
        {columns.length === 0 ? (
          <span className="text-muted-foreground/70">
            {t("io.chooseSourceTableForKeys")}
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {columns.map((c) => {
              const active = keyColumns.includes(c.name);
              return (
                <button
                  key={c.name}
                  onClick={() => toggleKeyColumn(c.name)}
                  className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                  title={
                    c.is_primary_key
                      ? t("io.primaryKey", { name: c.name })
                      : c.name
                  }
                >
                  {c.name}
                  {c.is_primary_key && (
                    <span className="ml-1 text-[10px] text-muted-foreground/60">
                      PK
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {dialectMismatch && (
          <span className="flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("io.dialectMismatchShort", {
              source: sourceSession?.dialect ?? "",
              target: targetSession?.dialect ?? "",
            })}
          </span>
        )}
        {sameTable && (
          <span className="text-amber-600 dark:text-amber-400">
            {t("io.sameTableWarning")}
          </span>
        )}
        {columns.length > 0 && keyColumns.length === 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            {t("io.selectAtLeastOneKeyColumn")}
          </span>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT: row-difference list */}
        <div className="flex w-[44%] min-w-[320px] flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <h3 className="text-sm font-semibold">{t("io.differences")}</h3>
            {diff && (
              <span className="text-xs text-muted-foreground">
                {t("io.diffSummaryCounts", {
                  inserts: counts.insert,
                  updates: counts.update,
                  deletes: counts.delete,
                  selected: selectedIds.length,
                  total: allRows.length,
                })}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {comparing && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("io.comparingRows")}
              </div>
            )}

            {!comparing && compareError && (
              <div className="m-4 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{compareError}</span>
              </div>
            )}

            {!comparing && !compareError && !diff && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                <GitCompareArrows className="h-8 w-8 opacity-40" />
                <p>
                  {t("io.pickSourceTargetTableCompare")}
                </p>
              </div>
            )}

            {!comparing && !compareError && diff && allRows.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{t("io.dataInSync")}</p>
                <p>{t("io.noRowDifferences")}</p>
              </div>
            )}

            {!comparing && !compareError && diff && allRows.length > 0 && (
              <div className="py-1">
                {KIND_ORDER.map((kind) => {
                  const rows = rowsForKind(diff, kind);
                  if (!rows.length) return null;
                  const meta = KIND_META[kind];
                  const checkedCount = rows.filter(
                    (r) => !unchecked.has(r.id)
                  ).length;
                  const allChecked = checkedCount === rows.length;
                  const someChecked = checkedCount > 0 && !allChecked;
                  return (
                    <div key={kind} className="mb-1">
                      <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={(el) => {
                            if (el) el.indeterminate = someChecked;
                          }}
                          onChange={(e) => setKindRows(kind, e.target.checked)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                        {t(meta.labelKey)}
                        <span className="font-normal lowercase text-muted-foreground/60">
                          ({checkedCount}/{rows.length})
                        </span>
                      </div>
                      {rows.map((row) => (
                        <RowItem
                          key={row.id}
                          kind={kind}
                          label={rowLabel(row, keyColumns)}
                          detail={rowDetail(row, kind)}
                          checked={!unchecked.has(row.id)}
                          onToggle={() => toggleRow(row.id)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: deployment script + run */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t("io.deploymentScript")}</h3>
              <span className="text-xs text-muted-foreground">
                {t("io.runsOnTargetTable", {
                  target: targetSession?.label ?? t("io.stepTarget"),
                  database: target.database || "—",
                  table: target.table ? `.${target.table}` : "",
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {scriptDirty && (
                <button
                  onClick={() => {
                    setScript(null);
                    setScriptDirty(false);
                  }}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary"
                  title={t("io.discardEditsRegenerate")}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("io.reset")}
                </button>
              )}
              <button
                onClick={handleRun}
                disabled={running || generatedStatements.length === 0}
                className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                title={t("io.applyStatementsToTarget")}
              >
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {t("io.runOnTarget")}
              </button>
            </div>
          </div>

          {/* Destructive warning when deletes are selected. */}
          {diff &&
            counts.delete > 0 &&
            diff.deletes.some((r) => !unchecked.has(r.id)) &&
            !running && (
              <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {t("io.deleteStatementsWarning")}
              </div>
            )}

          {/* Editor */}
          <div className="min-h-0 flex-1">
            {diff ? (
              <Editor
                height="100%"
                language="sql"
                value={effectiveScript}
                onChange={(v) => {
                  setScript(v ?? "");
                  setScriptDirty(true);
                }}
                theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily:
                    "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: "on",
                  renderWhitespace: "none",
                  // The preview is informational; edits don't change what runs.
                  readOnly: false,
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {t("io.scriptWillAppearAfterCompare")}
              </div>
            )}
          </div>

          {scriptDirty && (
            <div className="shrink-0 border-t border-border bg-card/40 px-4 py-1.5 text-xs text-muted-foreground">
              {t("io.manualEditsPreviewOnly")}
            </div>
          )}

          {/* Run result / error */}
          {(runSummary || runError) && (
            <div className="shrink-0 border-t border-border bg-card/40 p-3 text-xs">
              {runError ? (
                <div className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-words">{runError}</span>
                </div>
              ) : (
                <p className="font-medium text-green-600 dark:text-green-400">
                  {runSummary}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A source/target session + database + table picker. */
function SidePicker({
  label,
  caption,
  sessions,
  value,
  tables,
  loadingTables,
  onChange,
  onTableChange,
}: {
  label: string;
  caption: string;
  sessions: DataSyncSession[];
  value: SideSel;
  tables: string[];
  loadingTables: boolean;
  onChange: (v: SideSel) => void;
  onTableChange: (table: string) => void;
}) {
  const { t } = useTranslation();
  const session = sessionById(sessions, value.sessionId);
  const databases = session?.databases ?? [];

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}{" "}
        <span className="font-normal normal-case text-muted-foreground/60">
          {caption}
        </span>
      </span>
      <div className="flex items-center gap-2">
        <select
          value={value.sessionId}
          onChange={(e) => {
            const next = sessionById(sessions, e.target.value);
            onChange({
              sessionId: e.target.value,
              database: next?.databases[0] ?? "",
              table: "",
            });
          }}
          className="h-9 min-w-[130px] rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {sessions.length === 0 && <option value="">{t("io.noSessions")}</option>}
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={value.database}
          onChange={(e) =>
            onChange({ ...value, database: e.target.value, table: "" })
          }
          disabled={databases.length === 0}
          className="h-9 min-w-[130px] rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {databases.length === 0 && <option value="">{t("io.noDatabases")}</option>}
          {databases.map((db) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))}
        </select>
        <select
          value={value.table}
          onChange={(e) => onTableChange(e.target.value)}
          disabled={loadingTables || tables.length === 0}
          className="h-9 min-w-[140px] rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          <option value="">
            {loadingTables
              ? t("io.loadingDots")
              : tables.length === 0
                ? t("io.noTables")
                : t("io.selectTable")}
          </option>
          {tables.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** One row in the difference list. */
function RowItem({
  kind,
  label,
  detail,
  checked,
  onToggle,
}: {
  kind: RowDiffKind;
  label: string;
  detail: string | null;
  checked: boolean;
  onToggle: () => void;
}) {
  const badge =
    kind === "insert"
      ? "bg-green-500/15 text-green-600 dark:text-green-400"
      : kind === "delete"
        ? "bg-red-500/15 text-red-600 dark:text-red-400"
        : "bg-amber-500/15 text-amber-600 dark:text-amber-400";

  return (
    <div className="flex items-start gap-2 py-1 pl-7 pr-3 hover:bg-accent/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${badge}`}
          >
            {kind}
          </span>
          <span className="truncate font-mono text-xs">{label}</span>
        </div>
        {detail && (
          <p className="mt-0.5 truncate pl-0.5 text-[11px] text-muted-foreground">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

// ── helpers ──

function sessionById(
  sessions: DataSyncSession[],
  id?: string
): DataSyncSession | undefined {
  if (!id) return undefined;
  return sessions.find((s) => s.id === id);
}

/** Rows in this diff bucket, in their source order. */
function rowsForKind(diff: DataDiffResult, kind: RowDiffKind) {
  if (kind === "insert") return diff.inserts;
  if (kind === "update") return diff.updates;
  return diff.deletes;
}

/** A short `key1=v1, key2=v2` label for a diff row. */
function rowLabel(
  row: DataDiffResult["inserts"][number],
  keyColumns: string[]
): string {
  const data = row.target ?? row.source ?? {};
  const parts = keyColumns.map((k) => `${k}=${formatVal(data[k])}`);
  const text = parts.join(", ");
  return text || row.key || row.id;
}

/** For updates, summarize which columns changed. */
function rowDetail(
  row: DataDiffResult["updates"][number],
  kind: RowDiffKind
): string | null {
  if (kind !== "update") return null;
  if (!row.changedColumns || row.changedColumns.length === 0) return null;
  const changes = row.changedColumns.map((c) => {
    const before = formatVal(row.target?.[c]);
    const after = formatVal(row.source?.[c]);
    return `${c}: ${before} → ${after}`;
  });
  return changes.join("  ·  ");
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string") {
    return v.length > 24 ? `'${v.slice(0, 24)}…'` : `'${v}'`;
  }
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 24 ? `${s.slice(0, 24)}…` : s;
  }
  return String(v);
}

/**
 * Render the generated parameterized statements as a readable preview. Bound
 * params are shown as a trailing comment so the SQL stays valid and copyable.
 * Editing the preview does NOT change what runs (Run on target executes the
 * parameterized statements directly, never this text).
 */
function statementsToScript(statements: Statement[]): string {
  if (statements.length === 0) return "";
  return statements
    .map((s) => {
      const sql = s.sql.endsWith(";") ? s.sql : `${s.sql};`;
      if (s.params.length === 0) return sql;
      const params = s.params
        .map((p) => (typeof p === "string" ? `'${p}'` : String(p)))
        .join(", ");
      return `${sql}  -- params: [${params}]`;
    })
    .join("\n");
}
