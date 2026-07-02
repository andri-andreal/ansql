/**
 * Pure ALTER TABLE builder for the Table Designer.
 *
 * Exports:
 * - rawTypeToCatalog  — inverse of renderType: maps DB-reported data_type
 *                       strings to TYPE_CATALOG keys + sizes.
 * - diffColumns       — id-based diff of DesignerColumn arrays → AlterOp[].
 * - diffIndexes       — id-based diff of DesignerIndex arrays → AlterOp[].
 * - buildAlter        — turns AlterOp[] into dialect-correct Statement[].
 * - supportedOnSqlite — guard that reports which ops SQLite cannot execute.
 *
 * Design rules:
 * - Pure functions only — no React, no Tauri calls.
 * - All identifier quoting delegates to quoteIdent from mutationBuilder.ts.
 * - renderType from ddlBuilder.ts drives the full column spec in ALTER.
 * - PG PRIMARY KEY drop assumes the default constraint name <table>_pkey.
 *   If a table has a custom PK name, callers must handle that themselves.
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
import {
  renderType,
  quoteStringLiteral,
  mysqlColumnAttrs,
  generatedClause,
  buildIndexStatement,
} from "./ddlBuilder";

// ---------------------------------------------------------------------------
// AlterOp discriminated union
// ---------------------------------------------------------------------------

export type AlterOp =
  | { kind: "addColumn"; column: DesignerColumn }
  | { kind: "dropColumn"; name: string }
  | { kind: "renameColumn"; from: string; to: string; column: DesignerColumn }
  | {
      kind: "modifyColumn";
      column: DesignerColumn;
      typeChanged: boolean;
      nullChanged: boolean;
      defaultChanged: boolean;
      commentChanged: boolean;
      /**
       * MySQL-only extended attribute change (unsigned/zerofill/charset/
       * collation/onUpdateCurrentTimestamp/generated). Forces a full MODIFY
       * COLUMN re-render on MySQL; best-effort on Postgres; ignored on SQLite.
       * Optional for backward-compatibility (undefined = no attr change).
       */
      attrsChanged?: boolean;
    }
  | { kind: "setPrimaryKey"; columns: string[] }
  | { kind: "addIndex"; index: DesignerIndex }
  | { kind: "dropIndex"; name: string }
  | { kind: "addCheck"; check: DesignerCheck }
  | { kind: "dropCheck"; name: string }
  | { kind: "addUnique"; unique: DesignerUnique }
  | { kind: "dropUnique"; name: string }
  | { kind: "setTableOptions"; options: TableOptions }
  | { kind: "renameTable"; to: string };

// ---------------------------------------------------------------------------
// rawTypeToCatalog
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  type: string;
  length: number | null;
  precision: number | null;
  scale: number | null;
}

/**
 * Maps a DB-reported data_type string to a TYPE_CATALOG key + sizes.
 *
 * This is the inverse of renderType — loading an existing column then
 * re-rendering it must produce a stable round-trip with no spurious diffs.
 *
 * Handles, case-insensitively:
 * - Postgres long-form strings from information_schema.data_type
 * - Short forms (int, varchar(n), decimal(p,s), etc.)
 * - MySQL aliases (datetime, longblob, tinyint(1), double)
 *
 * Unknown types fall back to "text" (safe) without throwing.
 */
