/**
 * Pre-flight dry-run preview for raw single-table UPDATE/DELETE statements.
 *
 * Instead of executing the statement (or holding a transaction open across the
 * user's Commit/Cancel decision — which the pooled backend cannot do), the
 * UPDATE's SET expressions are projected into a single read-only SELECT:
 *
 *   UPDATE users SET status = 'inactive' WHERE last_login < '2025-01-01'
 *   →  SELECT *, ('inactive') AS "__ansql_new__status"
 *      FROM "users" WHERE last_login < '2025-01-01' LIMIT <cap+1>
 *
 * One query yields the current (before) row AND the predicted (after) values
 * atomically, and its before-columns double as the Time Machine Tier-2 undo
 * snapshot — a previewed run never snapshots twice. A DELETE preview is just
 * the plain snapshot SELECT (the rows that would disappear).
 *
 * The predicted values are exactly that — predictions: non-deterministic
 * expressions (NOW(), random()) evaluate again when the statement really runs,
 * and MySQL applies SET assignments left-to-right (later assignments see new
 * values) while this preview computes every expression from the current row.
 *
 * Like the rest of the raw-DML pipeline the bar is HIGH: anything we cannot
 * project faithfully returns null and the caller falls back to running the
 * statement without a preview. Pure module — no React, no Tauri.
 */

import type { Dialect, QueryResult } from "../types";
import { cellEquals } from "./dataDiff";
import { quoteIdent } from "./mutationBuilder";
import { parseSetAssignments, type DmlSource, type SetAssignment } from "./rawDmlSource";
import { buildSnapshotSql, qualifyTable } from "./rawDmlSnapshot";

/** Alias prefix marking a projected predicted-new-value column. */
export const NEW_VALUE_PREFIX = "__ansql_new__";

/** PostgreSQL silently truncates identifiers longer than 63 bytes. */
const MAX_ALIAS_LEN = 63;

export interface PreflightPlan {
  verb: "update" | "delete";
  /** Parsed SET assignments, targets resolved to metadata spelling ([] for DELETE). */
  assignments: SetAssignment[];
  /**
   * Read-only preview SELECT: every current column, plus (for UPDATE) one
   * `__ansql_new__<col>` aliased column per assignment. Ask for cap+1 rows so
   * the caller can tell "exactly cap" from "truncated".
   */
  previewSql: string;
  /** Exact matched-row count for the headline when the preview is truncated. */
  countSql: string;
  hasWhere: boolean;
}

/**
 * Build the preview plan for a detected single-table UPDATE/DELETE. Returns
 * null when a faithful preview can't be built — the caller must then fall back
 * to the plain (no-preview) execution path:
 *  - a top-level ORDER BY / LIMIT / OFFSET tail (the statement may touch fewer
 *    rows than its WHERE matches — the preview would over-report);
 *  - a real column already named `__ansql_new__*` (alias collision);
 *  - an UPDATE whose SET clause we can't parse into plain assignments;
 *  - an assignment target that doesn't resolve to exactly one known column;
 *  - an alias that would exceed PostgreSQL's 63-byte identifier limit.
 */
export function buildPreflightPlan(
  dialect: Dialect,
  src: DmlSource,
  columnNames: string[],
  cap: number,
): PreflightPlan | null {
  if (src.hasLimitTail) return null;
  if (columnNames.some((c) => c.startsWith(NEW_VALUE_PREFIX))) return null;

  const qualified = qualifyTable(dialect, src);
  const countSql = `SELECT COUNT(*) FROM ${qualified}${src.whereSql ? ` WHERE ${src.whereSql}` : ""}`;

  if (src.verb === "delete") {
    return {
      verb: "delete",
      assignments: [],
      previewSql: buildSnapshotSql(dialect, qualified, src.whereSql, cap + 1),
      countSql,
      hasWhere: src.whereSql !== null,
    };
  }

  if (src.setSql === null) return null;
  const parsed = parseSetAssignments(src.setSql);
  if (parsed === null) return null;

  const assignments: SetAssignment[] = [];
  const extraSelect: string[] = [];
  for (const a of parsed) {
    const column = resolveColumn(a.column, columnNames);
    if (column === null) return null;
    const alias = NEW_VALUE_PREFIX + column;
    if (alias.length > MAX_ALIAS_LEN) return null;
    assignments.push({ column, exprSql: a.exprSql });
    extraSelect.push(`(${a.exprSql}) AS ${quoteIdent(dialect, alias)}`);
  }

  return {
    verb: "update",
    assignments,
    previewSql: buildSnapshotSql(dialect, qualified, src.whereSql, cap + 1, extraSelect),
    countSql,
    hasWhere: src.whereSql !== null,
  };
}

/**
 * Resolve an assignment target against the table's column metadata: exact
 * match first, then a unique case-insensitive match (MySQL is
 * case-insensitive; PG lowercases unquoted idents). Returns the metadata
 * spelling — the alias must round-trip through the driver — or null when the
 * target is unknown or ambiguous.
 */
function resolveColumn(name: string, columnNames: string[]): string | null {
  if (columnNames.includes(name)) return name;
  const lower = name.toLowerCase();
  const matches = columnNames.filter((c) => c.toLowerCase() === lower);
  return matches.length === 1 ? matches[0] : null;
}

/** One preview row split into its current and predicted states. */
export interface PreflightRowDiff {
  /** The row as it exists now (preview columns stripped). */
  before: Record<string, unknown>;
  /** Predicted post-UPDATE row (before + applied assignments); null for DELETE. */
  after: Record<string, unknown> | null;
  /** Assignment targets whose predicted value differs from the current value. */
  changedColumns: string[];
}

/**
 * Split raw preview-result rows into before/after pairs. `before` is the row
 * minus every `__ansql_new__*` key; for UPDATE (non-empty `assignments`),
 * `after` overlays each projected predicted value onto `before`.
 */
export function splitPreviewRows(
  rows: Record<string, unknown>[],
  assignments: SetAssignment[],
): PreflightRowDiff[] {
  return rows.map((row) => {
    const before: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!key.startsWith(NEW_VALUE_PREFIX)) before[key] = value;
    }
    if (assignments.length === 0) {
      return { before, after: null, changedColumns: [] };
    }
    const after = { ...before };
    const changedColumns: string[] = [];
    for (const a of assignments) {
      after[a.column] = row[NEW_VALUE_PREFIX + a.column];
      if (!cellEquals(before[a.column], after[a.column])) changedColumns.push(a.column);
    }
    return { before, after, changedColumns };
  });
}

/**
 * Read the single COUNT(*) value from a count-query result. Drivers may return
 * bigint counts as strings; anything unreadable yields null (the headline then
 * falls back to "at least cap rows").
 */
export function readCountValue(result: QueryResult): number | null {
  const row = result.rows[0];
  if (!row) return null;
  const values = Object.values(row);
  if (values.length === 0) return null;
  const n = typeof values[0] === "number" ? values[0] : Number(values[0]);
  return Number.isFinite(n) ? n : null;
}
