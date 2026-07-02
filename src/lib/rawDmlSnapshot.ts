/**
 * Pure helpers for Tier-2 (best-effort) undo of raw UPDATE/DELETE statements.
 *
 * The query editor snapshots the rows a statement will touch BEFORE running it
 * (via {@link buildSnapshotSql}), then — on success — turns that snapshot into a
 * compensating batch ({@link buildRawUndo}) stored in the action journal.
 */

import type { Dialect, MutationColumn, Statement } from "../types";
import { buildUpdate, quoteIdent } from "./mutationBuilder";
import { invertDelete } from "./inverseBuilder";
import type { DmlSource } from "./rawDmlSource";

/** Qualified, dialect-quoted table name from a parsed DML source. */
export function qualifyTable(
  dialect: Dialect,
  src: { schema: string | null; table: string },
): string {
  return src.schema
    ? `${quoteIdent(dialect, src.schema)}.${quoteIdent(dialect, src.table)}`
    : quoteIdent(dialect, src.table);
}

/**
 * `SELECT * FROM <table> [WHERE ...]` capturing at most `cap` rows, dialect
 * correct (SQL Server has no LIMIT, so it uses `TOP (n)`).
 */
export function buildSnapshotSql(
  dialect: Dialect,
  qualified: string,
  whereSql: string | null,
  cap: number,
): string {
  const where = whereSql ? ` WHERE ${whereSql}` : "";
  if (dialect === "sqlserver") {
    return `SELECT TOP (${cap}) * FROM ${qualified}${where}`;
  }
  return `SELECT * FROM ${qualified}${where} LIMIT ${cap}`;
}

/**
 * Build the inverse (undo) batch for a raw UPDATE/DELETE from the snapshot of
 * rows captured BEFORE it ran.
 *  - DELETE → re-insert each snapshot row in full (forcing the primary key).
 *  - UPDATE → restore every non-key column of each snapshot row, keyed by PK.
 *
 * Returns null when the inverse can't be built safely: no rows captured, or an
 * UPDATE against a table with no primary key (no stable way to re-target rows).
 */
export function buildRawUndo(
  dialect: Dialect,
  src: DmlSource,
  columns: MutationColumn[],
  snapshotRows: Record<string, unknown>[],
): Statement[] | null {
  if (snapshotRows.length === 0) return null;
  const qualified = qualifyTable(dialect, src);

  if (src.verb === "delete") {
    const out: Statement[] = [];
    for (const row of snapshotRows) {
      const stmt = invertDelete(dialect, qualified, columns, row);
      if (stmt) out.push(stmt);
    }
    return out.length ? out : null;
  }

  // UPDATE: need a primary key to re-target each snapshot row.
  const pkCols = columns.filter((c) => c.is_primary_key);
  if (pkCols.length === 0) return null;
  const keyNames = new Set(pkCols.map((c) => c.name));

  const out: Statement[] = [];
  for (const row of snapshotRows) {
    const restore: Record<string, unknown> = {};
    for (const c of columns) {
      if (keyNames.has(c.name)) continue;
      if (c.name in row) restore[c.name] = row[c.name];
    }
    const stmt = buildUpdate(dialect, qualified, columns, row, restore);
    if (stmt) out.push(stmt);
  }
  return out.length ? out : null;
}
