/**
 * Pure SQL builders for the Function/Procedure (routine) editor.
 *
 * Design rules:
 * - Pure functions only — no React, no Tauri calls.
 * - Identifier quoting delegates to `quoteIdent` from mutationBuilder.ts; string
 *   literals (for information_schema lookups) use `quoteStringLiteral` from
 *   ddlBuilder.ts.
 * - Qualification mirrors the rest of the app: on MySQL the qualifier is the
 *   browsed database; on Postgres/SQL Server it is the schema (Postgres defaults
 *   to `public`, SQL Server to `dbo`).
 * - The routine body the user authors in the editor is the FULL `CREATE …`
 *   statement, applied verbatim — these builders only produce the scaffold,
 *   drop, list and definition-lookup SQL around it.
 *
 * SQLite has no stored functions/procedures, so every builder returns an empty
 * string / no-op for it (the editor is never opened on SQLite).
 *
 * SQL Server (T-SQL): `CREATE OR ALTER PROCEDURE|FUNCTION` with `@name TYPE`
 * parameters (OUTPUT for OUT/INOUT) and an `AS BEGIN … END` body. The `@` is
 * part of a parameter name, so parameter names are not bracket-quoted.
 */

import type { Dialect } from "../types";
import { quoteIdent } from "./mutationBuilder";
import { quoteStringLiteral } from "./ddlBuilder";

/** A routine is either a function (returns a value) or a procedure. */
export type RoutineKind = "function" | "procedure";

/**
 * A single routine parameter. `mode` is the SQL direction; it is always emitted
 * for procedures, but suppressed for MySQL functions (which only accept `IN`
 * parameters and reject the keyword in the signature).
 */
export interface RoutineParam {
  mode: "IN" | "OUT" | "INOUT";
  name: string;
  type: string;
}

/**
 * Qualify a routine name with an optional schema/database, each identifier
 * quoted. On MySQL `schema` is the database name; on Postgres it is the schema.
 * A null/empty qualifier yields a bare, quoted routine name.
 */
