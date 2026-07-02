/**
 * Pure, unit-testable per-column filtering helpers shared by ResultsGrid and
 * DataGridView. Filters run client-side over already-loaded rows and combine
 * with the global text search using AND.
 */

export type FilterOperator =
  | "contains"
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "starts_with"
  | "ends_with"
  | "is_null"
  | "is_not_null";

export interface ColumnFilter {
  column: string;
  operator: FilterOperator;
  /** Comparison operand (ignored for is_null / is_not_null). */
  value: string;
}

/** Operators that don't need a value operand. */
export const VALUELESS_OPERATORS: ReadonlySet<FilterOperator> = new Set<FilterOperator>([
  "is_null",
  "is_not_null",
]);

/** Human-readable labels for the operator dropdown. */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "contains",
  equals: "=",
  not_equals: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  starts_with: "starts with",
  ends_with: "ends with",
  is_null: "is null",
  is_not_null: "is not null",
};

export const OPERATOR_ORDER: FilterOperator[] = [
  "contains",
  "equals",
  "not_equals",
  "gt",
  "gte",
  "lt",
  "lte",
  "starts_with",
  "ends_with",
  "is_null",
  "is_not_null",
];

const isNullish = (v: unknown): boolean => v === null || v === undefined;

/**
 * Compare two operands numerically when both parse as finite numbers, otherwise
 * fall back to a locale string comparison. Returns negative / 0 / positive.
 */
function compare(cell: unknown, operand: string): number {
  const cellNum = typeof cell === "number" ? cell : Number(cell);
  const opNum = Number(operand);
  const bothNumeric =
    !Number.isNaN(cellNum) &&
    Number.isFinite(cellNum) &&
    operand.trim() !== "" &&
    !Number.isNaN(opNum) &&
    Number.isFinite(opNum);
  if (bothNumeric) return cellNum - opNum;
  return String(cell).localeCompare(operand);
}

/** Evaluate a single filter against one raw cell value. */
export function matchesFilter(cellValue: unknown, filter: ColumnFilter): boolean {
  const { operator, value } = filter;

  if (operator === "is_null") return isNullish(cellValue);
  if (operator === "is_not_null") return !isNullish(cellValue);

  // For value-based operators a null cell never matches.
  if (isNullish(cellValue)) return false;

  const cellStr = typeof cellValue === "object" ? JSON.stringify(cellValue) : String(cellValue);
  const cellLower = cellStr.toLowerCase();
  const valLower = value.toLowerCase();

  switch (operator) {
    case "contains":
      return cellLower.includes(valLower);
    case "equals":
      return cellLower === valLower;
    case "not_equals":
      return cellLower !== valLower;
    case "starts_with":
      return cellLower.startsWith(valLower);
    case "ends_with":
      return cellLower.endsWith(valLower);
    case "gt":
      return compare(cellValue, value) > 0;
    case "gte":
      return compare(cellValue, value) >= 0;
    case "lt":
      return compare(cellValue, value) < 0;
    case "lte":
      return compare(cellValue, value) <= 0;
    default:
      return true;
  }
}

/** A filter is "active" if it is valueless or carries a non-empty operand. */
export function isFilterActive(filter: ColumnFilter): boolean {
  if (VALUELESS_OPERATORS.has(filter.operator)) return true;
  return filter.value !== "";
}

/** Does a row satisfy ALL active filters (AND)? */
export function rowMatchesFilters(
  row: Record<string, unknown>,
  filters: ColumnFilter[]
): boolean {
  for (const f of filters) {
    if (!isFilterActive(f)) continue;
    if (!matchesFilter(row[f.column], f)) return false;
  }
  return true;
}

/**
 * Does a row match the global free-text search across the named columns
 * (case-insensitive substring over any column)? Empty search matches all.
 */
export function rowMatchesSearch(
  row: Record<string, unknown>,
  columns: string[],
  search: string
): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return columns.some((name) => {
    const v = row[name];
    if (isNullish(v)) return false;
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.toLowerCase().includes(needle);
  });
}

/**
 * Apply the global text search (AND) the active per-column filters to a row set.
 * Pure — returns a new array, preserving input order.
 */
export function applyGridFilters(
  rows: Record<string, unknown>[],
  columns: string[],
  search: string,
  filters: ColumnFilter[]
): Record<string, unknown>[] {
  const active = filters.filter(isFilterActive);
  if (!search && active.length === 0) return rows;
  return rows.filter(
    (row) => rowMatchesSearch(row, columns, search) && rowMatchesFilters(row, active)
  );
}
