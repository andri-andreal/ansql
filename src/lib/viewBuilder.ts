/**
 * Pure SQL builders for the View Designer.
 *
 * Design rules:
 * - Pure functions only — no React, no Tauri calls.
 * - Identifier quoting delegates to `quoteIdent` from mutationBuilder.ts.
 * - The view body is user-authored SQL (a SELECT). It is inserted verbatim — it
 *   is NOT parameterized or escaped, by design.
 * - Qualification mirrors the rest of the app: on MySQL the qualifier is the
 *   browsed database; on Postgres/SQLite/SQL Server it is the schema (or null →
 *   unqualified).
 */

import type { Dialect, Statement } from "../types";
import { quoteIdent } from "./mutationBuilder";

/**
 * Qualify a view name with an optional schema/database, each identifier quoted.
 * On MySQL `schema` is the database name; on Postgres/SQLite it is the schema.
 * A null/empty qualifier yields a bare, quoted view name.
 */
function qualified(dialect: Dialect, schema: string | null | undefined, name: string): string {
  if (schema) {
    return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, name)}`;
  }
  return quoteIdent(dialect, name);
}

/**
 * Build the statement(s) that (re)create a view.
 *
 * MySQL & Postgres support `CREATE OR REPLACE VIEW`, so a single statement is
 * enough. SQL Server supports `CREATE OR ALTER VIEW` (2016 SP1+), the T-SQL
 * equivalent. SQLite has no OR REPLACE for views, so it is emitted as two
 * statements: `DROP VIEW IF EXISTS …` followed by `CREATE VIEW …`.
 *
 * `body` is the user-authored SELECT and is inserted verbatim.
 *
 * `withCheckOption` appends `WITH CHECK OPTION` (so INSERT/UPDATE through the
 * view must satisfy its WHERE clause). It is supported on MySQL, Postgres and
 * SQL Server; SQLite views are read-only, so the flag is ignored there.
 */
export function buildCreateView(
  dialect: Dialect,
  schema: string | null | undefined,
  name: string,
  body: string,
  withCheckOption = false,
): Statement[] {
  const target = qualified(dialect, schema, name);

  if (dialect === "sqlite") {
    // SQLite views are read-only — WITH CHECK OPTION does not apply.
    return [
      { sql: `DROP VIEW IF EXISTS ${target}`, params: [] },
      { sql: `CREATE VIEW ${target} AS ${body}`, params: [] },
    ];
  }

  const checkOption = withCheckOption ? " WITH CHECK OPTION" : "";

  if (dialect === "sqlserver") {
    // T-SQL has no `OR REPLACE`; `CREATE OR ALTER VIEW` is the equivalent.
    return [
      { sql: `CREATE OR ALTER VIEW ${target} AS ${body}${checkOption}`, params: [] },
    ];
  }

  // mysql + postgres
  return [
    { sql: `CREATE OR REPLACE VIEW ${target} AS ${body}${checkOption}`, params: [] },
  ];
}

/** Build a `DROP VIEW IF EXISTS <qualified>` statement. */
export function buildDropView(
  dialect: Dialect,
  schema: string | null | undefined,
  name: string,
): Statement {
  return { sql: `DROP VIEW IF EXISTS ${qualified(dialect, schema, name)}`, params: [] };
}

// ---------------------------------------------------------------------------
// Materialized views (Postgres only)
//
// MySQL, SQLite and SQL Server have no native materialized views (SQL Server's
// indexed views are out of scope). For those dialects the builders below emit a
// single statement whose SQL is a SQL comment explaining that the feature is
// unsupported — applying it is a harmless no-op rather than an error, so the
// designer's preview/apply flow stays uniform.
// ---------------------------------------------------------------------------

/** A `-- comment` statement used to signal an unsupported-dialect no-op. */
function unsupportedComment(feature: string): Statement {
  return {
    sql: `-- ${feature} are only supported on PostgreSQL`,
    params: [],
  };
}

/**
 * Build the statement(s) that create a materialized view (Postgres only).
 *
 * Postgres: `CREATE MATERIALIZED VIEW <qualified> AS <selectBody> WITH [NO]
 * DATA`. `withData` defaults to true (populate on creation); false emits
 * `WITH NO DATA`, leaving the matview unscannable until refreshed.
 *
 * MySQL / SQLite: no native materialized views — returns a single comment
 * statement (see module note above).
 *
 * `selectBody` is the user-authored SELECT and is inserted verbatim.
 */
export function buildCreateMaterializedView(
  dialect: Dialect,
  schema: string | null | undefined,
  name: string,
  selectBody: string,
  withData = true,
): Statement[] {
  if (dialect !== "postgres") {
    return [unsupportedComment("Materialized views")];
  }
  const target = qualified(dialect, schema, name);
  const dataClause = withData ? " WITH DATA" : " WITH NO DATA";
  return [
    {
      sql: `CREATE MATERIALIZED VIEW ${target} AS ${selectBody}${dataClause}`,
      params: [],
    },
  ];
}

/**
 * Build a `REFRESH MATERIALIZED VIEW [CONCURRENTLY] <qualified>` statement
 * (Postgres only). `CONCURRENTLY` avoids locking out reads but requires a
 * unique index on the matview.
 *
 * MySQL / SQLite: returns a single comment statement (see module note above).
 */
export function buildRefreshMaterializedView(
  dialect: Dialect,
  schema: string | null | undefined,
  name: string,
  concurrently = false,
): Statement {
  if (dialect !== "postgres") {
    return unsupportedComment("Materialized views");
  }
  const target = qualified(dialect, schema, name);
  const concurrentClause = concurrently ? "CONCURRENTLY " : "";
  return {
    sql: `REFRESH MATERIALIZED VIEW ${concurrentClause}${target}`,
    params: [],
  };
}

/**
 * Build a `DROP MATERIALIZED VIEW IF EXISTS <qualified>` statement (Postgres
 * only). MySQL / SQLite: returns a single comment statement.
 */
export function buildDropMaterializedView(
  dialect: Dialect,
  schema: string | null | undefined,
  name: string,
): Statement {
  if (dialect !== "postgres") {
    return unsupportedComment("Materialized views");
  }
  return {
    sql: `DROP MATERIALIZED VIEW IF EXISTS ${qualified(dialect, schema, name)}`,
    params: [],
  };
}

/**
 * Query that lists the materialized views in the current schema (Postgres
 * only). Each row has a `name` column.
 *
 * Returns "" for MySQL, SQLite and SQL Server, which have no materialized
 * views — mirrors `listRoutinesQuery` returning "" for unsupported dialects.
 */
export function listMaterializedViewsQuery(dialect: Dialect): string {
  if (dialect !== "postgres") return "";
  return (
    "SELECT matviewname AS name FROM pg_matviews " +
    "WHERE schemaname = current_schema()"
  );
}
