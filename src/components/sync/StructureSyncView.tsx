import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  GitCompareArrows,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import type { Dialect } from "../../types";
import { fetchSchemaSnapshot } from "../../hooks/useSchemaSnapshot";
import {
  buildDeploymentScript,
  diffSchemas,
  type DiffOp,
  type DiffStatus,
  type SchemaDiffResult,
  type TableDiff,
} from "../../lib/schemaDiff";
import { splitStatements } from "../../lib/statementSplitter";
import { useTheme } from "../../hooks/useTheme";
import { useTranslation } from "../../i18n";

export interface SyncSession {
  id: string;
  label: string;
  databases: string[];
  dialect: Dialect;
}

export interface StructureSyncViewProps {
  /** Connected sessions to choose source/target from. */
  sessions: SyncSession[];
  initialSourceSessionId?: string;
  initialSourceDatabase?: string;
  getTables: (
    s: string,
    db: string,
    schema?: string
  ) => Promise<import("../../types").TableInfo[]>;
  getColumns: (
    s: string,
    db: string,
    t: string,
    schema?: string
  ) => Promise<import("../../types").ColumnDefinition[]>;
  getIndexes: (
    s: string,
    db: string,
    t: string,
    schema?: string
  ) => Promise<import("../../types").IndexInfo[]>;
  getForeignKeys: (
    s: string,
    db: string,
    t: string,
    schema?: string
  ) => Promise<import("../../types").ForeignKeyInfo[]>;
  /** Batched columns+indexes+FKs fetcher — lets Compare skip the per-table N+1. */
  getSchemaGraph?: (
    s: string,
    db: string,
    tables: string[],
    schema?: string
  ) => Promise<import("../../types").TableGraph[]>;
  /** Run the deployment script on TARGET. */
  executeQuery: (sessionId: string, sql: string) => Promise<unknown>;
}

/** Where one side of the comparison points. */
interface SideSel {
  sessionId: string;
  database: string;
}

/** A single line in the run log. */
interface RunLine {
  kind: "ok" | "error" | "info";
  text: string;
}

const STATUS_ORDER: DiffStatus[] = ["different", "only-source", "only-target", "same"];

const STATUS_META: Record<DiffStatus, { labelKey: string; dot: string }> = {
  different: { labelKey: "io.statusDifferent", dot: "bg-amber-500" },
  "only-source": { labelKey: "io.statusOnlyInSource", dot: "bg-green-500" },
  "only-target": { labelKey: "io.statusOnlyInTarget", dot: "bg-red-500" },
  same: { labelKey: "io.statusIdentical", dot: "bg-muted-foreground/40" },
};

const OP_LABEL_KEY: Record<DiffOp["kind"], string> = {
  "create-table": "io.opCreateTable",
  "drop-table": "io.opDropTable",
  "add-column": "io.opAddColumn",
  "drop-column": "io.opDropColumn",
  "alter-column": "io.opAlterColumn",
  "add-index": "io.opAddIndex",
  "drop-index": "io.opDropIndex",
  "add-fk": "io.opAddFk",
  "drop-fk": "io.opDropFk",
};

/** A SQL op is "destructive" if it can lose data on the target. */
function isDestructive(kind: DiffOp["kind"]): boolean {
  return kind === "drop-table" || kind === "drop-column";
}

