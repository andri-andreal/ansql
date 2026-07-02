/**
 * dumpBuilder.ts — pure string builders for a SQL "dump" (schema + data export).
 *
 * No React, no Tauri, no fs/dialog. Callers pass already-introspected metadata
 * (ColumnDefinition / IndexInfo / ForeignKeyInfo) plus plain row objects; the
 * hook layer handles save dialogs and writing the resulting text.
 *
 * Design rules (mirroring ddlBuilder.ts / mutationBuilder.ts):
 * - Identifier quoting delegates to mutationBuilder.quoteIdent.
 * - The column type is taken VERBATIM from `full_type ?? data_type` (these come
 *   from live introspection and are already dialect-correct), unlike the
 *   designer's ddlBuilder which renders types from a canonical catalog.
 * - Auto-increment encoding mirrors ddl.rs:
 *     MySQL      → trailing AUTO_INCREMENT keyword
 *     Postgres   → SMALLSERIAL / SERIAL / BIGSERIAL pseudo-type substitution
 *     SQLite     → inline `INTEGER PRIMARY KEY AUTOINCREMENT` for a single AI PK
 *                  (mutually exclusive with a table-level PRIMARY KEY clause)
 *     SQL Server → trailing IDENTITY(1,1) keyword on the column
 * - SQL Server has no `CREATE TABLE IF NOT EXISTS`; the drop builder uses the
 *   supported `DROP TABLE IF EXISTS` (2016+). Indexes / FKs are emitted with
 *   bracket-quoted identifiers exactly like the other dialects.
 * - Data rows reuse exportFormats.buildInsertSql; schema-qualification of the
 *   INSERT target is layered on here (buildInsertSql only quotes the bare name).
 */

import type {
  Dialect,
  ColumnDefinition,
  IndexInfo,
  ForeignKeyInfo,
} from "../types";
import { quoteIdent } from "./mutationBuilder";
import { buildInsertSql } from "./exportFormats";

// ---------------------------------------------------------------------------
// Public input shape
// ---------------------------------------------------------------------------

