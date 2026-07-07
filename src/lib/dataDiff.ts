import type { Dialect, MutationColumn, Statement } from "../types";
import { buildDelete, buildInsert, buildUpdate } from "./mutationBuilder";

/**
 * Row-level data synchronization diff.
 *
 * `diffRows` compares a source dataset against a target dataset, keying each row
 * by `keyColumns`, and classifies every row as an insert (source-only), a delete
 * (target-only), or an update (present in both but differing on at least one
 * `compareColumns` value). `buildSyncStatements` then turns that diff into the
 * parameterized statements that make the target match the source.
 *
 * Everything here is pure and deterministic: the diff preserves the source order
 * for inserts/updates and the target order for deletes, so the same inputs always
 * produce the same statement sequence.
 */

export interface RowChange {
  /** The key-column values that identify this row (drawn from the source row). */
  key: Record<string, unknown>;
  /** The matching target row (the "before" state), present for updates. */
  before?: Record<string, unknown>;
  /** The source row (the desired "after" state), present for inserts/updates. */
  after?: Record<string, unknown>;
}

export interface DataDiff {
  /** Rows present in the source but not the target (source rows, source order). */
  inserts: Record<string, unknown>[];
  /** Rows present in both but differing on a compare column (source order). */
  updates: RowChange[];
  /** Rows present in the target but not the source (target rows, target order). */
  deletes: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// View-facing API (object-argument variants used by DataSyncView).
//
// The positional `diffRows`/`buildSyncStatements` above are the canonical,
// tested core. The view, however, needs row-level identity (`id`), a stable
// string key, source/target sides, and the set of changed columns so it can
// render a per-row checklist. The object-argument overloads below provide that
// shape while reusing the same diff/statement core.
// ---------------------------------------------------------------------------

/** Which side a {@link RowDiff} represents. */
export type RowDiffKind = "insert" | "update" | "delete";

/** A single difference between source and target, with a stable row identity. */
export interface RowDiff {
  /** Stable per-row id (kind-prefixed, sequential) for selection tracking. */
  id: string;
  /** The encoded key identity for this row (from {@link keyOf}). */
  key: string;
  /** The source row (present for inserts and updates). */
  source?: Record<string, unknown>;
  /** The target row (present for deletes and updates). */
  target?: Record<string, unknown>;
  /** For updates, the value columns whose values differ. */
  changedColumns?: string[];
}

/** The grouped, row-identified diff consumed by the data-sync view. */
export interface DataDiffResult {
  inserts: RowDiff[];
  updates: RowDiff[];
  deletes: RowDiff[];
}

/** Arguments for the object-form {@link diffRows} overload. */
export interface DiffRowsArgs {
  keyColumns: string[];
  columns: MutationColumn[];
  sourceRows: Record<string, unknown>[];
  targetRows: Record<string, unknown>[];
}

/** Options for the object-form {@link buildSyncStatements} overload. */
export interface BuildSyncStatementsOpts {
  dialect: Dialect;
  /** Pre-quoted, fully-qualified table name. */
  tableName: string;
  columns: MutationColumn[];
  keyColumns: string[];
}

/**
 * Build a stable string identity for a row from its key-column values.
 *
 * Values are JSON-encoded and length-prefixed so that distinct tuples can never
 * collide (e.g. keys `["a", "b"]` vs `["ab"]` are kept apart, and `null` is
 * distinguished from the string `"null"`). `undefined` is normalized to `null`
 * so a missing key cell matches an explicit NULL.
 */
function keyOf(row: Record<string, unknown>, keyColumns: string[]): string {
  return keyColumns
    .map((c) => {
      const v = row[c];
      const json = JSON.stringify(v === undefined ? null : v);
      return `${json.length}:${json}`;
    })
    .join("|");
}

/** Pick just the key-column values out of a row. */
function pickKey(
  row: Record<string, unknown>,
  keyColumns: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of keyColumns) out[c] = row[c];
  return out;
}

/**
 * Compare two scalar cell values for equality. Objects/arrays (e.g. JSON columns)
 * are compared structurally via their JSON encoding; `null` and `undefined` are
 * treated as equal so a missing cell matches an explicit NULL. Everything else
 * uses strict equality.
 */
export function cellEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true; // null/undefined coalesce
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Diff `source` against `target`, keyed by `keyColumns`.
 *
 * - A key in `source` but not `target` becomes an insert.
 * - A key in `target` but not `source` becomes a delete.
 * - A key in both whose `compareColumns` values differ becomes an update; if all
 *   compare columns are equal the row is unchanged and omitted.
 *
 * Inserts and updates preserve source order; deletes preserve target order. When
 * the source contains duplicate keys the first occurrence wins; duplicate target
 * keys resolve to the first occurrence for the matching `before` row, and the
 * extra target rows are treated as deletes (they have no source counterpart).
 */