export function rawTypeToCatalog(dialect: Dialect, rawDataType: string): CatalogEntry {
  // Intentionally unused — the parser is based on string patterns, not dialect.
  void dialect;

  const s = rawDataType.trim().toLowerCase();

  // Extract optional (n) or (p,s) suffix from the type string.
  // e.g. "varchar(100)" → base="varchar", args="100"
  //      "decimal(10,2)" → base="decimal", args="10,2"
  const parenMatch = s.match(/^([^(]+)\(([^)]*)\)\s*$/);
  const base = parenMatch ? parenMatch[1].trim() : s;
  const args = parenMatch ? parenMatch[2].trim() : null;

  function parseLength(): number | null {
    if (args === null) return null;
    const n = parseInt(args, 10);
    return isNaN(n) ? null : n;
  }

  function parsePrecisionScale(): { precision: number | null; scale: number | null } {
    if (args === null) return { precision: null, scale: null };
    const parts = args.split(",").map((p) => parseInt(p.trim(), 10));
    const precision = isNaN(parts[0]) ? null : parts[0];
    const scale = parts.length > 1 && !isNaN(parts[1]) ? parts[1] : null;
    return { precision, scale };
  }

  const none: CatalogEntry = { type: "text", length: null, precision: null, scale: null };

  // ---- boolean special-case: tinyint(1) only ----
  if (base === "tinyint") {
    if (args === "1") {
      return { type: "boolean", length: null, precision: null, scale: null };
    }
    // Other tinyint variants map to int
    return { type: "int", length: null, precision: null, scale: null };
  }

  // ---- integer family ----
  if (
    base === "integer" ||
    base === "int" ||
    base === "int4"
  ) {
    return { type: "int", length: null, precision: null, scale: null };
  }

  if (base === "bigint" || base === "int8") {
    return { type: "bigint", length: null, precision: null, scale: null };
  }

  if (base === "smallint" || base === "int2") {
    return { type: "smallint", length: null, precision: null, scale: null };
  }

  // ---- decimal / numeric ----
  if (base === "decimal" || base === "numeric") {
    const { precision, scale } = parsePrecisionScale();
    return { type: "decimal", length: null, precision, scale };
  }

  // ---- floating point ----
  if (base === "real" || base === "float4") {
    return { type: "real", length: null, precision: null, scale: null };
  }

  if (
    base === "double precision" ||
    base === "double" ||
    base === "float8" ||
    base === "float"
  ) {
    return { type: "double", length: null, precision: null, scale: null };
  }

  // ---- varchar / character varying / char / character ----
  if (base === "varchar" || base === "character varying" || base === "char" || base === "character") {
    const length = parseLength();
    return { type: "varchar", length, precision: null, scale: null };
  }

  // ---- text ----
  if (base === "text") {
    return { type: "text", length: null, precision: null, scale: null };
  }

  // ---- boolean ----
  if (base === "boolean" || base === "bool") {
    return { type: "boolean", length: null, precision: null, scale: null };
  }

  // ---- date / time / timestamp ----
  if (base === "date") {
    return { type: "date", length: null, precision: null, scale: null };
  }

  if (
    base === "timestamp without time zone" ||
    base === "timestamp with time zone" ||
    base === "timestamp" ||
    base === "timestamptz" ||
    base === "datetime"
  ) {
    return { type: "timestamp", length: null, precision: null, scale: null };
  }

  if (
    base === "time without time zone" ||
    base === "time with time zone" ||
    base === "time" ||
    base === "timetz"
  ) {
    return { type: "time", length: null, precision: null, scale: null };
  }

  // ---- json ----
  if (base === "json" || base === "jsonb") {
    return { type: "json", length: null, precision: null, scale: null };
  }

  // ---- blob / binary ----
  if (
    base === "bytea" ||
    base === "blob" ||
    base === "longblob" ||
    base === "mediumblob" ||
    base === "tinyblob" ||
    base === "binary" ||
    base === "varbinary"
  ) {
    return { type: "blob", length: null, precision: null, scale: null };
  }

  // ---- uuid ----
  if (base === "uuid") {
    return { type: "uuid", length: null, precision: null, scale: null };
  }

  // ---- unknown → safe fallback ----
  return none;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Qualify a table name with optional schema, both quoted. */
function qualified(dialect: Dialect, schema: string | null, table: string): string {
  if (schema) {
    return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, table)}`;
  }
  return quoteIdent(dialect, table);
}

/** Normalize a comment: '' / null / undefined all collapse to "" ("no comment"). */
function normalizeComment(comment: string | null | undefined): string {
  return comment ?? "";
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
 * Render the type for a column spec, applying MySQL UNSIGNED / ZEROFILL and the
 * Postgres SERIAL substitution (mirrors ddlBuilder.renderColumnType). Kept local
 * because ddlBuilder does not export it.
 */
function renderColumnTypeForSpec(dialect: Dialect, col: DesignerColumn): string {
  if (col.isAutoIncrement && dialect === "postgres") {
    switch (col.type) {
      case "smallint": return "SMALLSERIAL";
      case "int":      return "SERIAL";
      case "bigint":   return "BIGSERIAL";
    }
  }
  let typeSql = renderType(dialect, col);
  // SQL Server: auto-increment is the IDENTITY(1,1) column property after the type.
  if (dialect === "sqlserver" && col.isAutoIncrement) {
    typeSql += " IDENTITY(1,1)";
  }
  if (dialect === "mysql" && isNumericType(col.type)) {
    if (col.unsigned || col.zerofill) typeSql += " UNSIGNED";
    if (col.zerofill) typeSql += " ZEROFILL";
  }
  return typeSql;
}

/**
 * Render a full column spec: TYPE [NOT NULL] [DEFAULT expr] [AUTO_INCREMENT]
 * [CHARACTER SET/COLLATE/ON UPDATE] [COMMENT '…'], including GENERATED columns.
 *
 * MySQL re-emits the full spec for every MODIFY/CHANGE COLUMN, so the comment
 * and extended attributes must ride along here or they would be dropped.
 * Postgres/SQLite never carry a comment in the column spec (Postgres uses
 * COMMENT ON COLUMN; SQLite ignores).
 */
function columnSpec(dialect: Dialect, col: DesignerColumn): string {
  const typeSql = renderColumnTypeForSpec(dialect, col);
  const nullFragment = col.nullable ? "" : " NOT NULL";

  // GENERATED columns carry no DEFAULT / AUTO_INCREMENT.
  if (col.generated != null && col.generated.expression !== "") {
    const genFragment = generatedClause(col.generated);
    const attrFragment = dialect === "mysql" ? mysqlColumnAttrs(col) : "";
    const commentFragment =
      dialect === "mysql" && normalizeComment(col.comment) !== ""
        ? ` COMMENT ${quoteStringLiteral(dialect, normalizeComment(col.comment))}`
        : "";
    return `${typeSql}${genFragment}${nullFragment}${attrFragment}${commentFragment}`;
  }

  // AUTO_INCREMENT columns must not emit a DEFAULT (mirrors ddlBuilder.ts buildCreateTable)
  const defaultFragment =
    !col.isAutoIncrement && col.defaultValue != null && col.defaultValue !== ""
      ? ` DEFAULT ${col.defaultValue}`
      : "";
  const autoFragment = col.isAutoIncrement && dialect === "mysql" ? " AUTO_INCREMENT" : "";
  const attrFragment = dialect === "mysql" ? mysqlColumnAttrs(col) : "";
  const commentFragment =
    dialect === "mysql" && normalizeComment(col.comment) !== ""
      ? ` COMMENT ${quoteStringLiteral(dialect, normalizeComment(col.comment))}`
      : "";
  return `${typeSql}${nullFragment}${defaultFragment}${autoFragment}${attrFragment}${commentFragment}`;
}

/** True when any MySQL extended column attribute differs between two columns. */
function attrsAreDifferent(a: DesignerColumn, b: DesignerColumn): boolean {
  const genA = a.generated ?? null;
  const genB = b.generated ?? null;
  const genDiff =
    (genA === null) !== (genB === null) ||
    (genA !== null && genB !== null &&
      (genA.expression !== genB.expression || genA.stored !== genB.stored));
  return (
    !!a.unsigned !== !!b.unsigned ||
    !!a.zerofill !== !!b.zerofill ||
    (a.charset ?? null) !== (b.charset ?? null) ||
    (a.collation ?? null) !== (b.collation ?? null) ||
    !!a.onUpdateCurrentTimestamp !== !!b.onUpdateCurrentTimestamp ||
    genDiff
  );
}

/** Treat ''/null/undefined as "no value". */
function hasValue(v: string | null | undefined): v is string {
  return v != null && v !== "";
}

/**
 * Render the trailing clause for a MySQL `ALTER TABLE … <clause>` table-options
 * statement: `ENGINE=… DEFAULT CHARSET=… COLLATE=… ROW_FORMAT=… AUTO_INCREMENT=… COMMENT='…'`
 * for the set options only. Returns "" when nothing is set.
 */
function mysqlTableOptionsClause(dialect: Dialect, options: TableOptions): string {
  const parts: string[] = [];
  if (hasValue(options.engine)) parts.push(`ENGINE=${options.engine}`);
  if (hasValue(options.charset)) parts.push(`DEFAULT CHARSET=${options.charset}`);
  if (hasValue(options.collation)) parts.push(`COLLATE=${options.collation}`);
  if (hasValue(options.rowFormat)) parts.push(`ROW_FORMAT=${options.rowFormat}`);
  if (options.autoIncrement != null) parts.push(`AUTO_INCREMENT=${options.autoIncrement}`);
  if (hasValue(options.comment)) parts.push(`COMMENT=${quoteStringLiteral(dialect, options.comment)}`);
  return parts.join(" ");
}

/** Human-readable label for an op SQLite cannot apply via ALTER TABLE. */
function sqliteUnsupportedReason(op: AlterOp): string {
  switch (op.kind) {
    case "addCheck": return `adding CHECK constraint "${op.check.name}"`;
    case "dropCheck": return `dropping CHECK constraint "${op.name}"`;
    case "addUnique": return `adding UNIQUE constraint "${op.unique.name}"`;
    case "dropUnique": return `dropping UNIQUE constraint "${op.name}"`;
    case "setTableOptions": return "changing table options";
    default: return "this change";
  }
}

/** Check if two DesignerColumns differ in type/length/precision/scale. */
function typeIsDifferent(a: DesignerColumn, b: DesignerColumn): boolean {
  return (
    a.type !== b.type ||
    (a.length ?? null) !== (b.length ?? null) ||
    (a.precision ?? null) !== (b.precision ?? null) ||
    (a.scale ?? null) !== (b.scale ?? null)
  );
}

// ---------------------------------------------------------------------------
// diffColumns
// ---------------------------------------------------------------------------

/**
 * Produce an AlterOp[] from id-based column diff.
 *
 * Rules:
 * - id in edited but not original → addColumn
 * - id in original but not edited → dropColumn (uses original name)
 * - same id, different name → renameColumn (+ modifyColumn if other fields changed)
 * - same id, type/sizes differ → modifyColumn with typeChanged=true
 * - same id, nullable differs → modifyColumn with nullChanged=true
 * - same id, defaultValue differs → modifyColumn with defaultChanged=true
 * - PK column set changed → one setPrimaryKey at the end
 */
export function diffColumns(
  original: DesignerColumn[],
  edited: DesignerColumn[],
): AlterOp[] {
  const ops: AlterOp[] = [];

  const origById = new Map(original.map((c) => [c.id, c]));
  const editedById = new Map(edited.map((c) => [c.id, c]));

  // Drops: in original but not in edited
  for (const orig of original) {
    if (!editedById.has(orig.id)) {
      ops.push({ kind: "dropColumn", name: orig.name });
    }
  }

  // Adds: in edited but not in original
  for (const edit of edited) {
    if (!origById.has(edit.id)) {
      ops.push({ kind: "addColumn", column: edit });
    }
  }

  // Renames + modifies: same id present in both
  for (const edit of edited) {
    const orig = origById.get(edit.id);
    if (!orig) continue; // already handled as addColumn above

    const renamed = orig.name !== edit.name;
    const typeChanged = typeIsDifferent(orig, edit);
    const nullChanged = orig.nullable !== edit.nullable;
    const defaultChanged = (orig.defaultValue ?? null) !== (edit.defaultValue ?? null);
    // Comments normalize ''/null/undefined to the same "none" sentinel.
    const commentChanged = normalizeComment(orig.comment) !== normalizeComment(edit.comment);
    // MySQL extended attributes (unsigned/zerofill/charset/collation/on-update/generated).
    const attrsChanged = attrsAreDifferent(orig, edit);

    if (renamed) {
      ops.push({ kind: "renameColumn", from: orig.name, to: edit.name, column: edit });
    }

    if (typeChanged || nullChanged || defaultChanged || commentChanged || attrsChanged) {
      ops.push({ kind: "modifyColumn", column: edit, typeChanged, nullChanged, defaultChanged, commentChanged, attrsChanged });
    }
  }

  // PK change: compare the sorted set of PK column IDs
  const origPkIds = original.filter((c) => c.isPrimaryKey).map((c) => c.id).sort();
  const editPkIds = edited.filter((c) => c.isPrimaryKey).map((c) => c.id).sort();

  const pkChanged =
    origPkIds.length !== editPkIds.length ||
    origPkIds.some((id, i) => id !== editPkIds[i]);

  if (pkChanged) {
    // Use the edited names in the order they appear in edited
    const pkCols = edited.filter((c) => c.isPrimaryKey).map((c) => c.name);
    ops.push({ kind: "setPrimaryKey", columns: pkCols });
  }

  return ops;
}

// ---------------------------------------------------------------------------
// diffIndexes
// ---------------------------------------------------------------------------

/**
 * Produce AlterOp[] from id-based index diff.
 *
 * Changed index (same id, different content) → drop old + add new.
 */
export function diffIndexes(
  original: DesignerIndex[],
  edited: DesignerIndex[],
): AlterOp[] {
  const ops: AlterOp[] = [];

  const origById = new Map(original.map((i) => [i.id, i]));
  const editedById = new Map(edited.map((i) => [i.id, i]));

  // Drops and drop+add for changed
  for (const orig of original) {
    const edit = editedById.get(orig.id);
    if (!edit) {
      // Removed
      ops.push({ kind: "dropIndex", name: orig.name });
    } else {
      // Check if changed
      const changed =
        orig.name !== edit.name ||
        orig.unique !== edit.unique ||
        orig.columns.length !== edit.columns.length ||
        orig.columns.some((c, i) => c !== edit.columns[i]);
      if (changed) {
        ops.push({ kind: "dropIndex", name: orig.name });
        ops.push({ kind: "addIndex", index: edit });
      }
    }
  }

  // Adds: in edited but not in original
  for (const edit of edited) {
    if (!origById.has(edit.id)) {
      ops.push({ kind: "addIndex", index: edit });
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// diffChecks
// ---------------------------------------------------------------------------

/**
 * Produce AlterOp[] from id-based CHECK-constraint diff.
 *
 * A changed check (same id, different name or expression) → drop old + add new,
 * mirroring how diffIndexes treats a changed index.
 */
export function diffChecks(
  original: DesignerCheck[],
  edited: DesignerCheck[],
): AlterOp[] {
  const ops: AlterOp[] = [];
  const origById = new Map(original.map((c) => [c.id, c]));
  const editedById = new Map(edited.map((c) => [c.id, c]));

  for (const orig of original) {
    const edit = editedById.get(orig.id);
    if (!edit) {
      ops.push({ kind: "dropCheck", name: orig.name });
    } else if (orig.name !== edit.name || orig.expression !== edit.expression) {
      ops.push({ kind: "dropCheck", name: orig.name });
      ops.push({ kind: "addCheck", check: edit });
    }
  }

  for (const edit of edited) {
    if (!origById.has(edit.id)) {
      ops.push({ kind: "addCheck", check: edit });
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// diffUniques
// ---------------------------------------------------------------------------

/**
 * Produce AlterOp[] from id-based named-UNIQUE-constraint diff.
 *
 * A changed unique (same id, different name or column set) → drop old + add new.
 */
export function diffUniques(
  original: DesignerUnique[],
  edited: DesignerUnique[],
): AlterOp[] {
  const ops: AlterOp[] = [];
  const origById = new Map(original.map((u) => [u.id, u]));
  const editedById = new Map(edited.map((u) => [u.id, u]));

  const colsEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((c, i) => c === b[i]);

  for (const orig of original) {
    const edit = editedById.get(orig.id);
    if (!edit) {
      ops.push({ kind: "dropUnique", name: orig.name });
    } else if (orig.name !== edit.name || !colsEqual(orig.columns, edit.columns)) {
      ops.push({ kind: "dropUnique", name: orig.name });
      ops.push({ kind: "addUnique", unique: edit });
    }
  }

  for (const edit of edited) {
    if (!origById.has(edit.id)) {
      ops.push({ kind: "addUnique", unique: edit });
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// diffTableOptions
// ---------------------------------------------------------------------------

/**
 * Produce a single setTableOptions AlterOp[] when any table option changed.
 *
 * Emits the *edited* options object verbatim; buildAlter renders only the
 * fields that differ from the originals into dialect-correct statements.
 * Returns [] when nothing changed.
 */
export function diffTableOptions(
  original: TableOptions | undefined,
  edited: TableOptions | undefined,
): AlterOp[] {
  const o = original ?? {};
  const e = edited ?? {};
  const changed =
    (o.engine ?? null) !== (e.engine ?? null) ||
    (o.charset ?? null) !== (e.charset ?? null) ||
    (o.collation ?? null) !== (e.collation ?? null) ||
    (o.comment ?? null) !== (e.comment ?? null) ||
    (o.autoIncrement ?? null) !== (e.autoIncrement ?? null) ||
    (o.rowFormat ?? null) !== (e.rowFormat ?? null);
  if (!changed) return [];
  return [{ kind: "setTableOptions", options: e }];
}

// ---------------------------------------------------------------------------
// buildAlter options
// ---------------------------------------------------------------------------

export interface BuildAlterOptions {
  /**
   * Whether the table currently has a PRIMARY KEY constraint.
   * Used by MySQL (DROP PRIMARY KEY) and Postgres (DROP CONSTRAINT <t>_pkey)
   * to decide whether to emit a DROP before the ADD.
   * Defaults to true (safe conservative assumption).
   */
  hasPk?: boolean;
}

// ---------------------------------------------------------------------------
// buildAlter
// ---------------------------------------------------------------------------

/**
 * Generate dialect-correct ALTER TABLE statements from an AlterOp[].
 *
 * Returns Statement[] (sql + params: []) compatible with commit_changes.
 *
 * Notes:
 * - Postgres DROP PRIMARY KEY assumes the default constraint name <table>_pkey.
 *   If the table uses a custom PK constraint name, the caller must handle that.
 * - MySQL DROP INDEX uses `DROP INDEX name ON table`.
 * - Postgres/SQLite DROP INDEX uses `DROP INDEX name` (no ON clause).
 * - Postgres modifyColumn emits one statement per changed sub-property (type,
 *   null, default) so each can be applied atomically within the transaction.
 * - MySQL rename always uses CHANGE COLUMN with the full spec; if a rename and
 *   a modifyColumn for the same column name are both present, they are merged
 *   into a single CHANGE COLUMN statement.
 */
export function buildAlter(
  dialect: Dialect,
  schema: string | null,
  table: string,
  ops: AlterOp[],
  options: BuildAlterOptions = {},
): Statement[] {
  const { hasPk = true } = options;
  const qualTable = qualified(dialect, schema, table);

  if (dialect === "mysql") {
    return buildAlterMySQL(qualTable, ops, hasPk, dialect, schema);
  } else if (dialect === "postgres") {
    return buildAlterPostgres(qualTable, table, ops, hasPk, dialect);
  } else if (dialect === "sqlserver") {
    return buildAlterSQLServer(qualTable, table, ops, hasPk, dialect);
  } else {
    return buildAlterSQLite(qualTable, ops, dialect);
  }
}

// ---------------------------------------------------------------------------
// MySQL
// ---------------------------------------------------------------------------

function buildAlterMySQL(
  qualTable: string,
  ops: AlterOp[],
  hasPk: boolean,
  dialect: Dialect,
  schema: string | null,
): Statement[] {
  const stmts: Statement[] = [];

  // Collect the "to" names of all rename ops so we can skip modifyColumn ops
  // whose column was already fully redefined by a CHANGE COLUMN statement.
  const renamedToNames = new Set<string>();
  for (const op of ops) {
    if (op.kind === "renameColumn") {
      renamedToNames.add(op.to);
    }
  }

  // Defer renameTable to after all other ops.
  let pendingRenameTable: { kind: "renameTable"; to: string } | null = null;

  for (const op of ops) {
    switch (op.kind) {
      case "addColumn": {
        const spec = columnSpec(dialect, op.column);
        stmts.push({
          sql: `ALTER TABLE ${qualTable} ADD COLUMN ${quoteIdent(dialect, op.column.name)} ${spec};`,
          params: [],
        });
        break;
      }

      case "dropColumn": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} DROP COLUMN ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "renameColumn": {
        // MySQL CHANGE COLUMN does rename + full redefinition in one statement.
        // op.column carries the edited column definition (new name, type, etc.).
        const spec = columnSpec(dialect, op.column);
        stmts.push({
          sql: `ALTER TABLE ${qualTable} CHANGE COLUMN ${quoteIdent(dialect, op.from)} ${quoteIdent(dialect, op.to)} ${spec};`,
          params: [],
        });
        break;
      }

      case "modifyColumn": {
        // If this column was already fully redefined by a CHANGE COLUMN above, skip it.
        if (renamedToNames.has(op.column.name)) {
          break;
        }
        // Pure modify: MODIFY COLUMN with full new spec
        const spec = columnSpec(dialect, op.column);
        stmts.push({
          sql: `ALTER TABLE ${qualTable} MODIFY COLUMN ${quoteIdent(dialect, op.column.name)} ${spec};`,
          params: [],
        });
        break;
      }

      case "setPrimaryKey": {
        if (hasPk) {
          stmts.push({
            sql: `ALTER TABLE ${qualTable} DROP PRIMARY KEY;`,
            params: [],
          });
        }
        if (op.columns.length > 0) {
          const cols = op.columns.map((c) => quoteIdent(dialect, c)).join(", ");
          stmts.push({
            sql: `ALTER TABLE ${qualTable} ADD PRIMARY KEY (${cols});`,
            params: [],
          });
        }
        break;
      }

      case "addIndex": {
        stmts.push({ sql: buildIndexStatement(dialect, qualTable, op.index), params: [] });
        break;
      }

      case "dropIndex": {
        stmts.push({
          sql: `DROP INDEX ${quoteIdent(dialect, op.name)} ON ${qualTable};`,
          params: [],
        });
        break;
      }

      case "addCheck": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} ADD CONSTRAINT ${quoteIdent(dialect, op.check.name)} CHECK (${op.check.expression});`,
          params: [],
        });
        break;
      }

      case "dropCheck": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} DROP CHECK ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "addUnique": {
        const cols = op.unique.columns.map((c) => quoteIdent(dialect, c)).join(", ");
        stmts.push({
          sql: `ALTER TABLE ${qualTable} ADD CONSTRAINT ${quoteIdent(dialect, op.unique.name)} UNIQUE (${cols});`,
          params: [],
        });
        break;
      }

      case "dropUnique": {
        // MySQL drops a named UNIQUE via DROP INDEX (the constraint name doubles
        // as the index name).
        stmts.push({
          sql: `ALTER TABLE ${qualTable} DROP INDEX ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "setTableOptions": {
        const clause = mysqlTableOptionsClause(dialect, op.options);
        if (clause !== "") {
          stmts.push({ sql: `ALTER TABLE ${qualTable} ${clause};`, params: [] });
        }
        break;
      }

      case "renameTable": {
        // Deferred — emit after all other ops so they reference the original name.
        pendingRenameTable = op;
        break;
      }
    }
  }

  // Emit RENAME TABLE last. New name is qualified with same db as old.
  if (pendingRenameTable !== null) {
    const newQual = qualified(dialect, schema, pendingRenameTable.to);
    stmts.push({
      sql: `RENAME TABLE ${qualTable} TO ${newQual};`,
      params: [],
    });
  }

  return stmts;
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

function buildAlterPostgres(
  qualTable: string,
  table: string,
  ops: AlterOp[],
  hasPk: boolean,
  dialect: Dialect,
): Statement[] {
  const stmts: Statement[] = [];

  // Defer renameTable to after all other ops.
  let pendingRenameTable: { kind: "renameTable"; to: string } | null = null;

  for (const op of ops) {
    switch (op.kind) {
      case "addColumn": {
        const spec = columnSpec(dialect, op.column);
        stmts.push({
          sql: `ALTER TABLE ${qualTable} ADD COLUMN ${quoteIdent(dialect, op.column.name)} ${spec};`,
          params: [],
        });
        break;
      }

      case "dropColumn": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} DROP COLUMN ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "renameColumn": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} RENAME COLUMN ${quoteIdent(dialect, op.from)} TO ${quoteIdent(dialect, op.to)};`,
          params: [],
        });
        break;
      }

      case "modifyColumn": {
        const qCol = quoteIdent(dialect, op.column.name);
        if (op.typeChanged) {
          const typeSql = renderType(dialect, op.column);
          stmts.push({
            sql: `ALTER TABLE ${qualTable} ALTER COLUMN ${qCol} TYPE ${typeSql} USING ${qCol}::${typeSql};`,
            params: [],
          });
        }
        if (op.nullChanged) {
          const fragment = op.column.nullable ? "DROP NOT NULL" : "SET NOT NULL";
          stmts.push({
            sql: `ALTER TABLE ${qualTable} ALTER COLUMN ${qCol} ${fragment};`,
            params: [],
          });
        }
        if (op.defaultChanged) {
          const fragment =
            op.column.defaultValue != null && op.column.defaultValue !== ""
              ? `SET DEFAULT ${op.column.defaultValue}`
              : "DROP DEFAULT";
          stmts.push({
            sql: `ALTER TABLE ${qualTable} ALTER COLUMN ${qCol} ${fragment};`,
            params: [],
          });
        }
        if (op.commentChanged) {
          // A cleared comment becomes IS NULL; otherwise IS '<escaped>'.
          const comment = normalizeComment(op.column.comment);
          const value = comment === "" ? "NULL" : quoteStringLiteral(dialect, comment);
          stmts.push({
            sql: `COMMENT ON COLUMN ${qualTable}.${qCol} IS ${value};`,
            params: [],
          });
        }
        if (op.attrsChanged && !op.typeChanged) {
          // Best-effort: MySQL-specific attrs (unsigned/zerofill/charset/
          // collation/on-update) have no Postgres equivalent, and a generated-
          // expression change cannot be done in place. Emit an explanatory
          // comment rather than invalid SQL (the type change, if any, already
          // re-rendered the column above).
          stmts.push({
            sql: `-- Postgres: column "${op.column.name}" attribute change has no direct ALTER equivalent; review manually.`,
            params: [],
          });
        }
        break;
      }

      case "setPrimaryKey": {
        // PG default constraint name is <table>_pkey.
        // NOTE: This assumes the table uses the Postgres default PK constraint
        // name. Tables with custom-named PK constraints require a separate
        // look-up of pg_constraint.conname before calling buildAlter.
        if (hasPk) {
          stmts.push({
            sql: `ALTER TABLE ${qualTable} DROP CONSTRAINT ${quoteIdent(dialect, `${table}_pkey`)};`,
            params: [],
          });
        }
        if (op.columns.length > 0) {
          const cols = op.columns.map((c) => quoteIdent(dialect, c)).join(", ");
          stmts.push({
            sql: `ALTER TABLE ${qualTable} ADD PRIMARY KEY (${cols});`,
            params: [],
          });
        }
        break;
      }

      case "addIndex": {
        stmts.push({ sql: buildIndexStatement(dialect, qualTable, op.index), params: [] });
        break;
      }

      case "dropIndex": {
        // Postgres DROP INDEX does not take an ON clause
        stmts.push({
          sql: `DROP INDEX ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "addCheck": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} ADD CONSTRAINT ${quoteIdent(dialect, op.check.name)} CHECK (${op.check.expression});`,
          params: [],
        });
        break;
      }

      case "dropCheck": {
        // Postgres drops CHECK like any other named constraint.
        stmts.push({
          sql: `ALTER TABLE ${qualTable} DROP CONSTRAINT ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "addUnique": {
        const cols = op.unique.columns.map((c) => quoteIdent(dialect, c)).join(", ");
        stmts.push({
          sql: `ALTER TABLE ${qualTable} ADD CONSTRAINT ${quoteIdent(dialect, op.unique.name)} UNIQUE (${cols});`,
          params: [],
        });
        break;
      }

      case "dropUnique": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} DROP CONSTRAINT ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "setTableOptions": {
        // Postgres has no ENGINE/CHARSET on tables — only the comment maps to a
        // statement (COMMENT ON TABLE … IS …). Other option fields are ignored.
        if (op.options.comment != null) {
          const value =
            op.options.comment === ""
              ? "NULL"
              : quoteStringLiteral(dialect, op.options.comment);
          stmts.push({
            sql: `COMMENT ON TABLE ${qualTable} IS ${value};`,
            params: [],
          });
        }
        break;
      }

      case "renameTable": {
        // Deferred — emit after all other ops so they reference the original name.
        pendingRenameTable = op;
        break;
      }
    }
  }

  // Emit RENAME TO last. New name is bare (unqualified) — same-schema rename.
  if (pendingRenameTable !== null) {
    stmts.push({
      sql: `ALTER TABLE ${qualTable} RENAME TO ${quoteIdent(dialect, pendingRenameTable.to)};`,
      params: [],
    });
  }

  return stmts;
}

// ---------------------------------------------------------------------------
// SQL Server (T-SQL)
// ---------------------------------------------------------------------------

/**
 * Render a SQL Server column spec WITHOUT a trailing DEFAULT. In T-SQL a column
 * default is a named/inline constraint, not part of the ADD/ALTER COLUMN type
 * clause, so it is emitted separately (ADD CONSTRAINT … DEFAULT … FOR col).
 *
 * IDENTITY(1,1) is carried by renderColumnTypeForSpec for auto-increment columns.
 */
function sqlServerColumnSpecNoDefault(col: DesignerColumn): string {
  const typeSql = renderColumnTypeForSpec("sqlserver", col);
  const nullFragment = col.nullable ? " NULL" : " NOT NULL";
  return `${typeSql}${nullFragment}`;
}

/** The implicit DEFAULT-constraint name SQL Server-style: DF_<table>_<column>. */
function sqlServerDefaultConstraintName(table: string, column: string): string {
  return `DF_${table}_${column}`;
}

/**
 * Generate T-SQL ALTER statements.
 *
 * T-SQL specifics:
 * - ADD/DROP column omit the COLUMN keyword on ADD: `ALTER TABLE t ADD [c] …`,
 *   but DROP keeps it: `ALTER TABLE t DROP COLUMN [c]`.
 * - Column type/nullability change via `ALTER TABLE t ALTER COLUMN [c] TYPE [NULL|NOT NULL]`.
 * - Defaults are constraints: `ADD CONSTRAINT [DF_…] DEFAULT (expr) FOR [c]` /
 *   `DROP CONSTRAINT [DF_…]`.
 * - PK/CHECK/UNIQUE/FK drop via `DROP CONSTRAINT [name]`.
 * - Rename of a column/table uses sp_rename (no native RENAME syntax).
 * - DROP INDEX takes an ON clause: `DROP INDEX [name] ON [table]`.
 */
function buildAlterSQLServer(
  qualTable: string,
  table: string,
  ops: AlterOp[],
  hasPk: boolean,
  dialect: Dialect,
): Statement[] {
  const stmts: Statement[] = [];

  // Defer renameTable to after all other ops.
  let pendingRenameTable: { kind: "renameTable"; to: string } | null = null;

  for (const op of ops) {
    switch (op.kind) {
      case "addColumn": {
        const spec = sqlServerColumnSpecNoDefault(op.column);
        const ident = quoteIdent(dialect, op.column.name);
        // T-SQL: ADD takes no COLUMN keyword; a DEFAULT becomes an inline constraint.
        const def =
          !op.column.isAutoIncrement &&
          op.column.defaultValue != null &&
          op.column.defaultValue !== ""
            ? ` CONSTRAINT ${quoteIdent(dialect, sqlServerDefaultConstraintName(table, op.column.name))} DEFAULT (${op.column.defaultValue})`
            : "";
        stmts.push({
          sql: `ALTER TABLE ${qualTable} ADD ${ident} ${spec}${def};`,
          params: [],
        });
        break;
      }

      case "dropColumn": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} DROP COLUMN ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "renameColumn": {
        // T-SQL has no RENAME COLUMN — use sp_rename with the 'COLUMN' object type.
        // The first arg is the schema-qualified "table.column" path (single-quoted).
        const target = `${qualTable}.${quoteIdent(dialect, op.from)}`;
        stmts.push({
          sql: `EXEC sp_rename ${quoteStringLiteral(dialect, target)}, ${quoteStringLiteral(dialect, op.to)}, 'COLUMN';`,
          params: [],
        });
        break;
      }

      case "modifyColumn": {
        const qCol = quoteIdent(dialect, op.column.name);
        // T-SQL folds type + nullability into a single ALTER COLUMN; emit it when
        // either changed so the (re-rendered) NULL/NOT NULL stays consistent.
        if (op.typeChanged || op.nullChanged) {
          const spec = sqlServerColumnSpecNoDefault(op.column);
          stmts.push({
            sql: `ALTER TABLE ${qualTable} ALTER COLUMN ${qCol} ${spec};`,
            params: [],
          });
        }
        if (op.defaultChanged) {
          // Drop the old default constraint, then add the new one (if any). The
          // constraint name follows the DF_<table>_<column> convention this
          // builder uses when creating defaults.
          const dfName = quoteIdent(dialect, sqlServerDefaultConstraintName(table, op.column.name));
          stmts.push({
            sql: `ALTER TABLE ${qualTable} DROP CONSTRAINT ${dfName};`,
            params: [],
          });
          if (op.column.defaultValue != null && op.column.defaultValue !== "") {
            stmts.push({
              sql: `ALTER TABLE ${qualTable} ADD CONSTRAINT ${dfName} DEFAULT (${op.column.defaultValue}) FOR ${qCol};`,
              params: [],
            });
          }
        }
        // commentChanged: SQL Server stores column comments as extended
        // properties (sp_addextendedproperty). That is out of scope here, so a
        // comment-only change emits nothing.
        if (op.attrsChanged && !op.typeChanged) {
          stmts.push({
            sql: `-- SQL Server: column "${op.column.name}" attribute change has no direct ALTER equivalent; review manually.`,
            params: [],
          });
        }
        break;
      }

      case "setPrimaryKey": {
        // T-SQL drops the PK by its constraint name; this builder cannot know the
        // existing name, so it follows the PK_<table> convention it would use when
        // creating one. Callers with a custom PK name must handle that themselves.
        if (hasPk) {
          stmts.push({
            sql: `ALTER TABLE ${qualTable} DROP CONSTRAINT ${quoteIdent(dialect, `PK_${table}`)};`,
            params: [],
          });
        }
        if (op.columns.length > 0) {
          const cols = op.columns.map((c) => quoteIdent(dialect, c)).join(", ");
          stmts.push({
            sql: `ALTER TABLE ${qualTable} ADD CONSTRAINT ${quoteIdent(dialect, `PK_${table}`)} PRIMARY KEY (${cols});`,
            params: [],
          });
        }
        break;
      }

      case "addIndex": {
        stmts.push({ sql: buildIndexStatement(dialect, qualTable, op.index), params: [] });
        break;
      }

      case "dropIndex": {
        // T-SQL DROP INDEX requires the ON <table> clause.
        stmts.push({
          sql: `DROP INDEX ${quoteIdent(dialect, op.name)} ON ${qualTable};`,
          params: [],
        });
        break;
      }

      case "addCheck": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} ADD CONSTRAINT ${quoteIdent(dialect, op.check.name)} CHECK (${op.check.expression});`,
          params: [],
        });
        break;
      }

      case "dropCheck": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} DROP CONSTRAINT ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "addUnique": {
        const cols = op.unique.columns.map((c) => quoteIdent(dialect, c)).join(", ");
        stmts.push({
          sql: `ALTER TABLE ${qualTable} ADD CONSTRAINT ${quoteIdent(dialect, op.unique.name)} UNIQUE (${cols});`,
          params: [],
        });
        break;
      }

      case "dropUnique": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} DROP CONSTRAINT ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "setTableOptions": {
        // SQL Server has no ENGINE/CHARSET/ROW_FORMAT table options to alter, and
        // table comments live in extended properties (out of scope). No-op.
        break;
      }

      case "renameTable": {
        pendingRenameTable = op;
        break;
      }
    }
  }

  // Emit the table rename last via sp_rename (the new name is unqualified —
  // sp_rename renames within the existing schema).
  if (pendingRenameTable !== null) {
    stmts.push({
      sql: `EXEC sp_rename ${quoteStringLiteral(dialect, qualTable)}, ${quoteStringLiteral(dialect, pendingRenameTable.to)};`,
      params: [],
    });
  }

  return stmts;
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

