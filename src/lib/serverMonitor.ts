/**
 * Pure SQL builders for the Server Monitor view.
 *
 * Design rules:
 * - Pure functions only — no React, no Tauri calls.
 * - One statement per builder; the caller runs them via executeQuery.
 * - SQLite has no server-side process list / status / variables surface, so
 *   every builder returns "" for it (the view shows "not supported").
 *
 * Per-dialect statements:
 * - processList:
 *     mysql     => SHOW FULL PROCESSLIST  (Id, User, Host, db, Command, Time, State, Info)
 *     postgres  => SELECT pid, usename, state, query, query_start FROM pg_stat_activity
 *     sqlserver => SELECT session_id, login_name, status, command, text FROM
 *                  sys.dm_exec_requests CROSS APPLY sys.dm_exec_sql_text(sql_handle)
 * - kill (terminate one connection by id):
 *     mysql     => KILL <id>
 *     postgres  => SELECT pg_terminate_backend(<id>)
 *     sqlserver => KILL <id>            (the session_id)
 * - status (server runtime counters):
 *     mysql     => SHOW STATUS               (Variable_name, Value)
 *     postgres  => SELECT name, setting FROM pg_settings  (settings double as status surface)
 *     sqlserver => SELECT name, value_in_use FROM sys.configurations  (config doubles as status)
 * - variables (server configuration):
 *     mysql     => SHOW VARIABLES            (Variable_name, Value)
 *     postgres  => SELECT name, setting FROM pg_settings  (name, setting)
 *     sqlserver => SELECT name, value_in_use FROM sys.configurations  (name, value_in_use)
 */

import type { Dialect } from "../types";

/** SQL listing the active server processes/connections. SQLite => "". */
export function processListQuery(dialect: Dialect): string {
  switch (dialect) {
    case "mysql":
      return "SHOW FULL PROCESSLIST";
    case "postgres":
      return "SELECT pid, usename, state, query, query_start FROM pg_stat_activity";
    case "sqlserver":
      return (
        "SELECT session_id, login_name, status, command, text " +
        "FROM sys.dm_exec_requests CROSS APPLY sys.dm_exec_sql_text(sql_handle)"
      );
    case "sqlite":
      return "";
  }
}

/**
 * SQL that kills/terminates a single connection by `id` (the process/backend
 * id from {@link processListQuery}). SQLite => "".
 */
export function killQuery(dialect: Dialect, id: string | number): string {
  switch (dialect) {
    case "mysql":
      return `KILL ${id}`;
    case "postgres":
      return `SELECT pg_terminate_backend(${id})`;
    case "sqlserver":
      return `KILL ${id}`;
    case "sqlite":
      return "";
  }
}

/** SQL for the server's runtime status counters. SQLite => "". */
export function statusQuery(dialect: Dialect): string {
  switch (dialect) {
    case "mysql":
      return "SHOW STATUS";
    case "postgres":
      return "SELECT name, setting FROM pg_settings";
    case "sqlserver":
      return "SELECT name, value_in_use FROM sys.configurations";
    case "sqlite":
      return "";
  }
}

/** SQL for the server's configuration variables. SQLite => "". */
export function variablesQuery(dialect: Dialect): string {
  switch (dialect) {
    case "mysql":
      return "SHOW VARIABLES";
    case "postgres":
      return "SELECT name, setting FROM pg_settings";
    case "sqlserver":
      return "SELECT name, value_in_use FROM sys.configurations";
    case "sqlite":
      return "";
  }
}