export function diffRows(
  source: Record<string, unknown>[],
  target: Record<string, unknown>[],
  keyColumns: string[],
  compareColumns: string[],
): DataDiff;
export function diffRows(args: DiffRowsArgs): DataDiffResult;
export function diffRows(
  sourceOrArgs: Record<string, unknown>[] | DiffRowsArgs,
  target?: Record<string, unknown>[],
  keyColumns?: string[],
  compareColumns?: string[],
): DataDiff | DataDiffResult {
  if (!Array.isArray(sourceOrArgs)) {
    return diffRowsView(sourceOrArgs);
  }
  return diffRowsCore(
    sourceOrArgs,
    target ?? [],
    keyColumns ?? [],
    compareColumns ?? [],
  );
}

function diffRowsCore(
  source: Record<string, unknown>[],
  target: Record<string, unknown>[],
  keyColumns: string[],
  compareColumns: string[],
): DataDiff {
  const diff: DataDiff = { inserts: [], updates: [], deletes: [] };

  // Index the target by key. Keep the first row per key as the canonical match;
  // remember every index so unmatched duplicates can be emitted as deletes.
  const targetByKey = new Map<string, Record<string, unknown>>();
  const targetMatched = new Array<boolean>(target.length).fill(false);
  const targetIndexByKey = new Map<string, number>();
  for (let i = 0; i < target.length; i += 1) {
    const k = keyOf(target[i], keyColumns);
    if (!targetByKey.has(k)) {
      targetByKey.set(k, target[i]);
      targetIndexByKey.set(k, i);
    }
  }

  const seenSourceKeys = new Set<string>();
  for (const srcRow of source) {
    const k = keyOf(srcRow, keyColumns);
    if (seenSourceKeys.has(k)) continue; // first source row per key wins
    seenSourceKeys.add(k);

    const tgtRow = targetByKey.get(k);
    if (tgtRow === undefined) {
      diff.inserts.push(srcRow);
      continue;
    }

    // Mark the canonical target row consumed.
    const idx = targetIndexByKey.get(k);
    if (idx !== undefined) targetMatched[idx] = true;

    const changed = compareColumns.some(
      (c) => !cellEquals(srcRow[c], tgtRow[c]),
    );
    if (changed) {
      diff.updates.push({
        key: pickKey(srcRow, keyColumns),
        before: tgtRow,
        after: srcRow,
      });
    }
  }

  // Any target row not matched by a source key is a delete (this includes the
  // duplicate target rows whose key was already consumed by their first sibling).
  for (let i = 0; i < target.length; i += 1) {
    if (!targetMatched[i]) diff.deletes.push(target[i]);
  }

  return diff;
}

/** The non-key value columns (these drive the change comparison). */
function valueColumnNames(
  columns: MutationColumn[],
  keyColumns: string[],
): string[] {
  const keySet = new Set(keyColumns);
  return columns.filter((c) => !keySet.has(c.name)).map((c) => c.name);
}

/**
 * Object-argument variant of {@link diffRows} that produces a
 * {@link DataDiffResult}: each bucket holds {@link RowDiff} entries carrying a
 * stable id, the encoded key, the source/target sides, and (for updates) the
 * changed columns. Compare columns are every non-key column in `columns`.
 */
function diffRowsView(args: DiffRowsArgs): DataDiffResult {
  const { keyColumns, columns, sourceRows, targetRows } = args;
  const compareColumns = valueColumnNames(columns, keyColumns);
  const core = diffRowsCore(sourceRows, targetRows, keyColumns, compareColumns);

  const result: DataDiffResult = { inserts: [], updates: [], deletes: [] };

  core.inserts.forEach((source, i) => {
    result.inserts.push({
      id: `insert:${i}`,
      key: keyOf(source, keyColumns),
      source,
    });
  });

  core.updates.forEach((change, i) => {
    const source = change.after ?? {};
    const target = change.before ?? {};
    const changedColumns = compareColumns.filter(
      (c) => !cellEquals(source[c], target[c]),
    );
    result.updates.push({
      id: `update:${i}`,
      key: keyOf(source, keyColumns),
      source,
      target,
      changedColumns,
    });
  });

  core.deletes.forEach((target, i) => {
    result.deletes.push({
      id: `delete:${i}`,
      key: keyOf(target, keyColumns),
      target,
    });
  });

  return result;
}

