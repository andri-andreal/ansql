/**
 * Pure SELECT-statement builder for the visual query builder panel.
 *
 * Design rules:
 * - Pure function only — no React, no Tauri calls.
 * - Identifier quoting delegates to `quoteIdent` from mutationBuilder.ts; column
 *   references are emitted as `table.column` (each part quoted per dialect).
 * - Unlike the parameterized whereBuilder, this produces a ready-to-edit SQL
 *   TEXT string for the editor, so filter operands become inline SQL string
 *   literals (single quotes doubled; backslashes doubled on MySQL only). They
 *   must therefore come from the trusted builder UI, never from untrusted row
 *   data.
 * - Row caps are dialect-correct: MySQL/Postgres/SQLite use a trailing
 *   `LIMIT n`; SQL Server (which has neither LIMIT nor a stable trailing clause)
 *   uses `TOP n` right after `SELECT [DISTINCT]`, which needs no ORDER BY.
 * - Filter operators mirror gridFilter semantics: contains/starts_with/ends_with
 *   map to LIKE with wildcard wrapping; equals/not_equals/gt/gte/lt/lte map to
 *   their SQL operators; is_null / is_not_null emit valueless conditions.
 */

import type { Dialect } from "../types";
import type { FilterOperator } from "./gridFilter";
import { VALUELESS_OPERATORS } from "./gridFilter";
import { quoteIdent } from "./mutationBuilder";

export interface BuilderColumn {
  table: string;
  column: string;
  alias?: string | null;
}

export interface BuilderJoin {
  kind: "INNER" | "LEFT" | "RIGHT";
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
}

export interface BuilderFilter {
  table: string;
  column: string;
  operator: FilterOperator;
  value: string;
  combinator?: "AND" | "OR";
}

export interface BuilderSort {
  table: string;
  column: string;
  direction: "asc" | "desc";
}

