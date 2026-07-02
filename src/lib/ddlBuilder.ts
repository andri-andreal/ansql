/**
 * Pure DDL builder for the Table Designer.
 *
 * Mirrors the Rust transfer engine's `ddl.rs` + `type_map.rs` for CREATE TABLE,
 * but operates on `DesignerColumn`/`DesignerIndex` (UI model) rather than
 * the runtime `ColumnDefinition` returned by database introspection.
 *
 * Design rules:
 * - Pure functions only — no React, no Tauri calls.
 * - All identifier quoting delegates to `quoteIdent` from mutationBuilder.ts.
 * - Auto-increment encoding mirrors ddl.rs exactly:
 *     MySQL   → trailing AUTO_INCREMENT keyword
 *     Postgres → SMALLSERIAL / SERIAL / BIGSERIAL pseudo-type (no keyword)
 *     SQLite  → inline `INTEGER PRIMARY KEY AUTOINCREMENT` (single-col PK only,
 *               mutually exclusive with a table-level PRIMARY KEY clause)
 */

import type {
  Dialect,
  DesignerColumn,
  DesignerIndex,
  DesignerCheck,
  DesignerUnique,
  TableOptions,
  Statement,
} from "../types";
import { quoteIdent } from "./mutationBuilder";

// ---------------------------------------------------------------------------
// Type catalog
// ---------------------------------------------------------------------------

export interface TypeEntry {
  /** Key used in DesignerColumn.type */
  key: string;
  /** Human-readable label for the UI dropdown */
  label: string;
  /** Whether this type accepts a (length) modifier — e.g. VARCHAR(n) */
  hasLength: boolean;
  /** Whether this type accepts (precision, scale) modifiers — e.g. DECIMAL(p,s) */
  hasPrecisionScale: boolean;
}

/**
 * Selectable column types. Order here is the suggested dropdown order.
 * Mirrors the CanonicalType variants in type_map.rs.
 */
export const TYPE_CATALOG: TypeEntry[] = [
  { key: "int",       label: "Integer (INT)",        hasLength: false, hasPrecisionScale: false },
  { key: "bigint",    label: "Big Integer (BIGINT)",  hasLength: false, hasPrecisionScale: false },
  { key: "smallint",  label: "Small Integer",         hasLength: false, hasPrecisionScale: false },
  { key: "decimal",   label: "Decimal (DECIMAL)",     hasLength: false, hasPrecisionScale: true  },
  { key: "real",      label: "Real (REAL)",            hasLength: false, hasPrecisionScale: false },
  { key: "double",    label: "Double Precision",       hasLength: false, hasPrecisionScale: false },
  { key: "varchar",   label: "Variable String",        hasLength: true,  hasPrecisionScale: false },
  { key: "text",      label: "Text (TEXT)",            hasLength: false, hasPrecisionScale: false },
  { key: "boolean",   label: "Boolean",                hasLength: false, hasPrecisionScale: false },
  { key: "date",      label: "Date",                   hasLength: false, hasPrecisionScale: false },
  { key: "timestamp", label: "Timestamp / DateTime",   hasLength: false, hasPrecisionScale: false },
  { key: "time",      label: "Time",                   hasLength: false, hasPrecisionScale: false },
  { key: "json",      label: "JSON",                   hasLength: false, hasPrecisionScale: false },
  { key: "blob",      label: "Binary / Blob",          hasLength: false, hasPrecisionScale: false },
  { key: "uuid",      label: "UUID",                   hasLength: false, hasPrecisionScale: false },
];

// ---------------------------------------------------------------------------
// quoteStringLiteral
// ---------------------------------------------------------------------------

/**
 * Single-quote and escape a string literal for the given dialect.
 *
 * Mirrors the Rust transfer engine's `dialect.rs::quote_string`:
 * - MySQL (default sql_mode, NO_BACKSLASH_ESCAPES off) treats `\` as an escape
 *   character inside string literals, so backslashes must be doubled there in
 *   addition to doubling the single quote.
 * - Postgres / SQLite use standard-conforming strings where only the single
 *   quote needs doubling.
 */
