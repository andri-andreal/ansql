import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataEditor,
  GridCellKind,
  CompactSelection,
  type DataEditorRef,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { Pencil, Eye, Save, Code, BarChart3 } from "lucide-react";
import type { QueryResult, SourceRef } from "../../types";
import { clipboardStore } from "../../lib/clipboardStore";
import { buildGlideTheme } from "./glideTheme";
import { aggregateSelection } from "../../lib/gridStats";
import type { SortSpec } from "../../lib/whereBuilder";
import { GridFindReplaceBar } from "./GridFindReplaceBar";
import { jsonCellRenderer, type JsonCell } from "./cells/JsonCell";
import { getDateInputType } from "./columnTypes";
import { dateCellRenderer, type DateCell } from "./cells/DateCell";
import { fkCellRenderer, type FkCell } from "./cells/FkCell";
import { enumCellRenderer, type EnumCell } from "./cells/EnumCell";
import { setCellRenderer, type SetCell } from "./cells/SetCell";
import { BulkEditDialog } from "./BulkEditDialog";
import type { ParsedEnumType } from "../../lib/enumType";
import type { FkTarget } from "../../lib/fkLookup";
import { useTranslation } from "../../i18n";
import { useDialogs } from "../ui";

/** Per-column FK editing config, keyed by local column name. */
export interface FkColumnConfig {
  target: FkTarget;
  labelColumn: string | null;
  nullable: boolean;
}

export interface DataGridViewProps {
  data: QueryResult;
  columnWidths: Map<string, number>;
  onColumnResize: (columnName: string, newWidth: number) => void;
  /** "rowIndex-columnName" keys with unsaved edits (existing rows). */
  editedKeys: Set<string>;
  /** "rowIndex-columnName" keys that FAILED validation (highlight red). */
  invalidKeys?: Set<string>;
  /** "newRowIdx-columnName" keys that FAILED validation on new rows. */
  invalidNewKeys?: Set<string>;
  /** Current (possibly edited) value for an existing row's cell. */
  getCellValue: (rowIndex: number, columnName: string) => unknown;
  onEditCell: (rowIndex: number, columnName: string, value: string) => void;
  /** Appended (new) rows. */
  newRowCount: number;
  getNewCellValue: (newRowIdx: number, columnName: string) => unknown;
  onEditNewCell: (newRowIdx: number, columnName: string, value: string) => void;
  onAppendRow: () => void;
  /** Indices into data.rows marked for deletion. */
  deletedRows: Set<number>;
  onPasteCell: (rowIndex: number, columnName: string, value: string) => void;
  /** Selected existing-row indices (from row markers), for toolbar actions. */
  onSelectedRowsChange: (rows: number[]) => void;
  /** Cell-edit undo / redo (Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z). */
  onUndo: () => void;
  onRedo: () => void;
  sourceRef: SourceRef;
  tableName: string;
  /** Ask the host to handle a cross-DB paste; returns true if it took over. */
  onRequestPaste: (snapshotTarget: {
    sessionId: string;
    database: string;
    table: string;
    schema?: string | null;
  }) => boolean;
  /** FK editing config per local column name (feature #10). */
  fkColumns?: Map<string, FkColumnConfig>;
  /** ENUM/SET columns keyed by name, with parsed members + nullability. */
  enumColumns?: Map<string, ParsedEnumType & { nullable: boolean }>;
  /** Active server-side sort (single column), drives the ▲/▼ header indicator. */
  sortBy?: { column: string; direction: "asc" | "desc" };
  /** Active multi-column server-side sort; takes precedence over `sortBy` for the
   *  header indicators (shows ▲/▼ + 1-based order). Header click maintains it. */
  sorts?: SortSpec[];
  /** Header click → toggle this column's server-side sort. `additive` is true on
   *  shift-click (append/maintain) vs. replace-with-single on a plain click. */
  onSortColumn?: (columnName: string, additive?: boolean) => void;
  /** Column names to hide from the rendered grid (others show in natural order). */
  hiddenColumns?: string[];
  /** Explicit column order (by name); missing columns fall back to natural order. */
  columnOrder?: string[];
  /** Number of leading columns to freeze (glide freezeColumns). */
  frozenCount?: number;
  /** Row height in px (defaults to the grid's natural row height). */
  rowHeight?: number;
  /** Drag-reorder: from/to are column NAMES' positions translated to names. */
  onColumnMoved?: (fromColumn: string, toColumn: string) => void;
  /** Context-menu: set an existing cell's value (null / "" / generated UUID). */
  onSetCellValue?: (rowIndex: number, column: string, value: unknown) => void;
  /** Context-menu: filter the table by this cell's value (server-side). */
  onFilterByCell?: (column: string, value: unknown) => void;
  /** Context-menu: copy the row as an INSERT or UPDATE statement. */
  onCopyRowAs?: (rowIndex: number, mode: "insert" | "update") => void;
  /** Context-menu: open the dockable cell viewer for this cell's value. */
  onViewCell?: (rowIndex: number, column: string, value: unknown) => void;
  /** Context-menu: save a cell's value to a file (host opens the save dialog). */
  onSaveCellToFile?: (value: unknown, suggestedName: string) => void;
  /** Context-menu: stage a raw SQL expression (e.g. CURRENT_TIMESTAMP) for a cell. */
  onSetRawCell?: (rowIndex: number, column: string, expr: string) => void;
  /** Context-menu: open the per-column statistics panel for this column. */
  onShowColumnStats?: (column: string) => void;
}

