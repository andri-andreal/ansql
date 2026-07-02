import type { Dialect, MutationColumn, ParamValue, Statement } from "../types";

/**
 * Pure builders that turn pending grid edits into parameterized SQL statements.
 *
 * Design rules:
 * - Values are NEVER string-interpolated into SQL. Non-null scalars become bound
 *   parameters; NULL is emitted as the literal `NULL` (in SET) / `IS NULL` (in
 *   WHERE), never a parameter.
 * - Placeholders are dialect-correct: `?` for MySQL/SQLite, `$1..$n` for Postgres,
 *   `@P1..@Pn` for SQL Server. On Postgres a `::type` cast is appended for columns
 *   whose bound text value would otherwise mismatch the column type (date/time/json/uuid).
 * - Rows are identified by their primary key when the table has one; otherwise by
 *   every column value (all-columns fallback), capped to a single row.
 *
 * The caller passes an already-quoted, fully-qualified table name (`tableName`).
 *
 * Known limitation: integer values round-trip through JSON as float64, so a
 * primary key whose magnitude exceeds 2^53 (e.g. snowflake-style bigints) can be
 * rounded before it reaches this builder. Such PKs cannot be matched exactly; a
 * fix belongs at the IPC transport layer (string-encode big integers), not here.
 */

/**
 * A raw SQL expression that should be emitted verbatim into a statement instead
 * of being bound as a parameter (e.g. `CURRENT_TIMESTAMP`, `NOW()`, `gen_random_uuid()`).
 *
 * Use this to let a cell commit a server-side expression. The grid wraps such a
 * value with `rawSql(expr)`; the builders detect it via `isRawSql` and splice the
 * expression literally into the SQL (no placeholder, no entry in `params`).
 *
 * SECURITY: the expression is interpolated unescaped, so it must come from a
 * trusted source (a fixed menu / the user's own SQL), never from row data.
 */
export interface RawSql {
  __raw: string;
}

/** Wrap a SQL expression so the builders emit it literally instead of binding it. */
export function rawSql(expr: string): RawSql {
  return { __raw: expr };
}

/** Type guard for a {@link RawSql} marker. */
export function isRawSql(v: unknown): v is RawSql {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { __raw?: unknown }).__raw === "string"
  );
}

