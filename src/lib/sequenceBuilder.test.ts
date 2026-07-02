import { describe, it, expect } from "vitest";
import {
  buildCreateSequence,
  buildAlterSequence,
  buildDropSequence,
  listSequencesQuery,
  type SequenceSpec,
} from "./sequenceBuilder";

function spec(overrides: Partial<SequenceSpec> = {}): SequenceSpec {
  return {
    name: "order_id_seq",
    schema: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildCreateSequence
// ---------------------------------------------------------------------------
describe("buildCreateSequence", () => {
  it("emits a bare CREATE SEQUENCE IF NOT EXISTS for a name-only spec", () => {
    expect(buildCreateSequence(spec())).toEqual([
      { sql: 'CREATE SEQUENCE IF NOT EXISTS "order_id_seq"', params: [] },
    ]);
  });

  it("qualifies by schema when provided", () => {
    expect(buildCreateSequence(spec({ schema: "app" }))).toEqual([
      { sql: 'CREATE SEQUENCE IF NOT EXISTS "app"."order_id_seq"', params: [] },
    ]);
  });

  it("emits option clauses in canonical order", () => {
    const stmts = buildCreateSequence(
      spec({ increment: 2, minValue: 10, maxValue: 1000, start: 10, cache: 5, cycle: true }),
    );
    expect(stmts).toEqual([
      {
        sql:
          'CREATE SEQUENCE IF NOT EXISTS "order_id_seq" INCREMENT BY 2 MINVALUE 10 ' +
          "MAXVALUE 1000 START WITH 10 CACHE 5 CYCLE",
        params: [],
      },
    ]);
  });

  it("emits NO CYCLE when cycle is false", () => {
    expect(buildCreateSequence(spec({ cycle: false }))[0].sql).toContain("NO CYCLE");
  });

  it("emits NO MINVALUE / NO MAXVALUE when explicitly null", () => {
    const sql = buildCreateSequence(spec({ minValue: null, maxValue: null }))[0].sql;
    expect(sql).toContain("NO MINVALUE");
    expect(sql).toContain("NO MAXVALUE");
  });

  it("omits unbounded clauses when options are undefined", () => {
    const sql = buildCreateSequence(spec())[0].sql;
    expect(sql).not.toContain("MINVALUE");
    expect(sql).not.toContain("MAXVALUE");
    expect(sql).not.toContain("INCREMENT");
    expect(sql).not.toContain("CYCLE");
  });

  it("ignores NaN numeric options (falls back to defaults)", () => {
    const sql = buildCreateSequence(spec({ increment: NaN, start: NaN }))[0].sql;
    expect(sql).toBe('CREATE SEQUENCE IF NOT EXISTS "order_id_seq"');
  });

  it("supports a zero start value", () => {
    expect(buildCreateSequence(spec({ start: 0 }))[0].sql).toContain("START WITH 0");
  });

  it("supports negative increment and minvalue", () => {
    const sql = buildCreateSequence(spec({ increment: -1, minValue: -100 }))[0].sql;
    expect(sql).toContain("INCREMENT BY -1");
    expect(sql).toContain("MINVALUE -100");
  });

  describe("sqlserver", () => {
    it("emits CREATE SEQUENCE without IF NOT EXISTS, bracket-quoted", () => {
      expect(buildCreateSequence(spec(), "sqlserver")).toEqual([
        { sql: "CREATE SEQUENCE [order_id_seq]", params: [] },
      ]);
    });

    it("qualifies by schema and emits option clauses in canonical order", () => {
      const [stmt] = buildCreateSequence(
        spec({ schema: "dbo", increment: 2, start: 10, cache: 5, cycle: true }),
        "sqlserver",
      );
      expect(stmt.sql).toBe(
        "CREATE SEQUENCE [dbo].[order_id_seq] INCREMENT BY 2 START WITH 10 CACHE 5 CYCLE",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// buildAlterSequence
// ---------------------------------------------------------------------------
describe("buildAlterSequence", () => {
  it("emits a bare ALTER SEQUENCE for a name-only spec", () => {
    expect(buildAlterSequence(spec())).toEqual([
      { sql: 'ALTER SEQUENCE "order_id_seq"', params: [] },
    ]);
  });

  it("emits only the option clauses present in the spec", () => {
    expect(buildAlterSequence(spec({ increment: 3, cache: 1 }))).toEqual([
      { sql: 'ALTER SEQUENCE "order_id_seq" INCREMENT BY 3 CACHE 1', params: [] },
    ]);
  });

  it("qualifies by schema when provided", () => {
    expect(buildAlterSequence(spec({ schema: "app", cycle: true }))[0].sql).toBe(
      'ALTER SEQUENCE "app"."order_id_seq" CYCLE',
    );
  });

  it("emits NO MAXVALUE when maxValue is explicitly null", () => {
    expect(buildAlterSequence(spec({ maxValue: null }))[0].sql).toContain("NO MAXVALUE");
  });

  describe("sqlserver", () => {
    it("re-states a start value as RESTART WITH (T-SQL resets via RESTART)", () => {
      const [stmt] = buildAlterSequence(spec({ start: 100, increment: 2 }), "sqlserver");
      expect(stmt.sql).toBe("ALTER SEQUENCE [order_id_seq] INCREMENT BY 2 RESTART WITH 100");
      // RESTART WITH, not a bare START WITH.
      expect(stmt.sql).not.toMatch(/(?<!RE)START WITH/);
    });

    it("qualifies by schema with bracket quoting", () => {
      const [stmt] = buildAlterSequence(spec({ schema: "dbo", cache: 1 }), "sqlserver");
      expect(stmt.sql).toBe("ALTER SEQUENCE [dbo].[order_id_seq] CACHE 1");
    });
  });
});

// ---------------------------------------------------------------------------
// buildDropSequence
// ---------------------------------------------------------------------------
describe("buildDropSequence", () => {
  it("emits DROP SEQUENCE IF EXISTS, unqualified", () => {
    expect(buildDropSequence(null, "order_id_seq")).toEqual([
      { sql: 'DROP SEQUENCE IF EXISTS "order_id_seq"', params: [] },
    ]);
  });

  it("qualifies by schema when provided", () => {
    expect(buildDropSequence("app", "order_id_seq")).toEqual([
      { sql: 'DROP SEQUENCE IF EXISTS "app"."order_id_seq"', params: [] },
    ]);
  });

  it("escapes embedded double quotes in identifiers", () => {
    expect(buildDropSequence(null, 'we"ird')[0].sql).toBe('DROP SEQUENCE IF EXISTS "we""ird"');
  });

  it("sqlserver drops IF EXISTS, bracket-quoted and schema-qualified", () => {
    expect(buildDropSequence("dbo", "order_id_seq", "sqlserver")).toEqual([
      { sql: "DROP SEQUENCE IF EXISTS [dbo].[order_id_seq]", params: [] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// listSequencesQuery
// ---------------------------------------------------------------------------
describe("listSequencesQuery", () => {
  it("reads pg_sequences in the current schema, aliasing name", () => {
    const sql = listSequencesQuery();
    expect(sql).toContain("FROM pg_sequences");
    expect(sql).toContain("sequencename AS name");
    expect(sql).toContain("schemaname = current_schema()");
  });

  it("sqlserver reads sys.sequences", () => {
    const sql = listSequencesQuery("sqlserver");
    expect(sql).toContain("FROM sys.sequences");
    expect(sql).toContain("SELECT name");
    expect(sql).not.toContain("pg_sequences");
  });
});
