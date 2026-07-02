import { describe, expect, it } from "vitest";
import type { MutationColumn } from "../types";
import {
  buildInverseBatch,
  invertDelete,
  invertInsert,
  invertMutation,
  invertUpdate,
} from "./inverseBuilder";

const cols: MutationColumn[] = [
  { name: "id", data_type: "int", is_primary_key: true, is_auto_increment: true },
  { name: "name", data_type: "varchar" },
  { name: "age", data_type: "int" },
];

const noPkCols: MutationColumn[] = [
  { name: "a", data_type: "int" },
  { name: "b", data_type: "varchar" },
];

describe("invertUpdate", () => {
  it("restores the original values, keyed by the (unchanged) PK", () => {
    const stmt = invertUpdate(
      "mysql",
      "`t`",
      cols,
      { id: 1, name: "old", age: 30 },
      { name: "new" },
    );
    expect(stmt).not.toBeNull();
    expect(stmt!.sql).toBe("UPDATE `t` SET `name` = ? WHERE `id` = ?");
    // SET the original value, WHERE on the current PK.
    expect(stmt!.params).toEqual(["old", 1]);
  });

  it("targets the NEW pk value when the pk itself was changed", () => {
    const stmt = invertUpdate("postgres", '"t"', cols, { id: 1, name: "a" }, { id: 2 });
    expect(stmt).not.toBeNull();
    // restore id -> 1, where id = 2 (post-update value)
    expect(stmt!.sql).toBe('UPDATE "t" SET "id" = $1 WHERE "id" = $2');
    expect(stmt!.params).toEqual([1, 2]);
  });

  it("restores a NULL original as a literal NULL in SET", () => {
    const stmt = invertUpdate("mysql", "`t`", cols, { id: 1, name: null }, { name: "x" });
    expect(stmt!.sql).toBe("UPDATE `t` SET `name` = NULL WHERE `id` = ?");
    expect(stmt!.params).toEqual([1]);
  });

  it("returns null when nothing changed", () => {
    expect(invertUpdate("mysql", "`t`", cols, { id: 1 }, {})).toBeNull();
  });
});

describe("invertInsert", () => {
  it("deletes by PK when the PK was provided", () => {
    const stmt = invertInsert("mysql", "`t`", cols, { id: 5, name: "a", age: 1 });
    expect(stmt!.sql).toBe("DELETE FROM `t` WHERE `id` = ?");
    expect(stmt!.params).toEqual([5]);
  });

  it("falls back to all present columns when the auto PK is absent", () => {
    // id (auto PK) not provided → match on name+age, capped to one row.
    const stmt = invertInsert("mysql", "`t`", cols, { name: "a", age: 7 });
    expect(stmt!.sql).toBe("DELETE FROM `t` WHERE `name` = ? AND `age` = ? LIMIT 1");
    expect(stmt!.params).toEqual(["a", 7]);
  });

  it("returns null when the inserted row is empty", () => {
    expect(invertInsert("mysql", "`t`", cols, {})).toBeNull();
  });
});

describe("invertDelete", () => {
  it("re-inserts the full original row including the PK", () => {
    const stmt = invertDelete("mysql", "`t`", cols, { id: 9, name: "a", age: 3 });
    expect(stmt!.sql).toBe("INSERT INTO `t` (`id`, `name`, `age`) VALUES (?, ?, ?)");
    expect(stmt!.params).toEqual([9, "a", 3]);
  });

  it("emits NULL literally for a null column", () => {
    const stmt = invertDelete("postgres", '"t"', cols, { id: 9, name: null, age: 3 });
    expect(stmt!.sql).toBe('INSERT INTO "t" ("id", "name", "age") VALUES ($1, NULL, $2)');
    expect(stmt!.params).toEqual([9, 3]);
  });
});

describe("invertMutation + buildInverseBatch", () => {
  it("dispatches by kind", () => {
    expect(invertMutation("mysql", "`t`", cols, { kind: "delete", row: { id: 1 } })!.sql).toContain(
      "INSERT INTO",
    );
    expect(invertMutation("mysql", "`t`", cols, { kind: "insert", row: { id: 1 } })!.sql).toContain(
      "DELETE FROM",
    );
  });

  it("reverses the order of inverses relative to the forward batch", () => {
    const batch = buildInverseBatch("mysql", "`t`", cols, [
      { kind: "insert", row: { id: 1, name: "a" } },
      { kind: "delete", row: { id: 2, name: "b", age: 5 } },
      { kind: "update", row: { id: 3, name: "old" }, changes: { name: "new" } },
    ]);
    // Forward: insert, delete, update → inverse reversed: undo update, undo
    // delete (re-insert), undo insert (delete).
    expect(batch).toHaveLength(3);
    expect(batch[0].sql).toContain("UPDATE");
    expect(batch[1].sql).toContain("INSERT INTO");
    expect(batch[2].sql).toContain("DELETE FROM");
  });

  it("matches an all-columns (no-PK) row on every column", () => {
    const stmt = invertInsert("mysql", "`t`", noPkCols, { a: 1, b: "x" });
    expect(stmt!.sql).toBe("DELETE FROM `t` WHERE `a` = ? AND `b` = ? LIMIT 1");
    expect(stmt!.params).toEqual([1, "x"]);
  });
});
