/**
 * Pure SQL builders for the Trigger designer.
 *
 * Design rules (mirroring routineBuilder.ts / viewBuilder.ts):
 * - Pure functions only — no React, no Tauri calls.
 * - Identifier quoting delegates to `quoteIdent` from mutationBuilder.ts.
 * - Qualification mirrors the rest of the app: on MySQL the qualifier is the
 *   browsed database; on Postgres/SQL Server it is the schema. SQLite is
 *   typically unqualified.
 * - The trigger body the user authors in the editor is applied verbatim. For
 *   MySQL/SQLite it is the statement(s) that follow `FOR EACH ROW` (a single
 *   statement or a `BEGIN … END` block). For Postgres it is the body of the
 *   companion plpgsql function (between `BEGIN` and `END`). For SQL Server it is
 *   the statement(s) inside the trigger's `BEGIN … END` block.
 *
 * Per-dialect statement shapes:
 * - MySQL : `CREATE TRIGGER … {timing} {event} ON {table} FOR EACH ROW {body}`
 *           Exactly one event, no `WHEN`.
 * - SQLite: `CREATE TRIGGER … {timing} {event} ON {table} [FOR EACH ROW]
 *           [WHEN (…)] BEGIN {body} END`. Single event; supports `WHEN`.
 * - Postgres: a `CREATE OR REPLACE FUNCTION {name}_fn() RETURNS trigger …` pair
 *           with `CREATE TRIGGER … EXECUTE FUNCTION {name}_fn()`. Events joined
 *           by ` OR `; supports `WHEN`.
 * - SQL Server: `CREATE OR ALTER TRIGGER {name} ON {table} {AFTER|INSTEAD OF}
 *           {events} AS BEGIN {body} END`. Statement-level (no FOR EACH ROW, use
 *           the `inserted`/`deleted` pseudo-tables); events comma-joined; no
 *           `WHEN`; T-SQL has no `BEFORE`, so `BEFORE` is mapped to `AFTER`.
 */

import type { Dialect, Statement } from "../types";
import { quoteIdent } from "./mutationBuilder";

export type TriggerTiming = "BEFORE" | "AFTER" | "INSTEAD OF";
export type TriggerEvent = "INSERT" | "UPDATE" | "DELETE";

export interface TriggerSpec {
  name: string;
  table: string;
  schema?: string | null;
  timing: TriggerTiming;
  events: TriggerEvent[]; // MySQL: exactly one; SQLite/Postgres: one or more
  forEachRow: boolean; // always true for MySQL
  when?: string | null; // optional WHEN condition (SQLite/Postgres; MySQL has none)
  body: string; // trigger logic the user authors (PG: the plpgsql body between BEGIN..END)
}

/**
 * Qualify a name with an optional schema/database, each identifier quoted. On
 * MySQL `schema` is the database name; on Postgres it is the schema. A
 * null/empty qualifier yields a bare, quoted name.
 */
