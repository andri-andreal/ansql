/**
 * Pure SQL builders for the sequence designer.
 *
 * Design rules (mirroring routineBuilder.ts / triggerBuilder.ts):
 * - Pure functions only — no React, no Tauri calls.
 * - Identifier quoting delegates to `quoteIdent` from mutationBuilder.ts.
 * - Sequences exist on Postgres and SQL Server (MySQL/SQLite have no
 *   equivalent and the designer is never opened for them). The dialect defaults
 *   to `postgres` so existing Postgres call sites need no change.
 * - Numeric options are interpolated as numbers (never user-typed strings), so
 *   there is nothing to bind — every statement carries empty `params`.
 *
 * DDL shape (Postgres):
 *   CREATE SEQUENCE [IF NOT EXISTS] {name}
 *     [INCREMENT BY n] [MINVALUE m | NO MINVALUE] [MAXVALUE x | NO MAXVALUE]
 *     [START WITH s] [CACHE c] [CYCLE | NO CYCLE];
 *   ALTER SEQUENCE {name} … (same option clauses);
 *   DROP SEQUENCE IF EXISTS {name};
 *
 * DDL shape (SQL Server / T-SQL):
 *   CREATE SEQUENCE {name}
 *     [INCREMENT BY n] [MINVALUE m | NO MINVALUE] [MAXVALUE x | NO MAXVALUE]
 *     [START WITH s] [CACHE c] [CYCLE | NO CYCLE];
 *   ALTER SEQUENCE {name} … (a START becomes `RESTART WITH`);
 *   DROP SEQUENCE IF EXISTS {name};
 * T-SQL has no `IF NOT EXISTS` on CREATE SEQUENCE.
 */

import type { Dialect, Statement } from "../types";
import { quoteIdent } from "./mutationBuilder";

/** The dialects that support sequences. */
type SequenceDialect = Extract<Dialect, "postgres" | "sqlserver">;

export interface SequenceSpec {
  name: string;
  schema?: string | null;
  increment?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  start?: number | null;
  cache?: number | null;
  cycle?: boolean;
}

/**
 * Qualify a sequence name with an optional schema, each identifier quoted. A
 * null/empty schema yields a bare, quoted sequence name.
 */
function qualified(dialect: SequenceDialect, schema: string | null | undefined, name: string): string {
  if (schema) {
    return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, name)}`;
  }
  return quoteIdent(dialect, name);
}

/**
 * Build the option clauses shared by CREATE and ALTER.
 *
 * - `increment` / `start` / `cache` only emit a clause when a finite number is
 *   provided (null/undefined → omitted, falling back to defaults).
 * - `minValue` / `maxValue`: a finite number emits `MINVALUE`/`MAXVALUE`;
 *   `null` explicitly emits `NO MINVALUE`/`NO MAXVALUE`; `undefined` omits the
 *   clause entirely (leaving the current/default bound).
 * - `cycle` only emits a clause when it is a boolean (`CYCLE` / `NO CYCLE`).
 *
 * `startKeyword` is the keyword used for the start value: `START WITH` for
 * CREATE (both dialects), `RESTART WITH` for an SQL Server ALTER (T-SQL uses
 * RESTART to reset a sequence's current value).
 */
function optionClauses(spec: SequenceSpec, startKeyword = "START WITH"): string[] {
  const parts: string[] = [];

  if (isFiniteNumber(spec.increment)) {
    parts.push(`INCREMENT BY ${spec.increment}`);
  }

  if (spec.minValue === null) {
    parts.push("NO MINVALUE");
  } else if (isFiniteNumber(spec.minValue)) {
    parts.push(`MINVALUE ${spec.minValue}`);
  }

  if (spec.maxValue === null) {
    parts.push("NO MAXVALUE");
  } else if (isFiniteNumber(spec.maxValue)) {
    parts.push(`MAXVALUE ${spec.maxValue}`);
  }

  if (isFiniteNumber(spec.start)) {
    parts.push(`${startKeyword} ${spec.start}`);
  }

  if (isFiniteNumber(spec.cache)) {
    parts.push(`CACHE ${spec.cache}`);
  }

  if (typeof spec.cycle === "boolean") {
    parts.push(spec.cycle ? "CYCLE" : "NO CYCLE");
  }

  return parts;
}

/** A finite, non-null number (guards against null/undefined/NaN). */
function isFiniteNumber(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Build a `CREATE SEQUENCE …` statement from the spec. Option clauses are
 * appended in canonical order; absent options fall back to dialect defaults.
 *
 * Postgres emits `CREATE SEQUENCE IF NOT EXISTS …`; SQL Server (T-SQL) has no
 * `IF NOT EXISTS` on CREATE SEQUENCE, so it emits a plain `CREATE SEQUENCE …`.
 */
export function buildCreateSequence(
  spec: SequenceSpec,
  dialect: SequenceDialect = "postgres",
): Statement[] {
  const name = qualified(dialect, spec.schema, spec.name);
  const clauses = optionClauses(spec);
  const tail = clauses.length > 0 ? ` ${clauses.join(" ")}` : "";
  const ifNotExists = dialect === "sqlserver" ? "" : "IF NOT EXISTS ";
  return [{ sql: `CREATE SEQUENCE ${ifNotExists}${name}${tail}`, params: [] }];
}

/**
 * Build an `ALTER SEQUENCE …` statement from the spec. Only the option clauses
 * present in the spec are emitted; a no-op spec (name only) yields a bare
 * `ALTER SEQUENCE {name}`, which both dialects accept as a no-op.
 *
 * On SQL Server a start value is re-stated as `RESTART WITH` (T-SQL resets the
 * current value via RESTART, not START WITH).
 */
export function buildAlterSequence(
  spec: SequenceSpec,
  dialect: SequenceDialect = "postgres",
): Statement[] {
  const name = qualified(dialect, spec.schema, spec.name);
  const startKeyword = dialect === "sqlserver" ? "RESTART WITH" : "START WITH";
  const clauses = optionClauses(spec, startKeyword);
  const tail = clauses.length > 0 ? ` ${clauses.join(" ")}` : "";
  return [{ sql: `ALTER SEQUENCE ${name}${tail}`, params: [] }];
}

/**
 * Build a `DROP SEQUENCE IF EXISTS …` statement. `IF EXISTS` is supported on
 * Postgres and on SQL Server 2016+.
 */
export function buildDropSequence(
  schema: string | null | undefined,
  name: string,
  dialect: SequenceDialect = "postgres",
): Statement[] {
  return [{ sql: `DROP SEQUENCE IF EXISTS ${qualified(dialect, schema, name)}`, params: [] }];
}

/**
 * Query that lists the sequences in the current schema. Each row has a `name`
 * column.
 *
 * - Postgres: from `pg_sequences`, aliasing `sequencename`.
 * - SQL Server: from `sys.sequences` (objects in the connected database; the
 *   name alone is enough for the explorer/designer).
 */
export function listSequencesQuery(dialect: SequenceDialect = "postgres"): string {
  if (dialect === "sqlserver") {
    return "SELECT name FROM sys.sequences ORDER BY name";
  }
  return (
    "SELECT sequencename AS name FROM pg_sequences " +
    "WHERE schemaname = current_schema() ORDER BY sequencename"
  );
}
