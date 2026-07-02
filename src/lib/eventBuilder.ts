/**
 * Pure SQL builders for the MySQL EVENT (scheduled-event) designer.
 *
 * Design rules (mirroring routineBuilder.ts / triggerBuilder.ts):
 * - Pure functions only — no React, no Tauri calls.
 * - Identifier quoting delegates to `quoteIdent` from mutationBuilder.ts; string
 *   literals (schedule timestamps, comments, information_schema lookups) use
 *   `quoteStringLiteral` from ddlBuilder.ts.
 * - The event body the user authors in the editor is the statement(s) that
 *   follow `DO` — a single statement or a `BEGIN … END` block — applied verbatim.
 *
 * MySQL-only: scheduled events do not exist in Postgres, SQLite or SQL Server,
 * so this module is never invoked for those dialects (the designer is gated to
 * MySQL). SQL Server schedules recurring work through SQL Agent jobs, which are
 * out of scope here; for `dialect === "sqlserver"` the build* functions return
 * no statements and `listEventsQuery` returns "". The dialect defaults to
 * `mysql` so existing MySQL call sites need no change.
 *
 * Schedule shapes:
 * - "at"   → `ON SCHEDULE AT '{ts}'`            (one-shot at a timestamp)
 * - "every"→ `ON SCHEDULE EVERY {n} {UNIT}`     (recurring interval)
 */

import type { Dialect, Statement } from "../types";
import { quoteIdent } from "./mutationBuilder";
import { quoteStringLiteral } from "./ddlBuilder";

/** The dialect(s) that support scheduled events. */
type EventDialect = Extract<Dialect, "mysql" | "sqlserver">;

/** Units accepted by a MySQL `EVERY {n} {unit}` schedule clause. */
export type EventInterval =
  | "SECOND"
  | "MINUTE"
  | "HOUR"
  | "DAY"
  | "WEEK"
  | "MONTH";

/** Alias for {@link EventInterval} — consumed by the EventDesigner UI. */
export type EventIntervalUnit = EventInterval;

/** The two MySQL event schedule shapes: one-shot `AT` vs recurring `EVERY`. */
export type EventScheduleKind = "at" | "every";

export interface EventSpec {
  name: string;
  scheduleKind: "at" | "every";
  /** Required when scheduleKind === "at": the timestamp literal, e.g. `2026-06-15 12:00:00`. */
  at?: string;
  /** Required when scheduleKind === "every": the interval count. */
  everyValue?: number;
  /** Required when scheduleKind === "every": the interval unit. */
  everyUnit?: EventInterval;
  /** ENABLE vs DISABLE. */
  enabled: boolean;
  /** ON COMPLETION PRESERVE (true) vs NOT PRESERVE (false/undefined → NOT PRESERVE). */
  preserve?: boolean;
  /** Optional COMMENT. */
  comment?: string | null;
  /** The statement(s) after `DO` the user authors — applied verbatim. */
  body: string;
}

/** Treat ''/null/undefined as "no comment". */
function hasComment(comment: string | null | undefined): comment is string {
  return comment != null && comment !== "";
}

/**
 * Render the `ON SCHEDULE …` clause for a spec.
 * - "at"   → `ON SCHEDULE AT '<ts>'`
 * - "every"→ `ON SCHEDULE EVERY <n> <UNIT>`
 */
function scheduleClause(spec: EventSpec): string {
  if (spec.scheduleKind === "at") {
    return `ON SCHEDULE AT ${quoteStringLiteral("mysql", spec.at ?? "")}`;
  }
  const value = spec.everyValue ?? 1;
  const unit = spec.everyUnit ?? "DAY";
  return `ON SCHEDULE EVERY ${value} ${unit}`;
}

/**
 * A starter event body the editor pre-fills in create mode. The user edits it
 * and it is applied verbatim after `DO`.
 */
export function eventTemplate(): string {
  return ["BEGIN", "  -- event body", "END"].join("\n");
}

/**
 * Render the shared `… <schedule> ON COMPLETION … <status> [COMMENT …] DO <body>`
 * tail used by both CREATE and ALTER.
 */
function eventTail(spec: EventSpec): string {
  const parts = [
    scheduleClause(spec),
    `ON COMPLETION ${spec.preserve ? "PRESERVE" : "NOT PRESERVE"}`,
    spec.enabled ? "ENABLE" : "DISABLE",
  ];
  if (hasComment(spec.comment)) {
    parts.push(`COMMENT ${quoteStringLiteral("mysql", spec.comment)}`);
  }
  parts.push(`DO ${spec.body}`);
  return parts.join("\n");
}

/**
 * Build a `CREATE EVENT IF NOT EXISTS {name} …` statement.
 *
 * The event is unqualified — MySQL creates it in the current/connection
 * database, mirroring how the routine/trigger designers operate on the browsed
 * database.
 *
 * SQL Server has no scheduled events (SQL Agent jobs are out of scope), so it
 * returns no statements.
 */
export function buildCreateEvent(spec: EventSpec, dialect: EventDialect = "mysql"): Statement[] {
  if (dialect === "sqlserver") return [];
  const sql = `CREATE EVENT IF NOT EXISTS ${quoteIdent("mysql", spec.name)}\n${eventTail(spec)}`;
  return [{ sql, params: [] }];
}

/**
 * Build an `ALTER EVENT {name} …` statement. ALTER re-states the full schedule,
 * completion, status, comment and body so the edit is a complete replacement of
 * the event's definition.
 *
 * SQL Server returns no statements (see {@link buildCreateEvent}).
 */
export function buildAlterEvent(spec: EventSpec, dialect: EventDialect = "mysql"): Statement[] {
  if (dialect === "sqlserver") return [];
  const sql = `ALTER EVENT ${quoteIdent("mysql", spec.name)}\n${eventTail(spec)}`;
  return [{ sql, params: [] }];
}

/**
 * Build a `DROP EVENT IF EXISTS {name}` statement.
 *
 * SQL Server returns no statements (see {@link buildCreateEvent}).
 */
export function buildDropEvent(name: string, dialect: EventDialect = "mysql"): Statement[] {
  if (dialect === "sqlserver") return [];
  return [{ sql: `DROP EVENT IF EXISTS ${quoteIdent("mysql", name)}`, params: [] }];
}

/**
 * Query that lists the events in a database from `information_schema.EVENTS`.
 * Each row exposes the name, type, interval, status and definition so the
 * explorer/designer can populate an EventSpec without a second round-trip.
 *
 * SQL Server has no scheduled events, so it returns "" (mirroring the other
 * builders' "unsupported dialect" convention).
 */
export function listEventsQuery(database: string, dialect: EventDialect = "mysql"): string {
  if (dialect === "sqlserver") return "";
  return (
    "SELECT EVENT_NAME AS name, EVENT_TYPE AS type, " +
    "INTERVAL_VALUE AS interval_value, INTERVAL_FIELD AS interval_field, " +
    "STATUS AS status, ON_COMPLETION AS on_completion, " +
    "EVENT_COMMENT AS comment, EVENT_DEFINITION AS definition " +
    "FROM information_schema.EVENTS " +
    `WHERE EVENT_SCHEMA = ${quoteStringLiteral("mysql", database)}`
  );
}
