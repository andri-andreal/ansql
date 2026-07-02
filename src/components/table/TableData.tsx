import { useState, useEffect, useMemo, useRef } from "react";
import { Loader2, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Square, Save, X, Plus, Trash2, Copy, AlertTriangle, SlidersHorizontal, Table as TableIcon, Rows3, Columns3, Bookmark } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import type { QueryResult, Statement, MutationColumn, Dialect, SourceRef, ColumnDefinition } from "../../types";
import { DataGridView, type FkColumnConfig } from "./DataGridView";
import { buildUpdate, buildInsert, buildDelete, rawSql } from "../../lib/mutationBuilder";
import { buildInverseBatch, type GridMutation } from "../../lib/inverseBuilder";
import { queryCommands, databaseCommands } from "../../lib/tauri-commands";
import { useJournalRecorder } from "../../hooks/useActionJournal";
import { useGridLayout } from "../../hooks/useGridLayout";
import { ColumnConfigPopover } from "./ColumnConfigPopover";
import { ColumnStatsPanel } from "./ColumnStatsPanel";
import { buildColumnStatsSql, parseColumnStats, type ColumnStats } from "../../lib/gridStats";
import { usePasteController } from "../../hooks/usePaste";
import { useSettings } from "../../hooks/useSettings";
import { validateRow, type ValidationColumn, type CellError } from "../../lib/validators";
import { buildFkTargetMap, pickLabelColumn, clearFkCache } from "../../lib/fkLookup";
import { buildWhere, buildOrderBy, type SortSpec } from "../../lib/whereBuilder";
import { FilterSortPane } from "./FilterSortPane";
import { FormView } from "./FormView";
import { CellViewerPanel } from "./CellViewerPanel";
import type { ColumnFilter } from "../../lib/gridFilter";
import { parseEnumType, type ParsedEnumType } from "../../lib/enumType";
import { buildInsertSql } from "../../lib/exportFormats";
import { useTranslation } from "../../i18n";
import { useDialogs } from "../ui";

/**
 * Compare a cell value to its original ignoring string-vs-number/boolean type
 * differences. Grid edits always arrive as strings, but DB values may be
 * numbers/booleans, so a strict === would keep a cell "dirty" after the user
 * types a value back to its original.
 */
function sameCellValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return norm(a) === norm(b);
}

/** Human-readable label for a batch of grid mutations (for the journal/timeline). */
function describeMutations(table: string, mutations: GridMutation[]): string {
  const counts = { insert: 0, update: 0, delete: 0 };
  for (const m of mutations) counts[m.kind] += 1;
  const parts: string[] = [];
  if (counts.insert) parts.push(`${counts.insert} insert${counts.insert > 1 ? "s" : ""}`);
  if (counts.update) parts.push(`${counts.update} update${counts.update > 1 ? "s" : ""}`);
  if (counts.delete) parts.push(`${counts.delete} delete${counts.delete > 1 ? "s" : ""}`);
  return `${table}: ${parts.join(", ") || "no changes"}`;
}

/** Inline a statement's params into its SQL for read-only preview display. */
function renderPreview(stmt: Statement): string {
  let i = 0;
  return stmt.sql.replace(/\$\d+|\?/g, () => {
    const p = stmt.params[i++];
    if (typeof p === "number" || typeof p === "boolean") return String(p);
    return `'${String(p).replace(/'/g, "''")}'`;
  });
}

