import { describe, it, expect } from "vitest";
import {
  listUsersQuery,
  listGrantsQuery,
  parseGrants,
  listRolesQuery,
} from "./userQueries";

// ---------------------------------------------------------------------------
// listUsersQuery (existing behaviour, locked down here)
// ---------------------------------------------------------------------------
describe("listUsersQuery", () => {
  it("mysql reads mysql.user", () => {
    expect(listUsersQuery("mysql")).toBe(
      "SELECT user AS name, host FROM mysql.user ORDER BY user",
    );
  });

  it("postgres reads pg_roles with flags", () => {
    expect(listUsersQuery("postgres")).toContain("FROM pg_roles");
  });

  it("sqlserver reads non-system principals from sys.database_principals", () => {
    const sql = listUsersQuery("sqlserver");
    expect(sql).toContain("FROM sys.database_principals");
    expect(sql).toContain("type IN ('S','U','G','E','X')");
    expect(sql).toContain("principal_id > 4");
  });

  it("sqlite returns empty", () => {
    expect(listUsersQuery("sqlite")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// listGrantsQuery
// ---------------------------------------------------------------------------
describe("listGrantsQuery", () => {
  it("mysql SHOW GRANTS FOR 'user'@'host'", () => {
    expect(listGrantsQuery("mysql", "alice", "localhost")).toBe(
      "SHOW GRANTS FOR 'alice'@'localhost'",
    );
  });

  it("mysql defaults the host to %", () => {
    expect(listGrantsQuery("mysql", "alice")).toBe("SHOW GRANTS FOR 'alice'@'%'");
  });

  it("mysql escapes a quote in the user name", () => {
    expect(listGrantsQuery("mysql", "o'brien")).toBe("SHOW GRANTS FOR 'o''brien'@'%'");
  });

  it("postgres queries role_table_grants filtered by grantee", () => {
    const sql = listGrantsQuery("postgres", "alice");
    expect(sql).toContain("information_schema.role_table_grants");
    expect(sql).toContain("grantee = 'alice'");
  });

  it("postgres escapes a quote in the grantee literal", () => {
    expect(listGrantsQuery("postgres", "o'brien")).toContain("grantee = 'o''brien'");
  });

  it("sqlserver queries sys.database_permissions filtered by principal name", () => {
    const sql = listGrantsQuery("sqlserver", "alice");
    expect(sql).toContain("sys.database_permissions");
    expect(sql).toContain("sys.database_principals");
    expect(sql).toContain("pr.name = 'alice'");
  });

  it("sqlserver escapes a quote in the principal literal", () => {
    expect(listGrantsQuery("sqlserver", "o'brien")).toContain("pr.name = 'o''brien'");
  });

  it("sqlite returns empty", () => {
    expect(listGrantsQuery("sqlite", "alice")).toBe("");
  });

  it("rejects a control character in the user name", () => {
    expect(() => listGrantsQuery("mysql", "a\nb")).toThrow();
  });

  it("rejects a control character in the host", () => {
    expect(() => listGrantsQuery("mysql", "alice", "ho\tst")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseGrants
// ---------------------------------------------------------------------------
describe("parseGrants", () => {
  it("mysql returns each row's grant string verbatim", () => {
    const rows = [
      { "Grants for alice@%": "GRANT SELECT ON `shop`.* TO `alice`@`%`" },
      { "Grants for alice@%": "GRANT USAGE ON *.* TO `alice`@`%`" },
    ];
    expect(parseGrants("mysql", rows)).toEqual([
      "GRANT SELECT ON `shop`.* TO `alice`@`%`",
      "GRANT USAGE ON *.* TO `alice`@`%`",
    ]);
  });

  it("mysql skips rows with no string value", () => {
    expect(parseGrants("mysql", [{ x: null }, { y: 3 }])).toEqual([]);
  });

  it("postgres formats privilege + qualified table", () => {
    const rows = [
      {
        privilege_type: "SELECT",
        table_schema: "public",
        table_name: "orders",
        is_grantable: "NO",
      },
      {
        privilege_type: "UPDATE",
        table_schema: "public",
        table_name: "orders",
        is_grantable: "YES",
      },
    ];
    expect(parseGrants("postgres", rows)).toEqual([
      'SELECT ON "public"."orders"',
      'UPDATE ON "public"."orders" WITH GRANT OPTION',
    ]);
  });

  it("postgres honours a boolean is_grantable", () => {
    const rows = [
      {
        privilege_type: "DELETE",
        table_schema: "public",
        table_name: "t",
        is_grantable: true,
      },
    ];
    expect(parseGrants("postgres", rows)).toEqual([
      'DELETE ON "public"."t" WITH GRANT OPTION',
    ]);
  });

  it("postgres skips rows missing a privilege", () => {
    expect(parseGrants("postgres", [{ table_name: "t" }])).toEqual([]);
  });

  it("sqlserver formats permission + bracket-qualified object", () => {
    const rows = [
      {
        privilege_type: "SELECT",
        state: "GRANT",
        table_schema: "dbo",
        table_name: "orders",
      },
      {
        privilege_type: "UPDATE",
        state: "GRANT_WITH_GRANT_OPTION",
        table_schema: "dbo",
        table_name: "orders",
      },
    ];
    expect(parseGrants("sqlserver", rows)).toEqual([
      "SELECT ON [dbo].[orders]",
      "UPDATE ON [dbo].[orders] WITH GRANT OPTION",
    ]);
  });

  it("sqlserver prefixes DENY and supports database-level permissions", () => {
    const rows = [
      { privilege_type: "CONNECT", state: "GRANT", table_schema: null, table_name: null },
      { privilege_type: "ALTER", state: "DENY", table_schema: "dbo", table_name: "t" },
    ];
    expect(parseGrants("sqlserver", rows)).toEqual([
      "CONNECT",
      "DENY ALTER ON [dbo].[t]",
    ]);
  });

  it("sqlserver skips rows missing a permission", () => {
    expect(parseGrants("sqlserver", [{ table_name: "t" }])).toEqual([]);
  });

  it("returns [] for non-array input", () => {
    expect(parseGrants("mysql", null)).toEqual([]);
    expect(parseGrants("postgres", undefined)).toEqual([]);
  });

  it("sqlite returns []", () => {
    expect(parseGrants("sqlite", [{ anything: "x" }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listRolesQuery
// ---------------------------------------------------------------------------
describe("listRolesQuery", () => {
  it("postgres lists non-login roles", () => {
    expect(listRolesQuery("postgres")).toBe(
      "SELECT rolname AS name FROM pg_roles WHERE rolcanlogin = false ORDER BY rolname",
    );
  });

  it("mysql lists locked, password-less accounts as roles", () => {
    const sql = listRolesQuery("mysql");
    expect(sql).toContain("FROM mysql.user");
    expect(sql).toContain("account_locked = 'Y'");
  });

  it("sqlserver lists user-defined database roles", () => {
    const sql = listRolesQuery("sqlserver");
    expect(sql).toContain("FROM sys.database_principals");
    expect(sql).toContain("type = 'R'");
    expect(sql).toContain("is_fixed_role = 0");
  });

  it("sqlite returns empty (unsupported)", () => {
    expect(listRolesQuery("sqlite")).toBe("");
  });
});