function buildAlterSQLite(
  qualTable: string,
  ops: AlterOp[],
  dialect: Dialect,
): Statement[] {
  const stmts: Statement[] = [];

  // Defer renameTable to after all other ops.
  let pendingRenameTable: { kind: "renameTable"; to: string } | null = null;

  for (const op of ops) {
    switch (op.kind) {
      case "addColumn": {
        const spec = columnSpec(dialect, op.column);
        stmts.push({
          sql: `ALTER TABLE ${qualTable} ADD COLUMN ${quoteIdent(dialect, op.column.name)} ${spec};`,
          params: [],
        });
        break;
      }

      case "dropColumn": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} DROP COLUMN ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "renameColumn": {
        stmts.push({
          sql: `ALTER TABLE ${qualTable} RENAME COLUMN ${quoteIdent(dialect, op.from)} TO ${quoteIdent(dialect, op.to)};`,
          params: [],
        });
        break;
      }

      case "modifyColumn":
      case "setPrimaryKey": {
        // Not supported in SQLite — caller should check supportedOnSqlite first.
        // Emit nothing; guard via supportedOnSqlite before calling buildAlter.
        break;
      }

      case "addIndex": {
        stmts.push({ sql: buildIndexStatement(dialect, qualTable, op.index), params: [] });
        break;
      }

      case "dropIndex": {
        // SQLite DROP INDEX does not take an ON clause
        stmts.push({
          sql: `DROP INDEX ${quoteIdent(dialect, op.name)};`,
          params: [],
        });
        break;
      }

      case "addCheck":
      case "dropCheck":
      case "addUnique":
      case "dropUnique":
      case "setTableOptions": {
        // SQLite cannot ALTER TABLE to add/drop table constraints or change
        // table options — these require a full table rebuild. Emit an
        // explanatory comment (mirrors the modifyColumn limitation pattern;
        // guard via supportedOnSqlite before calling buildAlter).
        stmts.push({
          sql: `-- SQLite: ${sqliteUnsupportedReason(op)} requires rebuilding the table; skipped.`,
          params: [],
        });
        break;
      }

      case "renameTable": {
        // Deferred — emit after all other ops so they reference the original name.
        pendingRenameTable = op;
        break;
      }
    }
  }

  // Emit RENAME TO last. SQLite supports this natively.
  if (pendingRenameTable !== null) {
    stmts.push({
      sql: `ALTER TABLE ${qualTable} RENAME TO ${quoteIdent(dialect, pendingRenameTable.to)};`,
      params: [],
    });
  }

  return stmts;
}

