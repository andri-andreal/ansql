import { describe, it, expect } from "vitest";
import {
  buildViewCopy,
  normalizeCreateDdl,
  dependencyOrder,
  type TransferObjectRef,
} from "./objectTransfer";

// ---------------------------------------------------------------------------
// buildViewCopy
// ---------------------------------------------------------------------------
describe("buildViewCopy", () => {
  const body = "SELECT id, name FROM users";

  describe("mysql", () => {
    it("emits a single CREATE OR REPLACE VIEW, qualified by database", () => {
      const stmts = buildViewCopy("mysql", "shop", "active_users", body);
      expect(stmts).toEqual([
        {
          sql: "CREATE OR REPLACE VIEW `shop`.`active_users` AS SELECT id, name FROM users",
          params: [],
        },
      ]);
    });

    it("drops OR REPLACE when replace is false", () => {
      const [stmt] = buildViewCopy("mysql", "shop", "active_users", body, false);
      expect(stmt.sql).toBe(
        "CREATE VIEW `shop`.`active_users` AS SELECT id, name FROM users",
      );
    });
  });

  describe("postgres", () => {
    it("emits a single CREATE OR REPLACE VIEW, qualified by schema", () => {
      const stmts = buildViewCopy("postgres", "public", "active_users", body);
      expect(stmts).toEqual([
        {
          sql: 'CREATE OR REPLACE VIEW "public"."active_users" AS SELECT id, name FROM users',
          params: [],
        },
      ]);
    });

    it("emits an unqualified view name when schema is null", () => {
      const [stmt] = buildViewCopy("postgres", null, "active_users", body);
      expect(stmt.sql).toBe(
        'CREATE OR REPLACE VIEW "active_users" AS SELECT id, name FROM users',
      );
    });

    it("drops OR REPLACE when replace is false", () => {
      const [stmt] = buildViewCopy("postgres", null, "v", body, false);
      expect(stmt.sql).toBe('CREATE VIEW "v" AS SELECT id, name FROM users');
    });
  });

  describe("sqlite", () => {
    it("emits DROP VIEW IF EXISTS then CREATE VIEW (no OR REPLACE)", () => {
      const stmts = buildViewCopy("sqlite", null, "active_users", body);
      expect(stmts).toEqual([
        { sql: 'DROP VIEW IF EXISTS "active_users"', params: [] },
        {
          sql: 'CREATE VIEW "active_users" AS SELECT id, name FROM users',
          params: [],
        },
      ]);
    });

    it("ignores replace=false (always drops then creates)", () => {
      const stmts = buildViewCopy("sqlite", null, "v", body, false);
      expect(stmts.map((s) => s.sql)).toEqual([
        'DROP VIEW IF EXISTS "v"',
        'CREATE VIEW "v" AS SELECT id, name FROM users',
      ]);
    });
  });

  it("inserts the body verbatim", () => {
    const messy = "SELECT *\n  FROM t -- trailing comment";
    const [stmt] = buildViewCopy("postgres", null, "v", messy);
    expect(stmt.sql).toBe(`CREATE OR REPLACE VIEW "v" AS ${messy}`);
  });
});

// ---------------------------------------------------------------------------
// normalizeCreateDdl
// ---------------------------------------------------------------------------
describe("normalizeCreateDdl", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeCreateDdl("  CREATE VIEW v AS SELECT 1  ")).toBe(
      "CREATE VIEW v AS SELECT 1",
    );
  });

  it("leaves DDL without a DEFINER untouched", () => {
    const ddl = "CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET NEW.a = 1";
    expect(normalizeCreateDdl(ddl)).toBe(ddl);
  });

  it("strips a backtick-quoted DEFINER clause (view)", () => {
    const ddl =
      "CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v` AS SELECT 1";
    expect(normalizeCreateDdl(ddl)).toBe(
      "CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v` AS SELECT 1",
    );
  });

  it("strips a DEFINER clause from a CREATE FUNCTION", () => {
    const ddl =
      "CREATE DEFINER=`admin`@`%` FUNCTION `f`() RETURNS int RETURN 1";
    expect(normalizeCreateDdl(ddl)).toBe(
      "CREATE FUNCTION `f`() RETURNS int RETURN 1",
    );
  });

  it("strips a DEFINER clause from a CREATE TRIGGER", () => {
    const ddl =
      "CREATE DEFINER=`root`@`localhost` TRIGGER `trg` BEFORE INSERT ON `t` FOR EACH ROW SET NEW.x = 1";
    expect(normalizeCreateDdl(ddl)).toBe(
      "CREATE TRIGGER `trg` BEFORE INSERT ON `t` FOR EACH ROW SET NEW.x = 1",
    );
  });

  it("strips a DEFINER clause with extra spaces around =", () => {
    const ddl =
      "CREATE DEFINER = `u`@`h` PROCEDURE `p`() BEGIN END";
    expect(normalizeCreateDdl(ddl)).toBe("CREATE PROCEDURE `p`() BEGIN END");
  });

  it("strips an unquoted DEFINER clause", () => {
    const ddl = "CREATE DEFINER=root@localhost VIEW v AS SELECT 1";
    expect(normalizeCreateDdl(ddl)).toBe("CREATE VIEW v AS SELECT 1");
  });

  it("dropFirst is a no-op that does not alter the DDL", () => {
    const ddl = "CREATE VIEW v AS SELECT 1";
    expect(normalizeCreateDdl(ddl, true)).toBe(normalizeCreateDdl(ddl, false));
  });
});

// ---------------------------------------------------------------------------
// dependencyOrder
// ---------------------------------------------------------------------------
describe("dependencyOrder", () => {
  it("orders views, then routines, then triggers", () => {
    const refs: TransferObjectRef[] = [
      { kind: "trigger", name: "trg1" },
      { kind: "view", name: "v1" },
      { kind: "routine", name: "fn1", routineKind: "function" },
      { kind: "trigger", name: "trg2" },
      { kind: "view", name: "v2" },
    ];
    expect(dependencyOrder(refs).map((r) => r.name)).toEqual([
      "v1",
      "v2",
      "fn1",
      "trg1",
      "trg2",
    ]);
  });

  it("is stable within each kind", () => {
    const refs: TransferObjectRef[] = [
      { kind: "view", name: "a" },
      { kind: "view", name: "b" },
      { kind: "view", name: "c" },
    ];
    expect(dependencyOrder(refs).map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const refs: TransferObjectRef[] = [
      { kind: "trigger", name: "t" },
      { kind: "view", name: "v" },
    ];
    const copy = [...refs];
    dependencyOrder(refs);
    expect(refs).toEqual(copy);
  });

  it("returns an empty array unchanged", () => {
    expect(dependencyOrder([])).toEqual([]);
  });
});
