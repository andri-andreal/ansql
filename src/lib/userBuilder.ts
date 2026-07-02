/**
 * Pure SQL builders for the User/Role manager.
 *
 * SECURITY: Passwords cannot be bound as parameters in `CREATE USER` /
 * `ALTER USER` / `CREATE ROLE`, so they MUST be interpolated as escaped string
 * literals. All literal escaping goes through `quoteStringLiteral` (which doubles
 * `'` everywhere and `\` on MySQL); identifiers go through `quoteIdent`. Nothing
 * here is ever concatenated raw.
 *
 * Per-dialect identifier/literal model:
 * - MySQL: the user is `'name'@'host'` — both `name` and `host` are *string
 *   literals* (not identifiers), single-quoted via `quoteStringLiteral`.
 * - Postgres: roles are identifiers, double-quoted via `quoteIdent`.
 * - SQLServer: users/roles are identifiers, bracket-quoted via `quoteIdent`
 *   (`[name]`). A contained-database user is `CREATE USER [name] WITH PASSWORD =
 *   'pw'`; role membership uses `ALTER ROLE [r] ADD/DROP MEMBER [u]`.
 * - SQLite: has no concept of users/roles — every builder throws.
 *
 * Design rules:
 * - Pure functions only — no React, no Tauri calls.
 * - Reject control characters (incl. NUL, newline) in names/hosts/passwords so a
 *   value can never break out of the literal/identifier or inject a statement.
 */

import type { Dialect, Statement } from "../types";
import { quoteStringLiteral } from "./ddlBuilder";
import { quoteIdent } from "./mutationBuilder";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateUserInput {
  name: string;
  /** MySQL only; defaults to "%". Ignored by Postgres. */
  host?: string;
  password: string;
}

export interface DropUserInput {
  name: string;
  host?: string;
}

export interface SetPasswordInput {
  name: string;
  host?: string;
  password: string;
}

export interface GrantInput {
  privileges: string[];
  /**
   * A caller-built, already-quoted scope spec, e.g. MySQL `` `db`.* `` / `*.*`,
   * Postgres `DATABASE "db"` / `ALL TABLES IN SCHEMA "public"`. For a column-level
   * grant the scope is a table spec, e.g. `` `db`.`t` `` / `"schema"."t"`.
   */
  scope: string;
  /**
   * Optional column-level scope. When non-empty each privilege is restricted to
   * these columns, rendered as `SELECT (col1, col2)` — a column-level grant that
   * both MySQL and Postgres accept on a table scope. Columns are quoted as
   * identifiers. Ignored when empty/omitted.
   */
  columns?: string[];
  name: string;
  host?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DEFAULT_HOST = "%";

/**
 * Reject control characters (anything < 0x20 plus DEL 0x7F). These can't be
 * safely escaped into a single-line SQL literal/identifier and have no business
 * in a user name, host, or password.
 */
function assertNoControlChars(value: string, label: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // C0 controls (incl. NUL, newline, tab) and DEL.
    if (code < 0x20 || code === 0x7f) {
      throw new Error(`${label} must not contain control characters`);
    }
  }
}

function assertNotSqlite(dialect: Dialect): void {
  if (dialect === "sqlite") {
    throw new Error("SQLite has no users or roles");
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim() === "") {
    throw new Error(`${label} is required`);
  }
}