/**
 * Restrict a column list to the WHERE-identity columns for a sync statement.
 *
 * The mutation builder identifies a row by the columns flagged `is_primary_key`
 * (falling back to every column when none is flagged). To make UPDATE/DELETE
 * match strictly on `keyColumns`, we flag exactly those columns as the primary
 * key for the builder, regardless of the table's declared PK.
 */
function keyedColumns(
  columns: MutationColumn[],
  keyColumns: string[],
): MutationColumn[] {
  const keySet = new Set(keyColumns);
  return columns.map((c) => ({ ...c, is_primary_key: keySet.has(c.name) }));
}

/** Only the compare/value columns the builder should write (excludes key columns). */
function diffChanges(
  after: Record<string, unknown>,
  columns: MutationColumn[],
  keyColumns: string[],
): Record<string, unknown> {
  const keySet = new Set(keyColumns);
  const changes: Record<string, unknown> = {};
  for (const col of columns) {
    if (keySet.has(col.name)) continue;
    if (col.name in after) changes[col.name] = after[col.name];
  }
  return changes;
}

/**
 * Turn a {@link DataDiff} into parameterized statements that make the target
 * match the source. Statements are emitted in the order inserts, updates,
 * deletes so that newly-inserted rows are present before any dependent updates
 * and removals run.
 *
 * - Inserts use {@link buildInsert} over all (non-auto-increment) columns.
 * - Updates use {@link buildUpdate}: SET the non-key columns, WHERE on the key.
 * - Deletes use {@link buildDelete}: WHERE on the key.
 *
 * `qualifiedTable` must be a pre-quoted, fully-qualified table name. The WHERE
 * clause of updates/deletes matches strictly on `keyColumns`. Inserts and
 * updates whose builder yields nothing (no insertable/changed columns) are
 * skipped.
 */
export function buildSyncStatements(
  dialect: Dialect,
  qualifiedTable: string,
  columns: MutationColumn[],
  keyColumns: string[],
  diff: DataDiff,
): Statement[];
export function buildSyncStatements(
  diff: DataDiffResult,
  selectedIds: Set<string>,
  opts: BuildSyncStatementsOpts,
): Statement[];
export function buildSyncStatements(
  a: Dialect | DataDiffResult,
  b: string | Set<string>,
  c: MutationColumn[] | BuildSyncStatementsOpts,
  keyColumns?: string[],
  diff?: DataDiff,
): Statement[] {
  if (typeof a === "string") {
    return buildSyncStatementsCore(
      a,
      b as string,
      c as MutationColumn[],
      keyColumns ?? [],
      diff ?? { inserts: [], updates: [], deletes: [] },
    );
  }
  return buildSyncStatementsView(a, b as Set<string>, c as BuildSyncStatementsOpts);
}

/**
 * Object-argument variant: filter a {@link DataDiffResult} down to the selected
 * rows, then delegate to the positional core. Inserts/updates carry a `source`
 * row; deletes carry a `target` row.
 */
function buildSyncStatementsView(
  diff: DataDiffResult,
  selectedIds: Set<string>,
  opts: BuildSyncStatementsOpts,
): Statement[] {
  const core: DataDiff = { inserts: [], updates: [], deletes: [] };
  for (const r of diff.inserts) {
    if (selectedIds.has(r.id) && r.source) core.inserts.push(r.source);
  }
  for (const r of diff.updates) {
    if (selectedIds.has(r.id) && r.source) {
      core.updates.push({
        key: r.target ?? r.source,
        before: r.target,
        after: r.source,
      });
    }
  }
  for (const r of diff.deletes) {
    if (selectedIds.has(r.id) && r.target) core.deletes.push(r.target);
  }
  return buildSyncStatementsCore(
    opts.dialect,
    opts.tableName,
    opts.columns,
    opts.keyColumns,
    core,
  );
}

function buildSyncStatementsCore(
  dialect: Dialect,
  qualifiedTable: string,
  columns: MutationColumn[],
  keyColumns: string[],
  diff: DataDiff,
): Statement[] {
  const statements: Statement[] = [];
  const keyed = keyedColumns(columns, keyColumns);

  for (const row of diff.inserts) {
    const stmt = buildInsert(dialect, qualifiedTable, columns, row);
    if (stmt) statements.push(stmt);
  }

  for (const change of diff.updates) {
    const after = change.after ?? {};
    const before = change.before ?? change.key;
    const changes = diffChanges(after, columns, keyColumns);
    const stmt = buildUpdate(dialect, qualifiedTable, keyed, before, changes);
    if (stmt) statements.push(stmt);
  }

  for (const row of diff.deletes) {
    statements.push(buildDelete(dialect, qualifiedTable, keyed, row));
  }

  return statements;
}
