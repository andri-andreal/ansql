import { describe, it, expect } from "vitest";
import {
  routineTemplate,
  buildDropRoutine,
  listRoutinesQuery,
  getRoutineDefinitionQuery,
  buildRoutineSignature,
  scaffoldRoutineBody,
  type RoutineParam,
} from "./routineBuilder";

// ---------------------------------------------------------------------------
// routineTemplate
// ---------------------------------------------------------------------------
describe("routineTemplate", () => {
  describe("postgres", () => {
    it("function uses CREATE OR REPLACE FUNCTION with a $$ plpgsql body", () => {
      const t = routineTemplate("postgres", "function");
      expect(t).toContain("CREATE OR REPLACE FUNCTION");
      expect(t).toContain("RETURNS");
      expect(t).toContain("LANGUAGE plpgsql");
      expect(t).toContain("$$");
      expect(t).toContain("BEGIN");
      expect(t).toContain("END;");
    });

    it("procedure uses CREATE OR REPLACE PROCEDURE (no RETURNS)", () => {
      const t = routineTemplate("postgres", "procedure");
      expect(t).toContain("CREATE OR REPLACE PROCEDURE");
      expect(t).not.toContain("RETURNS");
      expect(t).toContain("LANGUAGE plpgsql");
      expect(t).toContain("$$");
    });
  });

  describe("mysql", () => {
    it("function uses CREATE FUNCTION ... RETURNS ... DETERMINISTIC with BEGIN/END", () => {
      const t = routineTemplate("mysql", "function");
      expect(t).toContain("CREATE FUNCTION");
      expect(t).toContain("RETURNS");
      expect(t).toContain("DETERMINISTIC");
      expect(t).toContain("BEGIN");
      expect(t).toContain("END");
      // MySQL bodies do not use dollar-quoting.
      expect(t).not.toContain("$$");
    });

    it("procedure uses CREATE PROCEDURE with BEGIN/END and no RETURNS", () => {
      const t = routineTemplate("mysql", "procedure");
      expect(t).toContain("CREATE PROCEDURE");
      expect(t).not.toContain("RETURNS");
      expect(t).toContain("BEGIN");
      expect(t).toContain("END");
    });
  });

  describe("sqlserver", () => {
    it("function uses CREATE OR ALTER FUNCTION with RETURNS and AS BEGIN/END", () => {
      const t = routineTemplate("sqlserver", "function");
      expect(t).toContain("CREATE OR ALTER FUNCTION");
      expect(t).toContain("RETURNS INT");
      expect(t).toContain("AS");
      expect(t).toContain("BEGIN");
      expect(t).toContain("RETURN 0;");
      expect(t).toContain("END");
      expect(t).not.toContain("OR REPLACE");
      expect(t).not.toContain("$$");
    });

    it("procedure uses CREATE OR ALTER PROCEDURE with AS BEGIN/END and no RETURNS", () => {
      const t = routineTemplate("sqlserver", "procedure");
      expect(t).toContain("CREATE OR ALTER PROCEDURE");
      expect(t).not.toContain("RETURNS");
      expect(t).toContain("AS");
      expect(t).toContain("BEGIN");
      expect(t).toContain("END");
    });
  });

  describe("sqlite", () => {
    it("returns an empty scaffold (SQLite has no stored routines)", () => {
      expect(routineTemplate("sqlite", "function")).toBe("");
      expect(routineTemplate("sqlite", "procedure")).toBe("");
    });
  });
});

