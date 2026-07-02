import { describe, it, expect } from "vitest";
import {
  quoteIdent,
  buildUpdate,
  buildInsert,
  buildDelete,
  rawSql,
  isRawSql,
} from "./mutationBuilder";
import type { MutationColumn } from "../types";

const cols: MutationColumn[] = [
  { name: "id", data_type: "int", is_primary_key: true, is_auto_increment: true },
  { name: "name", data_type: "varchar", is_primary_key: false },
  { name: "qty", data_type: "int", is_primary_key: false },
];

describe("quoteIdent", () => {
  it("quotes and escapes per dialect", () => {
    expect(quoteIdent("mysql", "a`b")).toBe("`a``b`");
    expect(quoteIdent("postgres", 'a"b')).toBe('"a""b"');
    expect(quoteIdent("sqlite", "users")).toBe('"users"');
  });

  it("uses T-SQL bracket quoting for sqlserver, doubling a literal ]", () => {
    expect(quoteIdent("sqlserver", "users")).toBe("[users]");
    expect(quoteIdent("sqlserver", "we[i]rd")).toBe("[we[i]]rd]");
    expect(quoteIdent("sqlserver", "Order Items")).toBe("[Order Items]");
  });
});

describe("buildUpdate", () => {
  it("uses PK in WHERE and parameterizes values (mysql ?)", () => {
    const original = { id: 5, name: "x", qty: 1 };
    const s = buildUpdate("mysql", "`t`", cols, original, { name: "O'Brien \\ y" });
    expect(s!.sql).toBe("UPDATE `t` SET `name` = ? WHERE `id` = ?");
    expect(s!.params).toEqual(["O'Brien \\ y", 5]);
  });

  it("uses $n placeholders for postgres", () => {
    const original = { id: 5, name: "x", qty: 1 };
    const s = buildUpdate("postgres", '"t"', cols, original, { qty: 9 });
    expect(s!.sql).toBe('UPDATE "t" SET "qty" = $1 WHERE "id" = $2');
    expect(s!.params).toEqual([9, 5]);
  });

  it("uses @Pn placeholders and bracket idents for sqlserver", () => {
    const original = { id: 5, name: "x", qty: 1 };
    const s = buildUpdate("sqlserver", "[dbo].[t]", cols, original, { name: "y", qty: 9 });
    expect(s!.sql).toBe("UPDATE [dbo].[t] SET [name] = @P1, [qty] = @P2 WHERE [id] = @P3");
    expect(s!.params).toEqual(["y", 9, 5]);
  });

  it("caps a no-PK sqlserver update with TOP (1) (no LIMIT)", () => {
    const noPk: MutationColumn[] = [
      { name: "a", data_type: "int", is_primary_key: false },
      { name: "b", data_type: "varchar", is_primary_key: false },
    ];
    const original = { a: 1, b: null };
    const s = buildUpdate("sqlserver", "[t]", noPk, original, { a: 2 });
    expect(s!.sql).toBe("UPDATE TOP (1) [t] SET [a] = @P1 WHERE [a] = @P2 AND [b] IS NULL");
    expect(s!.params).toEqual([2, 1]);
  });

  it("falls back to all-columns WHERE when no PK, NULL → IS NULL", () => {
    const noPk: MutationColumn[] = [
      { name: "a", data_type: "int", is_primary_key: false },
      { name: "b", data_type: "varchar", is_primary_key: false },
    ];
    const original = { a: 1, b: null };
    const s = buildUpdate("mysql", "`t`", noPk, original, { a: 2 });
    expect(s!.sql).toBe("UPDATE `t` SET `a` = ? WHERE `a` = ? AND `b` IS NULL LIMIT 1");
    expect(s!.params).toEqual([2, 1]);
  });

  it("sets NULL as a literal, not a param", () => {
    const original = { id: 5, name: "x", qty: 1 };
    const s = buildUpdate("mysql", "`t`", cols, original, { name: null });
    expect(s!.sql).toBe("UPDATE `t` SET `name` = NULL WHERE `id` = ?");
    expect(s!.params).toEqual([5]);
  });

  it("returns null when there are no changes", () => {
    const original = { id: 5, name: "x", qty: 1 };
    expect(buildUpdate("mysql", "`t`", cols, original, {})).toBeNull();
  });
});

