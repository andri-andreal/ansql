import { describe, it, expect } from "vitest";
import {
  diffRows,
  buildSyncStatements,
  type DataDiff,
} from "./dataDiff";
import type { Dialect, MutationColumn } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mcol(
  overrides: Partial<MutationColumn> & { name: string },
): MutationColumn {
  return { data_type: "text", ...overrides };
}

const COLS: MutationColumn[] = [
  mcol({ name: "id", data_type: "int", is_primary_key: true }),
  mcol({ name: "name", data_type: "varchar" }),
  mcol({ name: "age", data_type: "int" }),
];

// ===========================================================================
// diffRows
// ===========================================================================
describe("diffRows", () => {
  it("classifies source-only rows as inserts", () => {
    const source = [{ id: 1, name: "a" }];
    const target: Record<string, unknown>[] = [];
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.inserts).toEqual([{ id: 1, name: "a" }]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("classifies target-only rows as deletes", () => {
    const source: Record<string, unknown>[] = [];
    const target = [{ id: 9, name: "z" }];
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.inserts).toEqual([]);
    expect(diff.updates).toEqual([]);
    expect(diff.deletes).toEqual([{ id: 9, name: "z" }]);
  });

  it("classifies rows present in both with a changed compare column as updates", () => {
    const source = [{ id: 1, name: "alice", age: 30 }];
    const target = [{ id: 1, name: "alicia", age: 30 }];
    const diff = diffRows(source, target, ["id"], ["name", "age"]);
    expect(diff.inserts).toEqual([]);
    expect(diff.deletes).toEqual([]);
    expect(diff.updates).toEqual([
      {
        key: { id: 1 },
        before: { id: 1, name: "alicia", age: 30 },
        after: { id: 1, name: "alice", age: 30 },
      },
    ]);
  });

  it("omits rows that are equal across all compare columns", () => {
    const source = [{ id: 1, name: "alice", age: 30 }];
    const target = [{ id: 1, name: "alice", age: 30 }];
    const diff = diffRows(source, target, ["id"], ["name", "age"]);
    expect(diff).toEqual({ inserts: [], updates: [], deletes: [] });
  });

  it("ignores differences outside the compare-column set", () => {
    // `age` differs but is not a compare column -> no update.
    const source = [{ id: 1, name: "alice", age: 99 }];
    const target = [{ id: 1, name: "alice", age: 30 }];
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.updates).toEqual([]);
  });

  it("handles a mix of inserts, updates, deletes in one pass", () => {
    const source = [
      { id: 1, name: "a" }, // unchanged
      { id: 2, name: "B" }, // update (was b)
      { id: 4, name: "d" }, // insert
    ];
    const target = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" }, // delete
    ];
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.inserts).toEqual([{ id: 4, name: "d" }]);
    expect(diff.updates.map((u) => u.key)).toEqual([{ id: 2 }]);
    expect(diff.deletes).toEqual([{ id: 3, name: "c" }]);
  });

  it("supports composite keys", () => {
    const source = [
      { a: 1, b: "x", v: "keep" },
      { a: 1, b: "y", v: "new" }, // insert (distinct composite key)
    ];
    const target = [
      { a: 1, b: "x", v: "keep" },
      { a: 2, b: "x", v: "gone" }, // delete
    ];
    const diff = diffRows(source, target, ["a", "b"], ["v"]);
    expect(diff.inserts).toEqual([{ a: 1, b: "y", v: "new" }]);
    expect(diff.deletes).toEqual([{ a: 2, b: "x", v: "gone" }]);
    expect(diff.updates).toEqual([]);
  });

  it("does not collide composite keys with the same concatenation", () => {
    // ["a","b"] must not equal ["ab"] / ["",""] etc.
    const source = [{ p: "a", q: "b", v: 1 }];
    const target = [{ p: "ab", q: "", v: 2 }];
    const diff = diffRows(source, target, ["p", "q"], ["v"]);
    expect(diff.inserts).toEqual([{ p: "a", q: "b", v: 1 }]);
    expect(diff.deletes).toEqual([{ p: "ab", q: "", v: 2 }]);
    expect(diff.updates).toEqual([]);
  });

  it("preserves source order for inserts and updates", () => {
    const source = [
      { id: 3, name: "c3" }, // insert
      { id: 1, name: "X1" }, // update
      { id: 5, name: "c5" }, // insert
      { id: 2, name: "X2" }, // update
    ];
    const target = [
      { id: 1, name: "1" },
      { id: 2, name: "2" },
    ];
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.inserts.map((r) => r.id)).toEqual([3, 5]);
    expect(diff.updates.map((u) => u.key.id)).toEqual([1, 2]);
  });

  it("preserves target order for deletes", () => {
    const source: Record<string, unknown>[] = [];
    const target = [
      { id: 30, name: "c" },
      { id: 10, name: "a" },
      { id: 20, name: "b" },
    ];
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.deletes.map((r) => r.id)).toEqual([30, 10, 20]);
  });

  it("treats null and undefined / missing cells as equal in compare columns", () => {
    const source = [{ id: 1, name: null }];
    const target = [{ id: 1 }]; // name missing
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.updates).toEqual([]); // null === undefined -> unchanged
  });

  it("matches rows whose key cell is null vs missing", () => {
    const source = [{ id: null, name: "a" }];
    const target = [{ name: "old" }]; // id missing -> coalesces to null key
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.inserts).toEqual([]);
    expect(diff.deletes).toEqual([]);
    expect(diff.updates).toHaveLength(1);
  });

  it("distinguishes a null cell from the string 'null' in keys", () => {
    const source = [{ id: null, v: 1 }];
    const target = [{ id: "null", v: 2 }];
    const diff = diffRows(source, target, ["id"], ["v"]);
    expect(diff.inserts).toEqual([{ id: null, v: 1 }]);
    expect(diff.deletes).toEqual([{ id: "null", v: 2 }]);
  });

  it("compares object/array (JSON) compare columns structurally", () => {
    const source = [{ id: 1, meta: { a: 1, b: 2 } }];
    const targetSame = [{ id: 1, meta: { a: 1, b: 2 } }];
    expect(
      diffRows(source, targetSame, ["id"], ["meta"]).updates,
    ).toEqual([]);

    const targetDiff = [{ id: 1, meta: { a: 1, b: 3 } }];
    expect(
      diffRows(source, targetDiff, ["id"], ["meta"]).updates,
    ).toHaveLength(1);
  });

  it("detects a change when one side is null and the other is a value", () => {
    const source = [{ id: 1, name: "x" }];
    const target = [{ id: 1, name: null }];
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.updates).toHaveLength(1);
  });

  it("uses string key values too (not just numbers)", () => {
    const source = [{ code: "AA", v: "new" }];
    const target = [{ code: "AA", v: "old" }];
    const diff = diffRows(source, target, ["code"], ["v"]);
    expect(diff.updates.map((u) => u.key)).toEqual([{ code: "AA" }]);
  });

  it("first source row per key wins on duplicate source keys", () => {
    const source = [
      { id: 1, name: "first" },
      { id: 1, name: "second" }, // ignored
    ];
    const target: Record<string, unknown>[] = [];
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.inserts).toEqual([{ id: 1, name: "first" }]);
  });

  it("matches against the first target row and deletes duplicate target siblings", () => {
    const source = [{ id: 1, name: "X" }];
    const target = [
      { id: 1, name: "a" }, // canonical match -> update
      { id: 1, name: "dup" }, // duplicate key -> delete
    ];
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].before).toEqual({ id: 1, name: "a" });
    expect(diff.deletes).toEqual([{ id: 1, name: "dup" }]);
  });

  it("returns empty diff for empty inputs", () => {
    expect(diffRows([], [], ["id"], ["name"])).toEqual({
      inserts: [],
      updates: [],
      deletes: [],
    });
  });

  it("does not mutate its inputs", () => {
    const source = [{ id: 1, name: "a" }];
    const target = [{ id: 2, name: "b" }];
    const srcCopy = JSON.parse(JSON.stringify(source));
    const tgtCopy = JSON.parse(JSON.stringify(target));
    diffRows(source, target, ["id"], ["name"]);
    expect(source).toEqual(srcCopy);
    expect(target).toEqual(tgtCopy);
  });

  it("derives the update key from the source row", () => {
    const source = [{ id: 7, name: "new" }];
    const target = [{ id: 7, name: "old" }];
    const diff = diffRows(source, target, ["id"], ["name"]);
    expect(diff.updates[0].key).toEqual({ id: 7 });
    expect(diff.updates[0].after).toBe(source[0]);
    expect(diff.updates[0].before).toBe(target[0]);
  });
});

