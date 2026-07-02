import { describe, it, expect } from "vitest";
import {
  buildCreateView,
  buildDropView,
  buildCreateMaterializedView,
  buildRefreshMaterializedView,
  buildDropMaterializedView,
  listMaterializedViewsQuery,
} from "./viewBuilder";

// ---------------------------------------------------------------------------
// buildCreateView
// ---------------------------------------------------------------------------
describe("buildCreateView", () => {
  const body = "SELECT id, name FROM users";

  describe("mysql", () => {
    it("emits a single CREATE OR REPLACE VIEW, qualified by database", () => {
      const stmts = buildCreateView("mysql", "shop", "active_users", body);
      expect(stmts).toEqual([
        {
          sql: "CREATE OR REPLACE VIEW `shop`.`active_users` AS SELECT id, name FROM users",
          params: [],
        },
      ]);
    });

    it("emits an unqualified view name when schema/database is null", () => {
      const stmts = buildCreateView("mysql", null, "active_users", body);
      expect(stmts).toEqual([
        {
          sql: "CREATE OR REPLACE VIEW `active_users` AS SELECT id, name FROM users",
          params: [],
        },
      ]);
    });
  });

  describe("postgres", () => {
    it("emits a single CREATE OR REPLACE VIEW, qualified by schema", () => {
      const stmts = buildCreateView("postgres", "public", "active_users", body);
      expect(stmts).toEqual([
        {
          sql: 'CREATE OR REPLACE VIEW "public"."active_users" AS SELECT id, name FROM users',
          params: [],
        },
      ]);
    });

    it("emits an unqualified view name when schema is null", () => {
      const stmts = buildCreateView("postgres", null, "active_users", body);
      expect(stmts).toEqual([
        {
          sql: 'CREATE OR REPLACE VIEW "active_users" AS SELECT id, name FROM users',
          params: [],
        },
      ]);
    });
  });

  describe("sqlite", () => {
    it("emits DROP VIEW IF EXISTS then CREATE VIEW (no OR REPLACE)", () => {
      const stmts = buildCreateView("sqlite", null, "active_users", body);
      expect(stmts).toEqual([
        { sql: 'DROP VIEW IF EXISTS "active_users"', params: [] },
        {
          sql: 'CREATE VIEW "active_users" AS SELECT id, name FROM users',
          params: [],
        },
      ]);
    });

    it("qualifies by schema when provided", () => {
      const stmts = buildCreateView("sqlite", "main", "active_users", body);
      expect(stmts).toEqual([
        { sql: 'DROP VIEW IF EXISTS "main"."active_users"', params: [] },
        {
          sql: 'CREATE VIEW "main"."active_users" AS SELECT id, name FROM users',
          params: [],
        },
      ]);
    });
  });

  describe("sqlserver", () => {
    it("emits a single CREATE OR ALTER VIEW (no OR REPLACE), bracket-quoted and schema-qualified", () => {
      const stmts = buildCreateView("sqlserver", "dbo", "active_users", body);
      expect(stmts).toEqual([
        {
          sql: "CREATE OR ALTER VIEW [dbo].[active_users] AS SELECT id, name FROM users",
          params: [],
        },
      ]);
    });

    it("emits an unqualified view name when schema is null", () => {
      const stmts = buildCreateView("sqlserver", null, "active_users", body);
      expect(stmts).toEqual([
        {
          sql: "CREATE OR ALTER VIEW [active_users] AS SELECT id, name FROM users",
          params: [],
        },
      ]);
      expect(stmts[0].sql).not.toContain("OR REPLACE");
    });

    it("appends WITH CHECK OPTION when requested", () => {
      const [stmt] = buildCreateView("sqlserver", "dbo", "active_users", body, true);
      expect(stmt.sql).toBe(
        "CREATE OR ALTER VIEW [dbo].[active_users] AS SELECT id, name FROM users WITH CHECK OPTION",
      );
    });
  });

  it("inserts the body verbatim", () => {
    const messy = "SELECT *\n  FROM t -- trailing comment";
    const [stmt] = buildCreateView("postgres", null, "v", messy);
    expect(stmt.sql).toBe(`CREATE OR REPLACE VIEW "v" AS ${messy}`);
  });

  describe("withCheckOption", () => {
    it("appends WITH CHECK OPTION on mysql", () => {
      const [stmt] = buildCreateView("mysql", "shop", "active_users", body, true);
      expect(stmt.sql).toBe(
        "CREATE OR REPLACE VIEW `shop`.`active_users` AS SELECT id, name FROM users WITH CHECK OPTION",
      );
    });

    it("appends WITH CHECK OPTION on postgres", () => {
      const [stmt] = buildCreateView("postgres", "public", "active_users", body, true);
      expect(stmt.sql).toBe(
        'CREATE OR REPLACE VIEW "public"."active_users" AS SELECT id, name FROM users WITH CHECK OPTION',
      );
    });

    it("omits the clause when false (default)", () => {
      const [stmt] = buildCreateView("postgres", null, "v", body);
      expect(stmt.sql).not.toContain("WITH CHECK OPTION");
    });

    it("ignores the flag on sqlite (read-only views)", () => {
      const stmts = buildCreateView("sqlite", null, "v", body, true);
      expect(stmts.map((s) => s.sql).join("\n")).not.toContain("WITH CHECK OPTION");
    });
  });
});