export function StructureSyncView(props: StructureSyncViewProps) {
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
  };
  const initialTarget: SideSel = {
    sessionId: firstSession?.id ?? "",
    database: firstSession?.databases[0] ?? "",
  };

  const [source, setSource] = useState<SideSel>(initialSource);
  const [target, setTarget] = useState<SideSel>(initialTarget);

  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [diff, setDiff] = useState<SchemaDiffResult | null>(null);
  /** Ids of ops the user has UN-checked (default = every non-"same" op checked). */
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /** User-editable deployment script; null until first generated. */
  const [script, setScript] = useState<string | null>(null);
  /** True once the user hand-edits the script (so checkbox changes don't clobber). */
  const [scriptDirty, setScriptDirty] = useState(false);

  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<RunLine[]>([]);
  const [runSummary, setRunSummary] = useState<string | null>(null);

  const sourceSession = sessionById(sessions, source.sessionId);
  const targetSession = sessionById(sessions, target.sessionId);

  // All ops across all tables, in diff order.
  const allOps = useMemo<DiffOp[]>(
    () => (diff ? diff.tables.flatMap((t) => t.ops) : []),
    [diff]
  );

  const selectedOps = useMemo(
    () => allOps.filter((op) => !unchecked.has(op.id)),
    [allOps, unchecked]
  );

  // The auto-generated script from the current selection.
  const generatedScript = useMemo(
    () => (diff ? buildDeploymentScript(selectedOps) : ""),
    [diff, selectedOps]
  );

  // The script actually shown/run: the user's edits if any, else the generated one.
  const effectiveScript = scriptDirty && script != null ? script : generatedScript;

  const dialectMismatch =
    !!sourceSession &&
    !!targetSession &&
    sourceSession.dialect !== targetSession.dialect;

  const canCompare =
    !!sourceSession &&
    !!targetSession &&
    !!source.database &&
    !!target.database &&
    !comparing &&
    !(source.sessionId === target.sessionId && source.database === target.database);

  async function handleCompare() {
    if (!sourceSession || !targetSession) return;
    setComparing(true);
    setCompareError(null);
    setDiff(null);
    setRunLog([]);
    setRunSummary(null);
    setScript(null);
    setScriptDirty(false);
    try {
      const [srcSnap, tgtSnap] = await Promise.all([
        fetchSchemaSnapshot({
          sessionId: source.sessionId,
          database: source.database,
          dialect: sourceSession.dialect,
          getTables: props.getTables,
          getColumns: props.getColumns,
          getIndexes: props.getIndexes,
          getForeignKeys: props.getForeignKeys,
          getSchemaGraph: props.getSchemaGraph,
        }),
        fetchSchemaSnapshot({
          sessionId: target.sessionId,
          database: target.database,
          dialect: targetSession.dialect,
          getTables: props.getTables,
          getColumns: props.getColumns,
          getIndexes: props.getIndexes,
          getForeignKeys: props.getForeignKeys,
          getSchemaGraph: props.getSchemaGraph,
        }),
      ]);
      const result = diffSchemas(srcSnap, tgtSnap);
      setDiff(result);
      // Default: every non-"same" op checked → start with an empty unchecked set.
      setUnchecked(new Set());
      // Expand tables that have ops so the user immediately sees the changes.
      setExpanded(
        new Set(
          result.tables.filter((t) => t.ops.length > 0).map((t) => tableKey(t))
        )
      );
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : String(e));
    } finally {
      setComparing(false);
    }
  }

  function toggleOp(id: string) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // A checkbox change resets the user's manual script edits (live regeneration).
    setScriptDirty(false);
  }

  function toggleTable(diffTable: TableDiff) {
    const key = tableKey(diffTable);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Check / uncheck every op in a table at once. */
  function setTableOps(diffTable: TableDiff, checked: boolean) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      for (const op of diffTable.ops) {
        if (checked) next.delete(op.id);
        else next.add(op.id);
      }
      return next;
    });
    setScriptDirty(false);
  }

  async function handleRun() {
    if (!targetSession) return;
    const sql = effectiveScript;
    const statements = splitStatements(sql);
    if (statements.length === 0) return;

    setRunning(true);
    setRunLog([]);
    setRunSummary(null);

    const total = statements.length;
    const started = performance.now();
    const lines: RunLine[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < total; i++) {
      const stmt = statements[i];
      try {
        await props.executeQuery(target.sessionId, stmt.text);
        succeeded++;
        const preview = stmt.text.replace(/\s+/g, " ").slice(0, 90);
        lines.push({ kind: "ok", text: `${i + 1}/${total}  ${preview}` });
        setRunLog([...lines]);
      } catch (e) {
        failed++;
        lines.push({ kind: "error", text: `${i + 1}/${total}  ${String(e)}` });
        setRunLog([...lines]);
        lines.push({
          kind: "info",
          text: t("io.stoppedFixAndRerun"),
        });
        setRunLog([...lines]);
        break;
      }
    }

    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    setRunSummary(`${succeeded} succeeded · ${failed} failed · ${elapsed}s`);
    setRunning(false);
  }

  const groups = useMemo(() => groupByStatus(diff), [diff]);
  const changedTableCount = diff
    ? diff.tables.filter((t) => t.status !== "same").length
    : 0;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* ── Top bar: source → target + Compare ── */}
      <div className="flex flex-wrap items-end gap-4 border-b border-border p-4">
        <SidePicker
          label={t("io.source")}
          caption={t("io.sourceDesiredStructure")}
          sessions={sessions}
          value={source}
          onChange={(v) => {
            setSource(v);
            setDiff(null);
          }}
        />

        <div className="flex h-9 items-center self-center pt-5 text-muted-foreground">
          <ArrowRight className="h-5 w-5" />
        </div>

        <SidePicker
          label={t("io.stepTarget")}
          caption={t("io.targetWillBeModified")}
          sessions={sessions}
          value={target}
          onChange={(v) => {
            setTarget(v);
            setDiff(null);
          }}
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

      {/* ── Caption / warnings ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card/40 px-4 py-2 text-xs">
        <span className="text-muted-foreground">
          {t("io.syncTransformsNote")}
        </span>
        {dialectMismatch && (
          <span className="flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("io.dialectMismatchBestEffort", {
              source: sourceSession?.dialect ?? "",
              target: targetSession?.dialect ?? "",
            })}
          </span>
        )}
        {source.sessionId === target.sessionId &&
          source.database === target.database && (
            <span className="text-amber-600 dark:text-amber-400">
              {t("io.sameDatabaseWarning")}
            </span>
          )}
      </div>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT: difference tree */}
        <div className="flex w-[44%] min-w-[320px] flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <h3 className="text-sm font-semibold">{t("io.differences")}</h3>
            {diff && (
              <span className="text-xs text-muted-foreground">
                {t("io.tablesChangedSummary", {
                  changed: changedTableCount,
                  total: diff.tables.length,
                  selected: selectedOps.length,
                  ops: allOps.length,
                })}
              </span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {/* States */}
            {comparing && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("io.comparingSchemas")}
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
                <p>{t("io.pickSourceTargetCompare")}</p>
              </div>
            )}

            {!comparing && !compareError && diff && allOps.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{t("io.schemasInSync")}</p>
                <p>{t("io.noStructuralDifferences")}</p>
              </div>
            )}

            {!comparing && !compareError && diff && allOps.length > 0 && (
              <div className="py-1">
                {STATUS_ORDER.map((status) => {
                  const tablesIn = groups[status];
                  if (!tablesIn.length) return null;
                  const meta = STATUS_META[status];
                  return (
                    <div key={status} className="mb-1">
                      <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <span
                          className={`h-2 w-2 rounded-full ${meta.dot}`}
                        />
                        {t(meta.labelKey)}
                        <span className="font-normal lowercase text-muted-foreground/60">
                          ({tablesIn.length})
                        </span>
                      </div>
                      {tablesIn.map((diffTable) => (
                        <TableRow
                          key={tableKey(diffTable)}
                          diffTable={diffTable}
                          expanded={expanded.has(tableKey(diffTable))}
                          unchecked={unchecked}
                          onToggleExpand={() => toggleTable(diffTable)}
                          onToggleOp={toggleOp}
                          onToggleAll={(checked) => setTableOps(diffTable, checked)}
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
                {t("io.runsOnTargetDb", {
                  target: targetSession?.label ?? t("io.stepTarget"),
                  database: target.database || "—",
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
                disabled={
                  running || !diff || effectiveScript.trim().length === 0
                }
                className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                title={t("io.executeScriptOnTarget")}
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

          {/* Destructive-op warning */}
          {diff &&
            selectedOps.some((op) => isDestructive(op.kind)) &&
            !running && (
              <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {t("io.dropOpsWarning")}
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
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {t("io.scriptWillAppearAfterCompare")}
              </div>
            )}
          </div>

          {/* Run log / summary */}
          {(runLog.length > 0 || runSummary) && (
            <div className="max-h-48 shrink-0 overflow-auto border-t border-border bg-card/40 p-3">
              {runSummary && (
                <p className="mb-2 text-xs font-medium">{runSummary}</p>
              )}
              <div className="space-y-0.5 font-mono text-xs">
                {runLog.map((line, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 ${
                      line.kind === "error"
                        ? "text-destructive"
                        : line.kind === "ok"
                          ? "text-green-600 dark:text-green-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span className="shrink-0">
                      {line.kind === "ok" ? "✓" : line.kind === "error" ? "✗" : "·"}
                    </span>
                    <span className="break-all">{line.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A source/target session + database picker. */
function SidePicker({
  label,
  caption,
  sessions,
  value,
  onChange,
}: {
  label: string;
  caption: string;
  sessions: SyncSession[];
  value: SideSel;
  onChange: (v: SideSel) => void;
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
            });
          }}
          className="h-9 min-w-[140px] rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
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
          onChange={(e) => onChange({ ...value, database: e.target.value })}
          disabled={databases.length === 0}
          className="h-9 min-w-[140px] rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {databases.length === 0 && <option value="">{t("io.noDatabases")}</option>}
          {databases.map((db) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** One table row in the difference tree, with expandable per-op checkboxes. */
function TableRow({
  diffTable,
  expanded,
  unchecked,
  onToggleExpand,
  onToggleOp,
  onToggleAll,
}: {
  diffTable: TableDiff;
  expanded: boolean;
  unchecked: Set<string>;
  onToggleExpand: () => void;
  onToggleOp: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const hasOps = diffTable.ops.length > 0;
  const checkedCount = diffTable.ops.filter((op) => !unchecked.has(op.id)).length;
  const allChecked = hasOps && checkedCount === diffTable.ops.length;
  const someChecked = checkedCount > 0 && !allChecked;

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-1 px-3 py-1.5 hover:bg-accent/40"
        onClick={hasOps ? onToggleExpand : undefined}
      >
        <span className="flex h-4 w-4 items-center justify-center text-muted-foreground">
          {hasOps ? (
            expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : null}
        </span>
        {hasOps && (
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = someChecked;
            }}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onToggleAll(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
        )}
        <span className="truncate text-sm">{diffTable.table}</span>
        {hasOps && (
          <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground/60">
            {checkedCount}/{diffTable.ops.length}
          </span>
        )}
      </div>

      {expanded && hasOps && (
        <div>
          {diffTable.ops.map((op) => (
            <div
              key={op.id}
              className="flex items-start gap-2 py-1 pl-12 pr-3 hover:bg-accent/30"
            >
              <input
                type="checkbox"
                checked={!unchecked.has(op.id)}
                onChange={() => onToggleOp(op.id)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                      isDestructive(op.kind)
                        ? "bg-red-500/15 text-red-600 dark:text-red-400"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {t(OP_LABEL_KEY[op.kind])}
                  </span>
                  <span className="truncate text-xs">{op.description}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── helpers ──

function sessionById(
  sessions: SyncSession[],
  id?: string
): SyncSession | undefined {
  if (!id) return undefined;
  return sessions.find((s) => s.id === id);
}

/** Stable key for a diff table (table names are unique within a snapshot). */
function tableKey(t: TableDiff): string {
  return t.table;
}

/** Bucket diff tables by status for the grouped left-pane list. */
function groupByStatus(
  diff: SchemaDiffResult | null
): Record<DiffStatus, TableDiff[]> {
  const out: Record<DiffStatus, TableDiff[]> = {
    different: [],
    "only-source": [],
    "only-target": [],
    same: [],
  };
  if (!diff) return out;
  for (const t of diff.tables) out[t.status].push(t);
  return out;
}