// ===========================================================================
// buildSyncStatements
// ===========================================================================
describe("buildSyncStatements", () => {
  function diffOf(
    dialect: Dialect,
    source: Record<string, unknown>[],
    target: Record<string, unknown>[],
    keyColumns: string[],
    compareColumns: string[],
  ) {
    const diff = diffRows(source, target, keyColumns, compareColumns);
    const quoted = dialect === "mysql" ? "`t`" : '"t"';
    return buildSyncStatements(dialect, quoted, COLS, keyColumns, diff);
  }

  it("emits statements in order: inserts, updates, deletes", () => {
    const diff: DataDiff = {
      inserts: [{ id: 4, name: "d", age: 1 }],
      updates: [
        { key: { id: 2 }, before: { id: 2, name: "b", age: 2 }, after: { id: 2, name: "B", age: 2 } },
      ],
      deletes: [{ id: 3, name: "c", age: 3 }],
    };
    const stmts = buildSyncStatements("mysql", "`t`", COLS, ["id"], diff);
    expect(stmts).toHaveLength(3);
    expect(stmts[0].sql).toMatch(/^INSERT INTO/);
    expect(stmts[1].sql).toMatch(/^UPDATE/);
    expect(stmts[2].sql).toMatch(/^DELETE FROM/);
  });

  it("builds a parameterized INSERT with all filled columns", () => {
    const stmts = diffOf("mysql", [{ id: 4, name: "d", age: 7 }], [], ["id"], ["name", "age"]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(
      "INSERT INTO `t` (`id`, `name`, `age`) VALUES (?, ?, ?)",
    );
    expect(stmts[0].params).toEqual([4, "d", 7]);
  });

  it("omits auto-increment columns on INSERT", () => {
    const cols: MutationColumn[] = [
      mcol({ name: "id", data_type: "int", is_primary_key: true, is_auto_increment: true }),
      mcol({ name: "name", data_type: "varchar" }),
    ];
    const diff: DataDiff = { inserts: [{ id: 4, name: "d" }], updates: [], deletes: [] };
    const stmts = buildSyncStatements("mysql", "`t`", cols, ["id"], diff);
    expect(stmts[0].sql).toBe("INSERT INTO `t` (`name`) VALUES (?)");
    expect(stmts[0].params).toEqual(["d"]);
  });

  it("builds a parameterized UPDATE that SETs non-key columns and WHEREs on the key", () => {
    const stmts = diffOf(
      "mysql",
      [{ id: 2, name: "B", age: 5 }],
      [{ id: 2, name: "b", age: 4 }],
      ["id"],
      ["name", "age"],
    );
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(
      "UPDATE `t` SET `name` = ?, `age` = ? WHERE `id` = ?",
    );
    // SET params come first (after = B, 5), then WHERE param (key id = 2).
    expect(stmts[0].params).toEqual(["B", 5, 2]);
  });

  it("never writes key columns in an UPDATE SET clause", () => {
    // Even though the key column `id` appears in the row data, it stays out of
    // the SET clause (it only identifies the row via WHERE). All non-key value
    // columns are written so the synced row matches the source.
    const stmts = diffOf(
      "mysql",
      [{ id: 2, name: "B", age: 5 }],
      [{ id: 2, name: "b", age: 5 }],
      ["id"],
      ["name"],
    );
    const setClause = stmts[0].sql.slice(
      stmts[0].sql.indexOf("SET"),
      stmts[0].sql.indexOf("WHERE"),
    );
    expect(setClause).not.toContain("`id`");
    expect(stmts[0].sql).toBe("UPDATE `t` SET `name` = ?, `age` = ? WHERE `id` = ?");
  });

  it("builds a parameterized DELETE keyed on keyColumns only", () => {
    const stmts = diffOf("mysql", [], [{ id: 3, name: "c", age: 9 }], ["id"], ["name"]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("DELETE FROM `t` WHERE `id` = ?");
    expect(stmts[0].params).toEqual([3]);
  });

  it("keys WHERE on keyColumns even when they are not the table's declared PK", () => {
    // COLS marks `id` as PK, but we sync on `name`. WHERE must use `name`.
    const stmts = diffOf("mysql", [], [{ id: 3, name: "c", age: 9 }], ["name"], ["age"]);
    expect(stmts[0].sql).toBe("DELETE FROM `t` WHERE `name` = ?");
    expect(stmts[0].params).toEqual(["c"]);
  });

  it("supports composite key WHERE clauses", () => {
    const cols: MutationColumn[] = [
      mcol({ name: "a", data_type: "int" }),
      mcol({ name: "b", data_type: "int" }),
      mcol({ name: "v", data_type: "varchar" }),
    ];
    const diff: DataDiff = {
      inserts: [],
      updates: [],
      deletes: [{ a: 1, b: 2, v: "x" }],
    };
    const stmts = buildSyncStatements("mysql", "`t`", cols, ["a", "b"], diff);
    expect(stmts[0].sql).toBe("DELETE FROM `t` WHERE `a` = ? AND `b` = ?");
    expect(stmts[0].params).toEqual([1, 2]);
  });

  it("uses Postgres placeholders and identifier quoting", () => {
    const cols: MutationColumn[] = [
      mcol({ name: "id", data_type: "int" }),
      mcol({ name: "name", data_type: "varchar" }),
    ];
    const diff: DataDiff = {
      inserts: [{ id: 1, name: "a" }],
      updates: [
        { key: { id: 2 }, before: { id: 2, name: "b" }, after: { id: 2, name: "B" } },
      ],
      deletes: [{ id: 3, name: "c" }],
    };
    const stmts = buildSyncStatements("postgres", '"public"."t"', cols, ["id"], diff);
    expect(stmts[0].sql).toBe(
      'INSERT INTO "public"."t" ("id", "name") VALUES ($1, $2)',
    );
    expect(stmts[1].sql).toBe('UPDATE "public"."t" SET "name" = $1 WHERE "id" = $2');
    // Each statement has its own placeholder counter that resets to $1.
    expect(stmts[2].sql).toBe('DELETE FROM "public"."t" WHERE "id" = $1');
  });

  it("uses SQL Server placeholders and bracket identifier quoting", () => {
    const cols: MutationColumn[] = [
      mcol({ name: "id", data_type: "int" }),
      mcol({ name: "name", data_type: "varchar" }),
    ];
    const diff: DataDiff = {
      inserts: [{ id: 1, name: "a" }],
      updates: [
        { key: { id: 2 }, before: { id: 2, name: "b" }, after: { id: 2, name: "B" } },
      ],
      deletes: [{ id: 3, name: "c" }],
    };
    const stmts = buildSyncStatements("sqlserver", "[dbo].[t]", cols, ["id"], diff);
    expect(stmts[0].sql).toBe(
      "INSERT INTO [dbo].[t] ([id], [name]) VALUES (@P1, @P2)",
    );
    expect(stmts[0].params).toEqual([1, "a"]);
    expect(stmts[1].sql).toBe("UPDATE [dbo].[t] SET [name] = @P1 WHERE [id] = @P2");
    expect(stmts[1].params).toEqual(["B", 2]);
    // Each statement has its own placeholder counter that resets to @P1.
    expect(stmts[2].sql).toBe("DELETE FROM [dbo].[t] WHERE [id] = @P1");
    expect(stmts[2].params).toEqual([3]);
  });

  it("caps a keyless SQL Server DELETE/UPDATE with TOP (1)", () => {
    // No PK on any column -> all-columns WHERE + TOP (1) single-row cap.
    const cols: MutationColumn[] = [
      mcol({ name: "name", data_type: "varchar" }),
      mcol({ name: "age", data_type: "int" }),
    ];
    const diff: DataDiff = {
      inserts: [],
      updates: [],
      deletes: [{ name: "c", age: 9 }],
    };
    const stmts = buildSyncStatements("sqlserver", "[dbo].[t]", cols, [], diff);
    expect(stmts[0].sql).toBe(
      "DELETE TOP (1) FROM [dbo].[t] WHERE [name] = @P1 AND [age] = @P2",
    );
    expect(stmts[0].params).toEqual(["c", 9]);
  });

  it("skips an UPDATE whose only differing column is a key column (no SET to write)", () => {
    // diffRows would not emit such an update, but buildSyncStatements must also
    // be robust: a change object with no non-key columns yields no statement.
    const diff: DataDiff = {
      inserts: [],
      updates: [{ key: { id: 1 }, before: { id: 1, name: "a" }, after: { id: 1 } }],
      deletes: [],
    };
    const stmts = buildSyncStatements("mysql", "`t`", COLS, ["id"], diff);
    expect(stmts).toEqual([]);
  });

  it("returns no statements for an empty diff", () => {
    const stmts = buildSyncStatements("mysql", "`t`", COLS, ["id"], {
      inserts: [],
      updates: [],
      deletes: [],
    });
    expect(stmts).toEqual([]);
  });

  it("emits NULL literals (not params) for null SET values", () => {
    // An UPDATE SETs every non-key value column present in the source row, so the
    // synced row fully matches the source (`age` is written too, even though only
    // `name` triggered the diff). NULLs become literals, not bound params.
    const stmts = diffOf(
      "mysql",
      [{ id: 1, name: null, age: 5 }],
      [{ id: 1, name: "a", age: 5 }],
      ["id"],
      ["name"],
    );
    expect(stmts[0].sql).toBe("UPDATE `t` SET `name` = NULL, `age` = ? WHERE `id` = ?");
    expect(stmts[0].params).toEqual([5, 1]);
  });

  it("end-to-end: diffRows -> buildSyncStatements produces the expected sequence", () => {
    const source = [
      { id: 1, name: "a", age: 10 }, // unchanged -> nothing
      { id: 2, name: "B", age: 22 }, // update
      { id: 4, name: "d", age: 40 }, // insert
    ];
    const target = [
      { id: 1, name: "a", age: 10 },
      { id: 2, name: "b", age: 20 },
      { id: 3, name: "c", age: 30 }, // delete
    ];
    const diff = diffRows(source, target, ["id"], ["name", "age"]);
    const stmts = buildSyncStatements("mysql", "`t`", COLS, ["id"], diff);
    expect(stmts.map((s) => s.sql)).toEqual([
      "INSERT INTO `t` (`id`, `name`, `age`) VALUES (?, ?, ?)",
      "UPDATE `t` SET `name` = ?, `age` = ? WHERE `id` = ?",
      "DELETE FROM `t` WHERE `id` = ?",
    ]);
    expect(stmts[0].params).toEqual([4, "d", 40]);
    expect(stmts[1].params).toEqual(["B", 22, 2]);
    expect(stmts[2].params).toEqual([3]);
  });
});
