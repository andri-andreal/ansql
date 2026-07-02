import { describe, it, expect } from "vitest";
import {
  exportConnections,
  importConnections,
  listSchemasQuery,
  CONNECTION_EXPORT_VERSION,
  type ConnectionExport,
} from "./connectionIO";
import type { Connection } from "../types";

// ---------------------------------------------------------------------------
// Helper factory
// ---------------------------------------------------------------------------
function conn(overrides: Partial<Connection> & { name: string }): Connection {
  const defaults: Connection = {
    id: "id-" + overrides.name,
    name: overrides.name,
    driver: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    username: "admin",
    credential_id: "cred-secret",
    group_id: "grp-1",
    options: null,
    color: "#ff0000",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };
  return { ...defaults, ...overrides };
}

// ---------------------------------------------------------------------------
// exportConnections
// ---------------------------------------------------------------------------
describe("exportConnections", () => {
  it("emits version + connections array", () => {
    const json = exportConnections([conn({ name: "a" })]);
    const parsed = JSON.parse(json) as ConnectionExport;
    expect(parsed.version).toBe(CONNECTION_EXPORT_VERSION);
    expect(parsed.connections).toHaveLength(1);
    expect(parsed.connections[0].name).toBe("a");
    expect(typeof parsed.exportedAt).toBe("string");
  });

  it("strips credential_id (never exports secrets)", () => {
    const json = exportConnections([conn({ name: "a", credential_id: "cred-secret" })]);
    expect(json).not.toContain("cred-secret");
    const parsed = JSON.parse(json) as ConnectionExport;
    expect(parsed.connections[0]).not.toHaveProperty("credential_id");
  });

  it("keeps non-secret fields", () => {
    const json = exportConnections([
      conn({
        name: "a",
        driver: "mysql",
        host: "db.example.com",
        port: 3306,
        database: "shop",
        username: "root",
        group_id: "grp-9",
        color: "#00ff00",
        options: '{"ssl":{"mode":"require"}}',
      }),
    ]);
    const c = (JSON.parse(json) as ConnectionExport).connections[0];
    expect(c.driver).toBe("mysql");
    expect(c.host).toBe("db.example.com");
    expect(c.port).toBe(3306);
    expect(c.database).toBe("shop");
    expect(c.username).toBe("root");
    expect(c.group_id).toBe("grp-9");
    expect(c.color).toBe("#00ff00");
    expect(c.options).toBe('{"ssl":{"mode":"require"}}');
  });
});

// ---------------------------------------------------------------------------
// importConnections
// ---------------------------------------------------------------------------
describe("importConnections", () => {
  it("round-trips export -> import (minus ids/timestamps/secrets)", () => {
    const original = [
      conn({ name: "a", driver: "postgres" }),
      conn({ name: "b", driver: "mysql", port: 3306 }),
    ];
    const imported = importConnections(exportConnections(original));
    expect(imported).toHaveLength(2);
    expect(imported[0]).toEqual({
      name: "a",
      driver: "postgres",
      host: "localhost",
      port: 5432,
      database: "app",
      username: "admin",
      group_id: "grp-1",
      color: "#ff0000",
      options: null,
    });
    // No ids, timestamps, or secrets survive the round-trip.
    expect(imported[0]).not.toHaveProperty("id");
    expect(imported[0]).not.toHaveProperty("created_at");
    expect(imported[0]).not.toHaveProperty("updated_at");
    expect(imported[0]).not.toHaveProperty("credential_id");
  });

  it("ignores credential_id present in the file (defense in depth)", () => {
    const json = JSON.stringify({
      version: 1,
      connections: [
        { name: "x", driver: "postgres", credential_id: "leaked-secret" },
      ],
    });
    const imported = importConnections(json);
    expect(imported[0]).not.toHaveProperty("credential_id");
    expect(JSON.stringify(imported)).not.toContain("leaked-secret");
  });

  it("omits absent optional fields", () => {
    const json = JSON.stringify({
      version: 1,
      connections: [{ name: "sqlite-local", driver: "sqlite" }],
    });
    expect(importConnections(json)).toEqual([{ name: "sqlite-local", driver: "sqlite" }]);
  });

  it("throws on non-JSON input", () => {
    expect(() => importConnections("not json {")).toThrow(/not valid JSON/i);
  });

  it("throws when root is not an object", () => {
    expect(() => importConnections("[]")).toThrow(/expected an object/i);
    expect(() => importConnections("42")).toThrow(/expected an object/i);
  });

  it("throws when connections is missing/not an array", () => {
    expect(() => importConnections('{"version":1}')).toThrow(/connections/i);
    expect(() => importConnections('{"connections":{}}')).toThrow(/connections/i);
  });

  it("throws when a connection lacks a name", () => {
    const json = JSON.stringify({ connections: [{ driver: "postgres" }] });
    expect(() => importConnections(json)).toThrow(/missing a name/i);
  });

  it("throws on an unknown driver", () => {
    const json = JSON.stringify({ connections: [{ name: "y", driver: "oracle" }] });
    expect(() => importConnections(json)).toThrow(/unknown driver/i);
  });

  it("accepts the sqlserver driver", () => {
    const json = JSON.stringify({
      connections: [{ name: "mssql", driver: "sqlserver", port: 1433 }],
    });
    expect(importConnections(json)).toEqual([
      { name: "mssql", driver: "sqlserver", port: 1433 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// listSchemasQuery
// ---------------------------------------------------------------------------
describe("listSchemasQuery", () => {
  it("returns the postgres schema list query", () => {
    const sql = listSchemasQuery("postgres");
    expect(sql).toContain("information_schema.schemata");
    expect(sql).toContain("pg_catalog");
    expect(sql).toContain("pg_temp%");
    expect(sql).toContain("pg_toast%");
    expect(sql).toContain("ORDER BY schema_name");
  });

  it("returns the sqlserver schema list query excluding system schemas", () => {
    const sql = listSchemasQuery("sqlserver");
    expect(sql).toContain("FROM sys.schemas");
    expect(sql).toContain("'sys','INFORMATION_SCHEMA','guest'");
    expect(sql).toContain("'db_owner'");
    expect(sql).toContain("'db_denydatawriter'");
    expect(sql).toContain("ORDER BY name");
  });

  it('returns "" for mysql and sqlite (no schema tier)', () => {
    expect(listSchemasQuery("mysql")).toBe("");
    expect(listSchemasQuery("sqlite")).toBe("");
  });
});
