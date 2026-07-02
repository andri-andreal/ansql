/**
 * Read-only introspection queries for the User/Role manager.
 *
 * Pure functions returning a SQL string (no params). SQLite has no users, so it
 * returns "" and the UI never runs it.
 */

import type { Dialect } from "../types";
import { quoteStringLiteral } from "./ddlBuilder";

/**
 * List database users/roles.
 *
 * - MySQL:     one row per `'user'@'host'` from `mysql.user`.
 * - Postgres:  one row per role from `pg_roles`, with login/superuser flags.
 * - SQLServer: one row per database principal that is a user (type S/U/G/E/X)
 *              from `sys.database_principals`, excluding fixed system principals.
 * - SQLite:    "" (no users).
 */
export function listUsersQuery(dialect: Dialect): string {
  if (dialect === "mysql") {
    return "SELECT user AS name, host FROM mysql.user ORDER BY user";
  }
  if (dialect === "postgres") {
    return "SELECT rolname AS name, rolcanlogin AS can_login, rolsuper AS is_super FROM pg_roles ORDER BY rolname";
  }
  if (dialect === "sqlserver") {
    return (
      "SELECT name FROM sys.database_principals " +
      "WHERE type IN ('S','U','G','E','X') AND principal_id > 4 " +
      "ORDER BY name"
    );
  }
  return "";
}

const DEFAULT_HOST = "%";

/**
 * Reject control characters so a name/host can never break out of the
 * single-line literal it is interpolated into.
 */
function assertNoControlChars(value: string, label: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(`${label} must not contain control characters`);
    }
  }
}

/**
 * List the privileges granted to a single user/role.
 *
 * - MySQL:    `SHOW GRANTS FOR 'user'@'host'` — each row is a ready-made GRANT
 *             statement; host defaults to `%`. The user/host are interpolated as
 *             escaped string literals (they are literals, not identifiers).
 * - Postgres:  union of table-level privileges from `information_schema.role_table_grants`
 *              and the role's attribute/membership flags from `pg_roles`, keyed by
 *              grantee = the role name (interpolated as an escaped literal).
 * - SQLServer: one row per granted permission from `sys.database_permissions`,
 *              joined to the grantee principal and (for object-level grants) the
 *              target object, keyed by the principal name (escaped literal).
 * - SQLite:    "" (no users).
 */
export function listGrantsQuery(dialect: Dialect, user: string, host?: string): string {
  assertNoControlChars(user, "User name");
  if (dialect === "mysql") {
    const h = host && host.trim() !== "" ? host : DEFAULT_HOST;
    assertNoControlChars(h, "Host");
    return `SHOW GRANTS FOR ${quoteStringLiteral(dialect, user)}@${quoteStringLiteral(dialect, h)}`;
  }
  if (dialect === "postgres") {
    const lit = quoteStringLiteral(dialect, user);
    // One row per granted table privilege, ordered for a stable display.
    return (
      "SELECT privilege_type, table_schema, table_name, is_grantable " +
      "FROM information_schema.role_table_grants " +
      `WHERE grantee = ${lit} ` +
      "ORDER BY table_schema, table_name, privilege_type"
    );
  }
  if (dialect === "sqlserver") {
    const lit = quoteStringLiteral(dialect, user);
    // One row per database permission for the grantee. permission_name doubles as
    // the privilege; the schema/object names are present only for object grants.
    return (
      "SELECT dp.permission_name AS privilege_type, dp.state_desc AS state, " +
      "SCHEMA_NAME(o.schema_id) AS table_schema, o.name AS table_name " +
      "FROM sys.database_permissions dp " +
      "JOIN sys.database_principals pr ON pr.principal_id = dp.grantee_principal_id " +
      "LEFT JOIN sys.objects o ON o.object_id = dp.major_id " +
      `WHERE pr.name = ${lit} ` +
      "ORDER BY table_schema, table_name, privilege_type"
    );
  }
  return "";
}