/** Quote an identifier as a literal for clipboard SQL (mirrors exportFormats). */
function quoteIdentLiteral(dialect: Dialect, ident: string): string {
  if (dialect === "mysql") return "`" + ident.replace(/`/g, "``") + "`";
  if (dialect === "sqlserver") return "[" + ident.replace(/]/g, "]]") + "]";
  return '"' + ident.replace(/"/g, '""') + '"';
}

/** Render a JS value as a SQL literal for clipboard SQL (mirrors exportFormats). */
function valueLiteral(dialect: Dialect, value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") {
    if (dialect === "postgres") return value ? "TRUE" : "FALSE";
    return value ? "1" : "0";
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  const str =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  let escaped = str.replace(/'/g, "''");
  if (dialect === "mysql") escaped = escaped.replace(/\\/g, "\\\\");
  return "'" + escaped + "'";
}

/**
 * Build a literal UPDATE ... SET ... WHERE statement for one row, for clipboard
 * use ("Copy as UPDATE"). The WHERE targets the primary key(s) when the column
 * metadata exposes them, else every column (best-effort row identification).
 */
function buildUpdateLiteral(
  dialect: Dialect,
  tableName: string,
  columns: MutationColumn[],
  resultColumns: { name: string }[],
  row: Record<string, unknown>,
): string {
  const names = resultColumns.map((c) => c.name);
  if (names.length === 0) return "";
  const pkNames = columns.filter((c) => c.is_primary_key).map((c) => c.name);
  const whereNames = pkNames.length > 0 ? pkNames : names;

  const setParts = names
    .map((n) => `${quoteIdentLiteral(dialect, n)} = ${valueLiteral(dialect, row[n])}`)
    .join(", ");
  const whereParts = whereNames
    .map((n) => {
      const v = row[n];
      if (v === null || v === undefined) return `${quoteIdentLiteral(dialect, n)} IS NULL`;
      return `${quoteIdentLiteral(dialect, n)} = ${valueLiteral(dialect, v)}`;
    })
    .join(" AND ");

  return `UPDATE ${quoteIdentLiteral(dialect, tableName)} SET ${setParts} WHERE ${whereParts};`;
}

interface TableDataProps {
  sessionId: string;
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  driver?: string;
  executeQuery: (
    sessionId: string,
    query: string
  ) => Promise<QueryResult>;
  /**
   * Raw WHERE clause text (sans the leading `WHERE`) to seed the initial data
   * load with — set when the grid was opened from "Edit results" on a
   * single-table SELECT. Applied verbatim as a raw WHERE in addition to the
   * grid's own filters; a "Filtered from query" chip lets the user clear it.
   */
  initialWhereSql?: string;
}

interface CellEdit {
  rowIndex: number;
  columnName: string;
  originalValue: unknown;
  newValue: unknown;
}

interface RowSnapshot {
  [columnName: string]: unknown;
}

interface NewRow {
  tempId: number; // Negative number to distinguish from existing rows
  data: { [columnName: string]: unknown };
}

/** One reversible cell change, for undo/redo. */
interface EditAction {
  target: "existing" | "new";
  rowIndex: number; // existing-row index, or new-row index when target === "new"
  columnName: string;
  prevValue: unknown;
  nextValue: unknown;
}

function TableData({
  sessionId,
  connectionId,
  database,
  table,
  schema,
  driver = 'mysql',
  executeQuery,
  initialWhereSql,
}: TableDataProps) {
  const dialect: Dialect =
    driver === 'postgres'
      ? 'postgres'
      : driver === 'sqlite'
        ? 'sqlite'
        : driver === 'sqlserver'
          ? 'sqlserver'
          : 'mysql';
  // SQL Server quotes identifiers with [brackets] (escaping ] as ]]); MySQL with
  // backticks; everyone else (postgres/sqlite) with ANSI double-quotes.
  const quoteIdent = (name: string) =>
    dialect === 'sqlserver'
      ? `[${name.replace(/]/g, ']]')}]`
      : driver === 'mysql'
        ? `\`${name}\``
        : `"${name}"`;

  const { t } = useTranslation();
  const dialogs = useDialogs();
  const { requestPaste } = usePasteController();
  const { settings } = useSettings();
  // Time Machine: record committed grid edits so they can be undone later.
  const recordAction = useJournalRecorder();

  // --- Per-table grid layout (hidden / order / freeze / row height / widths) ---
  const tableKey = [connectionId, database, table].join(":");
  const {
    layout,
    setLayout,
    profiles,
    saveProfile,
    applyProfile,
    deleteProfile,
    reset: resetLayout,
  } = useGridLayout(tableKey);

  const sourceRef = useMemo<SourceRef>(
    () => ({ sessionId, connectionId, dbType: dialect, database, schema: schema ?? null }),
    [sessionId, connectionId, dialect, database, schema]
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<QueryResult | null>(null);
  const [limit, setLimit] = useState(settings.defaultPageSize);
  const [offset, setOffset] = useState(0);
  /** Total matching rows (for the Last-page jump + "of N" indicator); null when unknown. */
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [currentQuery, setCurrentQuery] = useState<string>("");
  const [edits, setEdits] = useState<Map<string, CellEdit>>(new Map());
  const [originalRows, setOriginalRows] = useState<Map<number, RowSnapshot>>(new Map());
  const [committing, setCommitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingStatements, setPendingStatements] = useState<Statement[]>([]);
  // Inverse (undo) batch + label for the pending commit, recorded to the journal on success.
  const [pendingInverse, setPendingInverse] = useState<Statement[]>([]);
  const [pendingLabel, setPendingLabel] = useState<string>("");
  const [columnDefs, setColumnDefs] = useState<MutationColumn[]>([]);
  /** Full structural column metadata (for validation + FK label-column picking). */
  const [fullColumnDefs, setFullColumnDefs] = useState<ColumnDefinition[]>([]);
  /** FK editing config per local column name (feature #10). */
  const [fkColumns, setFkColumns] = useState<Map<string, FkColumnConfig>>(new Map());
  /** "rowIndex-columnName" keys that failed validation (existing rows). */
  const [invalidKeys, setInvalidKeys] = useState<Set<string>>(new Set());
  /** "newRowIdx-columnName" keys that failed validation (new rows). */
  const [invalidNewKeys, setInvalidNewKeys] = useState<Set<string>>(new Set());
  /** Human-readable validation summary, shown when a commit is blocked. */
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  const [nextTempId, setNextTempId] = useState(-1);
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set());
  const [selectedRowIndices, setSelectedRowIndices] = useState<number[]>([]);
  const [undoStack, setUndoStack] = useState<EditAction[]>([]);
  const [redoStack, setRedoStack] = useState<EditAction[]>([]);
  // --- Server-side sort + filter (feature: Filter / Sort pane) ----------------
  /** Active column sorts; ORDER BY is built from these (single-col toggle for now). */
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  /** Active server-side filters driving the SELECT's WHERE clause. */
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  /**
   * Raw WHERE clause seeded from `initialWhereSql` (the query that this grid was
   * opened from via "Edit results"). Applied as an extra raw WHERE on top of the
   * grid's own filters until the user clears it via the "Filtered from query"
   * chip. Empty string = no initial WHERE active.
   */
  const [initialWhere, setInitialWhere] = useState<string>(initialWhereSql?.trim() ?? "");
  /** How active filters combine in the WHERE clause. */
  const [combinator, setCombinator] = useState<"AND" | "OR">("AND");
  /** Whether the dockable Filter / Sort pane is open. */
  const [showFilterPane, setShowFilterPane] = useState(false);
  // --- View mode (grid vs single-record form) + cell viewer -------------------
  /** Grid (table) vs form (single-record) view of the loaded rows. */
  const [viewMode, setViewMode] = useState<"grid" | "form">("grid");
  /** Index into data.rows of the record shown in form view. */
  const [activeRow, setActiveRow] = useState(0);
  /** Cell currently open in the dockable cell viewer (null = closed). */
  const [viewerCell, setViewerCell] = useState<
    { rowIndex: number; column: string; value: unknown } | null
  >(null);
  // --- Columns & layout popover / profiles menu -------------------------------
  /** Whether the "Columns" config popover is open. */
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  /** Whether the "Layouts" (named profiles) menu is open. */
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  // --- Column statistics panel ------------------------------------------------
  /** Column whose stats panel is docked (null = closed). */
  const [statsColumn, setStatsColumn] = useState<string | null>(null);
  /** Parsed stats for the docked column (null while loading / on error). */
  const [statsData, setStatsData] = useState<ColumnStats | null>(null);
  /** Whether the column-stats query is in flight. */
  const [statsLoading, setStatsLoading] = useState(false);
  // --- Stop / in-flight load tracking -----------------------------------------
  /** requestId of the in-flight SELECT (for Stop → cancelQuery). */
  const inflightRequestId = useRef<string | null>(null);
  /** Monotonic token so a Stop'd / superseded load ignores its late result. */
  const loadToken = useRef(0);
  /** True while a load is genuinely in flight (drives the Stop button). */
  const [isFetching, setIsFetching] = useState(false);

  /** True when there are pending edits / inserts / deletes not yet committed.
   * Server-reloading actions (paging, sort, filter, refresh) are gated on this
   * to avoid silently discarding uncommitted changes. */
  const hasUncommittedChanges =
    edits.size > 0 || newRows.length > 0 || deletedRows.size > 0;

  /**
   * ENUM/SET columns keyed by name (parsed from each column's full_type, with the
   * column's nullability). Passed to the grid so those columns render as a
   * dropdown / checklist editor.
   */
  const enumColumns = useMemo<Map<string, ParsedEnumType & { nullable: boolean }>>(() => {
    const m = new Map<string, ParsedEnumType & { nullable: boolean }>();
    for (const c of fullColumnDefs) {
      const parsed = parseEnumType(c.full_type);
      if (parsed) m.set(c.name, { ...parsed, nullable: c.nullable });
    }
    return m;
  }, [fullColumnDefs]);

  // --- Cell editing with undo/redo --------------------------------------------

  /** Current displayed value of an existing-row cell (edited or original). */
  const currentExistingValue = (rowIndex: number, columnName: string): unknown => {
    const key = `${rowIndex}-${columnName}`;
    if (edits.has(key)) return edits.get(key)!.newValue;
    return data?.rows[rowIndex]?.[columnName];
  };

  /** Apply an existing-row cell value without recording undo history. */
  const setExistingCell = (rowIndex: number, columnName: string, value: unknown) => {
    if (!data) return;
    setOriginalRows((prev) => {
      if (prev.has(rowIndex)) return prev;
      return new Map(prev).set(rowIndex, { ...data.rows[rowIndex] });
    });
    setEdits((prev) => {
      const m = new Map(prev);
      const key = `${rowIndex}-${columnName}`;
      const originalValue = data.rows[rowIndex]?.[columnName];
      // Returning a cell to its original value clears its dirty state (compare
      // loosely: edits are strings, originals may be numbers/booleans).
      if (sameCellValue(value, originalValue)) m.delete(key);
      else m.set(key, { rowIndex, columnName, originalValue, newValue: value });
      return m;
    });
  };

  /** Apply a new-row cell value without recording undo history. */
  const setNewCell = (i: number, name: string, value: unknown) => {
    setNewRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, data: { ...r.data, [name]: value } } : r))
    );
  };

  /** Edit an existing-row cell (records undo history). Empty string -> NULL. */
  const editExistingCell = (rowIndex: number, columnName: string, rawValue: string) => {
    const finalValue = rawValue === "" ? null : rawValue;
    const prevValue = currentExistingValue(rowIndex, columnName);
    if (sameCellValue(prevValue, finalValue)) return;
    setExistingCell(rowIndex, columnName, finalValue);
    setUndoStack((s) => [...s, { target: "existing", rowIndex, columnName, prevValue, nextValue: finalValue }]);
    setRedoStack([]);
  };

  /** Edit a new (appended) row cell (records undo history). Empty string -> NULL. */
  const editNewCell = (i: number, name: string, rawValue: string) => {
    const finalValue = rawValue === "" ? null : rawValue;
    const prevValue = newRows[i]?.data[name];
    if (prevValue === finalValue) return;
    setNewCell(i, name, finalValue);
    setUndoStack((s) => [...s, { target: "new", rowIndex: i, columnName: name, prevValue, nextValue: finalValue }]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const action = undoStack[undoStack.length - 1];
    if (action.target === "existing") setExistingCell(action.rowIndex, action.columnName, action.prevValue);
    else setNewCell(action.rowIndex, action.columnName, action.prevValue);
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((r) => [...r, action]);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const action = redoStack[redoStack.length - 1];
    if (action.target === "existing") setExistingCell(action.rowIndex, action.columnName, action.nextValue);
    else setNewCell(action.rowIndex, action.columnName, action.nextValue);
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, action]);
  };

  // --- Server-side sort (multi-column) ----------------------------------------
  /**
   * Toggle a column's sort: none → asc → desc → none. A plain click replaces the
   * whole sort with this single column; `additive` (shift-click) appends/maintains
   * a multi-column sort, cycling just this column within the existing list. The
   * SortSpec[] feeds buildOrderBy (already multi-column-capable). Resets the page
   * so the new ordering starts from the top; the reload effect picks up `sorts`.
   */
  const handleSortColumn = (column: string, additive = false) => {
    // Sorting reloads from the server, which would discard uncommitted edits.
    // Mirror the pagination/refresh guard: ignore while there are pending changes.
    if (hasUncommittedChanges) return;
    setSorts((prev) => {
      const current = prev.find((s) => s.column === column);
      if (!additive) {
        // Single-column: replace the list with this column's next state.
        if (!current) return [{ column, direction: "asc" }];
        if (current.direction === "asc") return [{ column, direction: "desc" }];
        return [];
      }
      // Multi-column: cycle this column in place, keeping the others.
      const others = prev.filter((s) => s.column !== column);
      if (!current) return [...prev, { column, direction: "asc" }];
      if (current.direction === "asc")
        return prev.map((s) => (s.column === column ? { ...s, direction: "desc" } : s));
      return others; // was desc → drop this column from the sort
    });
    setOffset(0);
  };

  /** The first active sort (if any), passed down for back-compat header arrows. */
  const sortBy = sorts[0];

  // --- Cell context-menu actions ---------------------------------------------
  /**
   * Set a cell's value via the SAME edit pipeline as the grid (so coerceValue /
   * mutationBuilder apply on commit). `null` means SQL NULL — routed through
   * editExistingCell, which maps "" → NULL. A literal empty string ("") must NOT
   * collapse to NULL, so it's applied directly (with undo recorded). Any other
   * value (e.g. a generated UUID) goes through the normal edit path.
   */
  const handleSetCellValue = (rowIndex: number, column: string, value: unknown) => {
    if (value === null || value === undefined) {
      editExistingCell(rowIndex, column, ""); // "" → NULL
      return;
    }
    if (value === "") {
      // Literal empty string: bypass the ""→NULL mapping but keep undo history.
      const prevValue = currentExistingValue(rowIndex, column);
      if (sameCellValue(prevValue, "")) return;
      setExistingCell(rowIndex, column, "");
      setUndoStack((s) => [...s, { target: "existing", rowIndex, columnName: column, prevValue, nextValue: "" }]);
      setRedoStack([]);
      return;
    }
    editExistingCell(rowIndex, column, String(value));
  };

  /** Push an `equals` filter on this column's value and reload from offset 0. */
  const handleFilterByCell = (column: string, value: unknown) => {
    // Filtering reloads from the server (discarding uncommitted edits); guard it.
    if (hasUncommittedChanges) return;
    if (value === null || value === undefined) {
      setFilters([{ column, operator: "is_null", value: "" }]);
    } else {
      setFilters([{ column, operator: "equals", value: String(value) }]);
    }
    setCombinator("AND");
    setOffset(0);
  };

  /**
   * Copy a row as an INSERT or UPDATE statement (literal SQL, for pasting into an
   * editor). INSERT reuses exportFormats.buildInsertSql; UPDATE is built locally
   * from the row's current values, keyed by primary key when known.
   */
  const handleCopyRowAs = (rowIndex: number, mode: "insert" | "update") => {
    if (!data) return;
    const row = data.rows[rowIndex];
    if (!row) return;
    const columnNames = data.columns.map((c) => c.name);
    const sql =
      mode === "insert"
        ? buildInsertSql(table, columnNames, [row], dialect).trim()
        : buildUpdateLiteral(dialect, table, columnDefs, data.columns, row);
    if (sql) void navigator.clipboard?.writeText(sql);
  };

  // --- Form (single-record) view ----------------------------------------------
  /** Move the active record (form view), clamped to the loaded row range. */
  const handleFormNavigate = (dir: "first" | "prev" | "next" | "last") => {
    const last = (data?.rows.length ?? 1) - 1;
    setActiveRow((cur) => {
      switch (dir) {
        case "first": return 0;
        case "prev": return Math.max(0, cur - 1);
        case "next": return Math.min(last, cur + 1);
        case "last": return Math.max(0, last);
      }
    });
  };

  /** Columns of the active row with pending edits (highlight in form view). */
  const dirtyColumnsForActiveRow = useMemo(() => {
    const set = new Set<string>();
    edits.forEach((edit) => {
      if (edit.rowIndex === activeRow) set.add(edit.columnName);
    });
    return set;
  }, [edits, activeRow]);

  /** Current (edited-over-original) values of the active row, for the form. */
  const activeRowValues = useMemo<Record<string, unknown>>(() => {
    const base = { ...(data?.rows[activeRow] ?? {}) };
    edits.forEach((edit) => {
      if (edit.rowIndex === activeRow) base[edit.columnName] = edit.newValue;
    });
    return base;
  }, [data, activeRow, edits]);

  // --- Cell viewer ------------------------------------------------------------
  /** Open the dockable cell viewer for a grid cell. */
  const handleViewCell = (rowIndex: number, column: string, value: unknown) => {
    setViewerCell({ rowIndex, column, value });
  };

  // --- Save cell to file ------------------------------------------------------
  /**
   * Write a single cell's value to a file the user picks. Text/JSON values go out
   * as UTF-8; a base64-looking string is decoded to raw bytes (so a stored BLOB
   * round-trips), otherwise the value is stringified.
   */
  const handleSaveCellToFile = async (value: unknown, suggestedName: string) => {
    try {
      const filePath = await save({ title: "Save cell value", defaultPath: suggestedName });
      if (!filePath) return;
      if (value === null || value === undefined) {
        await writeTextFile(filePath, "");
        return;
      }
      // Try to detect a base64 payload (binary cell) and write raw bytes.
      const str =
        typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
      const looksBase64 =
        typeof value === "string" &&
        str.length > 0 &&
        str.length % 4 === 0 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(str);
      if (looksBase64) {
        try {
          const bin = atob(str);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          await writeFile(filePath, bytes);
          return;
        } catch {
          // Not valid base64 after all — fall through to text.
        }
      }
      await writeTextFile(filePath, str);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to save cell to file: ${msg}`);
    }
  };

  // --- Raw SQL cell value -----------------------------------------------------
  /**
   * Stage a raw SQL expression (e.g. CURRENT_TIMESTAMP) for an existing cell. We
   * use the lower-level setExistingCell (not editExistingCell) to bypass the
   * ""→NULL mapping and the String-coercion dirty-compare — a RawSql object is
   * always "dirty". Undo/redo records the RawSql object as the next value.
   * mutationBuilder.emitParam emits the expression literally on commit.
   */
  const handleSetRawCell = (rowIndex: number, column: string, expr: string) => {
    const raw = rawSql(expr);
    const prevValue = currentExistingValue(rowIndex, column);
    setExistingCell(rowIndex, column, raw);
    setUndoStack((s) => [...s, { target: "existing", rowIndex, columnName: column, prevValue, nextValue: raw }]);
    setRedoStack([]);
  };

  // --- Column statistics ------------------------------------------------------
  /**
   * Run a server-side stats query for one column and dock the stats panel. Uses
   * the same fully-qualified table name the SELECT builds; parseColumnStats reads
   * the aliased single row.
   */
  const handleShowColumnStats = async (column: string) => {
    setStatsColumn(column);
    setStatsData(null);
    setStatsLoading(true);
    try {
      const tableName = driver === 'mysql'
        ? (schema ? `${quoteIdent(database)}.${quoteIdent(schema)}.${quoteIdent(table)}` : `${quoteIdent(database)}.${quoteIdent(table)}`)
        : (schema ? `${quoteIdent(schema)}.${quoteIdent(table)}` : quoteIdent(table));
      const sql = buildColumnStatsSql(dialect, tableName, column);
      const result = await executeQuery(sessionId, sql);
      const row = result.rows[0] ?? {};
      setStatsData(parseColumnStats(row));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to compute column statistics: ${msg}`);
      setStatsData(null);
    } finally {
      setStatsLoading(false);
    }
  };

  // --- Column widths bridged into the persisted layout ------------------------
  /** Current column widths: persisted layout.widths overlaid by session edits. */
  const columnWidths = useMemo(() => {
    const m = new Map<string, number>();
    for (const [name, w] of Object.entries(layout.widths)) m.set(name, w);
    return m;
  }, [layout.widths]);

  /** Persist a resized column's width into the per-table layout. */
  const handleColumnResize = (name: string, width: number) => {
    setLayout({ widths: { ...layout.widths, [name]: width } });
  };

  /**
   * Drag-reorder: translate from/to column NAMES into a new explicit order over
   * the FULL column set (so the persisted order is complete and stable), then
   * persist it. The popover's up/down buttons feed the same layout.columnOrder.
   */
  const handleColumnMoved = (fromColumn: string, toColumn: string) => {
    if (!data) return;
    const names = data.columns.map((c) => c.name);
    // Seed from the current order, appending any columns missing from it.
    const seed = layout.columnOrder.length > 0 ? layout.columnOrder.slice() : names.slice();
    for (const n of names) if (!seed.includes(n)) seed.push(n);
    const from = seed.indexOf(fromColumn);
    const to = seed.indexOf(toColumn);
    if (from === -1 || to === -1 || from === to) return;
    const [moved] = seed.splice(from, 1);
    seed.splice(to, 0, moved);
    setLayout({ columnOrder: seed });
  };

  // --- Named layout profiles --------------------------------------------------
  /** Prompt for a name and snapshot the current table's layout as a profile. */
  const handleSaveProfile = async () => {
    const name = await dialogs.prompt({ title: "Save current layout as profile — name:", defaultValue: "" });
    if (name && name.trim()) saveProfile(name.trim());
    setShowLayoutMenu(false);
  };

  const loadData = async () => {
    const token = ++loadToken.current;
    const requestId = crypto.randomUUID();
    inflightRequestId.current = requestId;
    setLoading(true);
    setIsFetching(true);
    setError(null);
    try {
      // Build the SELECT query with proper identifier quoting per driver
      const tableName = driver === 'mysql'
        ? (schema ? `${quoteIdent(database)}.${quoteIdent(schema)}.${quoteIdent(table)}` : `${quoteIdent(database)}.${quoteIdent(table)}`)
        : (schema ? `${quoteIdent(schema)}.${quoteIdent(table)}` : quoteIdent(table));

      // Server-side filter (WHERE) + sort (ORDER BY). buildWhere returns a
      // parameterized tail (placeholders only, never value literals); buildOrderBy
      // returns the quoted ORDER BY tail. We concatenate base + where + order.
      const { sql: filterWhereSql, params } = buildWhere(filters, combinator, dialect, columnDefs);
      // When the grid was opened from "Edit results", `initialWhere` is the
      // recovered single-table SELECT's WHERE text — applied VERBATIM as a raw
      // WHERE (never parameterized here; the detector keeps it intact). Combine
      // it with the grid's own filter conditions via AND so both narrow the load.
      const filterConds = filterWhereSql.replace(/^WHERE\s+/i, ""); // "" or "(conds)"
      const whereParts = [
        initialWhere ? `(${initialWhere})` : "",
        filterConds,
      ].filter(Boolean);
      const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
      const orderBySql = buildOrderBy(sorts, dialect);
      // Pagination differs by dialect. SQL Server has no LIMIT/OFFSET: it uses
      // `OFFSET n ROWS FETCH NEXT m ROWS ONLY`, which REQUIRES an ORDER BY — so we
      // fall back to `ORDER BY (SELECT NULL)` when no sort is active. The other
      // dialects (mysql/postgres/sqlite) keep the trailing LIMIT/OFFSET.
      const isSqlServer = dialect === "sqlserver";
      const effectiveOrderBySql =
        isSqlServer && !orderBySql ? "ORDER BY (SELECT NULL)" : orderBySql;
      const paginationSql = isSqlServer
        ? `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
        : `LIMIT ${limit} OFFSET ${offset}`;
      // Compose only the non-empty tails so we never inject stray double-spaces
      // (which a global whitespace-collapse could mangle inside quoted idents).
      const query = [
        `SELECT * FROM ${tableName}`,
        whereSql,
        effectiveOrderBySql,
        paginationSql,
      ]
        .filter(Boolean)
        .join(" ");

      setCurrentQuery(query);
      // Fetch the data and the structural columns (for primary-key-based row
      // identification) together. getColumns may fail for views — fall back to []
      // (the mutation builder then uses an all-columns WHERE).
      //
      // When the filter contributes bound params we MUST run the parameterized
      // path: executeMutation runs execute_with_params and returns a full
      // QueryResult (columns + rows), so a parameterized SELECT works through it.
      // execute_query takes no params, so it can't carry the WHERE operands.
      // The parameterized path can't carry a requestId (execute_mutation has no
      // cancel token), so Stop only aborts the plain-SELECT path. We pass the
      // requestId through executeQuery directly so cancelQuery can target it.
      const runSelect = (): Promise<QueryResult> =>
        params.length > 0
          ? queryCommands.executeMutation(sessionId, query, params)
          : queryCommands.executeQuery(sessionId, query, requestId);

      // Total matching rows (filters applied, no ORDER BY / LIMIT) — drives the
      // Last-page jump and the "of N" indicator. Best-effort: tolerate failure.
      const countQuery = [`SELECT COUNT(*) AS cnt FROM ${tableName}`, whereSql]
        .filter(Boolean)
        .join(" ");
      const runCount = (): Promise<QueryResult> =>
        params.length > 0
          ? queryCommands.executeMutation(sessionId, countQuery, params)
          : executeQuery(sessionId, countQuery);

      const [result, defs, fks, countResult] = await Promise.all([
        runSelect(),
        databaseCommands
          .getColumns(sessionId, database, table, schema)
          .catch(() => [] as ColumnDefinition[]),
        databaseCommands
          .getForeignKeys(sessionId, database, table, schema)
          .catch(() => []),
        runCount().catch(() => null),
      ]);

      // A Stop or a newer load superseded this one — discard its result.
      if (token !== loadToken.current) return;

      const fullDefs = defs as ColumnDefinition[];
      setFullColumnDefs(fullDefs);
      setColumnDefs(fullDefs as unknown as MutationColumn[]);

      // Build FK dropdown config for single-column FKs whose referenced column we
      // can resolve. We don't know the referenced table's columns here, so the
      // label column is best-effort by name heuristic against the local schema's
      // common patterns — fall back to value-only when unknown.
      const fkTargets = buildFkTargetMap(fks);
      const fkConfig = new Map<string, FkColumnConfig>();
      for (const [localCol, target] of fkTargets) {
        const def = fullDefs.find((d) => d.name === localCol);
        // Label column is resolved lazily by the lookup query against the
        // referenced table; we pass null so it shows the key, unless the value
        // column itself hints a readable name. The backend lookup may still join
        // a label if labelColumns includes one — we keep it minimal here.
        fkConfig.set(localCol, {
          target,
          labelColumn: pickLabelColumn([target.valueColumn], target.valueColumn),
          nullable: def?.nullable ?? true,
        });
      }
      setFkColumns(fkConfig);
      clearFkCache();

      setData(result);
      // Parse COUNT(*) (driver may return it as a string); null when unavailable.
      if (countResult && countResult.rows[0]) {
        const raw = countResult.rows[0].cnt ?? Object.values(countResult.rows[0])[0];
        const n = Number(raw);
        setTotalCount(Number.isFinite(n) ? n : null);
      } else {
        setTotalCount(null);
      }
      setEdits(new Map()); // Clear edits when loading new data
      setOriginalRows(new Map()); // Clear original row snapshots
      setNewRows([]); // Clear new rows when loading new data
      setNextTempId(-1);
      setDeletedRows(new Set()); // Clear deleted rows when loading new data
      setSelectedRowIndices([]);
      setUndoStack([]);
      setRedoStack([]);
      setInvalidKeys(new Set());
      setInvalidNewKeys(new Set());
      setValidationErrors([]);
      setActiveRow(0); // Reset form-view cursor to the first record on reload.
      setViewerCell(null); // Close the cell viewer; its target row may be gone.
    } catch (err) {
      // Ignore errors from a load that was Stop'd / superseded (its requestId
      // was cancelled or a newer load took over).
      if (token !== loadToken.current) return;
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      console.error("Failed to load table data:", err);
    } finally {
      if (token === loadToken.current) {
        inflightRequestId.current = null;
        setLoading(false);
        setIsFetching(false);
      }
    }
  };

  /** Stop the in-flight load: cancel the backend query and ignore its result. */
  const handleStop = () => {
    const id = inflightRequestId.current;
    // Bump the token so the in-flight load's result/error is discarded, and ask
    // the backend to cancel the SELECT if it exposed a cancel token.
    loadToken.current += 1;
    inflightRequestId.current = null;
    setLoading(false);
    setIsFetching(false);
    if (id) void queryCommands.cancelQuery(id).catch(() => {});
  };

  /**
   * Validate all pending inserts/updates against column metadata. Returns the
   * invalid-cell key sets and a human-readable summary. Empty errors => OK.
   */
  const runValidation = (): {
    invalidExisting: Set<string>;
    invalidNew: Set<string>;
    summary: string[];
  } => {
    const invalidExisting = new Set<string>();
    const invalidNew = new Set<string>();
    const summary: string[] = [];

    const vCols: ValidationColumn[] = fullColumnDefs.map((c) => ({
      name: c.name,
      data_type: c.data_type,
      full_type: c.full_type,
      nullable: c.nullable,
      default_value: c.default_value ?? null,
      is_primary_key: c.is_primary_key,
      is_auto_increment: c.is_auto_increment,
    }));
    if (vCols.length === 0) return { invalidExisting, invalidNew, summary };

    // New rows: full INSERT validation.
    newRows.forEach((nr, i) => {
      const errs: CellError[] = validateRow(vCols, nr.data, true);
      for (const e of errs) {
        invalidNew.add(`${i}-${e.column}`);
        summary.push(`New row ${i + 1}: ${e.message}`);
      }
    });

    // Existing edited rows: validate only the changed columns (UPDATE semantics).
    const rowChanges = new Map<number, { row: Record<string, unknown>; cols: Set<string> }>();
    edits.forEach((edit) => {
      let entry = rowChanges.get(edit.rowIndex);
      if (!entry) {
        entry = { row: { ...(data?.rows[edit.rowIndex] ?? {}) }, cols: new Set() };
        rowChanges.set(edit.rowIndex, entry);
      }
      entry.row[edit.columnName] = edit.newValue;
      entry.cols.add(edit.columnName);
    });
    for (const [rowIndex, { row, cols }] of rowChanges) {
      const errs = validateRow(vCols, row, false, cols);
      for (const e of errs) {
        invalidExisting.add(`${rowIndex}-${e.column}`);
        summary.push(`Row ${rowIndex + 1}: ${e.message}`);
      }
    }

    return { invalidExisting, invalidNew, summary };
  };

  const handleCommit = () => {
    if (!data || (edits.size === 0 && newRows.length === 0 && deletedRows.size === 0)) return;

    // Client-side validation gate (feature #17): block + highlight on error.
    const { invalidExisting, invalidNew, summary } = runValidation();
    setInvalidKeys(invalidExisting);
    setInvalidNewKeys(invalidNew);
    setValidationErrors(summary);
    if (summary.length > 0) return;

    const tableName = driver === 'mysql'
      ? (schema ? `${quoteIdent(database)}.${quoteIdent(schema)}.${quoteIdent(table)}` : `${quoteIdent(database)}.${quoteIdent(table)}`)
      : (schema ? `${quoteIdent(schema)}.${quoteIdent(table)}` : quoteIdent(table));

    // Group edits by row to create UPDATE queries
    const rowEdits = new Map<number, CellEdit[]>();
    edits.forEach((edit) => {
      if (!rowEdits.has(edit.rowIndex)) {
        rowEdits.set(edit.rowIndex, []);
      }
      rowEdits.get(edit.rowIndex)!.push(edit);
    });

    // Resolve column metadata for primary-key-based row identification; fall
    // back to the result-set columns (all-columns WHERE) when unavailable.
    const mutCols: MutationColumn[] =
      columnDefs.length > 0
        ? columnDefs
        : data.columns.map((c) => ({ name: c.name, data_type: c.data_type }));

    const statements: Statement[] = [];
    // Mirror each forward statement with the structured mutation so the inverse
    // (undo) batch can be built — see lib/inverseBuilder.
    const mutations: GridMutation[] = [];

    // INSERT new rows. Empty columns are omitted so DB defaults / auto-increment
    // apply; auto-increment PKs are never sent.
    for (const newRow of newRows) {
      const stmt = buildInsert(dialect, tableName, mutCols, newRow.data);
      if (stmt) {
        statements.push(stmt);
        mutations.push({ kind: "insert", row: newRow.data });
      }
    }

    // DELETE rows marked for deletion, identified by PK (or all-columns fallback).
    for (const rowIndex of Array.from(deletedRows)) {
      const originalRow = originalRows.get(rowIndex) ?? data.rows[rowIndex];
      if (!originalRow) continue;
      statements.push(buildDelete(dialect, tableName, mutCols, originalRow));
      mutations.push({ kind: "delete", row: originalRow });
    }

    // UPDATE edited rows, using the original snapshot for the WHERE clause.
    for (const [rowIndex, rowEditsList] of rowEdits) {
      const originalRow = originalRows.get(rowIndex);
      if (!originalRow) continue;
      const changes: Record<string, unknown> = {};
      rowEditsList.forEach((edit) => {
        changes[edit.columnName] = edit.newValue;
      });
      const stmt = buildUpdate(dialect, tableName, mutCols, originalRow, changes);
      if (stmt) {
        statements.push(stmt);
        mutations.push({ kind: "update", row: originalRow, changes });
      }
    }

    setPendingStatements(statements);
    setPendingInverse(buildInverseBatch(dialect, tableName, mutCols, mutations));
    setPendingLabel(describeMutations(table, mutations));
    setShowConfirmDialog(true);
  };

  const handleConfirmCommit = async () => {
    setShowConfirmDialog(false);
    setCommitting(true);
    setError(null);

    try {
      // Apply every change in a single atomic transaction. If any statement
      // fails, the backend rolls the whole batch back.
      const results = await queryCommands.commitChanges(sessionId, pendingStatements);
      // A statement matching 0 rows means its snapshot WHERE no longer matches —
      // e.g. the row was changed or removed by another session.
      const noop = results.filter((r) => r.affected_rows === 0).length;

      // Time Machine: record this batch (with its inverse) so it can be undone.
      if (recordAction && pendingInverse.length > 0) {
        const affected = results.reduce((sum, r) => sum + (r.affected_rows ?? 0), 0);
        void recordAction({
          connectionId,
          database,
          table,
          kind: "grid_dml",
          label: pendingLabel,
          forwardSql: JSON.stringify(pendingStatements),
          inverseSql: JSON.stringify(pendingInverse),
          tier: 1,
          affectedRows: affected,
        });
      }

      // Reload data to get fresh state from database
      await loadData();

      if (noop > 0) {
        setError(
          `${noop} of ${pendingStatements.length} change(s) affected 0 rows — a row may have been modified or removed by another session. The Time Machine will warn again on undo.`
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to commit changes: ${errorMsg}`);
      console.error("Failed to commit changes:", err);
    } finally {
      setCommitting(false);
      setPendingStatements([]);
      setPendingInverse([]);
      setPendingLabel("");
    }
  };

  const handleCancelCommit = () => {
    setShowConfirmDialog(false);
    setPendingStatements([]);
    setPendingInverse([]);
    setPendingLabel("");
  };

  const handleDiscardChanges = () => {
    setEdits(new Map());
    setOriginalRows(new Map());
    setNewRows([]); // Clear new rows
    setNextTempId(-1);
    setDeletedRows(new Set()); // Clear deleted rows
    setSelectedRowIndices([]);
    setUndoStack([]);
    setRedoStack([]);
    loadData(); // Reload to reset any local changes
  };

  const handleAddRow = () => {
    if (!data) return;

    // Create a new empty row with null values for all columns
    const newRowData: { [columnName: string]: unknown } = {};
    data.columns.forEach((col) => {
      newRowData[col.name] = null;
    });

    const newRow: NewRow = {
      tempId: nextTempId,
      data: newRowData,
    };

    setNewRows([...newRows, newRow]);
    setNextTempId(nextTempId - 1);
  };

  const handleDeleteRow = (rowIndex: number) => {
    // Only existing rows can be marked for deletion; new (appended) rows have
    // indices >= data.rows.length and are removed differently, not via deletedRows.
    if (data && rowIndex >= data.rows.length) return;
    const newDeletedRows = new Set(deletedRows);
    newDeletedRows.add(rowIndex);
    setDeletedRows(newDeletedRows);
  };

  const handleUndeleteRow = (rowIndex: number) => {
    const newDeletedRows = new Set(deletedRows);
    newDeletedRows.delete(rowIndex);
    setDeletedRows(newDeletedRows);
  };

  const handleDuplicateRow = (rowIndex: number) => {
    if (!data) return;

    const sourceRow = data.rows[rowIndex];
    if (!sourceRow) return;

    // Create a new row with data from the source row
    const newRowData: { [columnName: string]: unknown } = {};

    // Fields to exclude or clear when duplicating
    const excludeFields = ['id']; // Auto-increment fields
    const clearFields = ['created_at', 'updated_at']; // Timestamp fields

    data.columns.forEach((col) => {
      const colNameLower = col.name.toLowerCase();

      if (excludeFields.includes(colNameLower)) {
        // Skip auto-increment fields (will be generated by DB)
        newRowData[col.name] = null;
      } else if (clearFields.includes(colNameLower)) {
        // Clear timestamp fields (will be set by DB or NOW())
        newRowData[col.name] = null;
      } else {
        // Copy the value from source row
        newRowData[col.name] = sourceRow[col.name];
      }
    });

    const newRow: NewRow = {
      tempId: nextTempId,
      data: newRowData,
    };

    setNewRows([...newRows, newRow]);
    setNextTempId(nextTempId - 1);
  };

  // Re-seed the raw initial WHERE when the prop changes (e.g. "Edit results"
  // re-opens this already-open table tab with a different recovered WHERE). The
  // reload effect below picks up the new `initialWhere` value.
  useEffect(() => {
    setInitialWhere(initialWhereSql?.trim() ?? "");
    setOffset(0);
  }, [initialWhereSql]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, database, table, schema, limit, offset, filters, combinator, sorts, initialWhere]);

  // Reload from the DB when an external action (Time Machine undo/redo) mutates
  // THIS table on THIS session. A wider blast radius would silently wipe the
  // user's unsaved edits on other tables in the same connection.
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;
  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sessionId?: string; table?: string } | undefined;
      if (detail?.sessionId && detail.sessionId !== sessionId) return;
      // If the event names a specific table it must match this one. An event
      // with no table field is treated as session-wide (legacy/forward-compat).
      if (detail?.table && detail.table !== table) return;
      void loadDataRef.current();
    };
    window.addEventListener("ansql:data-changed", onChanged);
    return () => window.removeEventListener("ansql:data-changed", onChanged);
  }, [sessionId, table]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // Don't block the UI on error - show error notification at bottom instead

  if (!data || data.rows.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center relative">
        <p className="text-muted-foreground">{t("table.noDataFound")}</p>

        {/* Error Notification - Bottom Box */}
        {error && (
          <div className="fixed bottom-0 left-0 right-0 z-50">
            <div className="bg-destructive/95 border-t border-destructive px-4 py-2">
              <div className="flex items-center justify-between max-w-7xl mx-auto">
                <p className="text-sm text-white">{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="ml-4 p-1 hover:bg-white/10 rounded transition-colors flex-shrink-0"
                  title={t("table.close")}
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Toolbar — secondary actions only. Paging + rows-per-page live in the
          bottom bar below the grid. */}
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {edits.size > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-600 dark:text-amber-400">
              <span className="font-medium">
                {edits.size === 1
                  ? t("table.unsavedChange", { count: edits.size })
                  : t("table.unsavedChanges", { count: edits.size })}
              </span>
            </div>
          )}
          {initialWhere && (
            <div
              className="flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-primary/10 border border-primary/30 rounded text-xs text-primary"
              title={t("table.filteredFromQueryTooltip", { where: initialWhere })}
            >
              <span className="font-medium">{t("table.filteredFromQuery")}</span>
              <button
                onClick={() => { setInitialWhere(""); setOffset(0); }}
                disabled={hasUncommittedChanges}
                className="p-0.5 rounded hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={hasUncommittedChanges ? t("table.commitBeforeClearFilter") : t("table.clearQueryFilter")}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Selection + change actions (only shown when relevant) */}
          {(selectedRowIndices.length > 0 || edits.size > 0 || newRows.length > 0 || deletedRows.size > 0) && (
            <>
              <div className="flex items-center gap-2">
                {selectedRowIndices.length > 0 && (
                  <>
                    <button
                      onClick={() => selectedRowIndices.forEach(handleDuplicateRow)}
                      disabled={committing}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50"
                      title={t("table.duplicateSelectedRows")}
                    >
                      <Copy className="w-4 h-4" />
                      {t("table.duplicateCount", { count: selectedRowIndices.length })}
                    </button>
                    <button
                      onClick={() => selectedRowIndices.forEach(handleDeleteRow)}
                      disabled={committing}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors disabled:opacity-50"
                      title={t("table.markSelectedForDeletion")}
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("table.deleteSelectedCount", { count: selectedRowIndices.length })}
                    </button>
                  </>
                )}
                {deletedRows.size > 0 && selectedRowIndices.some(i => deletedRows.has(i)) && (
                  <button
                    onClick={() => selectedRowIndices.forEach(handleUndeleteRow)}
                    disabled={committing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50"
                    title={t("table.restoreSelectedRows")}
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t("table.restoreSelected")}
                  </button>
                )}
                {(edits.size > 0 || newRows.length > 0 || deletedRows.size > 0) && (
                  <>
                    <button
                      onClick={handleDiscardChanges}
                      disabled={committing}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50"
                      title={t("table.discardAllChanges")}
                    >
                      <X className="w-4 h-4" />
                      {t("table.discard")}
                    </button>
                    <button
                      onClick={handleCommit}
                      disabled={committing}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-50"
                      title={t("table.commitChanges")}
                    >
                      <Save className="w-4 h-4" />
                      {committing ? t("table.committing") : t("table.commit")}
                    </button>
                  </>
                )}
              </div>
              <div className="h-6 w-px bg-border" />
            </>
          )}

          {/* Grid / Form view toggle */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm transition-colors ${
                viewMode === "grid"
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary hover:bg-secondary/80 text-muted-foreground"
              }`}
              title={t("table.gridView")}
            >
              <TableIcon className="w-4 h-4" />
              {t("table.grid")}
            </button>
            <button
              onClick={() => setViewMode("form")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm transition-colors border-l border-border ${
                viewMode === "form"
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary hover:bg-secondary/80 text-muted-foreground"
              }`}
              title={t("table.formView")}
            >
              <Rows3 className="w-4 h-4" />
              {t("table.form")}
            </button>
          </div>
          <div className="h-6 w-px bg-border" />

          {/* Filter / Sort pane toggle */}
          <button
            onClick={() => setShowFilterPane((s) => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
              showFilterPane || filters.length > 0 || sorts.length > 0
                ? "bg-primary/15 text-primary"
                : "bg-secondary hover:bg-secondary/80"
            }`}
            title={t("table.filterAndSort")}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {t("table.filterAndSort")}
            {(filters.length > 0 || sorts.length > 0) && (
              <span className="text-xs">({filters.length + sorts.length})</span>
            )}
          </button>
          <div className="h-6 w-px bg-border" />

          {/* Columns & layout config */}
          <div className="relative">
            <button
              onClick={() => { setShowColumnConfig((s) => !s); setShowLayoutMenu(false); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                showColumnConfig || layout.hiddenColumns.length > 0 || layout.frozenCount > 0
                  ? "bg-primary/15 text-primary"
                  : "bg-secondary hover:bg-secondary/80"
              }`}
              title={t("table.columnsAndLayout")}
            >
              <Columns3 className="w-4 h-4" />
              {t("table.columns")}
              {layout.hiddenColumns.length > 0 && (
                <span className="text-xs">{t("table.hiddenCount", { count: layout.hiddenColumns.length })}</span>
              )}
            </button>
            {showColumnConfig && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowColumnConfig(false)} />
                <div className="absolute right-0 top-10 z-40">
                  <ColumnConfigPopover
                    columns={data.columns}
                    hidden={layout.hiddenColumns}
                    order={layout.columnOrder.length > 0 ? layout.columnOrder : data.columns.map((c) => c.name)}
                    frozenCount={layout.frozenCount}
                    rowHeight={layout.rowHeight}
                    onChange={(patch) =>
                      setLayout({
                        ...(patch.hidden !== undefined ? { hiddenColumns: patch.hidden } : {}),
                        ...(patch.order !== undefined ? { columnOrder: patch.order } : {}),
                        ...(patch.frozenCount !== undefined ? { frozenCount: patch.frozenCount } : {}),
                        ...(patch.rowHeight !== undefined ? { rowHeight: patch.rowHeight } : {}),
                      })
                    }
                    onClose={() => setShowColumnConfig(false)}
                  />
                </div>
              </>
            )}
          </div>

          {/* Named layout profiles */}
          <div className="relative">
            <button
              onClick={() => { setShowLayoutMenu((s) => !s); setShowColumnConfig(false); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                showLayoutMenu ? "bg-primary/15 text-primary" : "bg-secondary hover:bg-secondary/80"
              }`}
              title={t("table.savedLayouts")}
            >
              <Bookmark className="w-4 h-4" />
              {t("table.layouts")}
            </button>
            {showLayoutMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowLayoutMenu(false)} />
                <div className="absolute right-0 top-10 z-40 w-60 bg-card border border-border rounded-md shadow-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">{t("table.savedLayouts")}</span>
                    <button
                      onClick={() => void handleSaveProfile()}
                      className="text-xs px-2 py-0.5 bg-secondary hover:bg-secondary/80 rounded transition-colors"
                      title={t("table.saveCurrentLayout")}
                    >
                      {t("table.saveCurrent")}
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto py-1">
                    {profiles.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">{t("table.noSavedLayouts")}</p>
                    ) : (
                      profiles.map((p) => (
                        <div key={p.name} className="flex items-center gap-1 px-2 py-1 hover:bg-secondary/50 transition-colors">
                          <button
                            onClick={() => { applyProfile(p.name); setShowLayoutMenu(false); }}
                            className="flex-1 min-w-0 text-left text-xs truncate text-foreground"
                            title={t("table.applyLayout", { name: p.name })}
                          >
                            {p.name}
                          </button>
                          <button
                            onClick={() => deleteProfile(p.name)}
                            className="p-1 shrink-0 rounded text-muted-foreground/60 hover:text-red-500 hover:bg-secondary transition-colors"
                            title={t("table.deleteLayout")}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="px-3 py-2 border-t border-border">
                    <button
                      onClick={() => { resetLayout(); setShowLayoutMenu(false); }}
                      className="w-full text-xs px-2 py-1 bg-secondary hover:bg-secondary/80 rounded transition-colors"
                      title={t("table.resetLayoutTooltip")}
                    >
                      {t("table.resetLayout")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="h-6 w-px bg-border" />

          {/* Refresh */}
          <button
            onClick={loadData}
            disabled={loading || edits.size > 0 || newRows.length > 0 || deletedRows.size > 0}
            className="p-1.5 hover:bg-secondary rounded-md transition-colors disabled:opacity-50"
            title={edits.size > 0 || newRows.length > 0 || deletedRows.size > 0 ? t("table.commitBeforeRefreshing") : t("table.refresh")}
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
          </button>

          {/* Divider + Add Row (primary action, far right) */}
          <div className="h-6 w-px bg-border" />
          <button
            onClick={handleAddRow}
            disabled={loading || committing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50"
            title={t("table.addNewRow")}
          >
            <Plus className="w-4 h-4" />
            {t("table.addRow")}
          </button>
        </div>
      </div>

      {/* Filter / Sort pane (dockable popover, top-right under the toolbar) */}
      {showFilterPane && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setShowFilterPane(false)}
          />
          <div className="absolute right-4 top-14 z-40">
            <FilterSortPane
              columns={data.columns}
              filters={filters}
              combinator={combinator}
              sorts={sorts}
              onApply={(f, c, s) => {
                setFilters(f);
                setCombinator(c);
                setSorts(s);
                setOffset(0);
              }}
              onClear={() => {
                setFilters([]);
                setSorts([]);
                setOffset(0);
              }}
              onClose={() => setShowFilterPane(false)}
            />
          </div>
        </>
      )}

      {/* Canvas: grid or single-record form */}
      <div className="flex-1 min-h-0 flex flex-col">
        {viewMode === "form" ? (
          <FormView
            columns={fullColumnDefs}
            values={activeRowValues}
            rowLabel={t("table.recordOf", { current: Math.min(activeRow + 1, data.rows.length), total: data.rows.length })}
            canPrev={activeRow > 0}
            canNext={activeRow < data.rows.length - 1}
            onNavigate={handleFormNavigate}
            onEdit={(column, value) => handleSetCellValue(activeRow, column, value)}
            dirtyColumns={dirtyColumnsForActiveRow}
          />
        ) : (
        <DataGridView
          data={data}
          columnWidths={columnWidths}
          onColumnResize={handleColumnResize}
          editedKeys={new Set(edits.keys())}
          invalidKeys={invalidKeys}
          invalidNewKeys={invalidNewKeys}
          fkColumns={fkColumns}
          getCellValue={(rowIndex, columnName) => {
            const key = `${rowIndex}-${columnName}`;
            if (edits.has(key)) return edits.get(key)!.newValue;
            return data.rows[rowIndex]?.[columnName];
          }}
          onEditCell={(rowIndex, columnName, newValue) => editExistingCell(rowIndex, columnName, newValue)}
          onPasteCell={(rowIndex, columnName, value) => editExistingCell(rowIndex, columnName, value)}
          newRowCount={newRows.length}
          getNewCellValue={(i, name) => newRows[i]?.data[name]}
          onEditNewCell={(i, name, value) => editNewCell(i, name, value)}
          onAppendRow={handleAddRow}
          deletedRows={deletedRows}
          onSelectedRowsChange={setSelectedRowIndices}
          onUndo={handleUndo}
          onRedo={handleRedo}
          sourceRef={sourceRef}
          tableName={table}
          onRequestPaste={(t) => requestPaste({ kind: "grid", ...t })}
          enumColumns={enumColumns}
          sortBy={sortBy}
          sorts={sorts}
          onSortColumn={handleSortColumn}
          hiddenColumns={layout.hiddenColumns}
          columnOrder={layout.columnOrder}
          frozenCount={layout.frozenCount}
          rowHeight={layout.rowHeight}
          onColumnMoved={handleColumnMoved}
          onSetCellValue={handleSetCellValue}
          onFilterByCell={handleFilterByCell}
          onCopyRowAs={handleCopyRowAs}
          onViewCell={handleViewCell}
          onSaveCellToFile={handleSaveCellToFile}
          onSetRawCell={handleSetRawCell}
          onShowColumnStats={handleShowColumnStats}
        />
        )}
      </div>

      {/* Dockable cell viewer (Text / JSON / Hex / Image), right-hand side. */}
      {viewerCell && (
        <CellViewerPanel
          columnName={viewerCell.column}
          value={currentExistingValue(viewerCell.rowIndex, viewerCell.column)}
          editable
          onChange={(v) => handleSetCellValue(viewerCell.rowIndex, viewerCell.column, v)}
          onClose={() => setViewerCell(null)}
        />
      )}

      {/* Dockable per-column statistics panel, right-hand side. */}
      {statsColumn && (
        <ColumnStatsPanel
          column={statsColumn}
          stats={statsData}
          loading={statsLoading}
          onClose={() => { setStatsColumn(null); setStatsData(null); }}
        />
      )}

      {/* Validation summary - blocks commit until resolved (feature #17) */}
      {validationErrors.length > 0 && (
        <div className="px-4 py-2 bg-red-600/95 border-y border-red-700">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-white mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-white font-medium">
                  {validationErrors.length === 1
                    ? t("table.validationErrorSummaryOne", { count: validationErrors.length })
                    : t("table.validationErrorSummaryMany", { count: validationErrors.length })}
                </p>
                <ul className="mt-1 text-xs text-white/90 list-disc list-inside max-h-24 overflow-auto">
                  {validationErrors.slice(0, 12).map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                  {validationErrors.length > 12 && (
                    <li>{t("table.andNMore", { count: validationErrors.length - 12 })}</li>
                  )}
                </ul>
              </div>
            </div>
            <button
              onClick={() => setValidationErrors([])}
              className="ml-4 p-1 hover:bg-white/10 rounded transition-colors flex-shrink-0"
              title={t("table.dismiss")}
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      )}

      {/* Error Notification - Between table and footer */}
      {error && (
        <div className="px-4 py-2 bg-destructive/95 border-y border-destructive">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-4 p-1 hover:bg-white/10 rounded transition-colors flex-shrink-0"
              title={t("table.close")}
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom bar — pagination + rows-per-page (left), one logical group.
          Kept compact (py-1 + 12px icons) so it doesn't eat vertical space. */}
      <div className="px-3 py-1 border-t border-border bg-secondary/30 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {/* Showing X–Y of Z */}
          <div className="text-muted-foreground whitespace-nowrap">
            {totalCount !== null
              ? t("table.showingRowsOf", {
                  from: offset + 1,
                  to: offset + data.rows.length,
                  total: totalCount.toLocaleString(),
                })
              : t("table.showingRows", {
                  from: offset + 1,
                  to: offset + data.rows.length,
                })}
          </div>
          {/* Pager */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setOffset(0)}
              disabled={offset === 0 || hasUncommittedChanges}
              className="p-0.5 hover:bg-secondary rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasUncommittedChanges ? t("table.commitBeforeNavigating") : t("table.firstPage")}
            >
              <ChevronsLeft className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0 || hasUncommittedChanges}
              className="p-0.5 hover:bg-secondary rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasUncommittedChanges ? t("table.commitBeforeNavigating") : t("table.previousPage")}
            >
              <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <span className="text-muted-foreground px-1.5 tabular-nums">
              {t("table.pageNumber", { page: Math.floor(offset / limit) + 1 })}
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={
                (totalCount !== null ? offset + limit >= totalCount : data.rows.length < limit) ||
                hasUncommittedChanges
              }
              className="p-0.5 hover:bg-secondary rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasUncommittedChanges ? t("table.commitBeforeNavigating") : t("table.nextPage")}
            >
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={() => {
                if (totalCount === null) return;
                const lastOffset = Math.max(0, Math.floor((totalCount - 1) / limit) * limit);
                setOffset(lastOffset);
              }}
              disabled={
                totalCount === null ||
                offset + limit >= totalCount ||
                hasUncommittedChanges
              }
              className="p-0.5 hover:bg-secondary rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasUncommittedChanges ? t("table.commitBeforeNavigating") : t("table.lastPage")}
            >
              <ChevronsRight className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            {isFetching && (
              <button
                onClick={handleStop}
                className="ml-1 flex items-center gap-1 px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                title={t("table.stopLoading")}
              >
                <Square className="w-2.5 h-2.5" fill="currentColor" />
                {t("table.stop")}
              </button>
            )}
          </div>
          {/* Rows per page */}
          <div className="flex items-center gap-1.5 pl-2 border-l border-border">
            <label className="text-muted-foreground whitespace-foreground">{t("table.rowsPerPage")}</label>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setOffset(0);
              }}
              disabled={edits.size > 0 || newRows.length > 0 || deletedRows.size > 0}
              className="px-1.5 py-0.5 bg-secondary rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            >
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
              <option value={2000}>2000</option>
            </select>
          </div>
        </div>
        {loading && (
          <div className="flex items-center gap-1 text-muted-foreground shrink-0">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{t("table.executing")}</span>
          </div>
        )}
      </div>

      {/* Footer - SQL Query Display (compact, matches the pager bar above) */}
      <div className="px-3 py-1 border-t border-border bg-secondary/50 flex items-center gap-2 text-xs">
        <span className="font-medium text-muted-foreground shrink-0">SQL:</span>
        <code className="font-mono text-foreground bg-background px-2 py-0.5 rounded border border-border flex-1 truncate">
          {currentQuery}
        </code>
        {data && !loading && (
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {data.execution_time_ms}ms
          </span>
        )}
      </div>

      {/* Right Sidebar - Query Preview */}
      {showConfirmDialog && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={handleCancelCommit}
          />

          {/* Sidebar */}
          <div className="fixed right-0 top-0 bottom-0 w-[500px] bg-card border-l border-border shadow-2xl z-50 flex flex-col animate-slide-in-right">
            {/* Sidebar Header */}
            <div className="px-6 py-4 border-b border-border bg-secondary/30">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{t("table.reviewChanges")}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {pendingStatements.length === 1
                      ? t("table.statementsInTransactionOne", { count: pendingStatements.length })
                      : t("table.statementsInTransactionMany", { count: pendingStatements.length })}
                  </p>
                </div>
                <button
                  onClick={handleCancelCommit}
                  className="p-2 hover:bg-secondary rounded-lg transition-colors"
                  title={t("table.close")}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sidebar Content - Scrollable Query List */}
            <div className="flex-1 overflow-auto px-6 py-4">
              <div className="space-y-3">
                {pendingStatements.map((stmt, idx) => (
                  <div key={idx} className="bg-secondary/50 rounded-lg p-4 border border-border">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                        <span className="text-xs font-bold text-primary">{idx + 1}</span>
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground">
                        {t("table.statementLabel", { keyword: stmt.sql.trim().split(/\s+/)[0].toUpperCase() })}
                      </span>
                    </div>
                    <code className="text-xs font-mono text-foreground block whitespace-pre-wrap break-all bg-background/50 p-3 rounded border border-border">
                      {renderPreview(stmt)}
                    </code>
                  </div>
                ))}
              </div>
            </div>

            {/* Sidebar Footer - Sticky Actions */}
            <div className="px-6 py-4 border-t border-border bg-secondary/30">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCancelCommit}
                  className="flex-1 px-4 py-2.5 text-sm bg-secondary hover:bg-secondary/80 rounded-lg transition-colors font-medium"
                >
                  {t("table.cancel")}
                </button>
                <button
                  onClick={handleConfirmCommit}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
                >
                  <Save className="w-4 h-4" />
                  {t("table.commitCount", { count: pendingStatements.length })}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default TableData;