export function quoteStringLiteral(dialect: Dialect, s: string): string {
  if (dialect === "mysql") {
    return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
  }
  // Postgres / SQLite — standard-conforming: only double the single quote.
  return `'${s.replace(/'/g, "''")}'`;
}

/** Treat ''/null/undefined as "no comment". */
function hasComment(comment: string | null | undefined): comment is string {
  return comment != null && comment !== "";
}

// ---------------------------------------------------------------------------
// renderType
// ---------------------------------------------------------------------------

/**
 * Render the SQL type string for a designer column, taking dialect into account.
 *
 * Mirrors type_map.rs::render for the canonical types in TYPE_CATALOG.
 * Auto-increment SERIAL substitution is handled in buildCreateTable (not here),
 * so this function always returns the plain dialect-correct type.
 */
export function renderType(dialect: Dialect, col: DesignerColumn): string {
  switch (col.type) {
    // Integer family — same string across all dialects.
    // SQL Server spells int as INT (not INTEGER), so handle it first.
    case "int":
      return dialect === "sqlserver" ? "INT" : "INTEGER";
    case "bigint":
      return "BIGINT";
    case "smallint":
      return "SMALLINT";

    // Decimal — (precision, scale) where provided, mirroring Decimal{p,s} render
    case "decimal": {
      if (col.precision != null && col.scale != null) return `DECIMAL(${col.precision},${col.scale})`;
      if (col.precision != null) return `DECIMAL(${col.precision})`;
      return "DECIMAL";
    }

    case "real":
      return "REAL";

    // Double: MySQL → DOUBLE, Postgres/SQLite → DOUBLE PRECISION, SQL Server → FLOAT
    case "double":
      if (dialect === "mysql") return "DOUBLE";
      if (dialect === "sqlserver") return "FLOAT";
      return "DOUBLE PRECISION";

    // VARCHAR: with length or fallback 255. SQL Server prefers NVARCHAR (Unicode).
    case "varchar":
      if (dialect === "sqlserver") {
        return col.length != null ? `NVARCHAR(${col.length})` : "NVARCHAR(255)";
      }
      return col.length != null ? `VARCHAR(${col.length})` : "VARCHAR(255)";

    // Text: SQL Server uses NVARCHAR(MAX) (the deprecated TEXT type is avoided).
    case "text":
      return dialect === "sqlserver" ? "NVARCHAR(MAX)" : "TEXT";

    // Boolean: TINYINT(1) / BOOLEAN / INTEGER / BIT
    case "boolean":
      if (dialect === "mysql") return "TINYINT(1)";
      if (dialect === "postgres") return "BOOLEAN";
      if (dialect === "sqlserver") return "BIT";
      return "INTEGER"; // SQLite

    case "date":
      return "DATE";

    // Timestamp/DateTime: MySQL → DATETIME, Postgres/SQLite → TIMESTAMP,
    // SQL Server → DATETIME2 (TIMESTAMP is a rowversion alias in T-SQL).
    case "timestamp":
      if (dialect === "mysql") return "DATETIME";
      if (dialect === "sqlserver") return "DATETIME2";
      return "TIMESTAMP";

    case "time":
      return "TIME";

    // JSON: Postgres → JSONB, MySQL → JSON, SQL Server → NVARCHAR(MAX), SQLite → TEXT
    case "json":
      if (dialect === "postgres") return "JSONB";
      if (dialect === "mysql") return "JSON";
      if (dialect === "sqlserver") return "NVARCHAR(MAX)";
      return "TEXT"; // SQLite

    // Blob: MySQL → LONGBLOB, Postgres → BYTEA, SQL Server → VARBINARY(MAX), SQLite → BLOB
    case "blob":
      if (dialect === "mysql") return "LONGBLOB";
      if (dialect === "postgres") return "BYTEA";
      if (dialect === "sqlserver") return "VARBINARY(MAX)";
      return "BLOB"; // SQLite

    // UUID: Postgres → UUID, SQL Server → UNIQUEIDENTIFIER, others → VARCHAR(36)
    case "uuid":
      if (dialect === "postgres") return "UUID";
      if (dialect === "sqlserver") return "UNIQUEIDENTIFIER";
      return "VARCHAR(36)";

    default:
      // Unknown/custom type: pass through as a Unicode-safe TEXT for SQL Server,
      // TEXT elsewhere (mirrors Unknown(_) in type_map.rs).
      return dialect === "sqlserver" ? "NVARCHAR(MAX)" : "TEXT";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Qualify a table name with an optional schema, each identifier quoted.
 * Mirrors ddl.rs::qualified.
 *
 * MySQL qualification: <db>.<table> (schema arg is the database name).
 * Postgres/SQLite:     "schema"."table" (or bare table when schema is null/empty).
 */
function qualified(dialect: Dialect, schema: string | null, table: string): string {
  if (schema) {
    return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, table)}`;
  }
  return quoteIdent(dialect, table);
}

/**
 * Render the column's type with auto-increment SERIAL substitution for Postgres,
 * plus MySQL UNSIGNED / ZEROFILL modifiers on numeric types.
 * Mirrors ddl.rs::render_column_type.
 *
 * MySQL appends UNSIGNED / ZEROFILL directly after the numeric type, e.g.
 * `INTEGER UNSIGNED`, `DECIMAL(10,2) UNSIGNED ZEROFILL`. Both modifiers only
 * apply to the integer/decimal/float families; other types ignore them.
 */
function renderColumnType(dialect: Dialect, col: DesignerColumn): string {
  if (col.isAutoIncrement && dialect === "postgres") {
    switch (col.type) {
      case "smallint": return "SMALLSERIAL";
      case "int":      return "SERIAL";
      case "bigint":   return "BIGSERIAL";
      // Non-integer auto-increment on PG falls through to plain type render
    }
  }
  let typeSql = renderType(dialect, col);
  // SQL Server: auto-increment is the IDENTITY(1,1) column property — it follows
  // the type (e.g. `INT IDENTITY(1,1)`), there is no SERIAL pseudo-type.
  if (dialect === "sqlserver" && col.isAutoIncrement) {
    typeSql += " IDENTITY(1,1)";
  }
  if (dialect === "mysql" && isNumericType(col.type)) {
    if (col.unsigned || col.zerofill) typeSql += " UNSIGNED";
    if (col.zerofill) typeSql += " ZEROFILL";
  }
  return typeSql;
}

/** Numeric type keys that accept MySQL UNSIGNED / ZEROFILL modifiers. */
function isNumericType(type: string): boolean {
  return (
    type === "int" ||
    type === "bigint" ||
    type === "smallint" ||
    type === "decimal" ||
    type === "real" ||
    type === "double"
  );
}

/**
 * Render the trailing per-column attribute fragments common to CREATE TABLE
 * and ALTER (MySQL MODIFY/CHANGE). Returns the fragments that follow the
 * type+null+default+autoinc sequence:
 *   - MySQL CHARACTER SET x COLLATE y (when set)
 *   - MySQL ON UPDATE CURRENT_TIMESTAMP (for timestamp/datetime)
 *   - MySQL COMMENT '…'
 *
 * Note: charset/collation only emit for MySQL; ON UPDATE only for MySQL on
 * timestamp columns. The caller already handles type/null/default/autoinc.
 */
export function mysqlColumnAttrs(col: DesignerColumn): string {
  let out = "";
  if (col.charset != null && col.charset !== "") {
    out += ` CHARACTER SET ${col.charset}`;
  }
  if (col.collation != null && col.collation !== "") {
    out += ` COLLATE ${col.collation}`;
  }
  if (col.onUpdateCurrentTimestamp && col.type === "timestamp") {
    out += " ON UPDATE CURRENT_TIMESTAMP";
  }
  return out;
}

/**
 * Render a GENERATED ALWAYS AS (expr) STORED|VIRTUAL column definition body
 * (everything after the quoted name + type). Shared by CREATE TABLE and ALTER.
 *
 * Generated columns never carry DEFAULT or AUTO_INCREMENT; NOT NULL is still
 * permitted and emitted by the caller. The STORED/VIRTUAL keyword follows the
 * expression. SQLite spells VIRTUAL the same way; MySQL/Postgres too.
 */
export function generatedClause(gen: { expression: string; stored: boolean }): string {
  const kind = gen.stored ? "STORED" : "VIRTUAL";
  return ` GENERATED ALWAYS AS (${gen.expression}) ${kind}`;
}

/**
 * Map an index access method to the dialect-correct keyword for `USING`.
 * Returns null when no method clause should be emitted.
 */
function indexMethodKeyword(dialect: Dialect, method: string | null | undefined): string | null {
  if (method == null || method === "") return null;
  const m = method.trim().toUpperCase();
  if (dialect === "mysql") {
    // MySQL supports BTREE / HASH (engine-dependent).
    if (m === "BTREE" || m === "HASH") return m;
    return null;
  }
  if (dialect === "postgres") {
    // Postgres uses lowercase access-method names.
    const lower = m.toLowerCase();
    if (lower === "btree" || lower === "hash" || lower === "gin" || lower === "gist" || lower === "brin" || lower === "spgist") {
      return lower;
    }
    return null;
  }
  // SQLite and SQL Server have no USING <method> clause in this scope.
  return null;
}

/**
 * Render one index column reference with optional MySQL prefix length and
 * per-column ASC/DESC order, e.g. `` `name`(10) DESC ``.
 */
function indexColumnRef(dialect: Dialect, idx: DesignerIndex, colName: string): string {
  let ref = quoteIdent(dialect, colName);
  const prefix = idx.prefixLengths?.[colName];
  if (dialect === "mysql" && typeof prefix === "number" && prefix > 0) {
    ref += `(${prefix})`;
  }
  const order = idx.columnOrders?.[colName];
  if (order === "ASC" || order === "DESC") {
    ref += ` ${order}`;
  }
  return ref;
}

/**
 * Build a single CREATE [UNIQUE|FULLTEXT|SPATIAL] INDEX statement for an index,
 * honoring method (USING), kind (FULLTEXT/SPATIAL on MySQL), per-column order
 * and prefix length. Shared by ddlBuilder and alterBuilder.
 */
export function buildIndexStatement(
  dialect: Dialect,
  qualifiedTable: string,
  idx: DesignerIndex,
): string {
  const cols = idx.columns.map((c) => indexColumnRef(dialect, idx, c)).join(", ");
  const name = quoteIdent(dialect, idx.name);

  // MySQL FULLTEXT / SPATIAL take their own keyword in place of UNIQUE.
  if (dialect === "mysql" && (idx.indexKind === "fulltext" || idx.indexKind === "spatial")) {
    const kw = idx.indexKind === "fulltext" ? "FULLTEXT" : "SPATIAL";
    return `CREATE ${kw} INDEX ${name} ON ${qualifiedTable} (${cols});`;
  }

  const unique = idx.unique ? "UNIQUE " : "";
  const method = indexMethodKeyword(dialect, idx.method);

  if (dialect === "postgres" && method) {
    // Postgres: USING <method> precedes the column list.
    return `CREATE ${unique}INDEX ${name} ON ${qualifiedTable} USING ${method} (${cols});`;
  }

  let sql = `CREATE ${unique}INDEX ${name} ON ${qualifiedTable} (${cols})`;
  if (dialect === "mysql" && method) {
    // MySQL: USING <method> follows the column list.
    sql += ` USING ${method}`;
  }
  return sql + ";";
}

// ---------------------------------------------------------------------------
// buildCreateTable
// ---------------------------------------------------------------------------

/**
 * Build a CREATE TABLE statement plus one CREATE [UNIQUE] INDEX per index.
 *
 * Returns Statement[] (sql + params: []) compatible with commit_changes.
 *
 * Mirrors generate_create_table + generate_indexes in ddl.rs:
 * - NOT NULL emitted for non-nullable columns.
 * - MySQL:   trailing AUTO_INCREMENT keyword.
 * - Postgres: SMALLSERIAL / SERIAL / BIGSERIAL pseudo-type; table-level PK clause.
 * - SQLite:   single auto-increment PK → inline INTEGER PRIMARY KEY AUTOINCREMENT;
 *             NO separate table-level PK clause in that case.
 * - DEFAULT <expr> when defaultValue is set (raw, user-quoted).
 */
export function buildCreateTable(
  dialect: Dialect,
  schema: string | null,
  table: string,
  columns: DesignerColumn[],
  indexes: DesignerIndex[],
  checks: DesignerCheck[] = [],
  uniques: DesignerUnique[] = [],
  options?: TableOptions,
): Statement[] {
  const qualifiedTable = qualified(dialect, schema, table);

  // Detect SQLite inline PK: single-col PK + auto-increment (mirrors ddl.rs exactly).
  const pkCount = columns.filter((c) => c.isPrimaryKey).length;
  const sqliteInlinePk =
    dialect === "sqlite" &&
    pkCount === 1 &&
    columns.some((c) => c.isPrimaryKey && c.isAutoIncrement);

  const colDefs: string[] = [];
  const pkCols: string[] = [];

  for (const c of columns) {
    const quotedName = quoteIdent(dialect, c.name);

    // SQLite inline PK case (mirrors ddl.rs lines 66-70)
    if (sqliteInlinePk && c.isPrimaryKey) {
      colDefs.push(`  ${quotedName} INTEGER PRIMARY KEY AUTOINCREMENT`);
      continue;
    }

    if (c.isPrimaryKey) {
      pkCols.push(quotedName);
    }

    // GENERATED columns: name + type + GENERATED ALWAYS AS (...) STORED|VIRTUAL.
    // No DEFAULT / AUTO_INCREMENT; NOT NULL still permitted.
    if (c.generated != null && c.generated.expression !== "") {
      const typeSql = renderColumnType(dialect, c);
      const nullFragment = c.nullable ? "" : " NOT NULL";
      const genFragment = generatedClause(c.generated);
      const attrFragment = dialect === "mysql" ? mysqlColumnAttrs(c) : "";
      const commentFragment =
        dialect === "mysql" && hasComment(c.comment)
          ? ` COMMENT ${quoteStringLiteral(dialect, c.comment)}`
          : "";
      colDefs.push(
        `  ${quotedName} ${typeSql}${genFragment}${nullFragment}${attrFragment}${commentFragment}`,
      );
      continue;
    }

    const typeSql = renderColumnType(dialect, c);
    const nullFragment = c.nullable ? "" : " NOT NULL";

    // MySQL auto-increment keyword (Postgres uses SERIAL above; SQLite handled inline)
    const autoFragment =
      c.isAutoIncrement && dialect === "mysql" ? " AUTO_INCREMENT" : "";

    const defaultFragment =
      !c.isAutoIncrement && c.defaultValue != null && c.defaultValue !== ""
        ? ` DEFAULT ${c.defaultValue}`
        : "";

    // MySQL-only per-column attrs: CHARACTER SET / COLLATE / ON UPDATE CURRENT_TIMESTAMP.
    const attrFragment = dialect === "mysql" ? mysqlColumnAttrs(c) : "";

    // MySQL carries the comment inline on the column line; Postgres emits a
    // separate COMMENT ON COLUMN below; SQLite has no column comments.
    const commentFragment =
      dialect === "mysql" && hasComment(c.comment)
        ? ` COMMENT ${quoteStringLiteral(dialect, c.comment)}`
        : "";

    colDefs.push(
      `  ${quotedName} ${typeSql}${nullFragment}${defaultFragment}${autoFragment}${attrFragment}${commentFragment}`,
    );
  }

  // Table-level PRIMARY KEY clause — omitted for SQLite inline case (mirrors ddl.rs line 95)
  if (pkCols.length > 0 && !sqliteInlinePk) {
    colDefs.push(`  PRIMARY KEY (${pkCols.join(", ")})`);
  }

  // Named UNIQUE constraints (all dialects): CONSTRAINT <name> UNIQUE (cols).
  for (const u of uniques) {
    if (u.columns.length === 0) continue;
    const cols = u.columns.map((c) => quoteIdent(dialect, c)).join(", ");
    colDefs.push(`  CONSTRAINT ${quoteIdent(dialect, u.name)} UNIQUE (${cols})`);
  }

  // CHECK constraints (MySQL 8+ / Postgres / SQLite): CONSTRAINT <name> CHECK (expr).
  for (const ck of checks) {
    if (ck.expression === "") continue;
    colDefs.push(`  CONSTRAINT ${quoteIdent(dialect, ck.name)} CHECK (${ck.expression})`);
  }

  const optionsClause = renderTableOptions(dialect, options);
  const createSql =
    `CREATE TABLE ${qualifiedTable} (\n${colDefs.join(",\n")}\n)${optionsClause};`;

  const statements: Statement[] = [{ sql: createSql, params: [] }];

  // Postgres column comments — one COMMENT ON COLUMN statement per commented
  // column, emitted right after the CREATE TABLE. MySQL handles comments inline
  // (above); SQLite has no column comments.
  if (dialect === "postgres") {
    for (const c of columns) {
      if (hasComment(c.comment)) {
        const stmt = `COMMENT ON COLUMN ${qualifiedTable}.${quoteIdent(dialect, c.name)} IS ${quoteStringLiteral(dialect, c.comment)};`;
        statements.push({ sql: stmt, params: [] });
      }
    }
    // Postgres table comment via a separate COMMENT ON TABLE statement (no
    // engine/charset support on PG).
    if (options && hasComment(options.comment)) {
      statements.push({
        sql: `COMMENT ON TABLE ${qualifiedTable} IS ${quoteStringLiteral(dialect, options.comment)};`,
        params: [],
      });
    }
  }

  // Indexes — mirrors generate_indexes in ddl.rs, plus method/kind/order/prefix.
  for (const idx of indexes) {
    statements.push({ sql: buildIndexStatement(dialect, qualifiedTable, idx), params: [] });
  }

  return statements;
}

/**
 * Render the trailing table-options clause for CREATE TABLE.
 *
 * MySQL: ` ENGINE=… DEFAULT CHARSET=… COLLATE=… ROW_FORMAT=… AUTO_INCREMENT=… COMMENT='…'`
 *        (only the set options, in that canonical order; the comment is quoted).
 * Postgres / SQLite: no inline options clause — Postgres emits COMMENT ON TABLE
 *        separately (handled in buildCreateTable); SQLite ignores options.
 */
function renderTableOptions(dialect: Dialect, options: TableOptions | undefined): string {
  if (!options || dialect !== "mysql") return "";
  const parts: string[] = [];
  if (options.engine != null && options.engine !== "") parts.push(`ENGINE=${options.engine}`);
  if (options.charset != null && options.charset !== "") parts.push(`DEFAULT CHARSET=${options.charset}`);
  if (options.collation != null && options.collation !== "") parts.push(`COLLATE=${options.collation}`);
  if (options.rowFormat != null && options.rowFormat !== "") parts.push(`ROW_FORMAT=${options.rowFormat}`);
  if (options.autoIncrement != null) parts.push(`AUTO_INCREMENT=${options.autoIncrement}`);
  if (hasComment(options.comment)) parts.push(`COMMENT=${quoteStringLiteral(dialect, options.comment)}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}
