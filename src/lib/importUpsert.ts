/**
 * importUpsert.ts — pure builders that turn imported rows into parameterized
 * "upsert" (INSERT … ON CONFLICT / ON DUPLICATE KEY) statements.
 *
 * Frontend-only data sync: the resulting `{ sql, params }[]` statements run
 * through `queryCommands.commitChanges`, which executes them in a single
 * transaction. Values are NEVER string-interpolated — every non-null scalar is a
 * bound parameter; identifiers go through `quoteIdent`. Placeholders match the
 * dialect (`?` for MySQL/SQLite, `$1..$n` for Postgres, `@P1..@Pn` for
 * SQL Server) exactly as `mutationBuilder` emits them, so the two stay
 * interchangeable.
 *
 * Conflict resolution per dialect:
 *   - postgres:  INSERT … ON CONFLICT (keys) DO UPDATE SET col = EXCLUDED.col
 *   - mysql:     INSERT … ON DUPLICATE KEY UPDATE col = VALUES(col)
 *   - sqlite:    INSERT … ON CONFLICT(keys) DO UPDATE SET col = excluded.col
 *   - sqlserver: MERGE INTO target AS t USING (VALUES …) AS s(cols) ON (t.key =
 *                s.key …) WHEN MATCHED THEN UPDATE SET … WHEN NOT MATCHED THEN
 *                INSERT (cols) VALUES (s.cols); (the MERGE is terminated by `;`)
 *
 * The non-key columns are the SET targets. If there are no non-key columns to
 * update (every column is a key), the statement degrades to a conflict no-op
 * (`DO NOTHING` / `INSERT IGNORE`-equivalent) so re-importing identical key rows
 * doesn't error.
 *
 * Rows are emitted one INSERT per row (each row is its own statement). `batchSize`
 * groups several rows into a single multi-VALUES INSERT to cut round-trips; it
 * has no effect on the produced SQL semantics, only on how many rows share one
 * statement.
 */

import type { Dialect, MutationColumn, ParamValue, Statement } from "../types";
import { coerceValue, quoteIdent } from "./mutationBuilder";

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

/**
 * Postgres binds text/number/bool params with explicit types and performs no
 * implicit cast into date/time/json/uuid columns, so append an explicit cast for
 * those. Mirrors `mutationBuilder.pgCast`.
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
 * Emit one VALUES cell for `col`. NULL/undefined become the literal `NULL`
 * (never a parameter); other values are bound through `ph`/`params` (with any
 * Postgres cast). Unlike INSERT-for-new-row in the grid, an imported value is
 * emitted as-is — empty strings included — because import semantics fill exactly
 * the mapped source columns.
 */
function emitValue(
  dialect: Dialect,
  col: MutationColumn,
  value: unknown,
  ph: Placeholders,
  params: ParamValue[],
): string {
  if (value === null || value === undefined) return "NULL";
  params.push(coerceValue(col, value));
  return ph.next() + pgCast(dialect, col.data_type);
}

/** The `SET col = <conflict-ref>.col` reference token per dialect. */
function excludedRef(dialect: Dialect): string {
  // postgres uppercases EXCLUDED by convention; sqlite uses lowercase excluded.
  return dialect === "postgres" ? "EXCLUDED" : "excluded";
}

/**
 * Build parameterized upsert statements for `rows`, one INSERT per `batchSize`
 * rows. `columns` is the full target column list (defines INSERT column order);
 * `keyColumns` are the conflict-key column names; non-key columns are the SET
 * targets. `qualifiedTable` must already be a fully-qualified, pre-quoted table
 * name (e.g. `"public"."users"` / `` `db`.`users` ``).
 *
 * Returns one `Statement` per batch. Empty `rows` → `[]`.
 */
export function buildUpsertStatements(
  dialect: Dialect,
  qualifiedTable: string,
  columns: MutationColumn[],
  keyColumns: string[],
  rows: Record<string, unknown>[],
  batchSize = 500,
): Statement[] {
  if (rows.length === 0 || columns.length === 0) return [];
  const size = batchSize > 0 ? batchSize : rows.length;

  const keySet = new Set(keyColumns);
  const insertCols = columns;
  const colIdents = insertCols.map((c) => quoteIdent(dialect, c.name)).join(", ");
  const keyIdents = keyColumns.map((k) => quoteIdent(dialect, k)).join(", ");

  // Non-key columns are the update targets. If none, the upsert is a no-op on
  // conflict (every column is part of the key).
  const updateCols = insertCols.filter((c) => !keySet.has(c.name));

  // SQL Server has no ON CONFLICT/ON DUPLICATE KEY: a parameterized MERGE
  // replaces the INSERT-plus-suffix shape entirely (one MERGE per batch).
  if (dialect === "sqlserver") {
    return buildMergeStatements(
      qualifiedTable,
      insertCols,
      keyColumns,
      updateCols,
      rows,
      size,
    );
  }

  // Build the trailing conflict clause (identical for every batch).
  const conflictClause = buildConflictClause(dialect, keyIdents, updateCols);

  const statements: Statement[] = [];
  for (let start = 0; start < rows.length; start += size) {
    const batch = rows.slice(start, start + size);
    const params: ParamValue[] = [];
    const ph = new Placeholders(dialect);

    const valueGroups = batch.map((row) => {
      const cells = insertCols.map((col) =>
        emitValue(dialect, col, row[col.name], ph, params),
      );
      return `(${cells.join(", ")})`;
    });

    const sql =
      `INSERT INTO ${qualifiedTable} (${colIdents}) VALUES ${valueGroups.join(", ")}` +
      conflictClause;
    statements.push({ sql, params });
  }

  return statements;
}