/** Quote and escape an identifier for the given dialect. */
export function quoteIdent(dialect: Dialect, name: string): string {
  if (dialect === "mysql") {
    return "`" + name.replace(/`/g, "``") + "`";
  }
  if (dialect === "sqlserver") {
    // T-SQL bracket quoting: a literal `]` is escaped by doubling it.
    return "[" + name.replace(/]/g, "]]") + "]";
  }
  // postgres + sqlite use double quotes
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Emits dialect-correct placeholders, tracking the running index for the
 * 1-indexed positional dialects: `$n` for Postgres, `@Pn` for SQL Server.
 * MySQL/SQLite use a plain `?`.
 */
class Placeholders {
  private n = 0;
  constructor(private readonly dialect: Dialect) {}
  next(): string {
    this.n += 1;
    if (this.dialect === "postgres") return `$${this.n}`;
    if (this.dialect === "sqlserver") return `@P${this.n}`;
    return "?";
  }
}

function isNumericType(dataType: string): boolean {
  const t = dataType.toLowerCase();
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

function isBoolType(dataType: string): boolean {
  const t = dataType.toLowerCase();
  return t.includes("bool") || t === "tinyint(1)" || t === "bit" || t === "bit(1)";
}

/** Is the value "empty" for INSERT purposes (omit so DB defaults apply)? */
function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Coerce a cell value to a bound parameter of the correct JS type, so native
 * sqlx binding matches the column type (important for Postgres' strict typing):
 * booleans bind as real bool, numerics as numbers, everything else as text (with
 * a Postgres `::type` cast added at the placeholder where needed). Callers must
 * only pass non-null values here.
 *
 * SQL Server needs no special casing: its `BIT` type is detected by `isBoolType`
 * and bound as a JS boolean (the driver maps bool → BIT 1/0); other types coerce
 * exactly as for the other dialects.
 */
export function coerceValue(col: MutationColumn, value: unknown): ParamValue {
  if (isBoolType(col.data_type)) {
    const s = String(value).toLowerCase();
    return s === "true" || s === "1" || s === "t";
  }
  if (isNumericType(col.data_type)) {
    const n = Number(value);
    return Number.isNaN(n) ? String(value) : n;
  }
  if (typeof value === "object") {
    // JSON columns / arrays — serialize compactly.
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value;
  return String(value);
}

/**
 * Postgres binds text/number/bool params with explicit types and performs no
 * implicit cast into date/time/json/uuid columns, so append an explicit cast for
 * those. Numeric and boolean columns bind as the right native type already.
 */
function pgCast(dialect: Dialect, dataType: string): string {
  if (dialect !== "postgres") return "";
  if (isNumericType(dataType) || isBoolType(dataType)) return "";
  const t = dataType.toLowerCase();
  if (t.includes("timestamptz") || t.includes("timestamp with time zone")) return "::timestamptz";
  if (t.includes("timestamp")) return "::timestamp";
  if (t.includes("date")) return "::date";
  if (t.includes("time")) return "::time";
  if (t.includes("jsonb")) return "::jsonb";
  if (t.includes("json")) return "::json";
  if (t.includes("uuid")) return "::uuid";
  return "";
}

/**
 * Push a bound parameter and return its placeholder (with any Postgres cast).
 * A {@link RawSql} value is emitted verbatim instead: no placeholder is taken
 * and nothing is pushed to `params`.
 */
function emitParam(
  dialect: Dialect,
  col: MutationColumn,
  value: unknown,
  ph: Placeholders,
  params: ParamValue[],
): string {
  if (isRawSql(value)) return value.__raw;
  params.push(coerceValue(col, value));
  return ph.next() + pgCast(dialect, col.data_type);
}

function hasPrimaryKey(columns: MutationColumn[]): boolean {
  return columns.some((c) => c.is_primary_key);
}

/** Columns used to identify a row: the PK if any, else every column. */
function whereColumns(columns: MutationColumn[]): MutationColumn[] {
  const pk = columns.filter((c) => c.is_primary_key);
  return pk.length > 0 ? pk : columns;
}

/**
 * Build a WHERE clause fragment (without the leading "WHERE") that identifies a
 * single row from its original values. NULLs become `IS NULL`; other values are
 * bound through `ph`/`params`.
 */
function buildWhere(
  dialect: Dialect,
  columns: MutationColumn[],
  originalRow: Record<string, unknown>,
  ph: Placeholders,
  params: ParamValue[],
): string {
  const clauses = whereColumns(columns).map((col) => {
    const value = originalRow[col.name];
    const ident = quoteIdent(dialect, col.name);
    if (value === null || value === undefined) {
      return `${ident} IS NULL`;
    }
    return `${ident} = ${emitParam(dialect, col, value, ph, params)}`;
  });
  return clauses.join(" AND ");
}

/**
 * The single-row cap for an UPDATE/DELETE targeting one row. With a primary key
 * the WHERE is exact and no cap is needed. Without one, two rows can be identical
 * across all columns, so the statement is capped to a single row, dialect-correctly:
 *  - MySQL: trailing `LIMIT 1` (`limit`).
 *  - Postgres/SQLite: a `ctid`/`rowid` subquery folded into the WHERE.
 *  - SQL Server: `TOP (1)` right after the verb (`top`), since T-SQL has no
 *    `LIMIT` nor a stable physical row id to subquery on.
 *
 * `top` is a prefix the caller splices between the verb and the table; `limit`
 * is a trailing suffix.
 */
function rowMatch(
  dialect: Dialect,
  tableName: string,
  columns: MutationColumn[],
  originalRow: Record<string, unknown>,
  ph: Placeholders,
  params: ParamValue[],
): { where: string; limit: string; top: string } {
  const where = buildWhere(dialect, columns, originalRow, ph, params);
  if (hasPrimaryKey(columns)) return { where: `WHERE ${where}`, limit: "", top: "" };
  if (dialect === "postgres") {
    return { where: `WHERE ctid = (SELECT ctid FROM ${tableName} WHERE ${where} LIMIT 1)`, limit: "", top: "" };
  }
  if (dialect === "sqlite") {
    return { where: `WHERE rowid IN (SELECT rowid FROM ${tableName} WHERE ${where} LIMIT 1)`, limit: "", top: "" };
  }
  if (dialect === "sqlserver") {
    return { where: `WHERE ${where}`, limit: "", top: "TOP (1) " };
  }
  return { where: `WHERE ${where}`, limit: " LIMIT 1", top: "" }; // mysql
}

/**
 * Build an UPDATE for the changed columns of one row. Returns null if `changes`
 * is empty. `tableName` must be pre-quoted.
 */
export function buildUpdate(
  dialect: Dialect,
  tableName: string,
  columns: MutationColumn[],
  originalRow: Record<string, unknown>,
  changes: Record<string, unknown>,
): Statement | null {
  const changedCols = Object.keys(changes);
  if (changedCols.length === 0) return null;

  const byName = new Map(columns.map((c) => [c.name, c]));
  const params: ParamValue[] = [];
  const ph = new Placeholders(dialect);

  const setClauses = changedCols.map((name) => {
    const ident = quoteIdent(dialect, name);
    const value = changes[name];
    if (value === null || value === undefined) {
      return `${ident} = NULL`;
    }
    const col = byName.get(name) ?? { name, data_type: "text" };
    return `${ident} = ${emitParam(dialect, col, value, ph, params)}`;
  });

  const { where, limit, top } = rowMatch(dialect, tableName, columns, originalRow, ph, params);
  return {
    sql: `UPDATE ${top}${tableName} SET ${setClauses.join(", ")} ${where}${limit}`,
    params,
  };
}

/** Options controlling how {@link buildInsert} selects columns. */
export interface InsertOptions {
  /**
   * Force-include EVERY column present in `rowData`, even auto-increment or
   * empty ones, emitting an explicit `NULL` for null/undefined values. Used to
   * restore a deleted row exactly — including its primary key — when inverting
   * a DELETE (see `inverseBuilder.invertDelete`). The default INSERT path omits
   * these so the DB supplies defaults / auto-increment.
   */
  forceAll?: boolean;
}

/**
 * Build an INSERT from a new row. Only columns the user filled (non-empty) are
 * included, so the database supplies defaults / auto-increment for the rest.
 * Auto-increment primary keys are always omitted. Returns null if nothing to insert.
 *
 * With `opts.forceAll`, every column present in `rowData` is emitted verbatim
 * (NULLs as the literal `NULL`), so a previously-deleted row can be re-created
 * with its exact original values.
 */
export function buildInsert(
  dialect: Dialect,
  tableName: string,
  columns: MutationColumn[],
  rowData: Record<string, unknown>,
  opts: InsertOptions = {},
): Statement | null {
  const params: ParamValue[] = [];
  const ph = new Placeholders(dialect);
  const idents: string[] = [];
  const placeholders: string[] = [];

  for (const col of columns) {
    const value = rowData[col.name];
    if (opts.forceAll) {
      // Restore mode: include every column that exists in the snapshot row,
      // emitting NULL literally (never a bound param) for null/undefined.
      if (!(col.name in rowData)) continue;
      idents.push(quoteIdent(dialect, col.name));
      placeholders.push(
        value === null || value === undefined ? "NULL" : emitParam(dialect, col, value, ph, params),
      );
      continue;
    }
    if (col.is_auto_increment) continue;
    if (isEmpty(value)) continue;
    idents.push(quoteIdent(dialect, col.name));
    placeholders.push(emitParam(dialect, col, value, ph, params));
  }

  if (idents.length === 0) return null;
  return {
    sql: `INSERT INTO ${tableName} (${idents.join(", ")}) VALUES (${placeholders.join(", ")})`,
    params,
  };
}

/** Build a DELETE that targets one row by PK (or single-row all-columns fallback). */
export function buildDelete(
  dialect: Dialect,
  tableName: string,
  columns: MutationColumn[],
  originalRow: Record<string, unknown>,
): Statement {
  const params: ParamValue[] = [];
  const ph = new Placeholders(dialect);
  const { where, limit, top } = rowMatch(dialect, tableName, columns, originalRow, ph, params);
  return { sql: `DELETE ${top}FROM ${tableName} ${where}${limit}`, params };
}