function qualified(dialect: Dialect, schema: string | null | undefined, name: string): string {
  if (schema) {
    return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, name)}`;
  }
  return quoteIdent(dialect, name);
}

/**
 * A starter `CREATE …` statement the editor pre-fills in create mode. The user
 * edits the whole thing (signature + body) and it is applied verbatim, so the
 * scaffold only needs to be a syntactically plausible starting point.
 *
 * SQLite returns "" — it has no stored routines and the editor is disabled there.
 */
export function routineTemplate(dialect: Dialect, kind: RoutineKind): string {
  if (dialect === "postgres") {
    if (kind === "procedure") {
      return [
        "CREATE OR REPLACE PROCEDURE procedure_name()",
        "LANGUAGE plpgsql",
        "AS $$",
        "BEGIN",
        "  -- procedure body",
        "END;",
        "$$;",
      ].join("\n");
    }
    return [
      "CREATE OR REPLACE FUNCTION function_name()",
      "RETURNS void",
      "LANGUAGE plpgsql",
      "AS $$",
      "BEGIN",
      "  -- function body",
      "END;",
      "$$;",
    ].join("\n");
  }

  if (dialect === "mysql") {
    if (kind === "procedure") {
      return [
        "CREATE PROCEDURE procedure_name()",
        "BEGIN",
        "  -- procedure body",
        "END",
      ].join("\n");
    }
    return [
      "CREATE FUNCTION function_name()",
      "RETURNS INT DETERMINISTIC",
      "BEGIN",
      "  -- function body",
      "  RETURN 0;",
      "END",
    ].join("\n");
  }

  if (dialect === "sqlserver") {
    if (kind === "procedure") {
      return [
        "CREATE OR ALTER PROCEDURE procedure_name",
        "AS",
        "BEGIN",
        "  -- procedure body",
        "END",
      ].join("\n");
    }
    return [
      "CREATE OR ALTER FUNCTION function_name()",
      "RETURNS INT",
      "AS",
      "BEGIN",
      "  -- function body",
      "  RETURN 0;",
      "END",
    ].join("\n");
  }

  // sqlite — no stored routines.
  return "";
}

/**
 * Render a single parameter as `<MODE> <name> <type>`, dialect-quoting the name.
 * The mode is omitted when `includeMode` is false (MySQL functions, which forbid
 * IN/OUT/INOUT). The type is emitted verbatim — it is a SQL type expression the
 * user controls, not an identifier.
 *
 * SQL Server (T-SQL) is special: a parameter is `@name TYPE`, with the `@`
 * forming part of the name (so it is NOT bracket-quoted), and OUT/INOUT modes
 * render as a trailing `OUTPUT` keyword rather than a leading IN/OUT/INOUT.
 */
function formatParam(dialect: Dialect, param: RoutineParam, includeMode: boolean): string {
  if (dialect === "sqlserver") {
    const type = param.type.trim();
    const output = param.mode === "OUT" || param.mode === "INOUT" ? " OUTPUT" : "";
    return `@${param.name} ${type}${output}`.trim();
  }
  const ident = quoteIdent(dialect, param.name);
  const type = param.type.trim();
  if (includeMode) {
    return `${param.mode} ${ident} ${type}`.trim();
  }
  return `${ident} ${type}`.trim();
}

/**
 * Build the `CREATE [OR REPLACE] {FUNCTION|PROCEDURE} <name>(<params>) [RETURNS …]`
 * header for a routine, dialect-correct:
 *
 * - Postgres functions emit `CREATE OR REPLACE FUNCTION name(params)` followed by
 *   `RETURNS <returnType>` (defaulting to `void` when none is given); procedures
 *   omit RETURNS. Parameters carry their IN/OUT/INOUT mode.
 * - MySQL functions emit `CREATE FUNCTION name(params)` + `RETURNS <returnType>`
 *   (defaulting to `INT`); parameters are `name type` only (no mode keyword).
 *   MySQL procedures emit `CREATE PROCEDURE name(params)` with no RETURNS, and
 *   parameters keep their mode.
 * - SQL Server functions emit `CREATE OR ALTER FUNCTION name(@p TYPE)` +
 *   `RETURNS <returnType>` (defaulting to `INT`); procedures emit
 *   `CREATE OR ALTER PROCEDURE name @p TYPE` — T-SQL procedure parameters take
 *   no surrounding parentheses. Parameters are `@name TYPE [OUTPUT]`.
 * - SQLite returns "" — it has no stored routines.
 *
 * The header is multi-line for Postgres/MySQL/SQL Server functions (RETURNS on
 * its own line), mirroring `routineTemplate`. `scaffoldRoutineBody` wraps it
 * with a body.
 */
export function buildRoutineSignature(
  dialect: Dialect,
  kind: RoutineKind,
  name: string,
  params: RoutineParam[],
  returnType?: string,
): string {
  if (dialect === "sqlite") return "";

  const ident = quoteIdent(dialect, name);

  if (dialect === "postgres") {
    const paramList = params.map((p) => formatParam("postgres", p, true)).join(", ");
    if (kind === "procedure") {
      return `CREATE OR REPLACE PROCEDURE ${ident}(${paramList})`;
    }
    const ret = returnType && returnType.trim().length > 0 ? returnType.trim() : "void";
    return `CREATE OR REPLACE FUNCTION ${ident}(${paramList})\nRETURNS ${ret}`;
  }

  if (dialect === "sqlserver") {
    const paramList = params.map((p) => formatParam("sqlserver", p, true)).join(", ");
    if (kind === "procedure") {
      // T-SQL procedure parameters are not wrapped in parentheses.
      const tail = paramList.length > 0 ? ` ${paramList}` : "";
      return `CREATE OR ALTER PROCEDURE ${ident}${tail}`;
    }
    const ret = returnType && returnType.trim().length > 0 ? returnType.trim() : "INT";
    return `CREATE OR ALTER FUNCTION ${ident}(${paramList})\nRETURNS ${ret}`;
  }

  // mysql
  if (kind === "procedure") {
    const paramList = params.map((p) => formatParam("mysql", p, true)).join(", ");
    return `CREATE PROCEDURE ${ident}(${paramList})`;
  }
  // MySQL functions forbid the IN/OUT/INOUT keyword on parameters.
  const paramList = params.map((p) => formatParam("mysql", p, false)).join(", ");
  const ret = returnType && returnType.trim().length > 0 ? returnType.trim() : "INT";
  return `CREATE FUNCTION ${ident}(${paramList})\nRETURNS ${ret}`;
}

/**
 * A full `CREATE …` scaffold built from `buildRoutineSignature` plus an empty
 * body, used in place of `routineTemplate` once the user has supplied parameters.
 * The body mirrors `routineTemplate`'s shape per dialect so the result is a
 * syntactically plausible starting point the user edits and applies verbatim.
 *
 * SQLite returns "".
 */
export function scaffoldRoutineBody(
  dialect: Dialect,
  kind: RoutineKind,
  name: string,
  params: RoutineParam[],
  returnType?: string,
): string {
  if (dialect === "sqlite") return "";

  const signature = buildRoutineSignature(dialect, kind, name, params, returnType);

  if (dialect === "postgres") {
    return [
      signature,
      "LANGUAGE plpgsql",
      "AS $$",
      "BEGIN",
      kind === "function" ? "  -- function body" : "  -- procedure body",
      "END;",
      "$$;",
    ].join("\n");
  }

  if (dialect === "sqlserver") {
    // T-SQL: `… AS BEGIN … END`; functions must RETURN a value.
    if (kind === "procedure") {
      return [signature, "AS", "BEGIN", "  -- procedure body", "END"].join("\n");
    }
    return [
      signature,
      "AS",
      "BEGIN",
      "  -- function body",
      "  RETURN 0;",
      "END",
    ].join("\n");
  }

  // mysql
  if (kind === "procedure") {
    return [signature, "BEGIN", "  -- procedure body", "END"].join("\n");
  }
  return [
    `${signature} DETERMINISTIC`,
    "BEGIN",
    "  -- function body",
    "  RETURN 0;",
    "END",
  ].join("\n");
}

/**
 * Build a `DROP {FUNCTION|PROCEDURE} IF EXISTS <qualified>` statement. The same
 * shape is correct for MySQL, Postgres and SQL Server (DROP … IF EXISTS is
 * supported on SQL Server 2016+).
 *
 * NOTE (Postgres): `DROP FUNCTION name` is ambiguous for overloaded functions —
 * Postgres may require the argument-type signature, e.g.
 * `DROP FUNCTION calc(int, text)`. For the MVP we emit the bare qualified name;
 * dropping an overloaded Postgres function may therefore fail and need a manual
 * signature.
 */
export function buildDropRoutine(
  dialect: Dialect,
  schema: string | null | undefined,
  name: string,
  kind: RoutineKind,
): string {
  if (dialect === "sqlite") return "";
  const keyword = kind === "procedure" ? "PROCEDURE" : "FUNCTION";
  return `DROP ${keyword} IF EXISTS ${qualified(dialect, schema, name)}`;
}

/**
 * Query that lists the routines (name + type) in a database/schema. Each row has
 * a `name` column and a `type` column whose value is `FUNCTION` or `PROCEDURE`.
 *
 * - MySQL reads information_schema.ROUTINES filtered by the database.
 * - Postgres reads pg_proc joined to pg_namespace, filtered by the schema
 *   (defaulting to `public`), mapping prokind → FUNCTION/PROCEDURE.
 * - SQL Server reads INFORMATION_SCHEMA.ROUTINES filtered by the schema
 *   (defaulting to `dbo`); ROUTINE_TYPE is already `FUNCTION`/`PROCEDURE`.
 * - SQLite returns "" (no routines).
 */
export function listRoutinesQuery(
  dialect: Dialect,
  database: string,
  schema?: string | null,
): string {
  if (dialect === "mysql") {
    return (
      "SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type " +
      "FROM information_schema.ROUTINES " +
      `WHERE ROUTINE_SCHEMA = ${quoteStringLiteral("mysql", database)}`
    );
  }

  if (dialect === "postgres") {
    const nsp = schema && schema.length > 0 ? schema : "public";
    return (
      "SELECT p.proname AS name, " +
      "CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS type " +
      "FROM pg_proc p " +
      "JOIN pg_namespace n ON n.oid = p.pronamespace " +
      `WHERE n.nspname = ${quoteStringLiteral("postgres", nsp)}`
    );
  }

  if (dialect === "sqlserver") {
    const nsp = schema && schema.length > 0 ? schema : "dbo";
    return (
      "SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type " +
      "FROM INFORMATION_SCHEMA.ROUTINES " +
      `WHERE ROUTINE_SCHEMA = ${quoteStringLiteral("sqlserver", nsp)}`
    );
  }

  // sqlite — no routines.
  return "";
}

/**
 * Query that returns the source definition of a single routine.
 *
 * - MySQL: `SHOW CREATE {FUNCTION|PROCEDURE} <qualified>` — the definition is in
 *   a column named `Create Function` / `Create Procedure`.
 * - Postgres: `SELECT pg_get_functiondef('<schema>.<name>'::regproc)` — returns
 *   the full `CREATE OR REPLACE FUNCTION …` text in a single column. The
 *   `::regproc` cast resolves by name; for OVERLOADED functions this is
 *   ambiguous and will error (acceptable MVP limitation).
 * - SQL Server: `SELECT OBJECT_DEFINITION(OBJECT_ID('<schema>.<name>')) AS
 *   definition` — returns the full `CREATE …` text the routine was created with.
 *   The schema defaults to `dbo`.
 * - SQLite returns "".
 */
export function getRoutineDefinitionQuery(
  dialect: Dialect,
  schema: string | null | undefined,
  name: string,
  kind: RoutineKind,
): string {
  if (dialect === "mysql") {
    const keyword = kind === "procedure" ? "PROCEDURE" : "FUNCTION";
    return `SHOW CREATE ${keyword} ${qualified(dialect, schema, name)}`;
  }

  if (dialect === "postgres") {
    // regproc resolves a routine by (schema-qualified) name. Build the dotted
    // name from raw identifiers and pass it as a single string literal.
    const dotted = schema ? `${schema}.${name}` : name;
    return `SELECT pg_get_functiondef(${quoteStringLiteral("postgres", dotted)}::regproc) AS definition`;
  }

  if (dialect === "sqlserver") {
    // OBJECT_ID resolves a (schema-qualified) object name; OBJECT_DEFINITION
    // returns its source text. Schema defaults to dbo.
    const dotted = schema && schema.length > 0 ? `${schema}.${name}` : name;
    return `SELECT OBJECT_DEFINITION(OBJECT_ID(${quoteStringLiteral("sqlserver", dotted)})) AS definition`;
  }

  // sqlite — no routines.
  return "";
}
