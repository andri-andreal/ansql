import { describe, expect, it } from "vitest";
import type { MutationColumn } from "../types";
import { detectSingleTableDml, parseSetAssignments, type DmlSource } from "./rawDmlSource";
import { buildRawUndo, buildSnapshotSql, qualifyTable } from "./rawDmlSnapshot";

const cols: MutationColumn[] = [
  { name: "id", data_type: "int", is_primary_key: true, is_auto_increment: true },
  { name: "name", data_type: "varchar" },
  { name: "age", data_type: "int" },
];

/** DmlSource literal with the preview fields defaulted, for undo tests. */
const src = (partial: Omit<DmlSource, "setSql" | "hasLimitTail">): DmlSource => ({
  setSql: null,
  hasLimitTail: false,
  ...partial,
});

describe("detectSingleTableDml", () => {
  it("parses a simple UPDATE with WHERE", () => {
    expect(detectSingleTableDml("UPDATE users SET name = 'x' WHERE id = 5")).toEqual({
      verb: "update",
      schema: null,
      table: "users",
      whereSql: "id = 5",
      setSql: "name = 'x'",
      hasLimitTail: false,
    });
  });

  it("parses a schema-qualified DELETE", () => {
    expect(detectSingleTableDml("DELETE FROM public.orders WHERE total > 100")).toEqual({
      verb: "delete",
      schema: "public",
      table: "orders",
      whereSql: "total > 100",
      setSql: null,
      hasLimitTail: false,
    });
  });

  it("captures WHERE up to ORDER BY / LIMIT and flags the limit tail", () => {
    const r = detectSingleTableDml("DELETE FROM t WHERE a = 1 ORDER BY a LIMIT 1");
    expect(r?.whereSql).toBe("a = 1");
    expect(r?.hasLimitTail).toBe(true);
  });

  it("captures SET up to WHERE / ORDER BY / LIMIT / RETURNING", () => {
    expect(detectSingleTableDml("UPDATE t SET a = 1, b = 2 WHERE c = 3")?.setSql).toBe(
      "a = 1, b = 2",
    );
    expect(detectSingleTableDml("UPDATE t SET a = 1 RETURNING id")?.setSql).toBe("a = 1");
    const limited = detectSingleTableDml("UPDATE t SET a = 1 WHERE b = 2 LIMIT 5");
    expect(limited?.setSql).toBe("a = 1");
    expect(limited?.hasLimitTail).toBe(true);
  });

  it("captures the full SET tail for an unconditional UPDATE", () => {
    expect(detectSingleTableDml("UPDATE t SET a = 1")).toMatchObject({
      setSql: "a = 1",
      whereSql: null,
      hasLimitTail: false,
    });
  });

  it("does not flag a quoted 'limit 5' literal as a limit tail", () => {
    expect(detectSingleTableDml("UPDATE t SET note = 'limit 5' WHERE id = 1")?.hasLimitTail).toBe(
      false,
    );
  });

  it("returns null WHERE for an unconditional statement", () => {
    expect(detectSingleTableDml("DELETE FROM t")?.whereSql).toBeNull();
  });

  it("rejects multi-table UPDATE ... FROM", () => {
    expect(detectSingleTableDml("UPDATE a SET x = b.y FROM b WHERE a.id = b.id")).toBeNull();
  });

  it("rejects a DELETE with an alias (can't reconstruct the snapshot)", () => {
    expect(detectSingleTableDml("DELETE FROM users u WHERE u.id = 1")).toBeNull();
  });

  it("rejects an UPDATE with an alias", () => {
    expect(detectSingleTableDml("UPDATE users u SET u.name = 'x' WHERE u.id = 1")).toBeNull();
  });

  it("ignores a WHERE inside a subquery (paren depth)", () => {
    const r = detectSingleTableDml("UPDATE t SET n = (SELECT c FROM s WHERE s.id = 1) WHERE id = 2");
    expect(r?.whereSql).toBe("id = 2");
  });

  it("rejects SELECT/INSERT", () => {
    expect(detectSingleTableDml("SELECT * FROM t")).toBeNull();
    expect(detectSingleTableDml("INSERT INTO t VALUES (1)")).toBeNull();
  });

  it("handles T-SQL DELETE TOP (n)", () => {
    expect(detectSingleTableDml("DELETE TOP (5) FROM t WHERE a = 1")).toMatchObject({
      verb: "delete",
      table: "t",
      whereSql: "a = 1",
    });
  });

  it("rejects an UPDATE with an empty SET clause", () => {
    expect(detectSingleTableDml("UPDATE t SET WHERE id = 1")).toBeNull();
  });
});