/** Minimal shape of glide's key event (we only need these fields). */
interface GridKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault?: () => void;
}

/** Max cells captured as an inline snapshot; larger selections fall back to a
 *  table reference (streamed by the transfer engine) to avoid giant clipboard payloads. */
const SNAPSHOT_CELL_CAP = 100_000;

const ROW_HEIGHT = 34;
const HEADER_HEIGHT = 38;

const isJsonColumn = (dataType: string) => /json/i.test(dataType);

/** Escape a literal string for safe insertion into a RegExp (case-insensitive replace). */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compact numeric formatter for the selection aggregate footer. */
const fmtStat = (n: number | null): string => {
  if (n === null) return "—";
  // Trim to a sane precision without trailing zeros for non-integers.
  return Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString();
};

export function DataGridView(props: DataGridViewProps) {
  const { t } = useTranslation();
  const dialogs = useDialogs();
  const {
    data, columnWidths, onColumnResize, editedKeys, invalidKeys, invalidNewKeys,
    getCellValue, onEditCell,
    newRowCount, getNewCellValue, onEditNewCell, onAppendRow, deletedRows,
    onPasteCell, onSelectedRowsChange, onUndo, onRedo,
    sourceRef, tableName, onRequestPaste, fkColumns, enumColumns,
    sortBy, sorts, onSortColumn,
    hiddenColumns, columnOrder, frozenCount, rowHeight, onColumnMoved,
    onSetCellValue, onFilterByCell, onCopyRowAs, onViewCell,
    onSaveCellToFile, onSetRawCell, onShowColumnStats,
  } = props;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [theme, setTheme] = useState<Partial<Theme>>(() => buildGlideTheme());
  const [selection, setSelection] = useState<GridSelection>({
    current: undefined,
    rows: CompactSelection.empty(),
    columns: CompactSelection.empty(),
  });
  // Per-column filters were removed in favor of the structured `filters` state
  // in TableData (the "Filter & Sort" pane) — keeping an un-synced filter row
  // above the Glide grid produced a permanently mis-aligned header. The
  // per-column quick-filter popover is still available via right-click on a
  // column header, and structured filters are reachable from the top toolbar.
  const [bulkOpen, setBulkOpen] = useState(false);
  // Cell right-click context menu (screen-positioned, targets one existing cell).
  const [cellMenu, setCellMenu] = useState<
    { x: number; y: number; rowIndex: number; column: string; value: unknown } | null
  >(null);
  // Find & Replace bar (Ctrl+F). Host-agnostic: matches run over loaded cells.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const gridRef = useRef<DataEditorRef>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(buildGlideTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // --- Filtering: map displayed existing rows -> original data.rows indices ----
  // Row-level filtering is handled by the structured `filters` in TableData
  // (which generates the SQL WHERE clause), so by the time rows reach this
  // component every existing row in `data.rows` is already server-filtered.
  // We just map display-row -> original-row identity by index.
  const visibleRowIndices = useMemo(() => data.rows.map((_, i) => i), [data.rows]);

  const totalRows = visibleRowIndices.length + newRowCount;

  /** Display row -> { isNew, origIndex | newIdx }. */
  const resolveRow = useCallback(
    (displayRow: number): { isNew: boolean; index: number } => {
      if (displayRow >= visibleRowIndices.length) {
        return { isNew: true, index: displayRow - visibleRowIndices.length };
      }
      return { isNew: false, index: visibleRowIndices[displayRow] };
    },
    [visibleRowIndices]
  );

  // --- Column hide / order: the rendered column list -------------------------
  // displayColumns is the ordered subset of data.columns actually shown. Every
  // display-index (glide `col`) maps through this array to a real column NAME,
  // so getCellContent / onCellEdited / paste / context-menu all stay correct.
  const hiddenSet = useMemo(() => new Set(hiddenColumns ?? []), [hiddenColumns]);
  const displayColumns = useMemo(() => {
    const byName = new Map(data.columns.map((c) => [c.name, c]));
    const ordered: QueryResult["columns"] = [];
    const taken = new Set<string>();
    // 1) honor the explicit order first (skip unknown / hidden names),
    for (const name of columnOrder ?? []) {
      if (taken.has(name) || hiddenSet.has(name)) continue;
      const c = byName.get(name);
      if (c) {
        ordered.push(c);
        taken.add(name);
      }
    }
    // 2) then append any remaining columns in natural order.
    for (const c of data.columns) {
      if (taken.has(c.name) || hiddenSet.has(c.name)) continue;
      ordered.push(c);
      taken.add(c.name);
    }
    return ordered;
  }, [data.columns, columnOrder, hiddenSet]);

  // Multi-column sort drives the header indicator; fall back to single sortBy.
  const sortOrder = useMemo(() => {
    const map = new Map<string, { direction: "asc" | "desc"; ord: number }>();
    if (sorts && sorts.length > 0) {
      sorts.forEach((s, i) => map.set(s.column, { direction: s.direction, ord: i + 1 }));
    } else if (sortBy) {
      map.set(sortBy.column, { direction: sortBy.direction, ord: 1 });
    }
    return map;
  }, [sorts, sortBy]);

  const columns: GridColumn[] = useMemo(
    () =>
      displayColumns.map((c) => {
        // Append a ▲/▼ (+ order number when multiple) to each sorted column.
        const s = sortOrder.get(c.name);
        const arrow = s
          ? `${s.direction === "asc" ? " ▲" : " ▼"}${sortOrder.size > 1 ? s.ord : ""}`
          : "";
        return { title: `${c.name}${arrow}`, id: c.name, width: columnWidths.get(c.name) ?? 150 };
      }),
    [displayColumns, columnWidths, sortOrder]
  );

  // toDisplay: pretty-print a cell value for the data grid's text renderer.
  const toDisplay = (v: unknown): string =>
    v === null || v === undefined ? "(Null)" : typeof v === "object" ? JSON.stringify(v) : String(v);

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, displayRow] = cell;
      const column = displayColumns[col];
      if (!column) return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
      const { isNew, index } = resolveRow(displayRow);
      const raw = isNew ? getNewCellValue(index, column.name) : getCellValue(index, column.name);
      const display = toDisplay(raw);
      const isNull = raw === null || raw === undefined;
      const dirty = !isNew && editedKeys.has(`${index}-${column.name}`);
      const invalid = isNew
        ? invalidNewKeys?.has(`${index}-${column.name}`)
        : invalidKeys?.has(`${index}-${column.name}`);

      // FK columns render as a searchable dropdown cell.
      const fkConfig = fkColumns?.get(column.name);
      if (fkConfig) {
        const text = isNull ? "" : String(raw);
        const fc: FkCell = {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: text,
          themeOverride: invalid ? { bgCell: "rgba(239,68,68,0.22)" } : undefined,
          data: {
            kind: "fk-cell",
            value: text,
            nullable: fkConfig.nullable,
            sessionId: sourceRef.sessionId,
            database: sourceRef.database,
            schema: sourceRef.schema,
            target: fkConfig.target,
            labelColumn: fkConfig.labelColumn,
          },
        };
        return fc;
      }

      // ENUM/SET columns render as a dropdown / checklist. FK takes precedence
      // above; an enum/set column is unlikely to also be JSON/date below.
      const enumConfig = enumColumns?.get(column.name);
      if (enumConfig?.kind === "enum") {
        const text = isNull ? null : String(raw);
        const ec: EnumCell = {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: text ?? "",
          themeOverride: invalid ? { bgCell: "rgba(239,68,68,0.22)" } : undefined,
          data: { kind: "enum-cell", value: text, options: enumConfig.values, nullable: enumConfig.nullable },
        };
        return ec;
      }
      if (enumConfig?.kind === "set") {
        const text = isNull ? null : String(raw);
        const sc: SetCell = {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: text ?? "",
          themeOverride: invalid ? { bgCell: "rgba(239,68,68,0.22)" } : undefined,
          data: { kind: "set-cell", value: text, options: enumConfig.values },
        };
        return sc;
      }

      if (isJsonColumn(column.data_type)) {
        const text = isNull ? "(Null)" : (typeof raw === "object" ? JSON.stringify(raw) : String(raw));
        const jc: JsonCell = {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: text,
          themeOverride: invalid ? { bgCell: "rgba(239,68,68,0.22)" } : undefined,
          data: { kind: "json-cell", value: text },
        };
        return jc;
      }
      const dt = getDateInputType(column.data_type);
      if (dt) {
        const text = isNull ? "" : String(raw);
        const dc: DateCell = {
          kind: GridCellKind.Custom,
          allowOverlay: true,
          copyData: text,
          themeOverride: invalid ? { bgCell: "rgba(239,68,68,0.22)" } : undefined,
          data: { kind: "date-cell", value: text, inputType: dt },
        };
        return dc;
      }
      return {
        kind: GridCellKind.Text,
        data: isNull ? "" : display,
        displayData: display,
        allowOverlay: true,
        themeOverride: invalid
          ? { bgCell: "rgba(239,68,68,0.22)" }
          : dirty
            ? { bgCell: "rgba(250,204,21,0.18)" }
            : isNull
              ? { textDark: theme.textLight }
              : undefined,
      };
    },
    [displayColumns, theme, editedKeys, invalidKeys, invalidNewKeys, getCellValue, getNewCellValue, resolveRow, fkColumns, enumColumns, sourceRef]
  );

  const onCellEdited = useCallback(
    (cell: Item, v: EditableGridCell) => {
      const [col, displayRow] = cell;
      const column = displayColumns[col];
      if (!column) return;
      const name = column.name;
      let value: string | undefined;
      if (v.kind === GridCellKind.Text) value = v.data;
      else if (v.kind === GridCellKind.Custom) {
        const d = v.data as { kind: string; value: string | null };
        if (d?.kind === "json-cell" || d?.kind === "date-cell" || d?.kind === "fk-cell") {
          value = d.value as string;
        } else if (d?.kind === "enum-cell" || d?.kind === "set-cell") {
          // enum value is string|null, set value is string. Coerce null -> ""
          // to match the host's "" -> NULL convention (see applyBulkEdit).
          value = (d.value ?? "") as string;
        }
      }
      if (value === undefined) return;
      const { isNew, index } = resolveRow(displayRow);
      if (isNew) onEditNewCell(index, name, value);
      else onEditCell(index, name, value);
    },
    [displayColumns, resolveRow, onEditCell, onEditNewCell]
  );

  const getRowThemeOverride = useCallback(
    (displayRow: number): Partial<Theme> | undefined => {
      const { isNew, index } = resolveRow(displayRow);
      if (isNew) return { bgCell: "rgba(34,197,94,0.12)" };
      if (deletedRows.has(index)) return { bgCell: "rgba(239,68,68,0.12)" };
      return undefined;
    },
    [resolveRow, deletedRows]
  );

  const onPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]) => {
      const [startCol, startRow] = target;
      values.forEach((rowVals, rOff) => {
        rowVals.forEach((value, cOff) => {
          const col = startCol + cOff;
          const displayRow = startRow + rOff;
          if (col >= displayColumns.length) return;
          if (displayRow >= totalRows) return;
          const name = displayColumns[col].name;
          const { isNew, index } = resolveRow(displayRow);
          if (isNew) onEditNewCell(index, name, value);
          else onPasteCell(index, name, value);
        });
      });
      return true;
    },
    [displayColumns, totalRows, resolveRow, onPasteCell, onEditNewCell]
  );

  const onGridSelectionChange = useCallback(
    (sel: GridSelection) => {
      setSelection(sel);
      // Translate display-row selection back to original data.rows indices.
      const displayRows = sel.rows ? sel.rows.toArray() : [];
      const orig = displayRows
        .map((dr) => resolveRow(dr))
        .filter((r) => !r.isNew)
        .map((r) => r.index);
      onSelectedRowsChange(orig);
    },
    [onSelectedRowsChange, resolveRow]
  );

  const onColumnResizeCb = useCallback(
    (column: GridColumn, newSize: number) => {
      if (column.id) onColumnResize(column.id, newSize);
    },
    [onColumnResize]
  );

  // --- Header click → server-side sort toggle ---------------------------------
  // Plain click replaces the sort with this single column (cycling asc→desc→off
  // is owned by the host); shift-click appends/maintains a multi-column sort.
  const onHeaderClicked = useCallback(
    (colIndex: number, event: { shiftKey: boolean }) => {
      const col = displayColumns[colIndex];
      if (col) onSortColumn?.(col.name, event.shiftKey);
    },
    [displayColumns, onSortColumn]
  );

  // --- Column drag-reorder → translate glide display indices to names ---------
  const onColumnMovedCb = useCallback(
    (from: number, to: number) => {
      const fromCol = displayColumns[from];
      const toCol = displayColumns[to];
      if (fromCol && toCol) onColumnMoved?.(fromCol.name, toCol.name);
    },
    [displayColumns, onColumnMoved]
  );

  // --- Cell right-click context menu ------------------------------------------
  const onCellContextMenu = useCallback(
    (cell: Item, event: { preventDefault: () => void; localEventX: number; localEventY: number }) => {
      event.preventDefault();
      const [col, displayRow] = cell;
      const column = displayColumns[col];
      if (!column) return;
      const { isNew, index } = resolveRow(displayRow);
      // Context actions only apply to existing (loaded) rows.
      if (isNew) return;
      const value = getCellValue(index, column.name);
      // glide gives grid-local coords; offset by the wrapper's viewport rect so
      // the fixed-position menu lands under the pointer.
      const rect = wrapperRef.current?.getBoundingClientRect();
      setCellMenu({
        x: (rect?.left ?? 0) + event.localEventX,
        y: (rect?.top ?? 0) + event.localEventY,
        rowIndex: index,
        column: column.name,
        value,
      });
    },
    [displayColumns, resolveRow, getCellValue]
  );

  // Close the context menu on outside click / Escape.
  useEffect(() => {
    if (!cellMenu) return;
    const close = () => setCellMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCellMenu(null);
    };
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [cellMenu]);

  // --- Bulk edit (feature #15) ------------------------------------------------
  /** Flatten the current multi-rect selection into [displayRow, col] cell coords. */
  const selectedCells = useMemo((): Array<[number, number]> => {
    const cells: Array<[number, number]> = [];
    const seen = new Set<string>();
    const ranges = [
      ...(selection.current ? [selection.current.range, ...selection.current.rangeStack] : []),
    ];
    for (const range of ranges) {
      const { x, y, width, height } = range;
      const lastCol = Math.min(x + width, displayColumns.length);
      const lastRow = Math.min(y + height, totalRows);
      for (let r = y; r < lastRow; r++) {
        for (let c = x; c < lastCol; c++) {
          const key = `${r}-${c}`;
          if (seen.has(key)) continue;
          seen.add(key);
          cells.push([r, c]);
        }
      }
    }
    // Whole-row selections (row markers) also count as bulk targets.
    if (selection.rows && selection.rows.length > 0) {
      for (const r of selection.rows.toArray()) {
        if (r >= totalRows) continue;
        for (let c = 0; c < displayColumns.length; c++) {
          const key = `${r}-${c}`;
          if (seen.has(key)) continue;
          seen.add(key);
          cells.push([r, c]);
        }
      }
    }
    return cells;
  }, [selection, displayColumns.length, totalRows]);

  const selectedColumnNames = useMemo(() => {
    const set = new Set<string>();
    for (const [, c] of selectedCells) set.add(displayColumns[c].name);
    return Array.from(set);
  }, [selectedCells, displayColumns]);

  const applyBulkEdit = useCallback(
    (value: string | null) => {
      const text = value === null ? "" : value; // hosts treat "" -> NULL
      for (const [displayRow, c] of selectedCells) {
        const name = displayColumns[c].name;
        const { isNew, index } = resolveRow(displayRow);
        if (isNew) onEditNewCell(index, name, text);
        else onEditCell(index, name, text);
      }
      setBulkOpen(false);
    },
    [selectedCells, displayColumns, resolveRow, onEditCell, onEditNewCell]
  );

  // --- Selection aggregate footer (count / sum / avg / min / max) -------------
  const selectionAggregate = useMemo(() => {
    if (selectedCells.length < 2) return null;
    const values: unknown[] = [];
    for (const [displayRow, c] of selectedCells) {
      const name = displayColumns[c].name;
      const { isNew, index } = resolveRow(displayRow);
      values.push(isNew ? getNewCellValue(index, name) : getCellValue(index, name));
    }
    return aggregateSelection(values);
  }, [selectedCells, displayColumns, resolveRow, getNewCellValue, getCellValue]);

  // Copy the current selection to the clipboard as TSV, prefixed with the
  // column headers row (restores the old table's "copy with headers").
  const copyWithHeaders = useCallback(() => {
    const range = selection.current?.range;
    if (!range) return;
    const { x, y, width, height } = range;
    const lastCol = Math.min(x + width, displayColumns.length);
    const stringify = (raw: unknown) =>
      raw === null || raw === undefined
        ? ""
        : typeof raw === "object"
          ? JSON.stringify(raw)
          : String(raw);

    const header: string[] = [];
    for (let c = x; c < lastCol; c++) header.push(displayColumns[c].name);
    const lines: string[] = [header.join("\t")];

    const lastRow = Math.min(y + height, totalRows);
    for (let r = y; r < lastRow; r++) {
      const { isNew, index } = resolveRow(r);
      const cells: string[] = [];
      for (let c = x; c < lastCol; c++) {
        const name = displayColumns[c].name;
        const raw = isNew ? getNewCellValue(index, name) : getCellValue(index, name);
        cells.push(stringify(raw));
      }
      lines.push(cells.join("\t"));
    }
    void navigator.clipboard?.writeText(lines.join("\n"));
  }, [selection, displayColumns, totalRows, resolveRow, getNewCellValue, getCellValue]);

  const captureSnapshot = useCallback(() => {
    const range = selection.current?.range;
    if (!range) return;
    const { x, y, width, height } = range;
    const lastCol = Math.min(x + width, displayColumns.length);
    const lastRow = Math.min(y + height, totalRows);
    if ((lastCol - x) * (lastRow - y) > SNAPSHOT_CELL_CAP) {
      // Too large to snapshot inline → reference the whole table instead.
      clipboardStore.set({
        kind: "table-ref",
        source: sourceRef,
        tables: [{ name: tableName, schema: sourceRef.schema }],
      });
      return;
    }
    const cols = [];
    for (let c = x; c < lastCol; c++) {
      const col = displayColumns[c];
      cols.push({ name: col.name, data_type: col.data_type, nullable: col.nullable });
    }
    const rows: unknown[][] = [];
    for (let r = y; r < lastRow; r++) {
      const { isNew, index } = resolveRow(r);
      const cells: unknown[] = [];
      for (let c = x; c < lastCol; c++) {
        const name = displayColumns[c].name;
        cells.push(isNew ? getNewCellValue(index, name) : getCellValue(index, name));
      }
      rows.push(cells);
    }
    clipboardStore.set({
      kind: "row-snapshot",
      source: sourceRef,
      table: tableName,
      columns: cols,
      rows,
    });
  }, [selection, displayColumns, totalRows, resolveRow, getNewCellValue, getCellValue, sourceRef, tableName]);

  // --- Find & Replace ---------------------------------------------------------
  // Matches are computed over the loaded (displayed) cells. Each match is a
  // [displayRow, displayCol] coordinate so navigation can scroll/select it and
  // replace can route through the existing edit pipeline (staging + validation).
  const cellText = useCallback(
    (displayRow: number, col: number): string => {
      const column = displayColumns[col];
      if (!column) return "";
      const { isNew, index } = resolveRow(displayRow);
      const raw = isNew ? getNewCellValue(index, column.name) : getCellValue(index, column.name);
      if (raw === null || raw === undefined) return "";
      return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    },
    [displayColumns, resolveRow, getNewCellValue, getCellValue]
  );

  const matches = useMemo((): Array<[number, number]> => {
    const q = findQuery;
    if (!findOpen || q === "") return [];
    const needle = findCase ? q : q.toLowerCase();
    const found: Array<[number, number]> = [];
    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < displayColumns.length; c++) {
        const hay = cellText(r, c);
        const cmp = findCase ? hay : hay.toLowerCase();
        if (cmp.includes(needle)) found.push([r, c]);
      }
    }
    return found;
  }, [findOpen, findQuery, findCase, totalRows, displayColumns.length, cellText]);

  // Keep the cursor in range and scroll/select the active match.
  const focusMatch = useCallback(
    (i: number) => {
      const m = matches[i];
      if (!m) return;
      const [r, c] = m;
      setSelection({
        current: {
          cell: [c, r],
          range: { x: c, y: r, width: 1, height: 1 },
          rangeStack: [],
        },
        rows: CompactSelection.empty(),
        columns: CompactSelection.empty(),
      });
      gridRef.current?.scrollTo(c, r, "both", 0, 0, { hAlign: "center", vAlign: "center" });
    },
    [matches]
  );

  const onFind = useCallback((query: string, opts: { matchCase: boolean }) => {
    setFindQuery(query);
    setFindCase(opts.matchCase);
    setMatchIndex(0);
  }, []);

  // After matches recompute, clamp the cursor and reveal it.
  useEffect(() => {
    if (matches.length === 0) return;
    const i = Math.min(matchIndex, matches.length - 1);
    if (i !== matchIndex) setMatchIndex(i);
    focusMatch(i);
    // focusMatch depends on `matches`; re-run when the match set or cursor moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, matchIndex]);

  const onFindNext = useCallback(() => {
    if (matches.length === 0) return;
    setMatchIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const onFindPrev = useCallback(() => {
    if (matches.length === 0) return;
    setMatchIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  // Route a single cell through the edit pipeline with the find→replace applied.
  const replaceCellText = useCallback(
    (displayRow: number, col: number, find: string, replace: string, matchCase: boolean) => {
      const column = displayColumns[col];
      if (!column) return;
      const current = cellText(displayRow, col);
      const next = matchCase
        ? current.split(find).join(replace)
        : current.replace(new RegExp(escapeRegExp(find), "gi"), replace);
      if (next === current) return;
      const { isNew, index } = resolveRow(displayRow);
      if (isNew) onEditNewCell(index, column.name, next);
      else onEditCell(index, column.name, next);
    },
    [displayColumns, cellText, resolveRow, onEditNewCell, onEditCell]
  );

  const onReplace = useCallback(
    (find: string, replace: string, opts: { matchCase: boolean }) => {
      const m = matches[matchIndex];
      if (!m || find === "") return;
      replaceCellText(m[0], m[1], find, replace, opts.matchCase);
    },
    [matches, matchIndex, replaceCellText]
  );

  const onReplaceAll = useCallback(
    (find: string, replace: string, opts: { matchCase: boolean }) => {
      if (find === "") return;
      // Snapshot the coords first (the edit re-renders and recomputes `matches`).
      for (const [r, c] of matches) replaceCellText(r, c, find, replace, opts.matchCase);
    },
    [matches, replaceCellText]
  );

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    setMatchIndex(0);
  }, []);

  const onKeyDown = useCallback(
    (e: GridKeyEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "f") {
        // Ctrl+F → open the in-grid find/replace bar.
        e.preventDefault?.();
        setFindOpen(true);
        return;
      }
      if (key === "h") {
        // Ctrl+H → bulk edit selected cells.
        e.preventDefault?.();
        if (selectedCells.length > 0) setBulkOpen(true);
        return;
      }
      if (key === "c") {
        // Capture structured payload; let glide also write TSV (no preventDefault).
        captureSnapshot();
        if (e.shiftKey) {
          e.preventDefault?.();
          copyWithHeaders();
        }
        return;
      }
      if (key === "v") {
        const tookOver = onRequestPaste({
          sessionId: sourceRef.sessionId,
          database: sourceRef.database,
          table: tableName,
          schema: sourceRef.schema,
        });
        if (tookOver) e.preventDefault?.();
        return;
      }
      if (key === "z" && !e.shiftKey) {
        e.preventDefault?.();
        onUndo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault?.();
        onRedo();
      }
    },
    [captureSnapshot, copyWithHeaders, onRequestPaste, sourceRef, tableName, onUndo, onRedo, selectedCells.length]
  );

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col">
      {/* Grid action bar: bulk edit. Per-column quick filters were removed
          (see the comment where `columnFilters` used to live) — the structured
          "Filter & Sort" pane in the toolbar is the only filter entry point. */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border bg-secondary/20 text-xs">
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => selectedCells.length > 0 && setBulkOpen(true)}
          disabled={selectedCells.length === 0}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("table.bulkEditSelectedCells")}
        >
          <Pencil className="w-3.5 h-3.5" />
          {t("table.bulkEdit")}{selectedCells.length > 0 ? ` (${selectedCells.length})` : ""}
        </button>
      </div>

      {/* Find & Replace bar (Ctrl+F) */}
      {findOpen && (
        <GridFindReplaceBar
          onFind={onFind}
          matchCount={matches.length}
          current={matchIndex}
          onNext={onFindNext}
          onPrev={onFindPrev}
          replaceEnabled
          onReplace={onReplace}
          onReplaceAll={onReplaceAll}
          onClose={closeFind}
        />
      )}

      <div ref={wrapperRef} className="flex-1 min-h-0 w-full">
        {size.width > 0 && (
          <DataEditor
            ref={gridRef}
            columns={columns}
            rows={totalRows}
            getCellContent={getCellContent}
            onCellEdited={onCellEdited}
            getRowThemeOverride={getRowThemeOverride}
            getCellsForSelection={true}
            onPaste={onPaste}
            rangeSelect="multi-rect"
            keybindings={{ copy: true, paste: true, selectAll: true }}
            gridSelection={selection}
            onGridSelectionChange={onGridSelectionChange}
            onKeyDown={onKeyDown}
            onHeaderClicked={onHeaderClicked}
            onCellContextMenu={onCellContextMenu}
            rowMarkers="both"
            onRowAppended={onAppendRow}
            trailingRowOptions={{ hint: t("table.newRowHint"), sticky: false }}
            width={size.width}
            height={size.height}
            rowHeight={rowHeight ?? ROW_HEIGHT}
            headerHeight={HEADER_HEIGHT}
            freezeColumns={frozenCount ?? 0}
            onColumnMoved={onColumnMoved ? onColumnMovedCb : undefined}
            smoothScrollX
            smoothScrollY
            theme={theme}
            onColumnResize={onColumnResizeCb}
            customRenderers={[jsonCellRenderer, dateCellRenderer, fkCellRenderer, enumCellRenderer, setCellRenderer]}
          />
        )}
      </div>

      {/* Selection aggregate footer (multi-cell selection) */}
      {selectionAggregate && (
        <div className="flex items-center gap-4 px-3 py-1 border-t border-border bg-secondary/20 text-[11px] tabular-nums text-muted-foreground">
          <span>
            {t("table.aggCount")} <span className="text-foreground">{selectionAggregate.count}</span>
          </span>
          {selectionAggregate.numericCount > 0 ? (
            <>
              <span>
                {t("table.aggSum")} <span className="text-foreground">{fmtStat(selectionAggregate.sum)}</span>
              </span>
              <span>
                {t("table.aggAvg")} <span className="text-foreground">{fmtStat(selectionAggregate.avg)}</span>
              </span>
              <span>
                {t("table.aggMin")} <span className="text-foreground">{fmtStat(selectionAggregate.min)}</span>
              </span>
              <span>
                {t("table.aggMax")} <span className="text-foreground">{fmtStat(selectionAggregate.max)}</span>
              </span>
            </>
          ) : (
            <span className="text-muted-foreground/70">{t("table.noNumericValues")}</span>
          )}
        </div>
      )}

      {bulkOpen && (
        <BulkEditDialog
          cellCount={selectedCells.length}
          columnNames={selectedColumnNames}
          onApply={applyBulkEdit}
          onCancel={() => setBulkOpen(false)}
        />
      )}

      {/* Cell context menu */}
      {cellMenu && (
        <div
          className="fixed z-[60] min-w-[180px] py-1 bg-card border border-border rounded-md shadow-xl text-sm"
          style={{ left: cellMenu.x, top: cellMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {onViewCell && (
            <>
              <button
                type="button"
                className="w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-secondary transition-colors"
                onClick={() => {
                  onViewCell(cellMenu.rowIndex, cellMenu.column, cellMenu.value);
                  setCellMenu(null);
                }}
              >
                <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                {t("table.viewCell")}
              </button>
              <div className="my-1 h-px bg-border" />
            </>
          )}
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-secondary transition-colors"
            onClick={() => {
              onSetCellValue?.(cellMenu.rowIndex, cellMenu.column, null);
              setCellMenu(null);
            }}
          >
            {t("table.setNull")}
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-secondary transition-colors"
            onClick={() => {
              onSetCellValue?.(cellMenu.rowIndex, cellMenu.column, "");
              setCellMenu(null);
            }}
          >
            {t("table.setEmptyString")}
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-secondary transition-colors"
            onClick={() => {
              onSetCellValue?.(cellMenu.rowIndex, cellMenu.column, crypto.randomUUID());
              setCellMenu(null);
            }}
          >
            {t("table.generateUuid")}
          </button>
          {onSetRawCell && (
            <button
              type="button"
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-secondary transition-colors"
              onClick={async () => {
                const target = cellMenu;
                setCellMenu(null);
                const expr = await dialogs.prompt({
                  title: t("table.rawSqlExpressionPrompt"),
                  defaultValue: "",
                });
                if (expr && expr.trim()) onSetRawCell(target.rowIndex, target.column, expr.trim());
              }}
            >
              <Code className="w-3.5 h-3.5 text-muted-foreground" />
              {t("table.setRawValue")}
            </button>
          )}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-secondary transition-colors"
            onClick={() => {
              onFilterByCell?.(cellMenu.column, cellMenu.value);
              setCellMenu(null);
            }}
          >
            {t("table.filterByThisValue")}
          </button>
          {onShowColumnStats && (
            <button
              type="button"
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-secondary transition-colors"
              onClick={() => {
                onShowColumnStats(cellMenu.column);
                setCellMenu(null);
              }}
            >
              <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
              {t("table.columnStatisticsMenu")}
            </button>
          )}
          {onSaveCellToFile && (
            <button
              type="button"
              className="w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-secondary transition-colors"
              onClick={() => {
                onSaveCellToFile(cellMenu.value, `${cellMenu.column}.txt`);
                setCellMenu(null);
              }}
            >
              <Save className="w-3.5 h-3.5 text-muted-foreground" />
              {t("table.saveToFile")}
            </button>
          )}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-secondary transition-colors"
            onClick={() => {
              onCopyRowAs?.(cellMenu.rowIndex, "insert");
              setCellMenu(null);
            }}
          >
            {t("table.copyAsInsert")}
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-secondary transition-colors"
            onClick={() => {
              onCopyRowAs?.(cellMenu.rowIndex, "update");
              setCellMenu(null);
            }}
          >
            {t("table.copyAsUpdate")}
          </button>
        </div>
      )}
    </div>
  );
}
