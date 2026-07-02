/**
 * fileImport.ts — pure parser/transform core for file imports.
 *
 * Parses CSV / JSON / Excel into a common `ParsedFile` shape and converts it
 * to the `RowTransfer` payload that the backend `transfer_rows` command
 * already consumes.  No React, no Tauri, no fs/dialog — callers pass raw
 * text/bytes.
 */

import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { RowTransfer, ColumnMap, SnapshotColumn, ConflictMode, Dialect } from "../types";

// ---------------------------------------------------------------------------
// Common intermediate shape
// ---------------------------------------------------------------------------

export interface ParsedFile {
  /** Header column names (de-duplicated; blank headers → `column_N`). */
  columns: string[];
  /** Row-major values aligned to `columns`. Empty/missing → null. */
  rows: unknown[][];
  /** Populated by parseExcel; undefined for CSV/JSON. */
  sheetNames?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** De-duplicate and blank-fill header names. */
function normalizeHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>(); // base name → count
  return raw.map((cell, idx) => {
    const base =
      cell == null || String(cell).trim() === ""
        ? `column_${idx + 1}`
        : String(cell).trim();
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    // collision: append _2, _3, … for the duplicates
    const suffix = count + 1;
    const deduped = `${base}_${suffix}`;
    seen.set(deduped, 1); // register the suffixed name too so further dups are handled
    return deduped;
  });
}

/** Convert an empty string / whitespace-only cell to null; leave other values. */
function cellOrNull(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}

/** Zero-pad a number to a fixed width (e.g. pad2(7) → "07"). */
function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/**
 * Format a JS Date into an ISO-style SQL string using the Date's LOCAL
 * components (SheetJS `cellDates` produces dates in local time, so reading
 * local components avoids an off-by-one day shift).
 *
 * - Pure-date cells (midnight) → "YYYY-MM-DD".
 * - Datetime cells            → "YYYY-MM-DD HH:MM:SS".
 */