/** Render the MySQL `'name'@'host'` actor as escaped string literals. */
function mysqlActor(dialect: Dialect, name: string, host: string | undefined): string {
  const h = host && host.trim() !== "" ? host : DEFAULT_HOST;
  assertNoControlChars(h, "Host");
  return `${quoteStringLiteral(dialect, name)}@${quoteStringLiteral(dialect, h)}`;
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export function buildCreateUser(dialect: Dialect, input: CreateUserInput): string {
  assertNotSqlite(dialect);
  assertNonEmpty(input.name, "User name");
  assertNonEmpty(input.password, "Password");
  assertNoControlChars(input.name, "User name");
  assertNoControlChars(input.password, "Password");

  const pw = quoteStringLiteral(dialect, input.password);

  if (dialect === "mysql") {
    return `CREATE USER ${mysqlActor(dialect, input.name, input.host)} IDENTIFIED BY ${pw}`;
  }
  if (dialect === "sqlserver") {
    // Contained-database user with its own password (no separate LOGIN needed).
    return `CREATE USER ${quoteIdent(dialect, input.name)} WITH PASSWORD = ${pw}`;
  }
  // postgres
  return `CREATE ROLE ${quoteIdent(dialect, input.name)} LOGIN PASSWORD ${pw}`;
}

// ---------------------------------------------------------------------------
// DROP
// ---------------------------------------------------------------------------

export function buildDropUser(dialect: Dialect, input: DropUserInput): string {
  assertNotSqlite(dialect);
  assertNonEmpty(input.name, "User name");
  assertNoControlChars(input.name, "User name");

  if (dialect === "mysql") {
    return `DROP USER ${mysqlActor(dialect, input.name, input.host)}`;
  }
  if (dialect === "sqlserver") {
    return `DROP USER ${quoteIdent(dialect, input.name)}`;
  }
  return `DROP ROLE ${quoteIdent(dialect, input.name)}`;
}

// ---------------------------------------------------------------------------
// SET PASSWORD
// ---------------------------------------------------------------------------

export function buildSetPassword(dialect: Dialect, input: SetPasswordInput): string {
  assertNotSqlite(dialect);
  assertNonEmpty(input.name, "User name");
  assertNonEmpty(input.password, "Password");
  assertNoControlChars(input.name, "User name");
  assertNoControlChars(input.password, "Password");

  const pw = quoteStringLiteral(dialect, input.password);

  if (dialect === "mysql") {
    return `ALTER USER ${mysqlActor(dialect, input.name, input.host)} IDENTIFIED BY ${pw}`;
  }
  if (dialect === "sqlserver") {
    return `ALTER USER ${quoteIdent(dialect, input.name)} WITH PASSWORD = ${pw}`;
  }
  return `ALTER ROLE ${quoteIdent(dialect, input.name)} PASSWORD ${pw}`;
}

// ---------------------------------------------------------------------------
// GRANT / REVOKE
// ---------------------------------------------------------------------------

/**
 * Validate + render the privilege list. The scope is caller-built and already
 * quoted. When `columns` is non-empty each privilege is suffixed with a quoted
 * `(col1, col2)` column list, producing a column-level grant.
 */
function renderPrivileges(
  dialect: Dialect,
  privileges: string[],
  columns?: string[],
): string {
  const cleaned = privileges.map((p) => p.trim()).filter((p) => p !== "");
  if (cleaned.length === 0) {
    throw new Error("At least one privilege is required");
  }
  for (const p of cleaned) {
    // Privileges are a fixed UI-supplied vocabulary; reject anything that isn't a
    // plain SQL privilege keyword so the list can't smuggle in extra clauses.
    if (!/^[A-Za-z ]+$/.test(p)) {
      throw new Error(`Invalid privilege: ${p}`);
    }
  }

  const cols = (columns ?? []).map((c) => c.trim()).filter((c) => c !== "");
  if (cols.length === 0) {
    return cleaned.join(", ");
  }
  for (const c of cols) {
    assertNoControlChars(c, "Column name");
  }
  const colList = cols.map((c) => quoteIdent(dialect, c)).join(", ");
  // Apply the same column list to every privilege, e.g. `SELECT (a), UPDATE (a)`.
  return cleaned.map((p) => `${p} (${colList})`).join(", ");
}

/** The grantee clause: MySQL `'name'@'host'`, Postgres `"name"`, SQLServer `[name]`. */
function grantee(dialect: Dialect, name: string, host: string | undefined): string {
  assertNonEmpty(name, "User name");
  assertNoControlChars(name, "User name");
  if (dialect === "mysql") {
    return mysqlActor(dialect, name, host);
  }
  return quoteIdent(dialect, name);
}

export function buildGrant(dialect: Dialect, input: GrantInput): string {
  assertNotSqlite(dialect);
  const privs = renderPrivileges(dialect, input.privileges, input.columns);
  return `GRANT ${privs} ON ${input.scope} TO ${grantee(dialect, input.name, input.host)}`;
}

export function buildRevoke(dialect: Dialect, input: GrantInput): string {
  assertNotSqlite(dialect);
  const privs = renderPrivileges(dialect, input.privileges, input.columns);
  return `REVOKE ${privs} ON ${input.scope} FROM ${grantee(dialect, input.name, input.host)}`;
}

// ---------------------------------------------------------------------------
// ROLES
// ---------------------------------------------------------------------------

/**
 * Create a role (a non-login group of privileges).
 *
 * - MySQL 8: `CREATE ROLE 'name'` — the role is a string-literal account name.
 * - Postgres: `CREATE ROLE "name"` (NOLOGIN by default) — an identifier.
 * - SQLServer: `CREATE ROLE [name]` — an identifier (the postgres branch's
 *   `quoteIdent` already emits bracket quoting for SQL Server).
 * - SQLite: throws.
 */
export function buildCreateRole(dialect: Dialect, name: string): Statement[] {
  assertNotSqlite(dialect);
  assertNonEmpty(name, "Role name");
  assertNoControlChars(name, "Role name");
  if (dialect === "mysql") {
    return [{ sql: `CREATE ROLE ${quoteStringLiteral(dialect, name)}`, params: [] }];
  }
  return [{ sql: `CREATE ROLE ${quoteIdent(dialect, name)}`, params: [] }];
}

/** Drop a role. Mirrors {@link buildCreateRole} per-dialect quoting. */
export function buildDropRole(dialect: Dialect, name: string): Statement[] {
  assertNotSqlite(dialect);
  assertNonEmpty(name, "Role name");
  assertNoControlChars(name, "Role name");
  if (dialect === "mysql") {
    return [{ sql: `DROP ROLE ${quoteStringLiteral(dialect, name)}`, params: [] }];
  }
  return [{ sql: `DROP ROLE ${quoteIdent(dialect, name)}`, params: [] }];
}

/**
 * Grant a role to a user (role membership).
 *
 * - MySQL 8: `GRANT 'role' TO 'user'@'%'` — both the role and the grantee are
 *   string-literal account names (host defaults to `%`).
 * - Postgres: `GRANT "role" TO "user"` — both are identifiers.
 * - SQLServer: `ALTER ROLE [role] ADD MEMBER [user]` — both are identifiers;
 *   T-SQL has no `GRANT role TO user` form for role membership.
 * - SQLite: throws.
 */
export function buildGrantRole(dialect: Dialect, role: string, toUser: string): Statement[] {
  assertNotSqlite(dialect);
  assertNonEmpty(role, "Role name");
  assertNonEmpty(toUser, "User name");
  assertNoControlChars(role, "Role name");
  assertNoControlChars(toUser, "User name");
  if (dialect === "mysql") {
    const sql = `GRANT ${quoteStringLiteral(dialect, role)} TO ${mysqlActor(dialect, toUser, undefined)}`;
    return [{ sql, params: [] }];
  }
  if (dialect === "sqlserver") {
    const sql = `ALTER ROLE ${quoteIdent(dialect, role)} ADD MEMBER ${quoteIdent(dialect, toUser)}`;
    return [{ sql, params: [] }];
  }
  return [
    {
      sql: `GRANT ${quoteIdent(dialect, role)} TO ${quoteIdent(dialect, toUser)}`,
      params: [],
    },
  ];
}