describe("buildInsert", () => {
  it("omits empty/undefined columns so DB defaults apply", () => {
    const s = buildInsert("mysql", "`t`", cols, { name: "a", qty: "" });
    expect(s!.sql).toBe("INSERT INTO `t` (`name`) VALUES (?)");
    expect(s!.params).toEqual(["a"]);
  });

  it("coerces numeric columns to numbers", () => {
    const s = buildInsert("mysql", "`t`", cols, { name: "a", qty: "7" });
    expect(s!.params).toEqual(["a", 7]);
  });

  it("skips auto-increment PK even if a value is present", () => {
    const s = buildInsert("mysql", "`t`", cols, { id: "99", name: "a" });
    expect(s!.sql).toBe("INSERT INTO `t` (`name`) VALUES (?)");
    expect(s!.params).toEqual(["a"]);
  });

  it("returns null when no columns have values", () => {
    expect(buildInsert("mysql", "`t`", cols, { name: "", qty: null })).toBeNull();
  });

  it("uses $n placeholders for postgres", () => {
    const s = buildInsert("postgres", '"t"', cols, { name: "a", qty: 3 });
    expect(s!.sql).toBe('INSERT INTO "t" ("name", "qty") VALUES ($1, $2)');
    expect(s!.params).toEqual(["a", 3]);
  });

  it("uses @Pn placeholders and bracket idents for sqlserver", () => {
    const s = buildInsert("sqlserver", "[dbo].[t]", cols, { name: "a", qty: "3" });
    expect(s!.sql).toBe("INSERT INTO [dbo].[t] ([name], [qty]) VALUES (@P1, @P2)");
    expect(s!.params).toEqual(["a", 3]);
  });
});

describe("buildDelete", () => {
  it("targets by PK", () => {
    const s = buildDelete("mysql", "`t`", cols, { id: 5, name: "x", qty: 1 });
    expect(s!.sql).toBe("DELETE FROM `t` WHERE `id` = ?");
    expect(s!.params).toEqual([5]);
  });

  it("falls back to all columns when no PK", () => {
    const noPk: MutationColumn[] = [
      { name: "a", data_type: "int", is_primary_key: false },
      { name: "b", data_type: "varchar", is_primary_key: false },
    ];
    const s = buildDelete("postgres", '"t"', noPk, { a: 1, b: null });
    expect(s!.sql).toBe(
      'DELETE FROM "t" WHERE ctid = (SELECT ctid FROM "t" WHERE "a" = $1 AND "b" IS NULL LIMIT 1)',
    );
    expect(s!.params).toEqual([1]);
  });

  it("caps mysql no-PK delete to a single row", () => {
    const noPk: MutationColumn[] = [{ name: "a", data_type: "int", is_primary_key: false }];
    const s = buildDelete("mysql", "`t`", noPk, { a: 1 });
    expect(s!.sql).toBe("DELETE FROM `t` WHERE `a` = ? LIMIT 1");
    expect(s!.params).toEqual([1]);
  });

  it("targets by PK with @Pn placeholders (sqlserver)", () => {
    const s = buildDelete("sqlserver", "[dbo].[t]", cols, { id: 5, name: "x", qty: 1 });
    expect(s!.sql).toBe("DELETE FROM [dbo].[t] WHERE [id] = @P1");
    expect(s!.params).toEqual([5]);
  });

  it("caps a no-PK sqlserver delete with TOP (1)", () => {
    const noPk: MutationColumn[] = [{ name: "a", data_type: "int", is_primary_key: false }];
    const s = buildDelete("sqlserver", "[t]", noPk, { a: 1 });
    expect(s!.sql).toBe("DELETE TOP (1) FROM [t] WHERE [a] = @P1");
    expect(s!.params).toEqual([1]);
  });
});

describe("rawSql / isRawSql", () => {
  it("wraps an expression and round-trips through the guard", () => {
    const r = rawSql("CURRENT_TIMESTAMP");
    expect(r).toEqual({ __raw: "CURRENT_TIMESTAMP" });
    expect(isRawSql(r)).toBe(true);
  });

  it("rejects non-raw values", () => {
    expect(isRawSql("CURRENT_TIMESTAMP")).toBe(false);
    expect(isRawSql(null)).toBe(false);
    expect(isRawSql(undefined)).toBe(false);
    expect(isRawSql(42)).toBe(false);
    expect(isRawSql({ raw: "x" })).toBe(false);
  });
});