// ---------------------------------------------------------------------------
// buildDropRoutine
// ---------------------------------------------------------------------------
describe("buildDropRoutine", () => {
  it("postgres drops a function, qualified by schema, with IF EXISTS", () => {
    expect(buildDropRoutine("postgres", "public", "calc", "function")).toBe(
      'DROP FUNCTION IF EXISTS "public"."calc"',
    );
  });

  it("postgres drops a procedure, qualified by schema, with IF EXISTS", () => {
    expect(buildDropRoutine("postgres", "public", "do_work", "procedure")).toBe(
      'DROP PROCEDURE IF EXISTS "public"."do_work"',
    );
  });

  it("mysql drops a function qualified by database with IF EXISTS", () => {
    expect(buildDropRoutine("mysql", "shop", "calc", "function")).toBe(
      "DROP FUNCTION IF EXISTS `shop`.`calc`",
    );
  });

  it("mysql drops a procedure qualified by database with IF EXISTS", () => {
    expect(buildDropRoutine("mysql", "shop", "do_work", "procedure")).toBe(
      "DROP PROCEDURE IF EXISTS `shop`.`do_work`",
    );
  });

  it("drops an unqualified routine when schema/database is null", () => {
    expect(buildDropRoutine("postgres", null, "calc", "function")).toBe(
      'DROP FUNCTION IF EXISTS "calc"',
    );
  });

  it("sqlserver drops a procedure, bracket-quoted and schema-qualified, with IF EXISTS", () => {
    expect(buildDropRoutine("sqlserver", "dbo", "do_work", "procedure")).toBe(
      "DROP PROCEDURE IF EXISTS [dbo].[do_work]",
    );
  });

  it("sqlserver drops a function, bracket-quoted, with IF EXISTS", () => {
    expect(buildDropRoutine("sqlserver", "dbo", "calc", "function")).toBe(
      "DROP FUNCTION IF EXISTS [dbo].[calc]",
    );
  });
});