/**
 * Build SQL Server MERGE upsert statements (one per batch).
 *
 * Shape:
 *   MERGE INTO <target> AS t
 *   USING (VALUES (@P1, …), (@Pn, …)) AS s(<cols>)
 *   ON (t.<key> = s.<key> [AND …])
 *   WHEN MATCHED THEN UPDATE SET t.<col> = s.<col>, …
 *   WHEN NOT MATCHED THEN INSERT (<cols>) VALUES (s.<col>, …);
 *
 * The trailing `;` is required to terminate a MERGE. When every column is a key
 * (no update targets), the WHEN MATCHED branch is dropped so re-importing
 * identical key rows is a no-op instead of an error.
 */
function buildMergeStatements(
  target: string,
  insertCols: MutationColumn[],
  keyColumns: string[],
  updateCols: MutationColumn[],
  rows: Record<string, unknown>[],
  size: number,
): Statement[] {
  const colIdents = insertCols.map((c) => quoteIdent("sqlserver", c.name)).join(", ");
  const onClause = keyColumns
    .map((k) => {
      const id = quoteIdent("sqlserver", k);
      return `t.${id} = s.${id}`;
    })
    .join(" AND ");
  const insertVals = insertCols
    .map((c) => `s.${quoteIdent("sqlserver", c.name)}`)
    .join(", ");
  const setClause = updateCols
    .map((c) => {
      const id = quoteIdent("sqlserver", c.name);
      return `t.${id} = s.${id}`;
    })
    .join(", ");

  const statements: Statement[] = [];
  for (let start = 0; start < rows.length; start += size) {
    const batch = rows.slice(start, start + size);
    const params: ParamValue[] = [];
    const ph = new Placeholders("sqlserver");

    const valueGroups = batch.map((row) => {
      const cells = insertCols.map((col) =>
        emitValue("sqlserver", col, row[col.name], ph, params),
      );
      return `(${cells.join(", ")})`;
    });

    const matched = setClause ? ` WHEN MATCHED THEN UPDATE SET ${setClause}` : "";
    const sql =
      `MERGE INTO ${target} AS t` +
      ` USING (VALUES ${valueGroups.join(", ")}) AS s(${colIdents})` +
      ` ON (${onClause})` +
      matched +
      ` WHEN NOT MATCHED THEN INSERT (${colIdents}) VALUES (${insertVals});`;
    statements.push({ sql, params });
  }

  return statements;
}

/** The dialect-specific ON CONFLICT / ON DUPLICATE KEY suffix (no params). */
function buildConflictClause(
  dialect: Dialect,
  keyIdents: string,
  updateCols: MutationColumn[],
): string {
  if (dialect === "mysql") {
    if (updateCols.length === 0) {
      // No non-key columns to update: keep the row unchanged on duplicate key.
      // Self-assigning the first key is the idiomatic MySQL "do nothing".
      // (keyIdents is non-empty whenever an upsert is meaningful.)
      const firstKey = keyIdents.split(",")[0]?.trim();
      return firstKey ? ` ON DUPLICATE KEY UPDATE ${firstKey} = ${firstKey}` : "";
    }
    const sets = updateCols
      .map((c) => {
        const ident = quoteIdent("mysql", c.name);
        return `${ident} = VALUES(${ident})`;
      })
      .join(", ");
    return ` ON DUPLICATE KEY UPDATE ${sets}`;
  }

  // postgres + sqlite share ON CONFLICT (keys) DO UPDATE / DO NOTHING.
  const ref = excludedRef(dialect);
  if (updateCols.length === 0) {
    return ` ON CONFLICT (${keyIdents}) DO NOTHING`;
  }
  const sets = updateCols
    .map((c) => {
      const ident = quoteIdent(dialect, c.name);
      return `${ident} = ${ref}.${ident}`;
    })
    .join(", ");
  return ` ON CONFLICT (${keyIdents}) DO UPDATE SET ${sets}`;
}
