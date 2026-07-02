/**
 * schemaDiff.ts — pure schema comparison engine (Structure Synchronization).
 *
 * Compares two introspected schema snapshots and produces an ordered list of
 * DDL operations that transform the TARGET schema into the SOURCE schema (the
 * source is the desired/authoritative state).
 *
 * No React, no Tauri, no IO. Callers pass already-introspected metadata
 * (ColumnDefinition / IndexInfo / ForeignKeyInfo); the hook/UI layer handles
 * fetching snapshots and executing the resulting SQL.
 *
 * Design rules (mirroring dumpBuilder.ts / alterBuilder.ts):
 * - Whole-table create/drop reuse buildCreateTableDump / buildDropTableDump.
 * - Identifier quoting delegates to quoteIdent from mutationBuilder.ts.
 * - Per-column / index / FK ALTERs mirror alterBuilder.ts dialect rules, but
 *   operate directly on ColumnDefinition (introspected) rather than on the
 *   designer's DesignerColumn.
 * - Column type is taken VERBATIM from `full_type ?? data_type` (already
 *   dialect-correct from live introspection).
 *
 * Dialect handling: v1 assumes both sides share a dialect; SQL is emitted using
 * source.dialect. If the two snapshots disagree on dialect, the emitted SQL
 * falls back to target.dialect (the side actually being mutated) and a warning
 * is woven into the affected op descriptions.
 */

import type {
  Dialect,
  ColumnDefinition,
  IndexInfo,
  ForeignKeyInfo,
} from "../types";
import { quoteIdent } from "./mutationBuilder";
import { buildCreateTableDump, buildDropTableDump } from "./dumpBuilder";

// ---------------------------------------------------------------------------
// Public contract types
// ---------------------------------------------------------------------------