// ---------------------------------------------------------------------------
// listRoutinesQuery
// ---------------------------------------------------------------------------
describe("listRoutinesQuery", () => {
  it("mysql selects name + type from information_schema.ROUTINES for the database", () => {
    const sql = listRoutinesQuery("mysql", "shop");
    expect(sql).toContain("information_schema.ROUTINES");
    expect(sql).toContain("ROUTINE_NAME AS name");
    expect(sql).toContain("ROUTINE_TYPE AS type");
    expect(sql).toContain("ROUTINE_SCHEMA = 'shop'");
  });

  it("mysql escapes single quotes in the database name", () => {
    const sql = listRoutinesQuery("mysql", "o'brien");
    expect(sql).toContain("ROUTINE_SCHEMA = 'o''brien'");
  });

  it("postgres selects proname + prokind from pg_proc for the schema", () => {
    const sql = listRoutinesQuery("postgres", "shop", "app");
    expect(sql).toContain("pg_proc");
    expect(sql).toContain("p.proname AS name");
    expect(sql).toContain("nspname = 'app'");
    expect(sql).toContain("PROCEDURE");
    expect(sql).toContain("FUNCTION");
  });

  it("postgres defaults to the public schema when none is given", () => {
    const sql = listRoutinesQuery("postgres", "shop");
    expect(sql).toContain("nspname = 'public'");
  });

  it("sqlserver selects name + type from INFORMATION_SCHEMA.ROUTINES for the schema", () => {
    const sql = listRoutinesQuery("sqlserver", "shop", "app");
    expect(sql).toContain("INFORMATION_SCHEMA.ROUTINES");
    expect(sql).toContain("ROUTINE_NAME AS name");
    expect(sql).toContain("ROUTINE_TYPE AS type");
    expect(sql).toContain("ROUTINE_SCHEMA = 'app'");
  });

  it("sqlserver defaults to the dbo schema when none is given", () => {
    expect(listRoutinesQuery("sqlserver", "shop")).toContain("ROUTINE_SCHEMA = 'dbo'");
  });

  it("sqlite returns an empty string (no routines)", () => {
    expect(listRoutinesQuery("sqlite", "main")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getRoutineDefinitionQuery
// ---------------------------------------------------------------------------
describe("getRoutineDefinitionQuery", () => {
  it("mysql uses SHOW CREATE FUNCTION on the qualified name", () => {
    expect(getRoutineDefinitionQuery("mysql", "shop", "calc", "function")).toBe(
      "SHOW CREATE FUNCTION `shop`.`calc`",
    );
  });

  it("mysql uses SHOW CREATE PROCEDURE on the qualified name", () => {
    expect(getRoutineDefinitionQuery("mysql", "shop", "do_work", "procedure")).toBe(
      "SHOW CREATE PROCEDURE `shop`.`do_work`",
    );
  });

  it("postgres uses pg_get_functiondef with a regproc cast on the qualified name", () => {
    const sql = getRoutineDefinitionQuery("postgres", "public", "calc", "function");
    expect(sql).toContain("pg_get_functiondef");
    expect(sql).toContain("'public.calc'::regproc");
  });

  it("postgres escapes single quotes in the qualified name literal", () => {
    const sql = getRoutineDefinitionQuery("postgres", "public", "o'brien", "function");
    expect(sql).toContain("'public.o''brien'::regproc");
  });

  it("sqlserver uses OBJECT_DEFINITION(OBJECT_ID(...)) on the qualified name", () => {
    const sql = getRoutineDefinitionQuery("sqlserver", "dbo", "calc", "function");
    expect(sql).toBe("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.calc')) AS definition");
  });

  it("sqlserver escapes single quotes in the qualified name literal", () => {
    const sql = getRoutineDefinitionQuery("sqlserver", "dbo", "o'brien", "function");
    expect(sql).toContain("OBJECT_ID('dbo.o''brien')");
  });

  it("sqlite returns an empty string", () => {
    expect(getRoutineDefinitionQuery("sqlite", "main", "x", "function")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildRoutineSignature
// ---------------------------------------------------------------------------
describe("buildRoutineSignature", () => {
  const params: RoutineParam[] = [
    { mode: "IN", name: "a", type: "integer" },
    { mode: "OUT", name: "b", type: "text" },
  ];

  describe("postgres", () => {
    it("function emits CREATE OR REPLACE FUNCTION with modes, quoted names, and RETURNS", () => {
      const sql = buildRoutineSignature("postgres", "function", "calc", params, "numeric");
      expect(sql).toBe(
        'CREATE OR REPLACE FUNCTION "calc"(IN "a" integer, OUT "b" text)\nRETURNS numeric',
      );
    });

    it("function defaults RETURNS to void when no return type is given", () => {
      const sql = buildRoutineSignature("postgres", "function", "f", []);
      expect(sql).toBe('CREATE OR REPLACE FUNCTION "f"()\nRETURNS void');
    });

    it("procedure omits RETURNS but keeps parameter modes", () => {
      const sql = buildRoutineSignature("postgres", "procedure", "do_work", params);
      expect(sql).toBe('CREATE OR REPLACE PROCEDURE "do_work"(IN "a" integer, OUT "b" text)');
      expect(sql).not.toContain("RETURNS");
    });
  });

  describe("mysql", () => {
    it("function omits parameter modes and emits RETURNS", () => {
      const sql = buildRoutineSignature("mysql", "function", "calc", params, "INT");
      expect(sql).toBe("CREATE FUNCTION `calc`(`a` integer, `b` text)\nRETURNS INT");
      expect(sql).not.toContain("IN ");
      expect(sql).not.toContain("OUT ");
    });

    it("function defaults RETURNS to INT when no return type is given", () => {
      const sql = buildRoutineSignature("mysql", "function", "f", []);
      expect(sql).toBe("CREATE FUNCTION `f`()\nRETURNS INT");
    });

    it("procedure keeps parameter modes and has no RETURNS", () => {
      const sql = buildRoutineSignature("mysql", "procedure", "do_work", params);
      expect(sql).toBe("CREATE PROCEDURE `do_work`(IN `a` integer, OUT `b` text)");
      expect(sql).not.toContain("RETURNS");
    });

    it("quotes identifiers containing backticks", () => {
      const sql = buildRoutineSignature(
        "mysql",
        "procedure",
        "we`ird",
        [{ mode: "INOUT", name: "p`x", type: "INT" }],
      );
      expect(sql).toBe("CREATE PROCEDURE `we``ird`(INOUT `p``x` INT)");
    });
  });

  describe("sqlserver", () => {
    it("function emits CREATE OR ALTER FUNCTION with @param names and RETURNS", () => {
      const sql = buildRoutineSignature("sqlserver", "function", "calc", params, "DECIMAL(10,2)");
      expect(sql).toBe(
        "CREATE OR ALTER FUNCTION [calc](@a integer, @b text OUTPUT)\nRETURNS DECIMAL(10,2)",
      );
    });

    it("function defaults RETURNS to INT when no return type is given", () => {
      const sql = buildRoutineSignature("sqlserver", "function", "f", []);
      expect(sql).toBe("CREATE OR ALTER FUNCTION [f]()\nRETURNS INT");
    });

    it("procedure has no surrounding parentheses on its parameters and no RETURNS", () => {
      const sql = buildRoutineSignature("sqlserver", "procedure", "do_work", params);
      expect(sql).toBe("CREATE OR ALTER PROCEDURE [do_work] @a integer, @b text OUTPUT");
      expect(sql).not.toContain("RETURNS");
    });

    it("a parameterless procedure omits the trailing space", () => {
      const sql = buildRoutineSignature("sqlserver", "procedure", "do_work", []);
      expect(sql).toBe("CREATE OR ALTER PROCEDURE [do_work]");
    });

    it("renders OUT/INOUT as a trailing OUTPUT and leaves IN bare", () => {
      const sql = buildRoutineSignature("sqlserver", "procedure", "p", [
        { mode: "IN", name: "x", type: "INT" },
        { mode: "INOUT", name: "y", type: "INT" },
      ]);
      expect(sql).toBe("CREATE OR ALTER PROCEDURE [p] @x INT, @y INT OUTPUT");
    });
  });

  describe("sqlite", () => {
    it("returns an empty string (no stored routines)", () => {
      expect(buildRoutineSignature("sqlite", "function", "x", [])).toBe("");
      expect(buildRoutineSignature("sqlite", "procedure", "x", [])).toBe("");
    });
  });
});

// ---------------------------------------------------------------------------
// scaffoldRoutineBody
// ---------------------------------------------------------------------------
describe("scaffoldRoutineBody", () => {
  const params: RoutineParam[] = [{ mode: "IN", name: "n", type: "integer" }];

  it("postgres function wraps the signature in a $$ plpgsql body", () => {
    const sql = scaffoldRoutineBody("postgres", "function", "calc", params, "numeric");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "calc"(IN "n" integer)');
    expect(sql).toContain("RETURNS numeric");
    expect(sql).toContain("LANGUAGE plpgsql");
    expect(sql).toContain("AS $$");
    expect(sql).toContain("BEGIN");
    expect(sql).toContain("END;");
    expect(sql).toContain("$$;");
    expect(sql).toContain("-- function body");
  });

  it("postgres procedure scaffolds a body without RETURNS", () => {
    const sql = scaffoldRoutineBody("postgres", "procedure", "do_work", params);
    expect(sql).toContain('CREATE OR REPLACE PROCEDURE "do_work"(IN "n" integer)');
    expect(sql).not.toContain("RETURNS");
    expect(sql).toContain("-- procedure body");
  });

  it("mysql function appends DETERMINISTIC and a RETURN 0 body", () => {
    const sql = scaffoldRoutineBody("mysql", "function", "calc", params, "INT");
    expect(sql).toContain("CREATE FUNCTION `calc`(`n` integer)");
    expect(sql).toContain("RETURNS INT DETERMINISTIC");
    expect(sql).toContain("BEGIN");
    expect(sql).toContain("RETURN 0;");
    expect(sql).toContain("END");
    expect(sql).not.toContain("$$");
  });

  it("mysql procedure scaffolds a BEGIN/END body with no RETURNS", () => {
    const sql = scaffoldRoutineBody("mysql", "procedure", "do_work", params);
    expect(sql).toContain("CREATE PROCEDURE `do_work`(IN `n` integer)");
    expect(sql).not.toContain("RETURNS");
    expect(sql).toContain("-- procedure body");
  });

  it("sqlserver function wraps the signature in an AS BEGIN/END body that returns", () => {
    const sql = scaffoldRoutineBody("sqlserver", "function", "calc", params, "INT");
    expect(sql).toContain("CREATE OR ALTER FUNCTION [calc](@n integer)");
    expect(sql).toContain("RETURNS INT");
    expect(sql).toContain("AS");
    expect(sql).toContain("BEGIN");
    expect(sql).toContain("RETURN 0;");
    expect(sql).toContain("END");
    expect(sql).not.toContain("$$");
    expect(sql).not.toContain("DETERMINISTIC");
  });

  it("sqlserver procedure scaffolds an AS BEGIN/END body with no RETURNS", () => {
    const sql = scaffoldRoutineBody("sqlserver", "procedure", "do_work", params);
    expect(sql).toContain("CREATE OR ALTER PROCEDURE [do_work] @n integer");
    expect(sql).not.toContain("RETURNS");
    expect(sql).toContain("-- procedure body");
  });

  it("sqlite returns an empty string", () => {
    expect(scaffoldRoutineBody("sqlite", "function", "x", [])).toBe("");
  });
});
