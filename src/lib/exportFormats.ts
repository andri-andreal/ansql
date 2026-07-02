/**
 * exportFormats.ts — pure builders for Excel (.xlsx) and SQL (.sql) export.
 *
 * No React, no Tauri, no fs/dialog. Callers pass plain column names + row
 * objects; the hook layer (useExport.ts) handles save dialogs and writing.
 *
 * Identifier quoting + value-literal rules mirror mutationBuilder.ts / ddl.rs:
 *   - mysql            → backtick identifiers, backslash-escaped string literals
 *   - postgres/sqlite  → double-quote identifiers, standard single-quote literals
 *   - sqlserver        → bracket identifiers ([ident], ] doubled), standard
 *                        single-quote literals (no backslash escaping); BIT 1/0
 *                        booleans
 */

import * as XLSX from "xlsx";
import type { Dialect } from "../types";

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

/**
 * Build an .xlsx workbook from columns + row objects.
 *
 * Rows are keyed by column name; missing keys export as blank cells. Returns the
 * raw bytes (Uint8Array) so the caller can write them via plugin-fs `writeFile`.
 */
export function buildXlsx(
  columns: string[],
  rows: Record<string, unknown>[]
): Uint8Array {
  // Project each row onto the column order so the sheet headers are stable and
  // ordered even when a row object is missing keys or has extra ones.
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      const value = row[col];
      obj[col] = value === undefined ? null : value;
    }
    return obj;
  });

  const worksheet = XLSX.utils.json_to_sheet(data, { header: columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

  const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Uint8Array(out as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// SQL INSERT
// ---------------------------------------------------------------------------

/** Default number of value-tuples per INSERT statement. */
export const DEFAULT_SQL_BATCH_SIZE = 100;

/** Quote an identifier (table / column) for the given dialect. */
function quoteIdent(dialect: Dialect, ident: string): string {
  if (dialect === "mysql") {
    return "`" + ident.replace(/`/g, "``") + "`";
  }
  if (dialect === "sqlserver") {
    // T-SQL bracket quoting: a literal `]` is escaped by doubling it.
    return "[" + ident.replace(/]/g, "]]") + "]";
  }
  // postgres + sqlite
  return '"' + ident.replace(/"/g, '""') + '"';
}

/**
 * Render a single value as a SQL literal for the given dialect.
 *
 *   null / undefined → NULL
 *   boolean          → mysql/sqlite/sqlserver 1|0, postgres TRUE|FALSE
 *   finite number    → raw
 *   bigint           → raw
 *   Date             → quoted ISO string
 *   everything else  → single-quoted string with proper escaping
 *
 * MySQL string literals additionally escape backslashes (NO_BACKSLASH_ESCAPES
 * is off by default); postgres/sqlite/sqlserver only double single quotes.
 */
function valueLiteral(dialect: Dialect, value: unknown): string {
  if (value === null || value === undefined) return "NULL";

  if (typeof value === "boolean") {
    if (dialect === "postgres") return value ? "TRUE" : "FALSE";
    return value ? "1" : "0";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  const str =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  return quoteStringLiteral(dialect, str);
}

/** Single-quote + escape a string literal per dialect. */
function quoteStringLiteral(dialect: Dialect, str: string): string {
  let escaped = str.replace(/'/g, "''");
  if (dialect === "mysql") {
    // MySQL treats backslash as an escape char inside string literals.
    escaped = escaped.replace(/\\/g, "\\\\");
  }
  return "'" + escaped + "'";
}

/**
 * Build a string of INSERT statements for `rows` into `tableName`.
 *
 * Rows are batched (`batchSize` tuples per statement) to keep statements a
 * reasonable size while limiting statement count. Values are projected onto
 * `columns` in order; missing keys become NULL. Returns "" when there are no
 * rows.
 */
export function buildInsertSql(
  tableName: string,
  columns: string[],
  rows: Record<string, unknown>[],
  dialect: Dialect,
  batchSize: number = DEFAULT_SQL_BATCH_SIZE
): string {
  if (rows.length === 0 || columns.length === 0) return "";

  const size = batchSize > 0 ? batchSize : DEFAULT_SQL_BATCH_SIZE;
  const quotedTable = quoteIdent(dialect, tableName);
  const quotedCols = columns.map((c) => quoteIdent(dialect, c)).join(", ");
  const prefix = `INSERT INTO ${quotedTable} (${quotedCols}) VALUES`;

  const statements: string[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const tuples = batch.map((row) => {
      const values = columns.map((col) => valueLiteral(dialect, row[col]));
      return `  (${values.join(", ")})`;
    });
    statements.push(`${prefix}\n${tuples.join(",\n")};`);
  }

  return statements.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Cell stringification (shared by HTML / XML / delimited-text builders)
// ---------------------------------------------------------------------------

/**
 * Render a value as plain text for the text-based exporters.
 *
 *   null / undefined → `nullToken` (defaults to "")
 *   Date             → ISO string
 *   object           → JSON
 *   everything else  → String(value)
 */
function cellToText(value: unknown, nullToken: string): string {
  if (value === null || value === undefined) return nullToken;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/** Escape a string for safe inclusion in HTML/XML text + attribute content. */
function escapeMarkup(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build an HTML `<table>` (with `<thead>`/`<tbody>`) from columns + row objects.
 *
 * Header labels and cell contents are HTML-escaped. Values are projected onto
 * `columns` in order; null/undefined cells render empty. Returns a `<table>`
 * with an empty `<tbody>` when there are no rows.
 */
export function buildHtml(
  columns: { name: string }[],
  rows: Record<string, unknown>[]
): string {
  const names = columns.map((c) => c.name);

  const head = names
    .map((name) => `      <th>${escapeMarkup(name)}</th>`)
    .join("\n");

  const body = rows
    .map((row) => {
      const cells = names
        .map(
          (name) =>
            `      <td>${escapeMarkup(cellToText(row[name], ""))}</td>`
        )
        .join("\n");
      return `    <tr>\n${cells}\n    </tr>`;
    })
    .join("\n");

  return (
    "<table>\n" +
    "  <thead>\n" +
    `    <tr>\n${head}\n    </tr>\n` +
    "  </thead>\n" +
    "  <tbody>\n" +
    (body ? body + "\n" : "") +
    "  </tbody>\n" +
    "</table>\n"
  );
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

/**
 * Build an XML document of the form
 * `<rows><row><col>..</col>..</row>..</rows>` from columns + row objects.
 *
 * Element text is XML-escaped. Column names are used verbatim as element tags,
 * so callers should pass names that are valid XML element names. Values are
 * projected onto `columns` in order; null/undefined cells render empty.
 */
export function buildXml(
  columns: { name: string }[],
  rows: Record<string, unknown>[],
  rootTag: string = "rows",
  rowTag: string = "row"
): string {
  const names = columns.map((c) => c.name);

  const body = rows
    .map((row) => {
      const cells = names
        .map(
          (name) =>
            `    <${name}>${escapeMarkup(
              cellToText(row[name], "")
            )}</${name}>`
        )
        .join("\n");
      return `  <${rowTag}>\n${cells}\n  </${rowTag}>`;
    })
    .join("\n");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<${rootTag}>\n` +
    (body ? body + "\n" : "") +
    `</${rootTag}>\n`
  );
}

// ---------------------------------------------------------------------------
// Delimited text (general CSV / TXT)
// ---------------------------------------------------------------------------

/** Options for {@link buildDelimitedText}. */
export interface ExportTextOptions {
  /** Field separator. Defaults to ",". */
  delimiter?: string;
  /** Text qualifier wrapped around fields that need quoting. Defaults to '"'. */
  quoteChar?: string;
  /** Emit a header row of column names. Defaults to true. */
  includeHeaders?: boolean;
  /** Literal substituted for null/undefined values. Defaults to "". */
  nullToken?: string;
  /** Line terminator between rows. Defaults to "\n". */
  lineBreak?: string;
}

/**
 * Build a delimited-text document (general CSV/TXT builder).
 *
 * A field is wrapped in `quoteChar` when it contains the delimiter, the quote
 * char, a CR, or an LF; embedded quote chars are doubled (RFC 4180 style).
 * Values are projected onto `columns` in order. The `nullToken` is applied to
 * null/undefined cells *before* the quoting check, so a token containing the
 * delimiter is still quoted correctly.
 */
export function buildDelimitedText(
  columns: { name: string }[],
  rows: Record<string, unknown>[],
  opts: ExportTextOptions = {}
): string {
  const delimiter = opts.delimiter ?? ",";
  const quoteChar = opts.quoteChar ?? '"';
  const includeHeaders = opts.includeHeaders ?? true;
  const nullToken = opts.nullToken ?? "";
  const lineBreak = opts.lineBreak ?? "\n";

  const names = columns.map((c) => c.name);

  const needsQuote = (field: string): boolean =>
    (quoteChar !== "" && field.includes(quoteChar)) ||
    (delimiter !== "" && field.includes(delimiter)) ||
    field.includes("\n") ||
    field.includes("\r");

  const qualify = (field: string): string => {
    if (quoteChar === "" || !needsQuote(field)) return field;
    const escaped = field.split(quoteChar).join(quoteChar + quoteChar);
    return quoteChar + escaped + quoteChar;
  };

  const lines: string[] = [];

  if (includeHeaders) {
    lines.push(names.map((name) => qualify(name)).join(delimiter));
  }

  for (const row of rows) {
    const fields = names.map((name) =>
      qualify(cellToText(row[name], nullToken))
    );
    lines.push(fields.join(delimiter));
  }

  return lines.join(lineBreak);
}