function formatExcelDate(d: Date): string {
  const date = `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  if (h === 0 && m === 0 && s === 0) return date;
  return `${date} ${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

/**
 * Tunable parsing options shared across the delimited/structured parsers.
 *
 * All fields are optional so existing call sites keep working unchanged:
 * - `delimiter`  — field separator for CSV (papaparse `delimiter`). Default ",".
 * - `quoteChar`  — quote character for CSV (papaparse `quoteChar`). Default '"'.
 * - `encoding`   — text encoding hint (decoding happens upstream when reading
 *                  bytes; recorded here so the UI can pass it through). Unused by
 *                  the string parsers, which receive already-decoded text.
 * - `skipRows`   — number of leading rows to drop BEFORE header detection.
 * - `headerRow`  — whether the first (post-skip) row is a header. Default true.
 */
export interface ImportParseOptions {
  delimiter?: string;
  quoteChar?: string;
  encoding?: string;
  skipRows?: number;
  headerRow?: boolean;
}

export interface CsvParseOpts extends ImportParseOptions {
  /**
   * Whether the first row is a header row.
   * @default true
   * @deprecated prefer `headerRow` (kept for backward compatibility).
   */
  hasHeader?: boolean;
}

/**
 * Parse a CSV string (including BOM) into a `ParsedFile`.
 *
 * - No dynamicTyping: all cell values are kept as strings so the backend's
 *   `infer_from_value` can promote clearly-numeric columns.
 * - Empty cells → null.
 * - `delimiter`/`quoteChar` are forwarded to papaparse (auto-detect when
 *   `delimiter` is omitted).
 * - `skipRows` drops that many leading lines before header detection.
 * - `headerRow` (alias of the legacy `hasHeader`) toggles header parsing.
 */
export function parseCsv(text: string, opts: CsvParseOpts = {}): ParsedFile {
  const { hasHeader, headerRow, delimiter, quoteChar, skipRows = 0 } = opts;
  // `headerRow` takes precedence; fall back to the legacy `hasHeader`; default true.
  const useHeader = headerRow ?? hasHeader ?? true;

  // Strip BOM (U+FEFF) if present.
  const clean = text.startsWith("﻿") ? text.slice(1) : text;

  const result = Papa.parse<string[]>(clean, {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: true,
    // papaparse treats "" as auto-detect; only set when explicitly provided.
    ...(delimiter ? { delimiter } : {}),
    ...(quoteChar ? { quoteChar } : {}),
  });

  let data: string[][] = result.data as string[][];
  // Drop leading rows (e.g. preamble/metadata) before header detection.
  if (skipRows > 0) data = data.slice(skipRows);
  if (data.length === 0) return { columns: [], rows: [] };

  let columns: string[];
  let rawRows: string[][];

  if (useHeader) {
    columns = normalizeHeaders(data[0]);
    rawRows = data.slice(1);
  } else {
    const width = data[0]?.length ?? 0;
    columns = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
    rawRows = data;
  }

  const rows = rawRows.map((row) =>
    columns.map((_, i) => cellOrNull(row[i]))
  );

  return { columns, rows };
}

// ---------------------------------------------------------------------------
// parseJson
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string into a `ParsedFile`.
 *
 * Accepts:
 *   (a) Array-of-objects  →  columns = union of keys in first-seen order.
 *   (b) Array-of-arrays   →  first element is the header row.
 *
 * Throws a clear Error for non-array roots.
 */
export function parseJson(text: string): ParsedFile {
  const parsed: unknown = JSON.parse(text);

  if (!Array.isArray(parsed)) {
    throw new Error(
      "JSON import expects an array at the root (either array-of-objects or array-of-arrays with a header row)."
    );
  }

  if (parsed.length === 0) return { columns: [], rows: [] };

  // Detect array-of-arrays (first element is an array).
  if (Array.isArray(parsed[0])) {
    const [headerRow, ...dataRows] = parsed as unknown[][];
    const columns = normalizeHeaders(headerRow);
    const rows = dataRows.map((row) =>
      columns.map((_, i) => cellOrNull(row[i]))
    );
    return { columns, rows };
  }

  // Array-of-objects: collect columns in first-seen order across all rows.
  const columnSet = new Map<string, number>(); // name → insertion index
  for (const obj of parsed) {
    if (obj != null && typeof obj === "object" && !Array.isArray(obj)) {
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        if (!columnSet.has(key)) columnSet.set(key, columnSet.size);
      }
    }
  }
  const columns = [...columnSet.keys()];
  const rows = (parsed as Record<string, unknown>[]).map((obj) =>
    columns.map((col) => {
      if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return null;
      return Object.prototype.hasOwnProperty.call(obj, col) ? (obj as Record<string, unknown>)[col] : null;
    })
  );

  return { columns, rows };
}

// ---------------------------------------------------------------------------
// parseXml
// ---------------------------------------------------------------------------

/** Lightweight XML node produced by {@link parseXmlNodes}. */
interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated direct text content (whitespace-trimmed). */
  text: string;
}

/** Decode the small set of predefined XML entities (plus numeric refs). */
function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    switch (body) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: return match; // unknown entity → leave verbatim
    }
  });
}

/**
 * Parse a (flat-ish) XML string into a tree of {@link XmlNode}s. Dependency-free
 * so it runs in both the Tauri webview and the node test environment. Handles
 * element nesting, attributes, self-closing tags, text content, CDATA, comments,
 * the XML/PI declarations, and the predefined entities. It is intentionally
 * small — sufficient for tabular import data, not a full XML 1.0 implementation.
 */