describe("raw SQL emission", () => {
  const tsCols: MutationColumn[] = [
    { name: "id", data_type: "int", is_primary_key: true, is_auto_increment: true },
    { name: "name", data_type: "varchar", is_primary_key: false },
    { name: "created_at", data_type: "timestamp", is_primary_key: false },
  ];

  it("buildInsert emits a raw expression literally (mysql), keeping bound params for the rest", () => {
    const s = buildInsert("mysql", "`t`", tsCols, {
      name: "a",
      created_at: rawSql("CURRENT_TIMESTAMP"),
    });
    expect(s!.sql).toBe("INSERT INTO `t` (`name`, `created_at`) VALUES (?, CURRENT_TIMESTAMP)");
    expect(s!.params).toEqual(["a"]);
  });

  it("buildInsert keeps $n numbering correct around a raw value (postgres)", () => {
    const s = buildInsert("postgres", '"t"', tsCols, {
      created_at: rawSql("now()"),
      name: "a",
    });
    // Column order follows the table's column order: name then created_at.
    expect(s!.sql).toBe('INSERT INTO "t" ("name", "created_at") VALUES ($1, now())');
    expect(s!.params).toEqual(["a"]);
  });

  it("buildInsert emits raw with no bound params at all (sqlite)", () => {
    const s = buildInsert("sqlite", '"t"', tsCols, {
      created_at: rawSql("datetime('now')"),
    });
    expect(s!.sql).toBe("INSERT INTO \"t\" (\"created_at\") VALUES (datetime('now'))");
    expect(s!.params).toEqual([]);
  });

  it("buildUpdate emits a raw SET value literally (mysql), PK still bound in WHERE", () => {
    const original = { id: 5, name: "x", created_at: "2026-01-01" };
    const s = buildUpdate("mysql", "`t`", tsCols, original, {
      created_at: rawSql("CURRENT_TIMESTAMP"),
    });
    expect(s!.sql).toBe("UPDATE `t` SET `created_at` = CURRENT_TIMESTAMP WHERE `id` = ?");
    expect(s!.params).toEqual([5]);
  });

  it("buildUpdate mixes a raw value with a bound value, $n indexes skip the raw one (postgres)", () => {
    const original = { id: 5, name: "x", created_at: "2026-01-01" };
    const s = buildUpdate("postgres", '"t"', tsCols, original, {
      name: "y",
      created_at: rawSql("now()"),
    });
    // name → $1 (bound), created_at → now() (raw, no placeholder), WHERE id → $2.
    expect(s!.sql).toBe('UPDATE "t" SET "name" = $1, "created_at" = now() WHERE "id" = $2');
    expect(s!.params).toEqual(["y", 5]);
  });
});

describe("Postgres type binding", () => {
  const boolCols: MutationColumn[] = [
    { name: "id", data_type: "integer", is_primary_key: true },
    { name: "active", data_type: "boolean", is_primary_key: false },
    { name: "ts", data_type: "timestamp without time zone", is_primary_key: false },
    { name: "meta", data_type: "jsonb", is_primary_key: false },
  ];

  it("binds booleans as real booleans, not 1/0", () => {
    const s = buildUpdate("postgres", '"t"', boolCols, { id: 1 }, { active: "true" });
    expect(s!.sql).toBe('UPDATE "t" SET "active" = $1 WHERE "id" = $2');
    expect(s!.params).toEqual([true, 1]);
  });

  it("appends ::timestamp / ::jsonb casts for date/json columns on Postgres", () => {
    const s = buildInsert("postgres", '"t"', boolCols, {
      active: "1",
      ts: "2026-06-06 10:00:00",
      meta: '{"k":1}',
    });
    expect(s!.sql).toBe(
      'INSERT INTO "t" ("active", "ts", "meta") VALUES ($1, $2::timestamp, $3::jsonb)',
    );
    expect(s!.params).toEqual([true, "2026-06-06 10:00:00", '{"k":1}']);
  });

  it("does not cast on mysql/sqlite", () => {
    const s = buildInsert("mysql", "`t`", boolCols, { ts: "2026-06-06 10:00:00" });
    expect(s!.sql).toBe("INSERT INTO `t` (`ts`) VALUES (?)");
  });
});