describe("parseSetAssignments", () => {
  it("parses a single assignment", () => {
    expect(parseSetAssignments("name = 'x'")).toEqual([{ column: "name", exprSql: "'x'" }]);
  });

  it("parses multiple assignments", () => {
    expect(parseSetAssignments("a = 1, b = a + 1")).toEqual([
      { column: "a", exprSql: "1" },
      { column: "b", exprSql: "a + 1" },
    ]);
  });

  it("keeps commas inside string literals and function calls", () => {
    expect(parseSetAssignments("note = 'a,b', full = concat(first, ', ', last)")).toEqual([
      { column: "note", exprSql: "'a,b'" },
      { column: "full", exprSql: "concat(first, ', ', last)" },
    ]);
  });

  it("unquotes quoted assignment targets", () => {
    expect(parseSetAssignments("`weird col` = 1")).toEqual([{ column: "weird col", exprSql: "1" }]);
    expect(parseSetAssignments('"Col" = 1')).toEqual([{ column: "Col", exprSql: "1" }]);
    expect(parseSetAssignments("[col] = 1")).toEqual([{ column: "col", exprSql: "1" }]);
  });

  it("keeps later = inside the RHS verbatim (CASE, comparisons)", () => {
    expect(parseSetAssignments("s = CASE WHEN x = 1 THEN 'a' ELSE 'b' END")).toEqual([
      { column: "s", exprSql: "CASE WHEN x = 1 THEN 'a' ELSE 'b' END" },
    ]);
  });

  it("allows a scalar subquery RHS", () => {
    expect(parseSetAssignments("n = (SELECT max(v) FROM s WHERE s.k = t.k)")).toEqual([
      { column: "n", exprSql: "(SELECT max(v) FROM s WHERE s.k = t.k)" },
    ]);
  });

  it("allows NULL and expressions referencing columns", () => {
    expect(parseSetAssignments("a = NULL, price = price * 1.1")).toEqual([
      { column: "a", exprSql: "NULL" },
      { column: "price", exprSql: "price * 1.1" },
    ]);
  });

  it("rejects the multi-column row form", () => {
    expect(parseSetAssignments("(a, b) = (1, 2)")).toBeNull();
  });

  it("rejects empty and DEFAULT right-hand sides", () => {
    expect(parseSetAssignments("a =")).toBeNull();
    expect(parseSetAssignments("a = DEFAULT")).toBeNull();
  });

  it("rejects duplicate targets (case-insensitive)", () => {
    expect(parseSetAssignments("a = 1, A = 2")).toBeNull();
  });

  it("rejects segments that are not plain assignments", () => {
    expect(parseSetAssignments("a = 1, garbage")).toBeNull();
    expect(parseSetAssignments("1 = a")).toBeNull();
  });
});

describe("buildSnapshotSql", () => {
  it("uses LIMIT for non-sqlserver", () => {
    expect(buildSnapshotSql("postgres", '"t"', "a = 1", 1000)).toBe(
      'SELECT * FROM "t" WHERE a = 1 LIMIT 1000',
    );
  });
  it("uses TOP for sqlserver", () => {
    expect(buildSnapshotSql("sqlserver", "[t]", null, 500)).toBe("SELECT TOP (500) * FROM [t]");
  });
  it("qualifies schema", () => {
    expect(qualifyTable("mysql", { schema: "db", table: "t" })).toBe("`db`.`t`");
  });
  it("appends extraSelect projections after *", () => {
    expect(
      buildSnapshotSql("postgres", '"t"', "a = 1", 10, [`('x') AS "__ansql_new__s"`]),
    ).toBe(`SELECT *, ('x') AS "__ansql_new__s" FROM "t" WHERE a = 1 LIMIT 10`);
    expect(buildSnapshotSql("sqlserver", "[t]", null, 10, ["(1) AS [n]"])).toBe(
      "SELECT TOP (10) *, (1) AS [n] FROM [t]",
    );
    expect(buildSnapshotSql("mysql", "`t`", null, 10, [])).toBe("SELECT * FROM `t` LIMIT 10");
  });
});

describe("buildRawUndo", () => {
  it("DELETE → re-inserts every snapshot row", () => {
    const undo = buildRawUndo(
      "mysql",
      src({ verb: "delete", schema: null, table: "users", whereSql: "age > 30" }),
      cols,
      [
        { id: 1, name: "a", age: 31 },
        { id: 2, name: "b", age: 40 },
      ],
    );
    expect(undo).toHaveLength(2);
    expect(undo![0].sql).toBe("INSERT INTO `users` (`id`, `name`, `age`) VALUES (?, ?, ?)");
    expect(undo![0].params).toEqual([1, "a", 31]);
  });

  it("UPDATE → restores non-key columns keyed by PK", () => {
    const undo = buildRawUndo(
      "postgres",
      src({ verb: "update", schema: null, table: "users", whereSql: "id = 1" }),
      cols,
      [{ id: 1, name: "old", age: 30 }],
    );
    expect(undo).toHaveLength(1);
    expect(undo![0].sql).toBe('UPDATE "users" SET "name" = $1, "age" = $2 WHERE "id" = $3');
    expect(undo![0].params).toEqual(["old", 30, 1]);
  });

  it("UPDATE with no primary key → null (cannot re-target safely)", () => {
    const noPk: MutationColumn[] = [
      { name: "a", data_type: "int" },
      { name: "b", data_type: "int" },
    ];
    expect(
      buildRawUndo("mysql", src({ verb: "update", schema: null, table: "t", whereSql: "a = 1" }), noPk, [
        { a: 1, b: 2 },
      ]),
    ).toBeNull();
  });

  it("empty snapshot → null", () => {
    expect(
      buildRawUndo("mysql", src({ verb: "delete", schema: null, table: "t", whereSql: null }), cols, []),
    ).toBeNull();
  });
});