function parseXmlNodes(text: string): XmlNode[] {
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  let i = 0;
  const n = text.length;

  const pushText = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "" || stack.length === 0) return;
    const top = stack[stack.length - 1];
    top.text += decodeXmlEntities(trimmed);
  };

  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt === -1) {
      pushText(text.slice(i));
      break;
    }
    if (lt > i) pushText(text.slice(i, lt));

    // Comment / CDATA / declarations.
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end === -1) throw new Error("XML import failed to parse: unterminated comment.");
      i = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end === -1) throw new Error("XML import failed to parse: unterminated CDATA section.");
      if (stack.length > 0) stack[stack.length - 1].text += text.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", lt) || text.startsWith("<!", lt)) {
      // Processing instruction or DOCTYPE — skip to the closing ">".
      const end = text.indexOf(">", lt);
      if (end === -1) throw new Error("XML import failed to parse: unterminated declaration.");
      i = end + 2 > n ? n : end + 1;
      continue;
    }

    const gt = text.indexOf(">", lt);
    if (gt === -1) throw new Error("XML import failed to parse: unterminated tag.");
    let inner = text.slice(lt + 1, gt);

    // Closing tag.
    if (inner[0] === "/") {
      const tag = inner.slice(1).trim();
      const top = stack.pop();
      if (!top || top.tag !== tag) {
        throw new Error(`XML import failed to parse: mismatched closing tag </${tag}>.`);
      }
      i = gt + 1;
      continue;
    }

    // Opening / self-closing tag.
    const selfClosing = inner.endsWith("/");
    if (selfClosing) inner = inner.slice(0, -1);

    const spaceIdx = inner.search(/\s/);
    const tag = (spaceIdx === -1 ? inner : inner.slice(0, spaceIdx)).trim();
    const attrSrc = spaceIdx === -1 ? "" : inner.slice(spaceIdx + 1);
    const attrs: Record<string, string> = {};
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(attrSrc)) !== null) {
      const value = m[3] !== undefined ? m[3] : (m[4] ?? "");
      attrs[m[1]] = decodeXmlEntities(value);
    }

    const node: XmlNode = { tag, attrs, children: [], text: "" };
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    if (!selfClosing) stack.push(node);

    i = gt + 1;
  }

  if (stack.length > 0) {
    throw new Error(`XML import failed to parse: unclosed tag <${stack[stack.length - 1].tag}>.`);
  }
  return roots;
}

/**
 * Parse a flat, tabular XML string into a `ParsedFile`.
 *
 * Convention (no schema required): the root element wraps a list of "record"
 * elements (one per row). For each record, a column is derived from:
 *   - each child element's tag name  →  value = the element's text content, and
 *   - each attribute's name          →  value = the attribute value.
 * Columns are the union of all names across records, in first-seen order. A
 * record missing a given column contributes `null` for it.
 *
 * Both common shapes work out of the box:
 *   <rows><row><id>1</id><name>Alice</name></row>…</rows>     (element-per-field)
 *   <table><record id="1" name="Alice"/>…</table>             (attribute-per-field)
 * and mixtures of the two.
 *
 * The record element is the root's first element child's tag (e.g. `row`,
 * `record`, `item`); every sibling sharing that tag is treated as a row.
 *
 * Throws a clear Error on malformed XML or when no fields are found.
 */
export function parseXml(text: string): ParsedFile {
  const roots = parseXmlNodes(text);
  if (roots.length === 0) {
    throw new Error("XML import expects a root element wrapping a list of records.");
  }

  // The root wraps the records; if multiple top-level same-tag nodes exist (no
  // single wrapper), treat those as the records directly.
  let records: XmlNode[];
  if (roots.length === 1) {
    records = roots[0].children;
  } else {
    const tag = roots[0].tag;
    records = roots.filter((r) => r.tag === tag);
  }
  if (records.length === 0) return { columns: [], rows: [] };

  // The record tag is the first record's tag; only same-tag siblings are rows.
  const recordTag = records[0].tag;
  records = records.filter((r) => r.tag === recordTag);

  // Build per-record field maps and collect the column union (first-seen order).
  const columnSet = new Map<string, number>(); // name → insertion index
  const recordMaps: Map<string, unknown>[] = records.map((rec) => {
    const fields = new Map<string, unknown>();

    // Attributes first (so attribute-named columns appear before element ones).
    for (const [name, value] of Object.entries(rec.attrs)) {
      if (!fields.has(name)) fields.set(name, value);
      if (!columnSet.has(name)) columnSet.set(name, columnSet.size);
    }

    // Child elements: tag name → text content.
    for (const child of rec.children) {
      const name = child.tag;
      if (!fields.has(name)) fields.set(name, child.text);
      if (!columnSet.has(name)) columnSet.set(name, columnSet.size);
    }

    return fields;
  });

  const columns = [...columnSet.keys()];
  if (columns.length === 0) {
    throw new Error("XML import found records but no fields (attributes or child elements).");
  }

  const rows = recordMaps.map((fields) =>
    columns.map((col) => (fields.has(col) ? cellOrNull(fields.get(col)) : null))
  );

  return { columns, rows };
}

// ---------------------------------------------------------------------------
// parseExcel
// ---------------------------------------------------------------------------

