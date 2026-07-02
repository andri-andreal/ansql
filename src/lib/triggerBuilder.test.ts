import { describe, it, expect } from "vitest";
import {
  buildCreateTrigger,
  buildDropTrigger,
  triggerTemplate,
  type TriggerSpec,
} from "./triggerBuilder";

function spec(overrides: Partial<TriggerSpec> = {}): TriggerSpec {
  return {
    name: "trg_audit",
    table: "users",
    schema: null,
    timing: "AFTER",
    events: ["INSERT"],
    forEachRow: true,
    when: null,
    body: "BEGIN END",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// triggerTemplate
// ---------------------------------------------------------------------------
describe("triggerTemplate", () => {
  it("postgres template ends with RETURN NEW;", () => {
    const t = triggerTemplate("postgres", "users");
    expect(t).toContain("RETURN NEW;");
    expect(t).toContain("users");
  });

  it("mysql template is a BEGIN..END block", () => {
    const t = triggerTemplate("mysql", "users");
    expect(t.startsWith("BEGIN")).toBe(true);
    expect(t.trimEnd().endsWith("END")).toBe(true);
  });

  it("sqlite template is a bare comment (BEGIN/END added by the builder)", () => {
    const t = triggerTemplate("sqlite", "users");
    expect(t).not.toContain("BEGIN");
    expect(t).toContain("users");
  });

  it("sqlserver template is a bare comment mentioning the pseudo-tables", () => {
    const t = triggerTemplate("sqlserver", "users");
    expect(t).not.toContain("BEGIN");
    expect(t).toContain("users");
    expect(t).toContain("inserted/deleted");
  });
});

// ---------------------------------------------------------------------------
// buildCreateTrigger — MySQL
// ---------------------------------------------------------------------------
describe("buildCreateTrigger (mysql)", () => {
  it("emits a single CREATE TRIGGER qualified by database, with FOR EACH ROW", () => {
    const stmts = buildCreateTrigger(
      "mysql",
      spec({ schema: "shop", timing: "BEFORE", events: ["UPDATE"], body: "SET NEW.updated_at = NOW()" }),
    );
    expect(stmts).toEqual([
      {
        sql:
          "CREATE TRIGGER `trg_audit` BEFORE UPDATE ON `shop`.`users` FOR EACH ROW SET NEW.updated_at = NOW()",
        params: [],
      },
    ]);
  });

  it("clamps to a single event and ignores WHEN (MySQL has neither)", () => {
    const stmts = buildCreateTrigger(
      "mysql",
      spec({ events: ["INSERT", "UPDATE", "DELETE"], when: "OLD.x <> NEW.x" }),
    );
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toContain("AFTER INSERT ON");
    expect(stmts[0].sql).not.toContain("UPDATE");
    expect(stmts[0].sql).not.toContain("WHEN");
  });

  it("uses an unqualified table name when schema is null", () => {
    const stmts = buildCreateTrigger("mysql", spec({ schema: null }));
    expect(stmts[0].sql).toContain("ON `users` FOR EACH ROW");
  });
});

// ---------------------------------------------------------------------------
// buildCreateTrigger — SQLite
// ---------------------------------------------------------------------------
describe("buildCreateTrigger (sqlite)", () => {
  it("wraps the body in BEGIN … END and includes FOR EACH ROW", () => {
    const stmts = buildCreateTrigger(
      "sqlite",
      spec({ timing: "AFTER", events: ["DELETE"], body: "DELETE FROM logs WHERE uid = OLD.id;" }),
    );
    expect(stmts).toEqual([
      {
        sql:
          'CREATE TRIGGER "trg_audit" AFTER DELETE ON "users" FOR EACH ROW BEGIN DELETE FROM logs WHERE uid = OLD.id; END',
        params: [],
      },
    ]);
  });

  it("emits a WHEN (…) clause when provided", () => {
    const stmts = buildCreateTrigger(
      "sqlite",
      spec({ events: ["UPDATE"], when: "NEW.qty < 0", body: "SELECT 1;" }),
    );
    expect(stmts[0].sql).toContain("WHEN (NEW.qty < 0)");
    expect(stmts[0].sql).toContain("BEGIN SELECT 1; END");
  });

  it("omits FOR EACH ROW when forEachRow is false", () => {
    const stmts = buildCreateTrigger("sqlite", spec({ forEachRow: false, body: "SELECT 1;" }));
    expect(stmts[0].sql).not.toContain("FOR EACH ROW");
  });

  it("is not schema-qualified", () => {
    const stmts = buildCreateTrigger("sqlite", spec({ schema: "main", body: "SELECT 1;" }));
    expect(stmts[0].sql).toContain('ON "users"');
    expect(stmts[0].sql).not.toContain('"main"');
  });
});

// ---------------------------------------------------------------------------
// buildCreateTrigger — SQL Server
// ---------------------------------------------------------------------------
describe("buildCreateTrigger (sqlserver)", () => {
  it("emits CREATE OR ALTER TRIGGER … AS BEGIN … END, statement-level, schema-qualified", () => {
    const stmts = buildCreateTrigger(
      "sqlserver",
      spec({
        schema: "dbo",
        timing: "AFTER",
        events: ["INSERT"],
        body: "INSERT INTO audit SELECT * FROM inserted;",
      }),
    );
    expect(stmts).toEqual([
      {
        sql:
          "CREATE OR ALTER TRIGGER [trg_audit] ON [dbo].[users] AFTER INSERT " +
          "AS BEGIN INSERT INTO audit SELECT * FROM inserted; END",
        params: [],
      },
    ]);
  });

  it("comma-joins multiple events and never emits FOR EACH ROW or WHEN", () => {
    const stmts = buildCreateTrigger(
      "sqlserver",
      spec({
        schema: "dbo",
        events: ["INSERT", "UPDATE", "DELETE"],
        when: "OLD.x <> NEW.x",
        body: "SELECT 1;",
      }),
    );
    expect(stmts[0].sql).toContain("AFTER INSERT, UPDATE, DELETE");
    expect(stmts[0].sql).not.toContain("FOR EACH ROW");
    expect(stmts[0].sql).not.toContain("WHEN");
  });

  it("keeps INSTEAD OF and maps BEFORE to AFTER (T-SQL has no BEFORE)", () => {
    const instead = buildCreateTrigger(
      "sqlserver",
      spec({ timing: "INSTEAD OF", events: ["UPDATE"], body: "SELECT 1;" }),
    );
    expect(instead[0].sql).toContain("INSTEAD OF UPDATE");

    const before = buildCreateTrigger(
      "sqlserver",
      spec({ timing: "BEFORE", events: ["UPDATE"], body: "SELECT 1;" }),
    );
    expect(before[0].sql).toContain("AFTER UPDATE");
    expect(before[0].sql).not.toContain("BEFORE");
  });

  it("uses an unqualified table name when schema is null", () => {
    const stmts = buildCreateTrigger("sqlserver", spec({ schema: null, body: "SELECT 1;" }));
    expect(stmts[0].sql).toContain("ON [users] AFTER INSERT");
  });
});

// ---------------------------------------------------------------------------
// buildCreateTrigger — Postgres
// ---------------------------------------------------------------------------
describe("buildCreateTrigger (postgres)", () => {
  it("emits the CREATE FUNCTION + CREATE TRIGGER pair, qualified by schema", () => {
    const stmts = buildCreateTrigger(
      "postgres",
      spec({ schema: "public", timing: "BEFORE", events: ["INSERT"], body: "  RETURN NEW;" }),
    );
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toEqual({
      sql:
        'CREATE OR REPLACE FUNCTION "public"."trg_audit_fn"() RETURNS trigger AS $$\n  RETURN NEW;\n$$ LANGUAGE plpgsql;',
      params: [],
    });
    expect(stmts[1]).toEqual({
      sql:
        'CREATE TRIGGER "trg_audit" BEFORE INSERT ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."trg_audit_fn"();',
      params: [],
    });
  });

  it("joins multiple events with ' OR '", () => {
    const stmts = buildCreateTrigger(
      "postgres",
      spec({ schema: "public", events: ["INSERT", "UPDATE", "DELETE"], body: "  RETURN NEW;" }),
    );
    expect(stmts[1].sql).toContain("AFTER INSERT OR UPDATE OR DELETE ON");
  });

  it("emits a WHEN (…) clause before EXECUTE FUNCTION", () => {
    const stmts = buildCreateTrigger(
      "postgres",
      spec({ schema: "public", events: ["UPDATE"], when: "OLD.* IS DISTINCT FROM NEW.*", body: "  RETURN NEW;" }),
    );
    const trigSql = stmts[1].sql;
    expect(trigSql).toContain("WHEN (OLD.* IS DISTINCT FROM NEW.*)");
    expect(trigSql.indexOf("WHEN (")).toBeLessThan(trigSql.indexOf("EXECUTE FUNCTION"));
  });

  it("works without a schema (unqualified function and table)", () => {
    const stmts = buildCreateTrigger("postgres", spec({ schema: null, events: ["INSERT"], body: "  RETURN NEW;" }));
    expect(stmts[0].sql).toContain('FUNCTION "trg_audit_fn"()');
    expect(stmts[1].sql).toContain('ON "users"');
    expect(stmts[1].sql).toContain('EXECUTE FUNCTION "trg_audit_fn"()');
  });
});

// ---------------------------------------------------------------------------
// buildDropTrigger
// ---------------------------------------------------------------------------
describe("buildDropTrigger", () => {
  it("mysql drops by schema-qualified trigger name", () => {
    const stmts = buildDropTrigger("mysql", "trg_audit", "users", "shop");
    expect(stmts).toEqual([
      { sql: "DROP TRIGGER IF EXISTS `shop`.`trg_audit`", params: [] },
    ]);
  });

  it("mysql drops by bare name when schema is null", () => {
    const stmts = buildDropTrigger("mysql", "trg_audit", "users", null);
    expect(stmts).toEqual([
      { sql: "DROP TRIGGER IF EXISTS `trg_audit`", params: [] },
    ]);
  });

  it("sqlite drops by bare trigger name", () => {
    const stmts = buildDropTrigger("sqlite", "trg_audit", "users");
    expect(stmts).toEqual([
      { sql: 'DROP TRIGGER IF EXISTS "trg_audit"', params: [] },
    ]);
  });

  it("sqlserver drops by schema-qualified trigger name (table not referenced)", () => {
    const stmts = buildDropTrigger("sqlserver", "trg_audit", "users", "dbo");
    expect(stmts).toEqual([
      { sql: "DROP TRIGGER IF EXISTS [dbo].[trg_audit]", params: [] },
    ]);
  });

  it("sqlserver drops by bare name when schema is null", () => {
    const stmts = buildDropTrigger("sqlserver", "trg_audit", "users", null);
    expect(stmts).toEqual([
      { sql: "DROP TRIGGER IF EXISTS [trg_audit]", params: [] },
    ]);
  });

  it("postgres drops the trigger on its table and the companion function", () => {
    const stmts = buildDropTrigger("postgres", "trg_audit", "users", "public");
    expect(stmts).toEqual([
      { sql: 'DROP TRIGGER IF EXISTS "trg_audit" ON "public"."users"', params: [] },
      { sql: 'DROP FUNCTION IF EXISTS "public"."trg_audit_fn"()', params: [] },
    ]);
  });

  it("postgres drop works without a schema", () => {
    const stmts = buildDropTrigger("postgres", "trg_audit", "users");
    expect(stmts).toEqual([
      { sql: 'DROP TRIGGER IF EXISTS "trg_audit" ON "users"', params: [] },
      { sql: 'DROP FUNCTION IF EXISTS "trg_audit_fn"()', params: [] },
    ]);
  });
});
