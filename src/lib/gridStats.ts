import { quoteIdent } from "./mutationBuilder";
import type { Dialect } from "../types";

/**
 * Pure helpers for grid statistics: a client-side aggregate over the current
 * selection (status-bar SUM/AVG/MIN/MAX/COUNT) and a server-side per-column
 * stats query (total / non-null / distinct / min / max).
 */

export interface SelectionAggregate {
  count: number;
  numericCount: number;
  sum: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
}

/**
 * Parse a cell value as a finite number, or null if it isn't numeric-parseable.
 * Booleans, objects, empty strings, null/undefined and non-numeric text are
 * treated as non-numeric and ignored by the aggregate's numeric stats.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Aggregate an arbitrary list of selected cell values. `count` includes every
 * value; the numeric stats (sum/avg/min/max) consider only numeric-parseable
 * values and are null when none qualify. `numericCount` reports how many values
 * contributed to the numeric stats.
 */
export function aggregateSelection(values: unknown[]): SelectionAggregate {
  const count = values.length;
  let numericCount = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const value of values) {
    const n = toNumber(value);
    if (n === null) continue;
    numericCount += 1;
    sum += n;
    if (n < min) min = n;
    if (n > max) max = n;
  }

  if (numericCount === 0) {
    return { count, numericCount: 0, sum: null, avg: null, min: null, max: null };
  }
  return { count, numericCount, sum, avg: sum / numericCount, min, max };
}

/**
 * Build a single-row stats query for one column of a table. The table name must
 * already be fully qualified (and quoted); the column is quoted per dialect.
 */
export function buildColumnStatsSql(
  dialect: Dialect,
  qualifiedTable: string,
  column: string,
): string {
  const col = quoteIdent(dialect, column);
  return (
    `SELECT COUNT(*) AS total, COUNT(${col}) AS non_null, ` +
    `COUNT(DISTINCT ${col}) AS distinct_count, ` +
    `MIN(${col}) AS min_val, MAX(${col}) AS max_val ` +
    `FROM ${qualifiedTable}`
  );
}

export interface ColumnStats {
  total: number;
  nonNull: number;
  distinct: number;
  nullPct: number;
  min: unknown;
  max: unknown;
}

/** Coerce a stats-row count value to a number, defaulting to 0. */
function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map a row returned by `buildColumnStatsSql` to a ColumnStats, computing the
 * null percentage from total vs. non-null. nullPct is 0 for an empty table.
 */
export function parseColumnStats(row: Record<string, unknown>): ColumnStats {
  const total = toCount(row.total);
  const nonNull = toCount(row.non_null);
  const distinct = toCount(row.distinct_count);
  const nullPct = total > 0 ? ((total - nonNull) / total) * 100 : 0;
  return {
    total,
    nonNull,
    distinct,
    nullPct,
    min: row.min_val ?? null,
    max: row.max_val ?? null,
  };
}
