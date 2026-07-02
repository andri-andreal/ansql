import { describe, expect, it } from "vitest";
import type { MutationColumn } from "../types";
import { detectSingleTableDml } from "./rawDmlSource";
import { buildRawUndo, buildSnapshotSql, qualifyTable } from "./rawDmlSnapshot";

const cols: MutationColumn[] = [
  { name: "id", data_type: "int", is_primary_key: true, is_auto_increment: true },
  { name: "name", data_type: "varchar" },
  { name: "age", data_type: "int" },
];

describe("detectSingleTableDml", () => {
  it("parses a simple UPDATE with WHERE", () => {
    expect(detectSingleTableDml("UPDATE users SET name = 'x' WHERE id = 5")).toEqual({
      verb: "update",
      schema: null,
      table: "users",
      whereSql: "id = 5",
    });
  });

  it("parses a schema-qualified DELETE", () => {
    expect(detectSingleTableDml("DELETE FROM public.orders WHERE total > 100")).toEqual({
      verb: "delete",
      schema: "public",
      table: "orders",
      whereSql: "total > 100",
    });
  });

  it("captures WHERE up to ORDER BY / LIMIT", () => {
    expect(detectSingleTableDml("DELETE FROM t WHERE a = 1 ORDER BY a LIMIT 1")?.whereSql).toBe(
      "a = 1",
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
});

describe("buildRawUndo", () => {
  it("DELETE → re-inserts every snapshot row", () => {
    const undo = buildRawUndo(
      "mysql",
      { verb: "delete", schema: null, table: "users", whereSql: "age > 30" },
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
      { verb: "update", schema: null, table: "users", whereSql: "id = 1" },
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
      buildRawUndo("mysql", { verb: "update", schema: null, table: "t", whereSql: "a = 1" }, noPk, [
        { a: 1, b: 2 },
      ]),
    ).toBeNull();
  });

  it("empty snapshot → null", () => {
    expect(
      buildRawUndo("mysql", { verb: "delete", schema: null, table: "t", whereSql: null }, cols, []),
    ).toBeNull();
  });
});
