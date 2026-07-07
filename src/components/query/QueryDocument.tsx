import { useState, useCallback, useEffect, useRef } from "react";
import { AlertCircle, ChevronUp, ChevronDown, Copy, Sparkles, BarChart3, Pencil } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";
import { format } from "sql-formatter";
import QueryToolbar from "./QueryToolbar";
import QueryEditor from "./QueryEditor";
import ResultTabs from "./ResultTabs";
import { ExplainPlanView } from "./ExplainPlanView";
import { SqlBuilderView } from "./SqlBuilderView";
import HistoryPanel from "./HistoryPanel";
import SavedQueriesPanel from "./SavedQueriesPanel";
import SaveFavoriteDialog from "./SaveFavoriteDialog";
import { ParamInputDialog } from "./ParamInputDialog";
import { SnippetManager } from "./SnippetManager";
import { ConfirmDialog, useDialogs } from "../ui";
import ResultsGrid from "../results/ResultsGrid";
import { ChartView } from "../results/ChartView";
import {
  resultEntryToQueryResult,
  toResultEntry,
  makeSnippet,
  type ResultEntry,
} from "../../hooks/useQueries";
import { useExport } from "../../hooks/useExport";
import { clipboardStore } from "../../lib/clipboardStore";
import { saveFavoriteQuery } from "../../lib/queryPanelCommands";
import { queryCommands } from "../../lib/tauri-commands";
import { splitStatements, statementAtOffset } from "../../lib/statementSplitter";
import {
  extractParamNames,
  applyParamsAsPlaceholders,
  applyParamsRaw,
} from "../../lib/sqlParams";
import { buildExplain } from "../../lib/explain";
import { parseExplainJson, type PlanNode } from "../../lib/explainPlan";
import { capResults, togglePinned, renameResult } from "../../lib/queryTabs";
import { detectSingleTableSelect } from "../../lib/sqlSource";
import { detectSingleTableDml } from "../../lib/rawDmlSource";
import { buildRawUndo, buildSnapshotSql, qualifyTable } from "../../lib/rawDmlSnapshot";
import { buildPreflightPlan, readCountValue, splitPreviewRows } from "../../lib/preflightPreview";
import {
  PreflightDialog,
  type PreflightData,
  type PreflightIrreversibleReason,
} from "./PreflightDialog";
import { useJournalRecorder } from "../../hooks/useActionJournal";
import type { AskAiAction, AskAiContext } from "../../lib/aiPrompts";
import type {
  SessionInfo,
  QueryResult,
  Connection,
  SourceRef,
  ParamValue,
  TableInfo,
  ColumnDefinition,
  ForeignKeyInfo,
  Dialect,
  MutationColumn,
  Statement,
} from "../../types";
import { isSqlDriver, toDialect } from "../../types";
import type { QueryTabPayload } from "../../lib/workspaceTabs";
import { useTranslation } from "../../i18n";

export interface QueryDocumentProps {
  /** This document's app-tab id (for dirty + payload patches). */
  tabId: string;
  /** Controlled document state (content + results + ui prefs). */
  payload: QueryTabPayload;
  /** Patch this document's payload in the workspace (content/results/ui/session). */
  onPatch: (patch: Partial<QueryTabPayload>) => void;
  /** Mark this tab dirty/clean (dirty = has unsaved/un-run edits; see below). */
  onDirty: (dirty: boolean) => void;

  /** Connection/session context for the toolbar selector + autocomplete. */
  sessions: SessionInfo[];
  connections: Connection[];
  /**
   * Switch which connection/database this document targets. Resolves/creates a
   * session and returns its id+database so the doc can write them into payload.
   */
  onConnectionChange: (
    connectionId: string,
    database?: string
  ) => Promise<{ sessionId: string; database: string | null } | void>;

  /** Run SQL against a session (App's executeQuery). Throws on failure. */
  executeQuery: (
    sessionId: string,
    sql: string,
    requestId: string
  ) => Promise<QueryResult>;
  /** Cancel an in-flight request by id. */
  cancelQuery: (requestId: string) => Promise<void>;

  /**
   * Surface this document's currently-selected result (or null) so the App can
   * feed the header Export button. ONLY the active tab's QueryDocument should be
   * the one that ends up driving export — App gates by active id.
   */
  onResultChange?: (result: QueryResult | null) => void;

  /**
   * Open the editable table grid seeded from the active result's single-table
   * SELECT. Wired only when the active result was produced by a query that
   * {@link detectSingleTableSelect} recognises; `whereSql` is the recovered
   * WHERE clause text (sans the leading WHERE), or null when the query had none.
   */
  onEditTable?: (
    sessionId: string,
    database: string,
    table: string,
    schema: string | null,
    whereSql: string | null
  ) => void;

  /**
   * Ask the AI assistant about the current SQL. The document resolves the SQL
   * (selection or statement under the cursor) + the active driver as dialect and
   * forwards everything to the App (which seeds the AI pane).
   */
  onAskAi?: (action: AskAiAction, sql: string, ctx: AskAiContext) => void;
  /** App-provided hook to capture this document's editor-insert callback so the
   * AI pane can drop generated SQL straight into the editor. */
  onRegisterInsertSql?: (insert: ((sql: string) => void) | null) => void;
  /** App-provided hook to capture this document's replace-selection callback so
   * the AI pane's "Replace selection" can overwrite the editor's current
   * selection with generated SQL. */
  onRegisterReplaceSelection?: (replace: ((sql: string) => void) | null) => void;

  /** Schema introspection — drives the visual SQL Builder's table/column/FK pickers. */
  getTables?: (sessionId: string, database: string, schema?: string) => Promise<TableInfo[]>;
  getColumns?: (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ) => Promise<ColumnDefinition[]>;
  getForeignKeys?: (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ) => Promise<ForeignKeyInfo[]>;
}

/**
 * A single standalone query document: one editor + toolbar + results area
 * (ResultTabs + ResultsGrid) plus the History / Saved-queries right dock and the
 * Save-to-Favorites dialog. Content and the executed-result list are CONTROLLED
 * via {@link QueryTabPayload} (lifted into the workspace tab) so switching app
 * tabs preserves an in-progress edit and the grid.
 */