// ---------------------------------------------------------------------------
// buildDropView
// ---------------------------------------------------------------------------
describe("buildDropView", () => {
  it("mysql qualifies by database", () => {
    expect(buildDropView("mysql", "shop", "active_users")).toEqual({
      sql: "DROP VIEW IF EXISTS `shop`.`active_users`",
      params: [],
    });
  });

  it("postgres qualifies by schema", () => {
    expect(buildDropView("postgres", "public", "active_users")).toEqual({
      sql: 'DROP VIEW IF EXISTS "public"."active_users"',
      params: [],
    });
  });

  it("drops an unqualified view when schema is null", () => {
    expect(buildDropView("sqlite", null, "active_users")).toEqual({
      sql: 'DROP VIEW IF EXISTS "active_users"',
      params: [],
    });
  });

  it("sqlserver qualifies by schema with bracket quoting", () => {
    expect(buildDropView("sqlserver", "dbo", "active_users")).toEqual({
      sql: "DROP VIEW IF EXISTS [dbo].[active_users]",
      params: [],
    });
  });
});

// ---------------------------------------------------------------------------
// buildCreateMaterializedView
// ---------------------------------------------------------------------------
describe("buildCreateMaterializedView", () => {
  const select = "SELECT id, count(*) AS n FROM events GROUP BY id";

  describe("postgres", () => {
    it("emits CREATE MATERIALIZED VIEW … WITH DATA by default, qualified by schema", () => {
      const stmts = buildCreateMaterializedView("postgres", "public", "evt_stats", select);
      expect(stmts).toEqual([
        {
          sql: `CREATE MATERIALIZED VIEW "public"."evt_stats" AS ${select} WITH DATA`,
          params: [],
        },
      ]);
    });

    it("emits WITH NO DATA when withData is false", () => {
      const [stmt] = buildCreateMaterializedView("postgres", null, "evt_stats", select, false);
      expect(stmt.sql).toBe(`CREATE MATERIALIZED VIEW "evt_stats" AS ${select} WITH NO DATA`);
    });

    it("inserts the select body verbatim", () => {
      const messy = "SELECT *\n  FROM t -- note";
      const [stmt] = buildCreateMaterializedView("postgres", null, "mv", messy);
      expect(stmt.sql).toBe(`CREATE MATERIALIZED VIEW "mv" AS ${messy} WITH DATA`);
    });
  });

  describe("non-postgres", () => {
    it("mysql returns a single unsupported-comment no-op", () => {
      const stmts = buildCreateMaterializedView("mysql", "shop", "mv", select);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toMatch(/^--/);
      expect(stmts[0].sql).toContain("PostgreSQL");
      expect(stmts[0].sql).not.toContain("CREATE");
    });

    it("sqlite returns a single unsupported-comment no-op", () => {
      const stmts = buildCreateMaterializedView("sqlite", null, "mv", select);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toMatch(/^--/);
    });

    it("sqlserver returns a single unsupported-comment no-op", () => {
      const stmts = buildCreateMaterializedView("sqlserver", "dbo", "mv", select);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toMatch(/^--/);
      expect(stmts[0].sql).not.toContain("CREATE");
    });
  });
});

// ---------------------------------------------------------------------------
// buildRefreshMaterializedView
// ---------------------------------------------------------------------------
describe("buildRefreshMaterializedView", () => {
  it("postgres refreshes, qualified by schema", () => {
    expect(buildRefreshMaterializedView("postgres", "public", "evt_stats")).toEqual({
      sql: 'REFRESH MATERIALIZED VIEW "public"."evt_stats"',
      params: [],
    });
  });

  it("postgres adds CONCURRENTLY when requested", () => {
    expect(buildRefreshMaterializedView("postgres", null, "evt_stats", true)).toEqual({
      sql: 'REFRESH MATERIALIZED VIEW CONCURRENTLY "evt_stats"',
      params: [],
    });
  });

  it("non-postgres returns an unsupported-comment no-op", () => {
    const stmt = buildRefreshMaterializedView("mysql", null, "mv");
    expect(stmt.sql).toMatch(/^--/);
    expect(stmt.sql).not.toContain("REFRESH");
  });
});

// ---------------------------------------------------------------------------
// buildDropMaterializedView
// ---------------------------------------------------------------------------
describe("buildDropMaterializedView", () => {
  it("postgres drops IF EXISTS, qualified by schema", () => {
    expect(buildDropMaterializedView("postgres", "public", "evt_stats")).toEqual({
      sql: 'DROP MATERIALIZED VIEW IF EXISTS "public"."evt_stats"',
      params: [],
    });
  });

  it("postgres drops an unqualified matview when schema is null", () => {
    expect(buildDropMaterializedView("postgres", null, "evt_stats")).toEqual({
      sql: 'DROP MATERIALIZED VIEW IF EXISTS "evt_stats"',
      params: [],
    });
  });

  it("non-postgres returns an unsupported-comment no-op", () => {
    const stmt = buildDropMaterializedView("sqlite", null, "mv");
    expect(stmt.sql).toMatch(/^--/);
    expect(stmt.sql).not.toContain("DROP");
  });
});

// ---------------------------------------------------------------------------
// listMaterializedViewsQuery
// ---------------------------------------------------------------------------
describe("listMaterializedViewsQuery", () => {
  it("postgres reads pg_matviews in the current schema", () => {
    const q = listMaterializedViewsQuery("postgres");
    expect(q).toContain("pg_matviews");
    expect(q).toContain("current_schema()");
    expect(q).toContain("matviewname");
  });

  it("returns '' for mysql, sqlite and sqlserver", () => {
    expect(listMaterializedViewsQuery("mysql")).toBe("");
    expect(listMaterializedViewsQuery("sqlite")).toBe("");
    expect(listMaterializedViewsQuery("sqlserver")).toBe("");
  });
});