/**
 * Parse an Excel file (xlsx/xls/…) from raw bytes into a `ParsedFile`.
 *
 * - Defaults to the first sheet; pass `sheetName` to select another.
 * - `sheetNames` is always populated from the workbook.
 * - Uses `cellDates: true` — Excel date/datetime serials are parsed into JS
 *   `Date` objects, then formatted into ISO-style SQL strings: pure-date cells
 *   become "YYYY-MM-DD" and datetime cells become "YYYY-MM-DD HH:MM:SS".  This
 *   avoids emitting raw Excel date serials (e.g. 45000) into the payload, so
 *   the backend imports real dates.  Local Date components are used to avoid an
 *   off-by-one day shift.  The `ParsedFile` cell values stay string/number/null
 *   — dates are strings.
 * - Empty cells → null via `defval: null`.
 */
export function parseExcel(bytes: Uint8Array, sheetName?: string): ParsedFile {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const sheetNames: string[] = wb.SheetNames;

  const targetSheet = sheetName ?? sheetNames[0];
  const ws = wb.Sheets[targetSheet];

  if (!ws) {
    throw new Error(`Sheet "${targetSheet}" not found in workbook.`);
  }

  // header:1 → returns rows as arrays; defval:null fills empty cells.
  // raw:true keeps non-date values un-coerced; date cells already arrive as
  // JS Date objects thanks to cellDates above.
  const data: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];

  if (data.length === 0) return { columns: [], rows: [], sheetNames };

  const columns = normalizeHeaders(data[0]);
  const rows = data.slice(1).map((row) =>
    columns.map((_, i) => {
      const v = cellOrNull(row[i]);
      // Date cells (from cellDates) → ISO-style SQL strings.
      return v instanceof Date ? formatExcelDate(v) : v;
    })
  );

  return { columns, rows, sheetNames };
}

// ---------------------------------------------------------------------------
// toRowTransfer
// ---------------------------------------------------------------------------

export interface ToRowTransferOpts {
  targetTable: string;
  targetSchema?: string;
  /** @default "append" */
  conflict?: ConflictMode;
  /** @default false */
  createIfMissing?: boolean;
  /** @default 500 */
  batchSize?: number;
  /** Source dialect passed to the backend for type inference.  @default "sqlite" */
  sourceDialect?: Dialect;
}

/**
 * Convert a `ParsedFile` + column mapping into a `RowTransfer` payload that
 * the `transfer_rows` Tauri command can consume directly.
 *
 * The backend (`apply_row_transfer`) keys a column-index on `columns[].name`
 * and resolves each `mapping.source` against it, using `mapping.target` as the
 * INSERT column list. So the payload must be SOURCE-aligned, exactly like
 * `PasteTransferModal` builds its row-snapshot transfer:
 *
 * - `columns` = the SOURCE column names (all of them, in source order), with an
 *   empty `data_type` so the backend infers types from the actual row data.
 * - `rows` = the raw source rows, unfiltered and unreordered (aligned to
 *   `columns`).
 * - `mapping` = the active mapping with skipped entries (`target === ""`)
 *   dropped; the backend selects/renames columns from this.
 */
export function toRowTransfer(
  parsed: Pick<ParsedFile, "columns" | "rows">,
  mapping: ColumnMap[],
  opts: ToRowTransferOpts
): RowTransfer {
  const {
    targetTable,
    targetSchema = null,
    conflict = "append",
    createIfMissing = false,
    batchSize = 500,
    sourceDialect = "sqlite",
  } = opts;

  // SnapshotColumns describe the SOURCE columns (all of them, source order).
  // Empty data_type → backend runs `infer_from_value` on the row data.
  const columns: SnapshotColumn[] = parsed.columns.map((name) => ({
    name,
    data_type: "",
    nullable: true,
  }));

  // Filter out skipped mappings (target === ""); the backend uses this to
  // select/rename source columns into the INSERT column list.
  const activeMapping = mapping.filter((m) => m.target !== "");

  return {
    source_dialect: sourceDialect,
    target_schema: targetSchema ?? null,
    target_table: targetTable,
    columns,
    // Raw, source-aligned rows — the backend resolves mapping.source against
    // `columns` per row, so rows must NOT be pre-filtered or reordered.
    rows: parsed.rows,
    mapping: activeMapping,
    conflict,
    create_if_missing: createIfMissing,
    batch_size: batchSize,
  };
}