// ---------------------------------------------------------------------------
// supportedOnSqlite
// ---------------------------------------------------------------------------

/**
 * Returns { ok: true, blocked: [] } when all ops are safe to execute on SQLite.
 * Returns { ok: false, blocked: [...reasons] } when any op is unsupported.
 *
 * Unsupported on SQLite:
 * - modifyColumn (type, null, default, or extended-attribute changes) — full rebuild
 * - setPrimaryKey — requires full table rebuild
 * - add/drop CHECK or UNIQUE constraint — requires full table rebuild
 * - setTableOptions — SQLite has no table options to alter
 *
 * Supported: addColumn, dropColumn, renameColumn, addIndex, dropIndex, renameTable.
 */
export function supportedOnSqlite(ops: AlterOp[]): { ok: boolean; blocked: string[] } {
  const blocked: string[] = [];

  for (const op of ops) {
    if (op.kind === "modifyColumn") {
      // A comment-only change is harmlessly ignored on SQLite (no column
      // comments), so it must NOT block. Only structural changes require a
      // full table rebuild.
      if (op.typeChanged || op.nullChanged || op.defaultChanged || op.attrsChanged) {
        const changes: string[] = [];
        if (op.typeChanged) changes.push("type");
        if (op.nullChanged) changes.push("nullable");
        if (op.defaultChanged) changes.push("default");
        if (op.attrsChanged) changes.push("attributes");
        const what = changes.join(", ");
        blocked.push(
          `Cannot modify column "${op.column.name}" (${what}) in SQLite without rebuilding the table.`,
        );
      }
    }
    if (op.kind === "setPrimaryKey") {
      blocked.push(
        "Cannot change the PRIMARY KEY in SQLite without rebuilding the table.",
      );
    }
    if (op.kind === "addCheck" || op.kind === "dropCheck") {
      blocked.push(
        "Cannot add/drop a CHECK constraint in SQLite without rebuilding the table.",
      );
    }
    if (op.kind === "addUnique" || op.kind === "dropUnique") {
      blocked.push(
        "Cannot add/drop a named UNIQUE constraint in SQLite without rebuilding the table.",
      );
    }
    if (op.kind === "setTableOptions") {
      blocked.push("Cannot change table options in SQLite.");
    }
  }

  return { ok: blocked.length === 0, blocked };
}
