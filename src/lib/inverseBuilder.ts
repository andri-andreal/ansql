import type { Dialect, MutationColumn, Statement } from "../types";
import { buildDelete, buildInsert, buildUpdate } from "./mutationBuilder";

/**
 * Compensating-statement builders: given a forward grid mutation (the exact
 * before/after state the data grid already tracks), produce the SQL that UNDOES
 * it. This is the core of the "Time Machine" rollback feature.
 *
 * The whole module is pure and reuses the forward builders in
 * {@link ./mutationBuilder}, so an inverse is always dialect-correct and
 * parameterized the same way the original mutation was:
 *
 *   - INSERT  →  DELETE the inserted row
 *   - UPDATE  →  UPDATE the row back to its original values
 *   - DELETE  →  INSERT the original row in full (forcing its primary key)
 *
 * Known limits (Tier-1, app-mediated DML only — surfaced as best-effort in UI):
 *   - An INSERT whose identity was an auto-increment PK assigned by the DB is
 *     matched on its other provided columns (capped to one row), not the PK.
 *   - Re-inserting a deleted row restores its old PK value, but any
 *     auto-increment sequence is NOT rewound.
 *   - Concurrent edits by another client can make an inverse match zero rows;
 *     callers should treat `affected_rows === 0` as a conflict (handled by the
 *     journal's conflict guard).
 */

export type MutationKind = "insert" | "update" | "delete";

/** One forward grid mutation, described by the state the grid already has. */
export interface GridMutation {
  kind: MutationKind;
  /**
   * insert → the row that was inserted.
   * update → the row's ORIGINAL values (pre-update).
   * delete → the row that was deleted (its full original values).
   */
  row: Record<string, unknown>;
  /** update only: the changed columns and their NEW values. */
  changes?: Record<string, unknown>;
}

/**
 * Inverse of an INSERT: a DELETE targeting the inserted row. Matches on the
 * columns actually present (and defined) in `insertedRow`. If the table's PK
 * was auto-assigned by the DB it won't appear in the row, so the match falls
 * back to all present columns (capped to a single row by {@link buildDelete}).
 */
export function invertInsert(
  dialect: Dialect,
  tableName: string,
  columns: MutationColumn[],
  insertedRow: Record<string, unknown>,
): Statement | null {
  const present = columns.filter(
    (c) => c.name in insertedRow && insertedRow[c.name] !== undefined,
  );
  if (present.length === 0) return null;
  return buildDelete(dialect, tableName, present, insertedRow);
}

/**
 * Inverse of an UPDATE: an UPDATE that restores the changed columns to their
 * original values. The WHERE targets the row in its POST-update state
 * (original ∪ changes), so it still matches after the forward update ran.
 */
export function invertUpdate(
  dialect: Dialect,
  tableName: string,
  columns: MutationColumn[],
  originalRow: Record<string, unknown>,
  changes: Record<string, unknown>,
): Statement | null {
  const changedKeys = Object.keys(changes);
  if (changedKeys.length === 0) return null;

  // Restore the ORIGINAL value of each column the forward update changed.
  const restore: Record<string, unknown> = {};
  for (const k of changedKeys) {
    restore[k] = k in originalRow ? originalRow[k] : null;
  }
  // The row's current identity after the forward update.
  const currentRow = { ...originalRow, ...changes };
  return buildUpdate(dialect, tableName, columns, currentRow, restore);
}

/**
 * Inverse of a DELETE: an INSERT that re-creates the deleted row exactly,
 * including its primary key (via `forceAll`).
 */
export function invertDelete(
  dialect: Dialect,
  tableName: string,
  columns: MutationColumn[],
  originalRow: Record<string, unknown>,
): Statement | null {
  return buildInsert(dialect, tableName, columns, originalRow, { forceAll: true });
}

/** Build the inverse of a single grid mutation. */
export function invertMutation(
  dialect: Dialect,
  tableName: string,
  columns: MutationColumn[],
  m: GridMutation,
): Statement | null {
  switch (m.kind) {
    case "insert":
      return invertInsert(dialect, tableName, columns, m.row);
    case "delete":
      return invertDelete(dialect, tableName, columns, m.row);
    case "update":
      return invertUpdate(dialect, tableName, columns, m.row, m.changes ?? {});
  }
}

/**
 * Build the inverse batch for a forward batch. The inverses are returned in
 * REVERSE order of the forward mutations, so applying them as one transaction
 * undoes the batch in the opposite order it was applied (important when rows
 * reference each other). Mutations whose inverse is a no-op are dropped.
 */
export function buildInverseBatch(
  dialect: Dialect,
  tableName: string,
  columns: MutationColumn[],
  mutations: GridMutation[],
): Statement[] {
  const inverses: Statement[] = [];
  for (const m of mutations) {
    const inv = invertMutation(dialect, tableName, columns, m);
    if (inv) inverses.push(inv);
  }
  return inverses.reverse();
}