export interface TableSnapshot {
  name: string;
  schema?: string | null;
  columns: ColumnDefinition[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export interface SchemaSnapshot {
  dialect: Dialect;
  database: string;
  schema?: string | null;
  tables: TableSnapshot[];
}

export type DiffStatus = "only-source" | "only-target" | "different" | "same";

export type DiffOpKind =
  | "create-table"
  | "drop-table"
  | "add-column"
  | "drop-column"
  | "alter-column"
  | "add-index"
  | "drop-index"
  | "add-fk"
  | "drop-fk";

export interface DiffOp {
  id: string;
  table: string;
  kind: DiffOpKind;
  description: string;
  sql: string;
}

export interface TableDiff {
  table: string;
  status: DiffStatus;
  ops: DiffOp[];
}

export interface SchemaDiffResult {
  tables: TableDiff[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Qualify a table name with optional schema, both quoted (mirrors dumpBuilder). */
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

/** The verbatim, dialect-correct type for a column. */
function columnType(c: ColumnDefinition): string {
  return c.full_type ?? c.data_type;
}

/** Build a TableSnapshot → DumpTableInput shape for the dump builders. */
function toDumpInput(t: TableSnapshot) {
  return {
    schema: t.schema,
    table: t.name,
    columns: t.columns,
    indexes: t.indexes,
    foreignKeys: t.foreignKeys,
  };
}

/** Compose a stable op id. */
function opId(table: string, kind: DiffOpKind, suffix: string): string {
  return `${table}::${kind}::${suffix}`;
}

// ---------------------------------------------------------------------------
// Per-column ALTER emission (mirrors alterBuilder.ts dialect rules)
// ---------------------------------------------------------------------------

/**
 * Full column spec used by ADD COLUMN / MySQL MODIFY COLUMN:
 *   <type> [NOT NULL] [DEFAULT expr]
 * Auto-increment is intentionally NOT carried here — sync of AI columns via
 * ALTER is dialect-fraught; the type itself (verbatim) is preserved and the
 * description flags any AI mismatch.
 */
function columnSpec(c: ColumnDefinition): string {
  const typeSql = columnType(c);
  const nullFragment = c.nullable ? "" : " NOT NULL";
  const defaultFragment =
    !c.is_auto_increment && c.default_value != null && c.default_value !== ""
      ? ` DEFAULT ${c.default_value}`
      : "";
  return `${typeSql}${nullFragment}${defaultFragment}`;
}

/** Emit an ADD COLUMN statement for one column. */
function addColumnSql(
  dialect: Dialect,
  qualTable: string,
  c: ColumnDefinition,
): string {
  // T-SQL: `ALTER TABLE t ADD [c] spec` (no COLUMN keyword); a DEFAULT there is a
  // constraint clause, but since columnSpec inlines `DEFAULT <expr>` exactly as
  // SQL Server also accepts an inline default on ADD, the verbatim spec is reused
  // (mirrors the introspected, dialect-correct default expression).
  if (dialect === "sqlserver") {
    return `ALTER TABLE ${qualTable} ADD ${quoteIdent(dialect, c.name)} ${columnSpec(c)};`;
  }
  return `ALTER TABLE ${qualTable} ADD COLUMN ${quoteIdent(dialect, c.name)} ${columnSpec(c)};`;
}

/** Emit a DROP COLUMN statement for one column. */
function dropColumnSql(
  dialect: Dialect,
  qualTable: string,
  name: string,
): string {
  return `ALTER TABLE ${qualTable} DROP COLUMN ${quoteIdent(dialect, name)};`;
}

/**
 * Emit dialect-correct ALTER COLUMN statement(s) that morph `target` into
 * `source` (same column name, differing attributes).
 *
 * - MySQL: a single MODIFY COLUMN re-declaring the full spec.
 * - Postgres: one statement per changed sub-property
 *     ALTER COLUMN ... TYPE ... USING ...
 *     ALTER COLUMN ... SET/DROP NOT NULL
 *     ALTER COLUMN ... SET/DROP DEFAULT
 * - SQL Server: a single `ALTER COLUMN <type> [NULL|NOT NULL]` (type + nullability
 *   are inseparable in T-SQL). DEFAULTs are separate constraint objects in SQL
 *   Server and are not synced via ALTER COLUMN; a default-only change is flagged
 *   in a trailing comment rather than emitted as fragile DROP/ADD CONSTRAINT SQL.
 * - SQLite: ALTER COLUMN is unsupported → a single comment noting the intended
 *   change (callers must rebuild the table to apply it).
 *
 * Returns the statements joined by newlines (one DiffOp carries all of them).
 */
function alterColumnSql(
  dialect: Dialect,
  qualTable: string,
  source: ColumnDefinition,
  target: ColumnDefinition,
): string {
  const qCol = quoteIdent(dialect, source.name);

  const typeChanged = columnType(source) !== columnType(target);
  const nullChanged = source.nullable !== target.nullable;
  const defaultChanged =
    (source.default_value ?? null) !== (target.default_value ?? null);

  if (dialect === "mysql") {
    return `ALTER TABLE ${qualTable} MODIFY COLUMN ${qCol} ${columnSpec(source)};`;
  }

  if (dialect === "sqlserver") {
    // T-SQL re-declares the column's type + nullability in one ALTER COLUMN.
    // DEFAULT is omitted (it lives in a separate constraint), so columnSpec is
    // not reused here; nullability is rendered inline.
    const nullFragment = source.nullable ? " NULL" : " NOT NULL";
    const stmt =
      `ALTER TABLE ${qualTable} ALTER COLUMN ${qCol} ${columnType(source)}${nullFragment};`;
    // A default-only change can't be carried by ALTER COLUMN; note it so the op
    // still surfaces the intent (the type re-assert above is always valid).
    if (defaultChanged && !typeChanged && !nullChanged) {
      const to = source.default_value ?? "NULL";
      return (
        `${stmt}\n` +
        `-- SQL Server DEFAULTs are named constraints; default change for ` +
        `${qualTable}.${qCol} -> ${to} must be applied via DROP/ADD CONSTRAINT.`
      );
    }
    return stmt;
  }

  if (dialect === "postgres") {
    const stmts: string[] = [];
    if (typeChanged) {
      const typeSql = columnType(source);
      stmts.push(
        `ALTER TABLE ${qualTable} ALTER COLUMN ${qCol} TYPE ${typeSql} USING ${qCol}::${typeSql};`,
      );
    }
    if (nullChanged) {
      const fragment = source.nullable ? "DROP NOT NULL" : "SET NOT NULL";
      stmts.push(`ALTER TABLE ${qualTable} ALTER COLUMN ${qCol} ${fragment};`);
    }
    if (defaultChanged) {
      const fragment =
        source.default_value != null && source.default_value !== ""
          ? `SET DEFAULT ${source.default_value}`
          : "DROP DEFAULT";
      stmts.push(`ALTER TABLE ${qualTable} ALTER COLUMN ${qCol} ${fragment};`);
    }
    // No detected sub-change (e.g. AI-only difference) → emit a MODIFY-style
    // best-effort TYPE re-assert so the op still carries actionable SQL.
    if (stmts.length === 0) {
      const typeSql = columnType(source);
      stmts.push(
        `ALTER TABLE ${qualTable} ALTER COLUMN ${qCol} TYPE ${typeSql} USING ${qCol}::${typeSql};`,
      );
    }
    return stmts.join("\n");
  }

  // SQLite — ALTER COLUMN is unsupported; describe the intended change.
  const intent: string[] = [];
  if (typeChanged) intent.push(`type ${columnType(target)} -> ${columnType(source)}`);
  if (nullChanged) intent.push(source.nullable ? "drop NOT NULL" : "set NOT NULL");
  if (defaultChanged) {
    const to = source.default_value ?? "NULL";
    intent.push(`default -> ${to}`);
  }
  const what = intent.length > 0 ? intent.join(", ") : "attributes";
  return (
    `-- SQLite does not support ALTER COLUMN. Intended change for ` +
    `${qualTable}.${qCol}: ${what}. Rebuild the table to apply.`
  );
}

// ---------------------------------------------------------------------------
// Index ALTER emission
// ---------------------------------------------------------------------------

function addIndexSql(
  dialect: Dialect,
  qualTable: string,
  idx: IndexInfo,
): string {
  const unique = idx.is_unique ? "UNIQUE " : "";
  const cols = idx.columns.map((c) => quoteIdent(dialect, c)).join(", ");
  return `CREATE ${unique}INDEX ${quoteIdent(dialect, idx.name)} ON ${qualTable} (${cols});`;
}

function dropIndexSql(
  dialect: Dialect,
  qualTable: string,
  name: string,
): string {
  // MySQL and SQL Server DROP INDEX require the ON <table> clause; Postgres and
  // SQLite drop the index by its (schema-global) name alone.
  if (dialect === "mysql" || dialect === "sqlserver") {
    return `DROP INDEX ${quoteIdent(dialect, name)} ON ${qualTable};`;
  }
  return `DROP INDEX ${quoteIdent(dialect, name)};`;
}

// ---------------------------------------------------------------------------
// FK ALTER emission
// ---------------------------------------------------------------------------

function addFkSql(
  dialect: Dialect,
  schema: string | null | undefined,
  qualTable: string,
  fk: ForeignKeyInfo,
): string {
  const cols = fk.columns.map((c) => quoteIdent(dialect, c)).join(", ");
  // Referenced table shares the owning table's schema.
  const refTable = qualified(dialect, schema, fk.referenced_table);
  const refCols = fk.referenced_columns
    .map((c) => quoteIdent(dialect, c))
    .join(", ");
  const onDelete = fk.on_delete ? ` ON DELETE ${fk.on_delete}` : "";
  const onUpdate = fk.on_update ? ` ON UPDATE ${fk.on_update}` : "";
  return (
    `ALTER TABLE ${qualTable} ADD CONSTRAINT ${quoteIdent(dialect, fk.name)} ` +
    `FOREIGN KEY (${cols}) REFERENCES ${refTable} (${refCols})${onDelete}${onUpdate};`
  );
}

function dropFkSql(
  dialect: Dialect,
  qualTable: string,
  name: string,
): string {
  // MySQL drops FKs with DROP FOREIGN KEY; Postgres/SQLite/SQL Server use
  // DROP CONSTRAINT. (SQLite cannot actually drop a constraint via ALTER.)
  if (dialect === "mysql") {
    return `ALTER TABLE ${qualTable} DROP FOREIGN KEY ${quoteIdent(dialect, name)};`;
  }
  return `ALTER TABLE ${qualTable} DROP CONSTRAINT ${quoteIdent(dialect, name)};`;
}

// ---------------------------------------------------------------------------
// Per-table diff
// ---------------------------------------------------------------------------

/**
 * Diff the columns / indexes / FKs of a table present in both snapshots.
 * `warn` is prepended to each op description when the dialects disagree.
 */
function diffExistingTable(
  dialect: Dialect,
  source: TableSnapshot,
  target: TableSnapshot,
  warn: string,
): DiffOp[] {
  const ops: DiffOp[] = [];
  const table = source.name;
  const qualTable = qualified(dialect, source.schema, table);
  const desc = (s: string) => (warn ? `${warn} ${s}` : s);

  // ---- Columns (compared by name) ----
  const srcCols = new Map(source.columns.map((c) => [c.name, c]));
  const tgtCols = new Map(target.columns.map((c) => [c.name, c]));

  // add-column: in source, not in target
  for (const c of source.columns) {
    if (!tgtCols.has(c.name)) {
      ops.push({
        id: opId(table, "add-column", c.name),
        table,
        kind: "add-column",
        description: desc(`Add column ${c.name} to ${table}`),
        sql: addColumnSql(dialect, qualTable, c),
      });
    }
  }

  // drop-column: in target, not in source
  for (const c of target.columns) {
    if (!srcCols.has(c.name)) {
      ops.push({
        id: opId(table, "drop-column", c.name),
        table,
        kind: "drop-column",
        description: desc(`Drop column ${c.name} from ${table}`),
        sql: dropColumnSql(dialect, qualTable, c.name),
      });
    }
  }

  // alter-column: in both, attributes differ
  for (const c of source.columns) {
    const tc = tgtCols.get(c.name);
    if (!tc) continue;
    const typeChanged = columnType(c) !== columnType(tc);
    const nullChanged = c.nullable !== tc.nullable;
    const defaultChanged =
      (c.default_value ?? null) !== (tc.default_value ?? null);
    const aiChanged = c.is_auto_increment !== tc.is_auto_increment;
    if (typeChanged || nullChanged || defaultChanged || aiChanged) {
      ops.push({
        id: opId(table, "alter-column", c.name),
        table,
        kind: "alter-column",
        description: desc(`Alter column ${c.name} on ${table}`),
        sql: alterColumnSql(dialect, qualTable, c, tc),
      });
    }
  }

  // ---- Indexes (compared by name) ----
  const srcIdx = new Map(source.indexes.map((i) => [i.name, i]));
  const tgtIdx = new Map(target.indexes.map((i) => [i.name, i]));

  for (const i of source.indexes) {
    if (i.is_primary) continue; // PK is part of the table definition, not synced here
    if (!tgtIdx.has(i.name)) {
      ops.push({
        id: opId(table, "add-index", i.name),
        table,
        kind: "add-index",
        description: desc(`Add index ${i.name} on ${table}`),
        sql: addIndexSql(dialect, qualTable, i),
      });
    }
  }

  for (const i of target.indexes) {
    if (i.is_primary) continue;
    if (!srcIdx.has(i.name)) {
      ops.push({
        id: opId(table, "drop-index", i.name),
        table,
        kind: "drop-index",
        description: desc(`Drop index ${i.name} from ${table}`),
        sql: dropIndexSql(dialect, qualTable, i.name),
      });
    }
  }

  // ---- Foreign keys (compared by name) ----
  const srcFk = new Map(source.foreignKeys.map((f) => [f.name, f]));
  const tgtFk = new Map(target.foreignKeys.map((f) => [f.name, f]));

  for (const f of source.foreignKeys) {
    if (!tgtFk.has(f.name)) {
      ops.push({
        id: opId(table, "add-fk", f.name),
        table,
        kind: "add-fk",
        description: desc(`Add foreign key ${f.name} on ${table}`),
        sql: addFkSql(dialect, source.schema, qualTable, f),
      });
    }
  }

  for (const f of target.foreignKeys) {
    if (!srcFk.has(f.name)) {
      ops.push({
        id: opId(table, "drop-fk", f.name),
        table,
        kind: "drop-fk",
        description: desc(`Drop foreign key ${f.name} from ${table}`),
        sql: dropFkSql(dialect, qualTable, f.name),
      });
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// diffSchemas
// ---------------------------------------------------------------------------

/**
 * Compare two schema snapshots and produce per-table diffs that transform the
 * TARGET into the SOURCE.
 *
 * - Table only in source → create-table op (buildCreateTableDump).
 * - Table only in target → drop-table op (buildDropTableDump).
 * - Table in both → column/index/FK diff; status "different" if any op, else "same".
 *
 * The emitted SQL uses source.dialect; if the dialects disagree it falls back
 * to target.dialect and prefixes affected op descriptions with a warning.
 */
export function diffSchemas(
  source: SchemaSnapshot,
  target: SchemaSnapshot,
): SchemaDiffResult {
  const mismatch = source.dialect !== target.dialect;
  // Mutating side is the target; on a mismatch, emit SQL for the target dialect.
  const dialect: Dialect = mismatch ? target.dialect : source.dialect;
  const warn = mismatch
    ? `[WARNING dialect mismatch: source=${source.dialect}, target=${target.dialect}; SQL emitted for ${dialect}]`
    : "";
  const desc = (s: string) => (warn ? `${warn} ${s}` : s);

  const srcTables = new Map(source.tables.map((t) => [t.name, t]));
  const tgtTables = new Map(target.tables.map((t) => [t.name, t]));

  const tables: TableDiff[] = [];

  // Preserve source order first, then any target-only tables.
  for (const st of source.tables) {
    const tt = tgtTables.get(st.name);
    if (!tt) {
      // only-source → create-table
      const op: DiffOp = {
        id: opId(st.name, "create-table", st.name),
        table: st.name,
        kind: "create-table",
        description: desc(`Create table ${st.name}`),
        sql: buildCreateTableDump(dialect, toDumpInput(st)),
      };
      tables.push({ table: st.name, status: "only-source", ops: [op] });
    } else {
      const ops = diffExistingTable(dialect, st, tt, warn);
      tables.push({
        table: st.name,
        status: ops.length > 0 ? "different" : "same",
        ops,
      });
    }
  }

  // only-target → drop-table
  for (const tt of target.tables) {
    if (srcTables.has(tt.name)) continue;
    const op: DiffOp = {
      id: opId(tt.name, "drop-table", tt.name),
      table: tt.name,
      kind: "drop-table",
      description: desc(`Drop table ${tt.name}`),
      sql: buildDropTableDump(dialect, tt.schema, tt.name),
    };
    tables.push({ table: tt.name, status: "only-target", ops: [op] });
  }

  return { tables };
}

// ---------------------------------------------------------------------------
// buildDeploymentScript
// ---------------------------------------------------------------------------

/**
 * Safe execution order for a deployment script. Additive/creating ops run first
 * (so later references resolve), then destructive ops run in reverse-dependency
 * order (drop FKs before the indexes/columns/tables they may guard).
 */
const ORDER: DiffOpKind[] = [
  "create-table",
  "add-column",
  "alter-column",
  "add-index",
  "add-fk",
  "drop-fk",
  "drop-index",
  "drop-column",
  "drop-table",
];

/**
 * Join the selected ops' SQL into a single deployment script: a leading header
 * comment followed by each op's SQL (blank-line separated), ordered by ORDER
 * (a stable sort preserves the relative order of same-kind ops).
 */
export function buildDeploymentScript(ops: DiffOp[]): string {
  const rank = new Map(ORDER.map((k, i) => [k, i]));
  const ordered = [...ops].sort(
    (a, b) => (rank.get(a.kind) ?? 0) - (rank.get(b.kind) ?? 0),
  );

  const header = "-- ANSQL schema synchronization script --";
  const body = ordered.map((op) => op.sql).filter((s) => s !== "");

  return [header, ...body].join("\n\n");
}
