/**
 * Connection import/export + schema-list query.
 *
 * Pure functions. Export NEVER includes secrets: `credential_id` (and any vault
 * references inside `options`) are stripped. Import parses + validates the JSON
 * and returns create-ready connection objects (no ids, timestamps, or secrets).
 */

import type { Connection, Dialect } from "../types";

/** Current on-disk format version for exported connection files. */
export const CONNECTION_EXPORT_VERSION = 1;

/** A single connection entry in an export file (secrets stripped). */
export type ExportedConnection = Omit<Connection, "credential_id"> & {
  credential_id?: undefined;
};

export interface ConnectionExport {
  version: number;
  exportedAt?: string;
  connections: ExportedConnection[];
}

/** A create-ready connection (no server-assigned ids/timestamps, no secrets). */
export type ImportedConnection = Omit<
  Connection,
  "id" | "created_at" | "updated_at" | "credential_id"
>;

/**
 * Serialize connections to a JSON string suitable for sharing/backup.
 * Strips `credential_id` (secrets live in the vault and are never exported).
 */
export function exportConnections(connections: Connection[]): string {
  const payload: ConnectionExport = {
    version: CONNECTION_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    connections: connections.map((c) => {
      // Drop credential_id; keep only non-secret connection fields.
      const { credential_id: _credential_id, ...rest } = c;
      return rest;
    }),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse + validate an export file and return create-ready connections.
 * Throws a clear Error on malformed input. Never returns secrets/ids/timestamps.
 */
export function importConnections(json: string): ImportedConnection[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid connection file: not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid connection file: expected an object.");
  }

  const root = parsed as Record<string, unknown>;
  const { connections } = root;
  if (!Array.isArray(connections)) {
    throw new Error('Invalid connection file: missing "connections" array.');
  }

  return connections.map((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`Invalid connection file: connection #${i + 1} is not an object.`);
    }
    const e = entry as Record<string, unknown>;

    if (typeof e.name !== "string" || e.name.trim() === "") {
      throw new Error(`Invalid connection file: connection #${i + 1} is missing a name.`);
    }
    if (
      e.driver !== "mysql" &&
      e.driver !== "postgres" &&
      e.driver !== "sqlite" &&
      e.driver !== "sqlserver"
    ) {
      throw new Error(
        `Invalid connection file: connection "${e.name}" has an unknown driver "${String(e.driver)}".`,
      );
    }

    const out: ImportedConnection = {
      name: e.name,
      driver: e.driver,
    };
    if (typeof e.host === "string") out.host = e.host;
    if (typeof e.port === "number") out.port = e.port;
    if (typeof e.database === "string") out.database = e.database;
    if (typeof e.username === "string") out.username = e.username;
    if (typeof e.group_id === "string") out.group_id = e.group_id;
    if (typeof e.color === "string") out.color = e.color;
    if (typeof e.options === "string" || e.options === null) out.options = e.options;

    return out;
  });
}

/**
 * SQL to list user schemas for a dialect.
 *
 * - Postgres: all non-system schemas (excludes pg_catalog/information_schema and
 *   transient pg_temp/pg_toast namespaces).
 * - SQLServer: user schemas from `sys.schemas`, excluding the built-in system
 *   schemas and the fixed database-role schemas.
 * - MySQL/SQLite: "" (no schema tier).
 */
export function listSchemasQuery(dialect: Dialect): string {
  if (dialect === "postgres") {
    return (
      "SELECT schema_name FROM information_schema.schemata " +
      "WHERE schema_name NOT IN ('pg_catalog','information_schema') " +
      "AND schema_name NOT LIKE 'pg_temp%' " +
      "AND schema_name NOT LIKE 'pg_toast%' " +
      "ORDER BY schema_name"
    );
  }
  if (dialect === "sqlserver") {
    return (
      "SELECT name FROM sys.schemas WHERE name NOT IN (" +
      "'sys','INFORMATION_SCHEMA','guest','db_owner','db_accessadmin'," +
      "'db_securityadmin','db_ddladmin','db_backupoperator','db_datareader'," +
      "'db_datawriter','db_denydatareader','db_denydatawriter') " +
      "ORDER BY name"
    );
  }
  return "";
}
