/**
 * Pure client-side validators for pending grid edits. Validate a row's values
 * against its column definitions BEFORE committing, so obviously-bad values
 * (NOT NULL violations, over-length strings, malformed numbers/dates) are caught
 * locally and the offending cells highlighted, instead of round-tripping a DB
 * error.
 *
 * These are intentionally conservative: they only reject values that are
 * (almost) certainly wrong. Anything ambiguous is allowed through so the DB can
 * have the final say.
 */

/** Minimal column shape needed for validation (subset of ColumnDefinition). */
export interface ValidationColumn {
  name: string;
  data_type: string;
  /** Sized/declared type, e.g. `varchar(255)`, `decimal(10,2)`. */
  full_type?: string | null;
  nullable: boolean;
  default_value?: string | null;
  is_primary_key?: boolean;
  is_auto_increment?: boolean;
}

export interface CellError {
  column: string;
  message: string;
}

const lower = (s: string) => s.toLowerCase();

function isNumericType(dataType: string): boolean {
  const t = lower(dataType);
  return (
    t.includes("int") ||
    t.includes("decimal") ||
    t.includes("numeric") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("real") ||
    t.includes("serial")
  );
}

function isIntegerType(dataType: string): boolean {
  const t = lower(dataType);
  // serial is an integer-backed auto type
  return (t.includes("int") || t.includes("serial")) && !t.includes("interval");
}

function isStringType(dataType: string): boolean {
  const t = lower(dataType);
  return t.includes("char") || t.includes("text") || t.includes("clob");
}

function isBoolType(dataType: string): boolean {
  const t = lower(dataType);
  return t.includes("bool") || t === "tinyint(1)" || t === "bit" || t === "bit(1)";
}

export type DateKind = "date" | "datetime" | "time" | null;

export function dateKind(dataType: string): DateKind {
  const t = lower(dataType);
  if (t.includes("timestamp") || t.includes("datetime")) return "datetime";
  if (t === "date") return "date";
  if (t.startsWith("time")) return "time";
  return null;
}

/** Parse the max length from a sized char/varchar declaration, else null. */
export function parseMaxLength(col: ValidationColumn): number | null {
  const decl = col.full_type ?? col.data_type;
  const t = lower(decl);
  if (!isStringType(t)) return null;
  // char(n) / varchar(n) / character varying(n) / nvarchar(n)
  const m = t.match(/\(\s*(\d+)\s*\)/);
  if (!m) return null;
  return Number(m[1]);
}

const isNullish = (v: unknown): boolean => v === null || v === undefined || v === "";

// Date/datetime/time format regexes (lenient; accept both space and "T").
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Validate a single cell value against its column. `isInsert` true for new rows
 * (NOT NULL is enforced unless the column auto-increments or has a default).
 * Returns an error message or null.
 */
export function validateCell(
  col: ValidationColumn,
  value: unknown,
  isInsert: boolean
): string | null {
  const empty = isNullish(value);

  // NOT NULL — only meaningfully enforced on INSERT. On UPDATE, leaving a cell
  // null may legitimately mean "no change", and a true null assignment will be
  // caught by the DB; we only block clearly-required new rows.
  if (empty) {
    if (
      isInsert &&
      !col.nullable &&
      !col.is_auto_increment &&
      (col.default_value === null || col.default_value === undefined)
    ) {
      return `"${col.name}" cannot be empty (NOT NULL)`;
    }
    return null; // empty + nullable / has default / update => fine
  }

  const str = typeof value === "object" ? JSON.stringify(value) : String(value);

  // String length
  const maxLen = parseMaxLength(col);
  if (maxLen !== null && str.length > maxLen) {
    return `"${col.name}" exceeds max length ${maxLen} (got ${str.length})`;
  }

  // Numeric sanity
  if (isNumericType(col.data_type) && !isBoolType(col.data_type)) {
    const n = Number(str);
    if (str.trim() === "" || Number.isNaN(n)) {
      return `"${col.name}" must be a number`;
    }
    if (isIntegerType(col.data_type) && !Number.isInteger(n)) {
      return `"${col.name}" must be a whole number`;
    }
  }

  // Date / time formats
  const dk = dateKind(col.data_type);
  if (dk === "date" && !DATE_RE.test(str)) {
    return `"${col.name}" must be a date (YYYY-MM-DD)`;
  }
  if (dk === "time" && !TIME_RE.test(str)) {
    return `"${col.name}" must be a time (HH:MM[:SS])`;
  }
  if (dk === "datetime" && !DATETIME_RE.test(str)) {
    return `"${col.name}" must be a date-time (YYYY-MM-DD HH:MM[:SS])`;
  }

  return null;
}

/**
 * Validate a full row (map of columnName -> value) against its column defs.
 * `changedColumns`, if provided, limits validation to those columns (used for
 * UPDATEs where only some cells changed). Returns one error per offending cell.
 */
export function validateRow(
  columns: ValidationColumn[],
  row: Record<string, unknown>,
  isInsert: boolean,
  changedColumns?: Set<string>
): CellError[] {
  const errors: CellError[] = [];
  for (const col of columns) {
    if (changedColumns && !changedColumns.has(col.name)) continue;
    const msg = validateCell(col, row[col.name], isInsert);
    if (msg) errors.push({ column: col.name, message: msg });
  }
  return errors;
}