export interface QueryBuilderSpec {
  fromTable: string;
  fromSchema?: string | null;
  selectedColumns: BuilderColumn[];
  joins: BuilderJoin[];
  filters: BuilderFilter[];
  sorts: BuilderSort[];
  limit?: number | null;
  distinct?: boolean;
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

/**
 * Render a string operand as an inline SQL literal (single-quoted, escaped).
 * A single quote is doubled in every dialect; only MySQL additionally treats a
 * backslash as an escape character, so it is doubled there. Postgres, SQLite and
 * SQL Server take the literal verbatim aside from the quote doubling.
 */
function stringLiteral(dialect: Dialect, value: string): string {
  let escaped = value.replace(/'/g, "''");
  if (dialect === "mysql") escaped = escaped.replace(/\\/g, "\\\\");
  return "'" + escaped + "'";
}

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

/** Quote a `table.column` reference, each part escaped per dialect. */
function columnRef(dialect: Dialect, table: string, column: string): string {
  return `${quoteIdent(dialect, table)}.${quoteIdent(dialect, column)}`;
}

/** Render the FROM target, qualifying with the schema when present. */
function qualifiedFrom(dialect: Dialect, table: string, schema?: string | null): string {
  if (schema) {
    return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, table)}`;
  }
  return quoteIdent(dialect, table);
}

/** Build the SELECT projection list. Empty selection -> `*`. */
function buildSelectList(dialect: Dialect, columns: BuilderColumn[]): string {
  if (columns.length === 0) return "*";
  return columns
    .map((c) => {
      const ref = columnRef(dialect, c.table, c.column);
      return c.alias ? `${ref} AS ${quoteIdent(dialect, c.alias)}` : ref;
    })
    .join(", ");
}

/** Build the JOIN clauses (one per spec) as `<KIND> JOIN <table> ON <l> = <r>`. */
function buildJoins(dialect: Dialect, joins: BuilderJoin[]): string[] {
  return joins.map((j) => {
    const left = columnRef(dialect, j.leftTable, j.leftColumn);
    const right = columnRef(dialect, j.rightTable, j.rightColumn);
    return `${j.kind} JOIN ${quoteIdent(dialect, j.rightTable)} ON ${left} = ${right}`;
  });
}

/** Build one filter condition, or null if the operator/value is unusable. */
function buildCondition(dialect: Dialect, f: BuilderFilter): string | null {
  const ident = columnRef(dialect, f.table, f.column);

  if (VALUELESS_OPERATORS.has(f.operator)) {
    return f.operator === "is_null" ? `${ident} IS NULL` : `${ident} IS NOT NULL`;
  }

  if (f.operator === "contains" || f.operator === "starts_with" || f.operator === "ends_with") {
    return `${ident} LIKE ${stringLiteral(dialect, likeOperand(f.operator, f.value))}`;
  }

  const op = COMPARISON_SQL[f.operator];
  if (!op) return null;
  return `${ident} ${op} ${stringLiteral(dialect, f.value)}`;
}

/**
 * Build the WHERE tail. Conditions are joined using each filter's own
 * `combinator` (the combinator stored on a filter applies to the join BEFORE
 * it; the first filter's combinator is ignored). Returns "" when no condition
 * is produced.
 */
function buildWhere(dialect: Dialect, filters: BuilderFilter[]): string {
  const parts: string[] = [];
  for (const f of filters) {
    const cond = buildCondition(dialect, f);
    if (cond === null) continue;
    if (parts.length === 0) {
      parts.push(cond);
    } else {
      parts.push(`${f.combinator === "OR" ? "OR" : "AND"} ${cond}`);
    }
  }
  if (parts.length === 0) return "";
  return `WHERE ${parts.join(" ")}`;
}

/** Build the ORDER BY tail, or "" when there are no sorts. */
function buildOrderBy(dialect: Dialect, sorts: BuilderSort[]): string {
  if (sorts.length === 0) return "";
  const parts = sorts.map((s) => {
    const dir = s.direction === "desc" ? "DESC" : "ASC";
    return `${columnRef(dialect, s.table, s.column)} ${dir}`;
  });
  return `ORDER BY ${parts.join(", ")}`;
}

/**
 * Build a dialect-correct SELECT statement from a {@link QueryBuilderSpec}.
 *
 * Output shape (clauses omitted when empty):
 *   SELECT [DISTINCT] [TOP n] <cols|*>   -- TOP n only on SQL Server
 *   FROM <schema.>table
 *   [<KIND> JOIN table ON l = r ...]
 *   [WHERE cond [AND|OR cond ...]]
 *   [ORDER BY ref dir, ...]
 *   [LIMIT n]                            -- LIMIT n on MySQL/Postgres/SQLite
 * and is terminated with a single trailing `;`.
 *
 * SQL Server has no LIMIT clause, so the row cap is emitted as `TOP n` right
 * after `SELECT [DISTINCT]` (this needs no ORDER BY, unlike OFFSET/FETCH).
 */
export function buildSelectQuery(dialect: Dialect, spec: QueryBuilderSpec): string {
  const select = buildSelectList(dialect, spec.selectedColumns);
  const distinct = spec.distinct ? "DISTINCT " : "";
  const from = qualifiedFrom(dialect, spec.fromTable, spec.fromSchema);

  const hasLimit =
    spec.limit != null && Number.isFinite(spec.limit) && spec.limit >= 0;
  const limit = hasLimit ? Math.floor(spec.limit as number) : null;

  // SQL Server caps rows with `TOP n` after the verb (it has no LIMIT clause).
  const top = dialect === "sqlserver" && limit != null ? `TOP ${limit} ` : "";

  const lines: string[] = [`SELECT ${distinct}${top}${select}`, `FROM ${from}`];

  for (const join of buildJoins(dialect, spec.joins)) {
    lines.push(join);
  }

  const where = buildWhere(dialect, spec.filters);
  if (where) lines.push(where);

  const orderBy = buildOrderBy(dialect, spec.sorts);
  if (orderBy) lines.push(orderBy);

  // Other dialects use a trailing LIMIT; SQL Server already emitted TOP above.
  if (limit != null && dialect !== "sqlserver") {
    lines.push(`LIMIT ${limit}`);
  }

  return `${lines.join("\n")};`;
}