export interface DumpTableInput {
  schema?: string | null;
  table: string;
  columns: ColumnDefinition[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Qualify a table name with an optional schema, each identifier quoted.
 * Mirrors ddl.rs::qualified — MySQL `db`.`table`, Postgres/SQLite "schema"."table",
 * or the bare quoted table when no schema is given.
 */
function qualified(
  dialect: Dialect,
  schema: string | null | undefined,
  table: string,
): string {
  if (schema) {
    return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, table)}`;
  }
  return quoteIdent(dialect, table);
}

/**
 * Postgres SERIAL substitution for an auto-increment integer column.
 * Inspects the verbatim type string to pick the right serial width; falls back
 * to the original type for non-integer auto-increment columns (mirrors ddl.rs).
 */
function pgSerialType(verbatimType: string): string {
  const t = verbatimType.toLowerCase();
  if (t.includes("bigint") || t.includes("int8")) return "BIGSERIAL";
  if (t.includes("smallint") || t.includes("int2")) return "SMALLSERIAL";
  if (t.includes("int")) return "SERIAL";
  return verbatimType;
}

// ---------------------------------------------------------------------------
// buildCreateTableDump
// ---------------------------------------------------------------------------

/**
 * Build the full CREATE TABLE block for one table: the CREATE TABLE itself,
 * then one CREATE [UNIQUE] INDEX per non-primary index, then one
 * ALTER TABLE ADD CONSTRAINT ... FOREIGN KEY per foreign key.
 *
 * Each statement is ';'-terminated and statements are newline-separated.
 */
export function buildCreateTableDump(dialect: Dialect, t: DumpTableInput): string {
  const qualifiedTable = qualified(dialect, t.schema, t.table);

  // SQLite single auto-increment PK → inline INTEGER PRIMARY KEY AUTOINCREMENT,
  // with NO separate table-level PK clause (mirrors ddl.rs).
  const pkCols = t.columns.filter((c) => c.is_primary_key);
  const sqliteInlinePk =
    dialect === "sqlite" &&
    pkCols.length === 1 &&
    pkCols[0].is_auto_increment;

  const colDefs: string[] = [];

  for (const c of t.columns) {
    const quotedName = quoteIdent(dialect, c.name);

    if (sqliteInlinePk && c.is_primary_key) {
      colDefs.push(`  ${quotedName} INTEGER PRIMARY KEY AUTOINCREMENT`);
      continue;
    }

    // Type taken verbatim from full_type, falling back to bare data_type.
    let typeSql = c.full_type ?? c.data_type;
    if (c.is_auto_increment && dialect === "postgres") {
      typeSql = pgSerialType(typeSql);
    }

    const nullFragment = c.nullable ? "" : " NOT NULL";

    // DEFAULT is raw (introspected expression / literal), emitted as-is.
    const defaultFragment =
      !c.is_auto_increment && c.default_value != null && c.default_value !== ""
        ? ` DEFAULT ${c.default_value}`
        : "";

    // MySQL carries AUTO_INCREMENT as a trailing keyword; SQL Server uses
    // IDENTITY(1,1); Postgres uses SERIAL (substituted above); SQLite is inline.
    let autoFragment = "";
    if (c.is_auto_increment && dialect === "mysql") autoFragment = " AUTO_INCREMENT";
    if (c.is_auto_increment && dialect === "sqlserver") autoFragment = " IDENTITY(1,1)";

    colDefs.push(
      `  ${quotedName} ${typeSql}${nullFragment}${defaultFragment}${autoFragment}`,
    );
  }

  // Table-level PRIMARY KEY clause (single or composite) — omitted for the
  // SQLite inline case.
  if (pkCols.length > 0 && !sqliteInlinePk) {
    const pkList = pkCols.map((c) => quoteIdent(dialect, c.name)).join(", ");
    colDefs.push(`  PRIMARY KEY (${pkList})`);
  }

  const statements: string[] = [
    `CREATE TABLE ${qualifiedTable} (\n${colDefs.join(",\n")}\n);`,
  ];

  // Indexes — skip primary (covered by the inline/table-level PK clause).
  for (const idx of t.indexes) {
    if (idx.is_primary) continue;
    const unique = idx.is_unique ? "UNIQUE " : "";
    const cols = idx.columns.map((c) => quoteIdent(dialect, c)).join(", ");
    statements.push(
      `CREATE ${unique}INDEX ${quoteIdent(dialect, idx.name)} ON ${qualifiedTable} (${cols});`,
    );
  }

  // Foreign keys — emitted as ALTER TABLE ADD CONSTRAINT after the table exists.
  for (const fk of t.foreignKeys) {
    const cols = fk.columns.map((c) => quoteIdent(dialect, c)).join(", ");
    // Referenced table lives in the same schema as the owning table.
    const refTable = qualified(dialect, t.schema, fk.referenced_table);
    const refCols = fk.referenced_columns
      .map((c) => quoteIdent(dialect, c))
      .join(", ");
    const onDelete = fk.on_delete ? ` ON DELETE ${fk.on_delete}` : "";
    const onUpdate = fk.on_update ? ` ON UPDATE ${fk.on_update}` : "";
    statements.push(
      `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT ${quoteIdent(dialect, fk.name)} ` +
        `FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols})${onDelete}${onUpdate};`,
    );
  }

  return statements.join("\n");
}

// ---------------------------------------------------------------------------
// buildDropTableDump
// ---------------------------------------------------------------------------

/** "DROP TABLE IF EXISTS <qualified>;" for the given table. */
export function buildDropTableDump(
  dialect: Dialect,
  schema: string | null | undefined,
  table: string,
): string {
  return `DROP TABLE IF EXISTS ${qualified(dialect, schema, table)};`;
}

// ---------------------------------------------------------------------------
// buildInsertDump
// ---------------------------------------------------------------------------

/**
 * Build INSERT statements for `rows`, schema-qualifying the target table.
 *
 * Reuses exportFormats.buildInsertSql for value-literal rendering and batching,
 * then rewrites the leading (bare) `INSERT INTO <quotedTable>` prefix to the
 * schema-qualified form. Returns "" when there are no rows / columns.
 */
export function buildInsertDump(
  dialect: Dialect,
  schema: string | null | undefined,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  const sql = buildInsertSql(table, columns, rows, dialect);
  if (sql === "") return "";

  if (!schema) return sql;

  // buildInsertSql emits the bare table quoted as the INSERT target (each
  // statement starts `INSERT INTO <bareQuoted> (`). Rewrite that bare token to
  // the schema-qualified form. We match the token between the `INSERT INTO `
  // verb and the opening of the column list rather than re-deriving the exact
  // quote chars, so the rewrite is robust regardless of the per-dialect quoting
  // buildInsertSql uses (e.g. SQL Server brackets vs. ANSI double quotes).
  const qualifiedTable = qualified(dialect, schema, table);
  return sql.replace(
    /INSERT INTO .+? \(/g,
    `INSERT INTO ${qualifiedTable} (`,
  );
}

// ---------------------------------------------------------------------------
// dumpHeader
// ---------------------------------------------------------------------------

/** A leading comment header describing the dump. */
export function dumpHeader(dialect: Dialect, databaseName: string): string {
  return `-- ANSQL dump of ${databaseName} (${dialect}) --`;
}
