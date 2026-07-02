import type { QueryResult } from "../types";

export type ChartType = "bar" | "line" | "area" | "pie";

export interface ChartSpec {
  type: ChartType;
  /** Column whose values become the category/X axis. */
  xColumn: string;
  /** One or more columns plotted as series (Y values). */
  yColumns: string[];
}

/** Coerce an arbitrary cell value to a finite number, or null when it isn't. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Project a query result into chart-ready rows: each row is `{ x, ...yColumns }`
 * where `x` is the (stringified) value of {@link ChartSpec.xColumn} and every
 * requested y column is coerced to a number (non-numeric cells become 0).
 *
 * Only y columns that have at least one numeric value across the rows are kept;
 * `numericYColumns` reports the surviving set so callers can render exactly the
 * series that have data.
 */
export function buildChartData(
  result: QueryResult,
  spec: ChartSpec
): { rows: Record<string, unknown>[]; numericYColumns: string[] } {
  const colNames = new Set(result.columns.map((c) => c.name));
  const yColumns = spec.yColumns.filter((c) => colNames.has(c) && c !== spec.xColumn);
  const hasX = colNames.has(spec.xColumn);

  // A y column is "numeric" if any row has a coercible numeric value.
  const numericYColumns = yColumns.filter((col) =>
    result.rows.some((row) => toNumber(row[col]) !== null)
  );

  const rows = result.rows.map((row) => {
    const out: Record<string, unknown> = {
      x: hasX ? String(row[spec.xColumn] ?? "") : "",
    };
    for (const col of numericYColumns) {
      out[col] = toNumber(row[col]) ?? 0;
    }
    return out;
  });

  return { rows, numericYColumns };
}