/**
 * Turn the rows returned by `listGrantsQuery` into human-readable grant lines.
 *
 * - MySQL:    each row is already a GRANT statement under a single (variably
 *             named) column — return its text verbatim.
 * - Postgres:  format each `role_table_grants` row as
 *              `PRIVILEGE ON "schema"."table"` (plus a WITH GRANT OPTION marker).
 * - SQLServer: format each `sys.database_permissions` row as
 *              `PRIVILEGE ON [schema].[table]` (object grants) or `PRIVILEGE`
 *              (database-level), prefixed with `DENY ` when the permission was denied.
 *
 * Tolerant of shape drift: unknown/empty rows are skipped.
 */
export function parseGrants(dialect: Dialect, rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];

  if (dialect === "mysql") {
    const out: string[] = [];
    for (const row of rows) {
      if (row == null) continue;
      // SHOW GRANTS returns a single column whose name varies by server/version,
      // e.g. "Grants for user@host". Take the first non-empty string value.
      const values =
        typeof row === "object" ? Object.values(row as Record<string, unknown>) : [row];
      const text = values.find((v) => typeof v === "string" && v.trim() !== "");
      if (typeof text === "string") out.push(text.trim());
    }
    return out;
  }

  if (dialect === "postgres") {
    const out: string[] = [];
    for (const row of rows) {
      if (row == null || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const priv = r.privilege_type != null ? String(r.privilege_type) : "";
      if (priv === "") continue;
      const schema = r.table_schema != null ? String(r.table_schema) : "";
      const table = r.table_name != null ? String(r.table_name) : "";
      const target = schema && table ? `"${schema}"."${table}"` : table ? `"${table}"` : "";
      const grantable = r.is_grantable === true || r.is_grantable === "YES";
      let line = target ? `${priv} ON ${target}` : priv;
      if (grantable) line += " WITH GRANT OPTION";
      out.push(line);
    }
    return out;
  }

  if (dialect === "sqlserver") {
    const out: string[] = [];
    for (const row of rows) {
      if (row == null || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const priv = r.privilege_type != null ? String(r.privilege_type) : "";
      if (priv === "") continue;
      const schema = r.table_schema != null ? String(r.table_schema) : "";
      const table = r.table_name != null ? String(r.table_name) : "";
      const target = schema && table ? `[${schema}].[${table}]` : table ? `[${table}]` : "";
      let line = target ? `${priv} ON ${target}` : priv;
      // state_desc is GRANT / GRANT_WITH_GRANT_OPTION / DENY / REVOKE.
      const state = r.state != null ? String(r.state) : "";
      if (state === "DENY") line = `DENY ${line}`;
      else if (state === "GRANT_WITH_GRANT_OPTION") line += " WITH GRANT OPTION";
      out.push(line);
    }
    return out;
  }

  return [];
}

/**
 * List the assignable roles (group roles / non-login roles).
 *
 * - Postgres:  non-login roles from `pg_roles` (`rolcanlogin = false`).
 * - MySQL 8:   roles are users that cannot authenticate; surface them from
 *              `mysql.user` where the account is locked and has no password.
 *              Older MySQL has no roles — callers treat an empty result as
 *              "roles unsupported".
 * - SQLServer: user-defined database roles from `sys.database_principals`
 *              (`type = 'R'`), excluding the fixed system roles (principal_id > 4).
 * - SQLite:    "" (no roles).
 */
export function listRolesQuery(dialect: Dialect): string {
  if (dialect === "postgres") {
    return "SELECT rolname AS name FROM pg_roles WHERE rolcanlogin = false ORDER BY rolname";
  }
  if (dialect === "mysql") {
    // MySQL 8 roles: locked accounts with no authentication string.
    return (
      "SELECT user AS name, host FROM mysql.user " +
      "WHERE account_locked = 'Y' AND authentication_string = '' ORDER BY user"
    );
  }
  if (dialect === "sqlserver") {
    return (
      "SELECT name FROM sys.database_principals " +
      "WHERE type = 'R' AND is_fixed_role = 0 AND principal_id > 4 " +
      "ORDER BY name"
    );
  }
  return "";
}