function QueryDocument({
  tabId: _tabId,
  payload,
  onPatch,
  onDirty,
  sessions,
  connections,
  onConnectionChange,
  executeQuery,
  cancelQuery,
  onResultChange,
  onEditTable,
  onAskAi,
  onRegisterInsertSql,
  onRegisterReplaceSelection,
  getTables,
  getColumns,
  getForeignKeys,
}: QueryDocumentProps) {
  const { t } = useTranslation();
  const dialogs = useDialogs();
  const { exportToCSV, exportToJSON } = useExport();
  const { settings } = useSettings();
  // Time Machine: best-effort (Tier-2) undo of raw UPDATE/DELETE statements.
  const recordAction = useJournalRecorder();

  // --- Local (transient, while-mounted) UI state -----------------------------
  // Execution state + in-flight request id are local: they don't need to survive
  // a process restart, only a tab switch (and all tabs stay mounted).
  const [executing, setExecuting] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  // Live Monaco editor instance (surfaced via QueryEditor's onEditorMount) so we
  // can read the current selection + cursor offset for scoped Run actions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  // Mirrors whether the editor has a non-empty selection — drives the
  // "Run Selected" button's enabled state.
  const [hasSelection, setHasSelection] = useState(false);

  // When a run encounters [$name] params, we stash the raw SQL here and open the
  // ParamInputDialog; submitting it resumes the run with the collected values.
  const [pendingParamSql, setPendingParamSql] = useState<string | null>(null);
  const [pendingParamNames, setPendingParamNames] = useState<string[]>([]);

  // Resize / collapse for the results panel. resultsPanelHeight + showResults are
  // mirrored into the payload so they survive tab switches; we keep a local copy
  // for the live drag and write it back through onPatch.
  const [isResizing, setIsResizing] = useState(false);
  const showResults = payload.showResults ?? true;
  const resultsPanelHeight = payload.resultsPanelHeight ?? 300;

  // Side panels (history / saved queries) and the save dialog. These are
  // transient dock toggles — local state is fine and persists while mounted.
  const [showHistory, setShowHistory] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  // Bumped after a save so the SavedQueriesPanel reloads.
  const [favoritesSignal, setFavoritesSignal] = useState(0);

  // Toggles the chart view over the results grid (visualizes the active result).
  const [showChart, setShowChart] = useState(false);

  // Parsed EXPLAIN plan tree → drives the docked ExplainPlanView (null = hidden).
  const [explainNodes, setExplainNodes] = useState<PlanNode[] | null>(null);
  // Visual SELECT builder modal toggle.
  const [showBuilder, setShowBuilder] = useState(false);

  // --- Derived session / connection context ---------------------------------
  const activeSession = sessions.find((s) => s.id === payload.sessionId);
  const activeConnection = connections.find(
    (c) => c.id === activeSession?.connection_id
  );
  const activeConnectionId = activeSession?.connection_id ?? null;
  const activeDatabase =
    payload.database ?? activeSession?.database ?? activeConnection?.database ?? null;
  // The query workspace is SQL-only; narrow the active connection's driver to a
  // SQL Dialect (defaulting to mysql when there is no SQL connection in context).
  const connDialect: Dialect =
    activeConnection && isSqlDriver(activeConnection.driver)
      ? toDialect(activeConnection.driver)
      : "mysql";

  // --- Derived result state (from controlled payload) -----------------------
  const results = payload.results;
  const activeResultEntry: ResultEntry | null =
    results.find((r) => r.id === payload.activeResultId) ??
    (results.length > 0 ? results[results.length - 1] : null);
  const currentResult: QueryResult | null =
    activeResultEntry && !activeResultEntry.error
      ? resultEntryToQueryResult(activeResultEntry)
      : null;
  // The active result's error (per-result), falling back to the doc-level error.
  const activeError = activeResultEntry?.error ?? null;

  // Only offer "Copy as source" when the active session + its connection are
  // still resolvable — a displayed result can outlive its session after disconnect.
  const copySourceReady = !!currentResult && !!activeConnection;

  // "Edit results": when the active (successful) result came from a recognisably
  // single-table SELECT, recover its base table + WHERE so we can open the
  // editable grid seeded from it. Gated on a resolvable session + database +
  // a wired onEditTable handler. null = not editable (read-only grid only).
  const editableSource =
    onEditTable && currentResult && payload.sessionId && activeDatabase && activeResultEntry?.sourceSql
      ? detectSingleTableSelect(activeResultEntry.sourceSql)
      : null;

  // Open the editable table grid for the recovered single-table SELECT.
  const handleEditResults = useCallback(() => {
    if (!onEditTable || !editableSource || !payload.sessionId || !activeDatabase) return;
    onEditTable(
      payload.sessionId,
      activeDatabase,
      editableSource.table,
      editableSource.schema ?? null,
      editableSource.whereSql ?? null
    );
  }, [onEditTable, editableSource, payload.sessionId, activeDatabase]);

  // Surface the current result to the host so a global Export button can use it.
  useEffect(() => {
    onResultChange?.(currentResult);
    return () => onResultChange?.(null);
  }, [currentResult, onResultChange]);

  // Auto-close the chart panel when there's no chartable result (e.g. the active
  // result errored or was cleared) so a stale chart never lingers.
  const canChart = !!currentResult && currentResult.rows.length > 0;
  useEffect(() => {
    if (!canChart && showChart) setShowChart(false);
  }, [canChart, showChart]);

  // --- Execute / Cancel ------------------------------------------------------
  // Build an error ResultEntry for a failed statement, mirroring the shape the
  // (non-error) toResultEntry produces.
  const makeErrorEntry = useCallback((sql: string, errorMsg: string): ResultEntry => {
    return {
      id: `result-err-${crypto.randomUUID()}`,
      snippet: makeSnippet(sql),
      columns: [],
      rows: [],
      execTimeMs: 0,
      error: errorMsg,
    };
  }, []);

  /**
   * Run a single statement (or already-rewritten param SQL) against the session.
   * Passing `opts.params` routes through executeMutation (parameterized) instead
   * of the plain executeQuery path. Returns the produced ResultEntry; on failure
   * it returns an error ResultEntry (never throws) so callers can decide whether
   * to keep going. `opts.label` overrides the snippet (e.g. original [$name] SQL).
   */
  /**
   * Tier-2 Time Machine: for a single-table raw UPDATE/DELETE, snapshot the rows
   * it will touch BEFORE it runs and build a compensating (undo) batch.
   *
   * Returns a discriminated union:
   *   - { kind: "none" }      → not a journalable DML (skip silently).
   *   - { kind: "ready", … }  → snapshot captured; safe to record on success.
   *   - { kind: "too-large" } → snapshot would exceed the cap; caller MUST
   *                              warn the user before running without undo.
   *
   * The cap comes from `settings.timeMachineSnapshotCap` (default 1000).
   */
  const snapshotCap = settings.timeMachineSnapshotCap;

  type UndoCapture =
    | { kind: "none" }
    | { kind: "ready"; inverse: Statement[]; label: string; rows: number; table: string }
    | { kind: "too-large"; cap: number; affectedEstimate: number; table: string; verb: string };

  const captureRawUndo = useCallback(
    async (sessionId: string, sql: string): Promise<UndoCapture> => {
      if (!recordAction || !getColumns || !activeDatabase) return { kind: "none" };
      const src = detectSingleTableDml(sql);
      if (!src) return { kind: "none" };
      // A DELETE with an ORDER BY/LIMIT tail deletes fewer rows than its WHERE
      // matches — the snapshot would "undo" rows that were never deleted.
      if (src.verb === "delete" && src.hasLimitTail) return { kind: "none" };
      try {
        const cols = await getColumns(sessionId, activeDatabase, src.table, src.schema ?? undefined);
        if (cols.length === 0) return { kind: "none" };
        const mutCols: MutationColumn[] = cols.map((c) => ({
          name: c.name,
          data_type: c.data_type,
          is_primary_key: c.is_primary_key,
          is_auto_increment: c.is_auto_increment,
        }));
        const qualified = qualifyTable(connDialect, src);
        // Ask for one extra row so we can tell the difference between
        // "exactly N rows" and "more than the cap".
        const cap = Math.max(1, snapshotCap);
        const snapSql = buildSnapshotSql(connDialect, qualified, src.whereSql, cap + 1);
        const snap = await executeQuery(sessionId, snapSql, crypto.randomUUID());
        if (snap.rows.length > cap) {
          return {
            kind: "too-large",
            cap,
            affectedEstimate: snap.rows.length,
            table: src.table,
            verb: src.verb.toUpperCase(),
          };
        }
        const inverse = buildRawUndo(connDialect, src, mutCols, snap.rows);
        if (!inverse || inverse.length === 0) return { kind: "none" };
        return {
          kind: "ready",
          inverse,
          label: `${src.verb.toUpperCase()} ${src.table} (${snap.rows.length} row(s))`,
          rows: snap.rows.length,
          table: src.table,
        };
      } catch {
        // Snapshot failed (parse mismatch, permissions, …) — degrade silently
        // (the run proceeds, the action just won't be journaled).
        return { kind: "none" };
      }
    },
    [recordAction, getColumns, activeDatabase, connDialect, executeQuery, snapshotCap]
  );

  // When a raw DML exceeds the snapshot cap we surface a confirm modal and
  // block the run until the user decides. The resolver ref holds the promise
  // we resolve on user choice so the in-flight runStatement can resume.
  const [tooLargeConfirm, setTooLargeConfirm] = useState<{
    table: string;
    verb: string;
    cap: number;
    affectedEstimate: number;
  } | null>(null);
  const tooLargeResolverRef = useRef<((ok: boolean) => void) | null>(null);

  // Pre-flight dry-run: preview the rows a raw UPDATE/DELETE will touch and
  // gate execution on an explicit Commit (same resolver pattern as above).
  // The preview SELECT's before-columns double as the Tier-2 undo snapshot,
  // so a previewed run never snapshots twice.
  const [preflight, setPreflight] = useState<PreflightData | null>(null);
  const preflightResolverRef = useRef<((ok: boolean) => void) | null>(null);

  type PreflightCapture =
    | { kind: "none" }
    | {
        kind: "ready";
        data: PreflightData;
        undo: { inverse: Statement[]; label: string; rows: number; table: string } | null;
      };

  const capturePreflight = useCallback(
    async (sessionId: string, sql: string): Promise<PreflightCapture> => {
      if (!settings.preflightEnabled || !getColumns || !activeDatabase) return { kind: "none" };
      const src = detectSingleTableDml(sql);
      if (!src) return { kind: "none" };
      try {
        const cols = await getColumns(sessionId, activeDatabase, src.table, src.schema ?? undefined);
        if (cols.length === 0) return { kind: "none" };
        const cap = Math.max(1, snapshotCap);
        const plan = buildPreflightPlan(
          connDialect,
          src,
          cols.map((c) => c.name),
          cap,
        );
        if (!plan) return { kind: "none" };

        const preview = await executeQuery(sessionId, plan.previewSql, crypto.randomUUID());
        const truncated = preview.rows.length > cap;
        const shown = truncated ? preview.rows.slice(0, cap) : preview.rows;
        const rows = splitPreviewRows(shown, plan.assignments);

        // The preview row count IS the exact headline count unless truncated —
        // only then is the COUNT(*) round-trip worth it.
        let totalRows: number | null = preview.rows.length;
        if (truncated) {
          try {
            totalRows = readCountValue(
              await executeQuery(sessionId, plan.countSql, crypto.randomUUID()),
            );
          } catch {
            totalRows = null;
          }
        }

        const mutCols: MutationColumn[] = cols.map((c) => ({
          name: c.name,
          data_type: c.data_type,
          is_primary_key: c.is_primary_key,
          is_auto_increment: c.is_auto_increment,
        }));
        const pkNames = mutCols.filter((c) => c.is_primary_key).map((c) => c.name);
        const pkAssigned = plan.assignments.some((a) => pkNames.includes(a.column));

        let undo: { inverse: Statement[]; label: string; rows: number; table: string } | null =
          null;
        let irreversible: PreflightIrreversibleReason | null = null;
        if (truncated) {
          irreversible = "truncated";
        } else if (pkAssigned) {
          // The undo would re-target rows by their OLD primary key, which no
          // longer exists after the statement changes it.
          irreversible = "pk-assigned";
        } else if (rows.length === 0) {
          irreversible = "empty";
        } else {
          const inverse = recordAction
            ? buildRawUndo(connDialect, src, mutCols, rows.map((r) => r.before))
            : null;
          if (inverse && inverse.length > 0) {
            undo = {
              inverse,
              label: `${src.verb.toUpperCase()} ${src.table} (${rows.length} row(s))`,
              rows: rows.length,
              table: src.table,
            };
          } else {
            irreversible = "no-pk";
          }
        }

        return {
          kind: "ready",
          undo,
          data: {
            verb: src.verb,
            table: src.schema ? `${src.schema}.${src.table}` : src.table,
            sql,
            hasWhere: src.whereSql !== null,
            totalRows,
            truncated,
            cap,
            rows,
            columns: mutCols.map((c) => c.name),
            keyColumns: pkNames,
            assignments: plan.assignments,
            irreversible,
          },
        };
      } catch {
        // Preview failed (parse mismatch, permissions, …) — degrade silently
        // to the plain execution path; a broken preview must never block a run.
        return { kind: "none" };
      }
    },
    [
      settings.preflightEnabled,
      getColumns,
      activeDatabase,
      connDialect,
      executeQuery,
      snapshotCap,
      recordAction,
    ],
  );

  const runStatement = useCallback(
    async (
      sessionId: string,
      sql: string,
      opts?: { params?: ParamValue[]; label?: string }
    ): Promise<ResultEntry> => {
      const requestId = crypto.randomUUID();
      requestIdRef.current = requestId;
      // Capture an undo snapshot for raw (non-parameterized) UPDATE/DELETE first.
      // Parameterized runs already go through a dialog — skip them here.
      let pendingUndo: { inverse: Statement[]; label: string; rows: number; table: string } | null = null;
      if (!opts?.params) {
        // Pre-flight dry-run first: preview the affected rows and gate the run
        // on an explicit Commit. Its snapshot doubles as the Tier-2 undo (and
        // its "truncated" badge subsumes the too-large gate), so captureRawUndo
        // is skipped on this path.
        const pf = await capturePreflight(sessionId, sql);
        if (pf.kind === "ready") {
          const proceed = await new Promise<boolean>((resolve) => {
            preflightResolverRef.current = resolve;
            setPreflight(pf.data);
          });
          if (!proceed) {
            return makeErrorEntry(
              opts?.label ?? sql,
              t("query.preflightCancelled", {
                verb: pf.data.verb.toUpperCase(),
                table: pf.data.table,
              }),
            );
          }
          pendingUndo = pf.undo;
        } else {
          const capture = await captureRawUndo(sessionId, sql);
          if (capture.kind === "ready") {
            pendingUndo = capture;
          } else if (capture.kind === "too-large") {
            // Block the run until the user explicitly opts in to running without
            // an undo entry. A silent "no journal" here is dangerous — the user
            // would lose data they thought was protected by Time Machine.
            const proceed = await new Promise<boolean>((resolve) => {
              tooLargeResolverRef.current = resolve;
              setTooLargeConfirm({
                table: capture.table,
                verb: capture.verb,
                cap: capture.cap,
                affectedEstimate: capture.affectedEstimate,
              });
            });
            if (!proceed) {
              return makeErrorEntry(
                opts?.label ?? sql,
                `Cancelled: ${capture.verb} would affect more than ${capture.cap} rows and cannot be undone.`,
              );
            }
          }
        }
      }
      try {
        const result = opts?.params
          ? await queryCommands.executeMutation(sessionId, sql, opts.params)
          : await executeQuery(sessionId, sql, requestId);
        const entry = toResultEntry(result, opts?.label ?? sql);
        // Keep the full source SQL (toResultEntry's snippet is truncated) so the
        // "Edit results" affordance can recover a single-table SELECT's base
        // table + WHERE via detectSingleTableSelect.
        entry.sourceSql = opts?.label ?? sql;
        // Record the Tier-2 undo entry now that the statement succeeded.
        if (pendingUndo && recordAction) {
          void recordAction({
            connectionId: activeConnectionId ?? undefined,
            database: activeDatabase ?? undefined,
            table: pendingUndo.table,
            kind: "raw_sql",
            label: pendingUndo.label,
            forwardSql: JSON.stringify([{ sql, params: [] }]),
            inverseSql: JSON.stringify(pendingUndo.inverse),
            tier: 2,
            affectedRows: result.affected_rows,
          });
        }
        return entry;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return makeErrorEntry(opts?.label ?? sql, errorMsg);
      } finally {
        requestIdRef.current = null;
      }
    },
    [
      executeQuery,
      makeErrorEntry,
      captureRawUndo,
      capturePreflight,
      recordAction,
      activeConnectionId,
      activeDatabase,
      t,
    ]
  );

  /**
   * The unified run pipeline. Extracts [$name] params (opening the param dialog
   * when present), otherwise splits the buffer and runs each statement
   * sequentially — appending one ResultEntry per statement and stopping at the
   * first error.
   */
  const runText = useCallback(
    async (rawSql: string) => {
      const sessionId = payload.sessionId;
      if (!sessionId || !rawSql.trim()) return;

      // Parameterized run: defer to the dialog (resumed in handleParamSubmit).
      const names = extractParamNames(rawSql);
      if (names.length > 0) {
        setPendingParamSql(rawSql);
        setPendingParamNames(names);
        return;
      }

      const statements = splitStatements(rawSql);
      if (statements.length === 0) return;

      setExecuting(true);
      try {
        // Accumulate locally — onPatch's payload.results won't update mid-loop.
        let acc = results;
        for (const stmt of statements) {
          const entry = await runStatement(sessionId, stmt.text);
          acc = capResults([...acc, entry]);
          onPatch({
            results: acc,
            activeResultId: entry.id,
            error: entry.error ?? null,
            showResults: true,
          });
          // Stop the batch at the first failing statement.
          if (entry.error) break;
        }
      } finally {
        setExecuting(false);
      }
    },
    [payload.sessionId, results, runStatement, onPatch]
  );

  // Resolve the param dialog: rewrite the pending SQL and run it.
  const handleParamSubmit = useCallback(
    async (values: Record<string, string>, raw: boolean) => {
      const rawSql = pendingParamSql;
      setPendingParamSql(null);
      setPendingParamNames([]);
      const sessionId = payload.sessionId;
      if (!rawSql || !sessionId) return;

      if (raw) {
        // Literal substitution → run via the normal (multi-statement) path.
        await runText(applyParamsRaw(rawSql, values));
        return;
      }

      // Bind as placeholders and run the single parameterized statement.
      const dialect = connDialect;
      const { sql, params } = applyParamsAsPlaceholders(rawSql, values, dialect);
      setExecuting(true);
      try {
        const entry = await runStatement(sessionId, sql, {
          params,
          label: rawSql,
        });
        const acc = capResults([...results, entry]);
        onPatch({
          results: acc,
          activeResultId: entry.id,
          error: entry.error ?? null,
          showResults: true,
        });
      } finally {
        setExecuting(false);
      }
    },
    [pendingParamSql, payload.sessionId, connDialect, runText, runStatement, results, onPatch]
  );

  const handleParamCancel = useCallback(() => {
    setPendingParamSql(null);
    setPendingParamNames([]);
  }, []);

  // Read the editor's current non-empty selection text, or null.
  const readSelection = useCallback((): string | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    const sel = editor.getSelection();
    const model = editor.getModel();
    if (!sel || !model || sel.isEmpty()) return null;
    const text: string = model.getValueInRange(sel);
    return text.trim().length > 0 ? text : null;
  }, []);

  // Read the cursor's offset into the full buffer (0 when unavailable).
  const readCursorOffset = useCallback((): number => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const pos = editor?.getPosition();
    if (!model || !pos) return 0;
    return model.getOffsetAt(pos);
  }, []);

  // Smart run: selection if any, else the statement under the cursor, else all.
  const handleExecute = useCallback(async () => {
    const selection = readSelection();
    if (selection) {
      await runText(selection);
      return;
    }
    const fullText = payload.content;
    const stmt = statementAtOffset(fullText, readCursorOffset());
    await runText(stmt?.text ?? fullText);
  }, [readSelection, readCursorOffset, runText, payload.content]);

  // Run the whole buffer (all statements).
  const handleRunAll = useCallback(async () => {
    await runText(payload.content);
  }, [runText, payload.content]);

  // Run only the current selection.
  const handleRunSelected = useCallback(async () => {
    const selection = readSelection();
    if (selection) await runText(selection);
  }, [readSelection, runText]);

  // EXPLAIN the selection (or statement under the cursor): run EXPLAIN (FORMAT
  // JSON), parse the JSON plan, and surface it in the docked ExplainPlanView.
  // The raw EXPLAIN result is still appended as a normal result tab; the visual
  // plan panel is the primary surface and falls back to a text node on a parse
  // miss (e.g. SQLite's tabular EXPLAIN QUERY PLAN).
  const handleExplain = useCallback(async () => {
    const sessionId = payload.sessionId;
    if (!sessionId) return;
    const selection = readSelection();
    const targetSql =
      selection ??
      statementAtOffset(payload.content, readCursorOffset())?.text ??
      payload.content;
    if (!targetSql.trim()) return;
    const dialect = connDialect;
    const explainSql = buildExplain(targetSql, dialect, "json");

    setExecuting(true);
    try {
      const entry = await runStatement(sessionId, explainSql);
      const acc = capResults([...results, entry]);
      onPatch({
        results: acc,
        activeResultId: entry.id,
        error: entry.error ?? null,
        showResults: true,
      });
      if (entry.error) {
        setExplainNodes(null);
        return;
      }
      // pg/mysql: the JSON plan lives in the single cell of the (single-row)
      // result — pass that cell value. sqlite: EXPLAIN QUERY PLAN is tabular, so
      // join the rows into a text form (parseExplainJson wraps it as one node).
      let raw: unknown;
      if (dialect === "sqlite") {
        raw = entry.rows
          .map((r) => Object.values(r).join("\t"))
          .join("\n");
      } else {
        const firstRow = entry.rows[0];
        raw = firstRow !== undefined ? Object.values(firstRow)[0] : null;
      }
      setExplainNodes(parseExplainJson(dialect, raw));
    } finally {
      setExecuting(false);
    }
  }, [payload.sessionId, payload.content, readSelection, readCursorOffset, connDialect, runStatement, results, onPatch]);

  // Surface the editor's native Find / Replace widget via the captured Monaco
  // instance (falls back to the find-only widget).
  const handleFindReplace = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const action =
      editor.getAction("editor.action.startFindReplaceAction") ??
      editor.getAction("actions.find");
    action?.run();
  }, []);

  // Ask AI: resolve the current SQL (selection → statement under cursor → whole
  // buffer) and the active driver as the dialect, then forward to the App. For
  // "convert" we prompt for a target dialect (cancel aborts). "fix" attaches the
  // active result's error so the model can use it.
  const handleAskAi = useCallback(
    async (action: AskAiAction) => {
      if (!onAskAi) return;
      const sql =
        readSelection() ??
        statementAtOffset(payload.content, readCursorOffset())?.text ??
        payload.content;
      if (!sql.trim()) return;

      const dialect = connDialect;
      const ctx: AskAiContext = { dialect };

      if (action === "convert") {
        const target = await dialogs.prompt({
          title: t("query.convertDialectPrompt"),
          defaultValue: dialect === "postgres" ? "mysql" : "postgres",
        });
        if (!target || !target.trim()) return; // cancelled
        ctx.targetDialect = target.trim();
      }

      if (action === "fix" && activeError) {
        ctx.error = activeError;
      }

      onAskAi(action, sql, ctx);
    },
    [onAskAi, readSelection, readCursorOffset, payload.content, connDialect, activeError, t, dialogs]
  );

  // "Fix with AI": seed the AI pane to fix the failing statement using the active
  // result's error. We resolve the SQL the same way Ask-AI does (selection →
  // statement under cursor → whole buffer) — after a failed run the editor is
  // still on the offending statement — and attach the error explicitly.
  const handleFixWithAi = useCallback(() => {
    if (!onAskAi || !activeError) return;
    const sql =
      readSelection() ??
      statementAtOffset(payload.content, readCursorOffset())?.text ??
      payload.content;
    if (!sql.trim()) return;
    const dialect = connDialect;
    onAskAi("fix", sql, { dialect, error: activeError });
  }, [onAskAi, activeError, readSelection, readCursorOffset, payload.content, connDialect]);

  // Insert generated SQL at the editor's current selection (replacing it), then
  // refocus — falls back to appending to the controlled content when no live
  // editor. Shared with handleInsertSnippet below; registered with the App so
  // the AI pane's "Insert into editor" can reach this document's editor.
  const insertSql = useCallback(
    (body: string) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const selection = editor?.getSelection();
      if (editor && model && selection) {
        editor.executeEdits("ai-insert", [
          { range: selection, text: body, forceMoveMarkers: true },
        ]);
        editor.focus();
        return;
      }
      const prev = payload.content;
      const next = prev && !prev.endsWith("\n") ? `${prev}\n${body}` : `${prev}${body}`;
      onPatch({ content: next });
      onDirty(true);
    },
    [payload.content, onPatch, onDirty]
  );

  // Replace the editor's current selection with generated SQL. When there's a
  // non-empty selection we overwrite exactly that range; otherwise (no live
  // editor or empty selection) we replace the whole buffer content — a sensible
  // "Replace selection" fallback driven from the AI pane.
  const replaceSelection = useCallback(
    (body: string) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const selection = editor?.getSelection();
      if (editor && model && selection && !selection.isEmpty()) {
        editor.executeEdits("ai-replace", [
          { range: selection, text: body, forceMoveMarkers: true },
        ]);
        editor.focus();
        return;
      }
      // No active selection: replace the entire buffer.
      onPatch({ content: body });
      onDirty(true);
    },
    [onPatch, onDirty]
  );

  // Register / unregister this document's editor-insert callback with the App so
  // the (singleton) AI pane can route generated SQL into the open editor.
  useEffect(() => {
    if (!onRegisterInsertSql) return;
    onRegisterInsertSql(insertSql);
    return () => onRegisterInsertSql(null);
  }, [onRegisterInsertSql, insertSql]);

  // Register / unregister the replace-selection callback (mirrors insertSql) so
  // the AI pane's "Replace selection" can reach this document's editor.
  useEffect(() => {
    if (!onRegisterReplaceSelection) return;
    onRegisterReplaceSelection(replaceSelection);
    return () => onRegisterReplaceSelection(null);
  }, [onRegisterReplaceSelection, replaceSelection]);

  // Track the editor instance + keep hasSelection in sync for the toolbar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEditorMount = useCallback((editor: any) => {
    editorRef.current = editor;
    const sync = () => {
      const sel = editor.getSelection();
      setHasSelection(!!sel && !sel.isEmpty());
    };
    editor.onDidChangeCursorSelection(sync);
    sync();
  }, []);

  const handleCancel = useCallback(async () => {
    const requestId = requestIdRef.current;
    if (requestId) {
      try {
        await cancelQuery(requestId);
      } catch (err) {
        console.error("Failed to cancel query:", err);
      }
    }
    setExecuting(false);
  }, [cancelQuery]);

  // --- Toolbar: session / connection switching ------------------------------
  const handleSessionChange = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      onPatch({
        sessionId,
        database: session?.database ?? null,
      });
    },
    [sessions, onPatch]
  );

  const handleConnectionChange = useCallback(
    async (connectionId: string, database?: string) => {
      const res = await onConnectionChange(connectionId, database);
      if (res) {
        onPatch({ sessionId: res.sessionId, database: res.database });
      }
    },
    [onConnectionChange, onPatch]
  );

  // --- Editor edits ----------------------------------------------------------
  const handleContentChange = useCallback(
    (value: string) => {
      onPatch({ content: value });
      onDirty(true);
    },
    [onPatch, onDirty]
  );

  const handleFormat = useCallback(() => {
    if (!payload.content) return;
    // Format with the connected engine's grammar (fall back to generic SQL).
    const language =
      activeConnection?.driver === "postgres"
        ? "postgresql"
        : activeConnection?.driver === "sqlite"
          ? "sqlite"
          : activeConnection?.driver === "mysql"
            ? "mysql"
            : "sql";
    try {
      const formatted = format(payload.content, {
        language,
        tabWidth: 2,
        keywordCase: "upper",
        indentStyle: "standard",
      });
      onPatch({ content: formatted });
      onDirty(true);
    } catch (err) {
      console.error("Format failed:", err);
    }
  }, [payload.content, activeConnection, onPatch, onDirty]);

  // --- Save to favorites -----------------------------------------------------
  const handleSave = useCallback(() => {
    if (!payload.content.trim()) return;
    setShowSaveDialog(true);
  }, [payload.content]);

  const handleConfirmSave = useCallback(
    async (name: string, description?: string) => {
      await saveFavoriteQuery({
        name,
        description,
        connection_id: activeConnectionId ?? undefined,
        database: activeDatabase ?? undefined,
        query: payload.content,
      });
      setShowSaveDialog(false);
      setFavoritesSignal((n) => n + 1);
      // A saved query is no longer "unsaved".
      onDirty(false);
    },
    [payload.content, activeConnectionId, activeDatabase, onDirty]
  );

  // --- Load query (from history / favorites) ---------------------------------
  const handleLoadQuery = useCallback(
    (sql: string) => {
      onPatch({ content: sql });
      onDirty(true);
    },
    [onPatch, onDirty]
  );

  // --- Results: select / close ----------------------------------------------
  const handleSelectResult = useCallback(
    (resultId: string) => {
      onPatch({ activeResultId: resultId });
    },
    [onPatch]
  );

  const handleCloseResult = useCallback(
    (resultId: string) => {
      const filtered = results.filter((r) => r.id !== resultId);
      // If we removed the selected one, re-point to the newest remaining.
      let activeResultId = payload.activeResultId;
      if (activeResultId === resultId) {
        activeResultId =
          filtered.length > 0 ? filtered[filtered.length - 1].id : null;
      }
      onPatch({ results: filtered, activeResultId });
    },
    [results, payload.activeResultId, onPatch]
  );

  // Pin/unpin a result tab (pinned tabs survive the capResults eviction).
  const handleTogglePinResult = useCallback(
    (resultId: string) => {
      onPatch({ results: togglePinned(results, resultId) });
    },
    [results, onPatch]
  );

  // Set/clear a result tab's custom label (blank reverts to the snippet).
  const handleRenameResult = useCallback(
    (resultId: string, name: string) => {
      onPatch({ results: renameResult(results, resultId, name) });
    },
    [results, onPatch]
  );

  // --- Export ----------------------------------------------------------------
  const handleExport = useCallback(
    async (fmt: "csv" | "json") => {
      if (!currentResult) return;
      try {
        const name = activeResultEntry?.snippet;
        if (fmt === "csv") {
          await exportToCSV(currentResult, name);
        } else {
          await exportToJSON(currentResult, name);
        }
      } catch (err) {
        console.error("Export failed:", err);
      }
    },
    [currentResult, activeResultEntry, exportToCSV, exportToJSON]
  );

  // --- Copy as cross-DB transfer source -------------------------------------
  const handleCopyAsSource = useCallback(() => {
    if (activeSession && activeConnection && currentResult && payload.content) {
      const source: SourceRef = {
        sessionId: activeSession.id,
        connectionId: activeConnection.id,
        dbType: activeConnection.driver,
        database: activeSession.database ?? activeConnection.database ?? "",
        schema: null,
      };
      clipboardStore.set({
        kind: "query-ref",
        source,
        sql: payload.content,
        columns: currentResult.columns.map((c) => ({
          name: c.name,
          data_type: c.data_type,
          nullable: c.nullable,
        })),
      });
    }
  }, [activeSession, activeConnection, currentResult, payload.content]);

  // --- Results panel resize / collapse --------------------------------------
  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isResizing) return;
      const container = e.currentTarget as HTMLElement;
      const rect = container.getBoundingClientRect();
      const newHeight = rect.bottom - e.clientY;
      onPatch({
        resultsPanelHeight: Math.max(
          100,
          Math.min(newHeight, rect.height - 100)
        ),
      });
    },
    [isResizing, onPatch]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  const toggleResults = useCallback(() => {
    onPatch({ showResults: !showResults });
  }, [showResults, onPatch]);

  // Opening one side panel closes the others (they share the same dock).
  const toggleHistory = useCallback(() => {
    setShowHistory((v) => {
      const next = !v;
      if (next) {
        setShowFavorites(false);
        setShowSnippets(false);
      }
      return next;
    });
  }, []);
  const toggleFavorites = useCallback(() => {
    setShowFavorites((v) => {
      const next = !v;
      if (next) {
        setShowHistory(false);
        setShowSnippets(false);
      }
      return next;
    });
  }, []);
  const toggleSnippets = useCallback(() => {
    setShowSnippets((v) => {
      const next = !v;
      if (next) {
        setShowHistory(false);
        setShowFavorites(false);
      }
      return next;
    });
  }, []);

  // Insert a snippet body at the editor's current selection (replacing it), then
  // refocus — same path as the AI "Insert into editor" action (see insertSql).
  const handleInsertSnippet = insertSql;

  // Open the visual SQL Builder modal — only useful once we can introspect.
  const builderReady =
    !!payload.sessionId && !!activeDatabase && !!getTables && !!getColumns && !!getForeignKeys;
  const handleOpenBuilder = useCallback(() => {
    setShowBuilder(true);
  }, []);

  return (
    <div
      className="h-full flex flex-col"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Query Toolbar */}
      <QueryToolbar
        sessions={sessions}
        activeSessionId={payload.sessionId}
        isExecuting={executing}
        executionTime={currentResult?.execution_time_ms}
        onExecute={handleExecute}
        onCancel={handleCancel}
        onSave={handleSave}
        onFormat={handleFormat}
        onRunAll={handleRunAll}
        onRunSelected={handleRunSelected}
        hasSelection={hasSelection}
        onExplain={handleExplain}
        onFindReplace={handleFindReplace}
        onOpenBuilder={builderReady ? handleOpenBuilder : undefined}
        onAskAi={onAskAi ? handleAskAi : undefined}
        onSessionChange={handleSessionChange}
        onConnectionChange={handleConnectionChange}
        onToggleHistory={toggleHistory}
        historyOpen={showHistory}
        onToggleFavorites={toggleFavorites}
        favoritesOpen={showFavorites}
        onToggleSnippets={toggleSnippets}
        snippetsOpen={showSnippets}
      />

      {/* Body: editor + results on the left, optional side panel on the right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor and Results */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Editor */}
          <div
            className="flex-1 min-h-[100px]"
            style={{
              height: showResults
                ? `calc(100% - ${resultsPanelHeight}px)`
                : "100%",
            }}
          >
            <QueryEditor
              value={payload.content}
              onChange={handleContentChange}
              onExecute={handleExecute}
              onFormat={handleFormat}
              onEditorMount={handleEditorMount}
              sessionId={payload.sessionId}
              database={activeDatabase}
            />
          </div>

          {/* Results Panel Toggle */}
          <div
            className="flex items-center justify-between px-3 py-1 bg-secondary border-t border-border cursor-pointer"
            onClick={toggleResults}
          >
            <span className="text-xs font-medium text-muted-foreground">
              {t("query.results")}
              {currentResult &&
                ` (${t("query.resultsRows", { count: currentResult.rows.length })})`}
            </span>
            <div className="flex items-center gap-1">
              {canChart && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPatch({ showResults: true });
                    setShowChart((v) => !v);
                  }}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
                    showChart
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                  title={t("query.chartTooltip")}
                >
                  <BarChart3 className="w-3 h-3" />
                  {t("query.chart")}
                </button>
              )}
              {editableSource && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditResults();
                  }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title={t("query.editResultsTooltip", {
                    table: editableSource.table,
                  })}
                >
                  <Pencil className="w-3 h-3" />
                  {t("query.editResults")}
                </button>
              )}
              {copySourceReady && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyAsSource();
                  }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title={t("query.copyAsSourceTooltip")}
                >
                  <Copy className="w-3 h-3" />
                  {t("query.copyAsSource")}
                </button>
              )}
              {showResults ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Results Panel */}
          {showResults && (
            <>
              {/* Resize Handle */}
              <div
                className="h-1 bg-border hover:bg-primary cursor-row-resize"
                onMouseDown={handleMouseDown}
              />

              {/* Result tab bar (one tab per execution) */}
              {results.length > 0 && (
                <ResultTabs
                  results={results}
                  activeResultId={payload.activeResultId}
                  onSelect={handleSelectResult}
                  onClose={handleCloseResult}
                  onTogglePin={handleTogglePinResult}
                  onRename={handleRenameResult}
                />
              )}

              {/* Results Content */}
              <div
                style={{ height: resultsPanelHeight }}
                className="overflow-hidden"
              >
                {activeError || payload.error ? (
                  <div className="flex items-start gap-3 p-4 bg-destructive/10 text-destructive">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-medium">{t("query.queryError")}</p>
                      <p className="text-sm mt-1 break-words">
                        {activeError ?? payload.error}
                      </p>
                      {onAskAi && activeError && (
                        <button
                          onClick={handleFixWithAi}
                          className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-background/70 text-foreground border border-border hover:bg-background transition-colors"
                          title={t("query.fixWithAiTooltip")}
                        >
                          <Sparkles className="w-3.5 h-3.5 text-primary" />
                          {t("query.fixWithAi")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : currentResult ? (
                  showChart ? (
                    <ChartView
                      result={currentResult}
                      onClose={() => setShowChart(false)}
                    />
                  ) : (
                    <ResultsGrid result={currentResult} onExport={handleExport} />
                  )
                ) : executing ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      {t("query.executing")}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    {t("query.executeToSeeResults")}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right dock: history / saved queries */}
        {showHistory && (
          <HistoryPanel
            connectionId={activeConnectionId}
            onLoadQuery={handleLoadQuery}
            onClose={() => setShowHistory(false)}
          />
        )}
        {showFavorites && (
          <SavedQueriesPanel
            connectionId={activeConnectionId}
            onLoadQuery={handleLoadQuery}
            onClose={() => setShowFavorites(false)}
            refreshSignal={favoritesSignal}
          />
        )}
        {showSnippets && (
          <SnippetManager
            onClose={() => setShowSnippets(false)}
            onInsert={handleInsertSnippet}
          />
        )}
        {explainNodes && (
          <div className="w-96 flex-shrink-0">
            <ExplainPlanView
              nodes={explainNodes}
              onClose={() => setExplainNodes(null)}
            />
          </div>
        )}
      </div>

      {/* Save to Favorites dialog */}
      <SaveFavoriteDialog
        open={showSaveDialog}
        sql={payload.content}
        onCancel={() => setShowSaveDialog(false)}
        onSave={handleConfirmSave}
      />

      {/* Query parameter prompt ([$name] placeholders) */}
      {pendingParamSql !== null && (
        <ParamInputDialog
          names={pendingParamNames}
          onSubmit={handleParamSubmit}
          onCancel={handleParamCancel}
        />
      )}

      {/* Visual SELECT builder modal */}
      {showBuilder && builderReady && payload.sessionId && activeDatabase && (
        <SqlBuilderView
          sessionId={payload.sessionId}
          database={activeDatabase}
          dialect={connDialect}
          getTables={getTables!}
          getColumns={getColumns!}
          getForeignKeys={getForeignKeys!}
          onApply={insertSql}
          onClose={() => setShowBuilder(false)}
        />
      )}

      {/* Pre-flight dry-run: before → after preview + Commit/Cancel gate for
          raw UPDATE/DELETE. Escape / backdrop / X all resolve as Cancel. */}
      <PreflightDialog
        data={preflight}
        onCommit={() => {
          const resolve = preflightResolverRef.current;
          preflightResolverRef.current = null;
          setPreflight(null);
          resolve?.(true);
        }}
        onCancel={() => {
          const resolve = preflightResolverRef.current;
          preflightResolverRef.current = null;
          setPreflight(null);
          resolve?.(false);
        }}
      />

      {/* Time Machine: raw DML exceeds the snapshot cap — confirm before
          running without an undo entry. The user MUST opt in explicitly. */}
      <ConfirmDialog
        open={tooLargeConfirm !== null}
        title="This action can't be undone"
        confirmLabel="Run without undo"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          const resolve = tooLargeResolverRef.current;
          tooLargeResolverRef.current = null;
          setTooLargeConfirm(null);
          resolve?.(true);
        }}
        onCancel={() => {
          const resolve = tooLargeResolverRef.current;
          tooLargeResolverRef.current = null;
          setTooLargeConfirm(null);
          resolve?.(false);
        }}
        message={
          tooLargeConfirm && (
            <div className="space-y-2">
              <p>
                The {tooLargeConfirm.verb} on{" "}
                <span className="font-mono font-semibold">{tooLargeConfirm.table}</span>{" "}
                would affect more than{" "}
                <span className="font-semibold">{tooLargeConfirm.cap.toLocaleString()}</span>{" "}
                rows, which is beyond the Time Machine snapshot limit.
              </p>
              <p>
                If you continue, this change will be <strong>permanent</strong> — you
                won't be able to roll it back from the timeline. Consider exporting
                a backup or narrowing the statement with a <code>WHERE</code> clause.
              </p>
            </div>
          )
        }
      />
    </div>
  );
}

export default QueryDocument;