function qualified(dialect: Dialect, schema: string | null | undefined, name: string): string {
  if (schema) {
    return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, name)}`;
  }
  return quoteIdent(dialect, name);
}

/**
 * A starter trigger body the editor pre-fills in create mode. The user edits it
 * and it is applied verbatim.
 *
 * - Postgres: the plpgsql body between BEGIN..END — ends with `RETURN NEW;` so
 *   the companion function returns the row as a trigger function must.
 * - SQL Server: a single placeholder statement; the builder wraps it in
 *   `AS BEGIN … END`. T-SQL triggers are statement-level — use the
 *   `inserted`/`deleted` pseudo-tables rather than per-row NEW/OLD.
 * - MySQL/SQLite: a single placeholder statement.
 */
export function triggerTemplate(dialect: Dialect, table: string): string {
  if (dialect === "postgres") {
    return [
      `  -- trigger logic for ${table}`,
      "  RETURN NEW;",
    ].join("\n");
  }

  if (dialect === "mysql") {
    return [
      "BEGIN",
      `  -- trigger logic for ${table}`,
      "END",
    ].join("\n");
  }

  if (dialect === "sqlserver") {
    // Body goes inside the AS BEGIN … END block (added by the builder).
    return `  -- trigger logic for ${table} (use inserted/deleted pseudo-tables)`;
  }

  // sqlite — body goes between BEGIN … END (added by the builder).
  return `  -- trigger logic for ${table}`;
}

/**
 * Build the dialect-correct `CREATE TRIGGER` statement(s).
 *
 * - MySQL clamps `events` to its first entry (MySQL allows exactly one event
 *   per trigger) and ignores `when` (MySQL triggers have no `WHEN`).
 * - SQLite emits a single event, an optional `FOR EACH ROW`, an optional
 *   `WHEN (…)`, and wraps the body in `BEGIN … END`.
 * - SQL Server emits a single `CREATE OR ALTER TRIGGER … ON {table}
 *   {AFTER|INSTEAD OF} {events} AS BEGIN {body} END`; events are comma-joined,
 *   there is no `FOR EACH ROW`/`WHEN`, and `BEFORE` is mapped to `AFTER`.
 * - Postgres returns a `CREATE OR REPLACE FUNCTION …_fn()` / `CREATE TRIGGER …`
 *   pair; events are joined by ` OR `.
 */
export function buildCreateTrigger(dialect: Dialect, spec: TriggerSpec): Statement[] {
  const { name, table, schema, timing, events, forEachRow, when, body } = spec;
  const ident = quoteIdent(dialect, name);

  if (dialect === "mysql") {
    const qualifiedTable = qualified("mysql", schema, table);
    const event = events[0]; // MySQL: exactly one event
    const sql = `CREATE TRIGGER ${ident} ${timing} ${event} ON ${qualifiedTable} FOR EACH ROW ${body}`;
    return [{ sql, params: [] }];
  }

  if (dialect === "sqlserver") {
    const qualifiedTable = qualified("sqlserver", schema, table);
    // T-SQL has no BEFORE; only AFTER / INSTEAD OF. Events are comma-joined and
    // the trigger is statement-level (no FOR EACH ROW / WHEN).
    const tsqlTiming = timing === "INSTEAD OF" ? "INSTEAD OF" : "AFTER";
    const eventList = events.join(", ");
    const sql =
      `CREATE OR ALTER TRIGGER ${ident} ON ${qualifiedTable} ${tsqlTiming} ${eventList} AS BEGIN ${body} END`;
    return [{ sql, params: [] }];
  }

  if (dialect === "sqlite") {
    // SQLite is typically unqualified.
    const targetTable = quoteIdent("sqlite", table);
    const event = events[0];
    const parts = [`CREATE TRIGGER ${ident} ${timing} ${event} ON ${targetTable}`];
    if (forEachRow) parts.push("FOR EACH ROW");
    if (when) parts.push(`WHEN (${when})`);
    parts.push(`BEGIN ${body} END`);
    return [{ sql: parts.join(" "), params: [] }];
  }

  // postgres — function + trigger pair.
  const fnName = qualified("postgres", schema, `${name}_fn`);
  const qualifiedTable = qualified("postgres", schema, table);
  const eventList = events.join(" OR ");

  const fnSql =
    `CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger AS $$\n${body}\n$$ LANGUAGE plpgsql;`;

  const triggerParts = [
    `CREATE TRIGGER ${ident} ${timing} ${eventList} ON ${qualifiedTable}`,
    "FOR EACH ROW",
  ];
  if (when) triggerParts.push(`WHEN (${when})`);
  triggerParts.push(`EXECUTE FUNCTION ${fnName}();`);

  return [
    { sql: fnSql, params: [] },
    { sql: triggerParts.join(" "), params: [] },
  ];
}

/**
 * Build the `DROP TRIGGER` statement(s).
 *
 * - MySQL: `DROP TRIGGER IF EXISTS {schema}.{name}` (schema = database).
 * - SQLite: `DROP TRIGGER IF EXISTS {name}` (unqualified).
 * - SQL Server: `DROP TRIGGER IF EXISTS {schema}.{name}` — a DML trigger is
 *   namespaced by its schema, not its table, so the table is not referenced.
 * - Postgres: `DROP TRIGGER IF EXISTS {name} ON {qualifiedTable}` plus a
 *   `DROP FUNCTION IF EXISTS {name}_fn()` for the companion function created by
 *   `buildCreateTrigger` under the `<name>_fn` convention.
 */
export function buildDropTrigger(
  dialect: Dialect,
  name: string,
  table: string,
  schema?: string | null,
): Statement[] {
  const ident = quoteIdent(dialect, name);

  if (dialect === "mysql") {
    // MySQL triggers are namespaced by schema/database, not by table.
    const target = qualified("mysql", schema, name);
    return [{ sql: `DROP TRIGGER IF EXISTS ${target}`, params: [] }];
  }

  if (dialect === "sqlserver") {
    // SQL Server DML triggers are namespaced by schema, not by table.
    const target = qualified("sqlserver", schema, name);
    return [{ sql: `DROP TRIGGER IF EXISTS ${target}`, params: [] }];
  }

  if (dialect === "sqlite") {
    return [{ sql: `DROP TRIGGER IF EXISTS ${ident}`, params: [] }];
  }

  // postgres — drop the trigger (on its table) and the companion function.
  const qualifiedTable = qualified("postgres", schema, table);
  const fnName = qualified("postgres", schema, `${name}_fn`);
  return [
    { sql: `DROP TRIGGER IF EXISTS ${ident} ON ${qualifiedTable}`, params: [] },
    { sql: `DROP FUNCTION IF EXISTS ${fnName}()`, params: [] },
  ];
}
