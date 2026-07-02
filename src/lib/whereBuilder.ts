import type { ColumnFilter, FilterOperator } from "./gridFilter";
import { VALUELESS_OPERATORS, isFilterActive } from "./gridFilter";
import { coerceValue, quoteIdent } from "./mutationBuilder";
import type { Dialect, MutationColumn, ParamValue } from "../types";

/**
 * Pure builders that turn grid sort/filter state into a parameterized SQL
 * WHERE / ORDER BY tail for server-side filtered loads.
 *
 * Design rules (mirroring mutationBuilder):
 * - Comparison operands are NEVER string-interpolated into SQL. Every operand
 *   becomes a bound parameter; placeholders are dialect-correct (`?` for
 *   MySQL/SQLite, `$1..$n` for Postgres, `@P1..@Pn` for SQL Server).
 * - Valueless operators (is_null / is_not_null) emit pure SQL with no param.
 * - LIKE operators keep a plain placeholder in the SQL; the wildcard-wrapped
 *   string is what lands in `params`.
 */

export interface SortSpec {
  column: string;
  direction: "asc" | "desc";
}

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

/** Binary comparison operators mapped to their SQL operator. */
const COMPARISON_SQL: Partial<Record<FilterOperator, string>> = {
  equals: "=",
  not_equals: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

/** Wrap a LIKE operand with the wildcards appropriate for the operator. */
function likeOperand(operator: FilterOperator, value: string): string {
  switch (operator) {
    case "contains":
      return `%${value}%`;
    case "starts_with":
      return `${value}%`;
    case "ends_with":
      return `%${value}`;
    default:
      return value;
  }
}

/**
 * Build an ORDER BY tail from sort specs. Returns "" for no sorts, otherwise
 * `ORDER BY <ident> ASC, <ident> DESC` with each column quoted per dialect.
 */
export function buildOrderBy(sorts: SortSpec[], dialect: Dialect): string {
  if (sorts.length === 0) return "";
  const parts = sorts.map((s) => {
    const dir = s.direction === "desc" ? "DESC" : "ASC";
    return `${quoteIdent(dialect, s.column)} ${dir}`;
  });
  return `ORDER BY ${parts.join(", ")}`;
}

/**
 * Build a parameterized WHERE tail from active column filters, joined by the
 * chosen combinator. Returns `{ sql: "", params: [] }` when no filter is active;
 * otherwise `sql` is `WHERE (cond AND/OR cond ...)`. Operands are bound through
 * dialect-correct placeholders; valueless operators emit no parameter.
 */
export function buildWhere(
  filters: ColumnFilter[],
  combinator: "AND" | "OR",
  dialect: Dialect,
  columns: MutationColumn[],
): { sql: string; params: ParamValue[] } {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const params: ParamValue[] = [];
  const ph = new Placeholders(dialect);
  const conditions: string[] = [];

  for (const f of filters) {
    if (!isFilterActive(f)) continue;
    const ident = quoteIdent(dialect, f.column);

    if (VALUELESS_OPERATORS.has(f.operator)) {
      conditions.push(f.operator === "is_null" ? `${ident} IS NULL` : `${ident} IS NOT NULL`);
      continue;
    }

    const col = byName.get(f.column) ?? { name: f.column, data_type: "text" };

    if (f.operator === "contains" || f.operator === "starts_with" || f.operator === "ends_with") {
      params.push(likeOperand(f.operator, f.value));
      conditions.push(`${ident} LIKE ${ph.next()}`);
      continue;
    }

    const op = COMPARISON_SQL[f.operator];
    if (!op) continue;
    params.push(coerceValue(col, f.value));
    conditions.push(`${ident} ${op} ${ph.next()}`);
  }

  if (conditions.length === 0) return { sql: "", params: [] };
  return { sql: `WHERE (${conditions.join(` ${combinator} `)})`, params };
}
