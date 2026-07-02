import { describe, it, expect } from "vitest";
import { buildUpsertStatements } from "./importUpsert";
import type { MutationColumn } from "../types";

const cols: MutationColumn[] = [
  { name: "id", data_type: "int", is_primary_key: true },
  { name: "name", data_type: "varchar" },
  { name: "qty", data_type: "int" },
];

const rows = [
  { id: 1, name: "Alice", qty: 10 },
  { id: 2, name: "Bob", qty: 20 },
];

describe("buildUpsertStatements — postgres", () => {
  it("emits INSERT … ON CONFLICT (keys) DO UPDATE SET col = EXCLUDED.col", () => {
    const stmts = buildUpsertStatements("postgres", '"public"."t"', cols, ["id"], rows);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(
      'INSERT INTO "public"."t" ("id", "name", "qty") VALUES ($1, $2, $3), ($4, $5, $6)' +
        ' ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "qty" = EXCLUDED."qty"',
    );
    // numeric columns coerce to numbers, text to string
    expect(stmts[0].params).toEqual([1, "Alice", 10, 2, "Bob", 20]);
  });

  it("uses $n placeholders that increment across rows in a batch", () => {
    const stmts = buildUpsertStatements("postgres", '"t"', cols, ["id"], rows);
    expect(stmts[0].sql).toContain("VALUES ($1, $2, $3), ($4, $5, $6)");
  });

  it("appends ::type casts for date/json columns", () => {
    const dcols: MutationColumn[] = [
      { name: "id", data_type: "int", is_primary_key: true },
      { name: "created", data_type: "timestamp" },
      { name: "meta", data_type: "jsonb" },
    ];
    const stmts = buildUpsertStatements("postgres", '"t"', dcols, ["id"], [
      { id: 1, created: "2026-01-01 00:00:00", meta: '{"a":1}' },
    ]);
    expect(stmts[0].sql).toContain("$2::timestamp");
    expect(stmts[0].sql).toContain("$3::jsonb");
  });

  it("DO NOTHING when there are no non-key columns to update", () => {
    const keyOnly: MutationColumn[] = [
      { name: "a", data_type: "int", is_primary_key: true },
      { name: "b", data_type: "int", is_primary_key: true },
    ];
    const stmts = buildUpsertStatements("postgres", '"t"', keyOnly, ["a", "b"], [
      { a: 1, b: 2 },
    ]);
    expect(stmts[0].sql).toBe(
      'INSERT INTO "t" ("a", "b") VALUES ($1, $2) ON CONFLICT ("a", "b") DO NOTHING',
    );
  });

  it("supports composite conflict keys", () => {
    const stmts = buildUpsertStatements("postgres", '"t"', cols, ["id", "name"], [rows[0]]);
    expect(stmts[0].sql).toContain('ON CONFLICT ("id", "name") DO UPDATE SET "qty" = EXCLUDED."qty"');
  });
});

describe("buildUpsertStatements — mysql", () => {
  it("emits INSERT … ON DUPLICATE KEY UPDATE col = VALUES(col)", () => {
    const stmts = buildUpsertStatements("mysql", "`t`", cols, ["id"], rows);
    expect(stmts[0].sql).toBe(
      "INSERT INTO `t` (`id`, `name`, `qty`) VALUES (?, ?, ?), (?, ?, ?)" +
        " ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `qty` = VALUES(`qty`)",
    );
    expect(stmts[0].params).toEqual([1, "Alice", 10, 2, "Bob", 20]);
  });

  it("uses ? placeholders (never $n)", () => {
    const stmts = buildUpsertStatements("mysql", "`t`", cols, ["id"], rows);
    expect(stmts[0].sql).not.toContain("$1");
  });

  it("self-assigns the first key when there are no non-key columns", () => {
    const keyOnly: MutationColumn[] = [
      { name: "a", data_type: "int", is_primary_key: true },
      { name: "b", data_type: "int", is_primary_key: true },
    ];
    const stmts = buildUpsertStatements("mysql", "`t`", keyOnly, ["a", "b"], [{ a: 1, b: 2 }]);
    expect(stmts[0].sql).toContain("ON DUPLICATE KEY UPDATE `a` = `a`");
  });
});

describe("buildUpsertStatements — sqlite", () => {
  it("emits INSERT … ON CONFLICT(keys) DO UPDATE SET col = excluded.col (lowercase)", () => {
    const stmts = buildUpsertStatements("sqlite", '"t"', cols, ["id"], rows);
    expect(stmts[0].sql).toBe(
      'INSERT INTO "t" ("id", "name", "qty") VALUES (?, ?, ?), (?, ?, ?)' +
        ' ON CONFLICT ("id") DO UPDATE SET "name" = excluded."name", "qty" = excluded."qty"',
    );
    expect(stmts[0].params).toEqual([1, "Alice", 10, 2, "Bob", 20]);
  });

  it("DO NOTHING when every column is a key", () => {
    const keyOnly: MutationColumn[] = [{ name: "a", data_type: "int", is_primary_key: true }];
    const stmts = buildUpsertStatements("sqlite", '"t"', keyOnly, ["a"], [{ a: 1 }]);
    expect(stmts[0].sql).toBe('INSERT INTO "t" ("a") VALUES (?) ON CONFLICT ("a") DO NOTHING');
  });
});

describe("buildUpsertStatements — sqlserver", () => {
  it("emits a parameterized MERGE with @Pn placeholders terminated by ;", () => {
    const stmts = buildUpsertStatements("sqlserver", "[dbo].[t]", cols, ["id"], rows);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(
      "MERGE INTO [dbo].[t] AS t" +
        " USING (VALUES (@P1, @P2, @P3), (@P4, @P5, @P6)) AS s([id], [name], [qty])" +
        " ON (t.[id] = s.[id])" +
        " WHEN MATCHED THEN UPDATE SET t.[name] = s.[name], t.[qty] = s.[qty]" +
        " WHEN NOT MATCHED THEN INSERT ([id], [name], [qty]) VALUES (s.[id], s.[name], s.[qty]);",
    );
    expect(stmts[0].params).toEqual([1, "Alice", 10, 2, "Bob", 20]);
  });

  it("supports composite conflict keys in the ON clause", () => {
    const stmts = buildUpsertStatements("sqlserver", "[t]", cols, ["id", "name"], [rows[0]]);
    expect(stmts[0].sql).toContain("ON (t.[id] = s.[id] AND t.[name] = s.[name])");
    // only the remaining non-key column is updated
    expect(stmts[0].sql).toContain("WHEN MATCHED THEN UPDATE SET t.[qty] = s.[qty]");
  });

  it("drops the WHEN MATCHED branch when every column is a key (no-op on match)", () => {
    const keyOnly: MutationColumn[] = [
      { name: "a", data_type: "int", is_primary_key: true },
      { name: "b", data_type: "int", is_primary_key: true },
    ];
    const stmts = buildUpsertStatements("sqlserver", "[t]", keyOnly, ["a", "b"], [{ a: 1, b: 2 }]);
    expect(stmts[0].sql).not.toContain("WHEN MATCHED");
    expect(stmts[0].sql).toBe(
      "MERGE INTO [t] AS t" +
        " USING (VALUES (@P1, @P2)) AS s([a], [b])" +
        " ON (t.[a] = s.[a] AND t.[b] = s.[b])" +
        " WHEN NOT MATCHED THEN INSERT ([a], [b]) VALUES (s.[a], s.[b]);",
    );
  });

  it("emits NULL literally for null/missing fields and omits them from params", () => {
    const stmts = buildUpsertStatements("sqlserver", "[t]", cols, ["id"], [
      { id: 1, name: null, qty: 5 },
    ]);
    expect(stmts[0].sql).toContain("VALUES (@P1, NULL, @P2)");
    expect(stmts[0].params).toEqual([1, 5]);
  });

  it("resets @P numbering per batch", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `n${i}`, qty: i }));
    const stmts = buildUpsertStatements("sqlserver", "[t]", cols, ["id"], many, 2);
    expect(stmts).toHaveLength(3); // 2 + 2 + 1
    for (const s of stmts) expect(s.sql).toContain("VALUES (@P1, @P2, @P3)");
    expect(stmts[2].params).toHaveLength(3);
  });
});

describe("buildUpsertStatements — value handling", () => {
  it("emits NULL literally (never a bound param) and omits it from params", () => {
    const stmts = buildUpsertStatements("postgres", '"t"', cols, ["id"], [
      { id: 1, name: null, qty: 5 },
    ]);
    expect(stmts[0].sql).toContain("VALUES ($1, NULL, $2)");
    expect(stmts[0].params).toEqual([1, 5]);
  });

  it("treats undefined (missing field) as NULL", () => {
    const stmts = buildUpsertStatements("postgres", '"t"', cols, ["id"], [{ id: 1, qty: 5 }]);
    expect(stmts[0].sql).toContain("VALUES ($1, NULL, $2)");
    expect(stmts[0].params).toEqual([1, 5]);
  });

  it("coerces booleans for bool columns", () => {
    const bcols: MutationColumn[] = [
      { name: "id", data_type: "int", is_primary_key: true },
      { name: "active", data_type: "boolean" },
    ];
    const stmts = buildUpsertStatements("postgres", '"t"', bcols, ["id"], [
      { id: 1, active: "true" },
    ]);
    expect(stmts[0].params).toEqual([1, true]);
  });

  it("serializes object values to JSON text", () => {
    const jcols: MutationColumn[] = [
      { name: "id", data_type: "int", is_primary_key: true },
      { name: "meta", data_type: "jsonb" },
    ];
    const stmts = buildUpsertStatements("postgres", '"t"', jcols, ["id"], [
      { id: 1, meta: { a: 1 } },
    ]);
    expect(stmts[0].params).toEqual([1, '{"a":1}']);
  });
});

describe("buildUpsertStatements — batching", () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `n${i}`, qty: i }));

  it("groups rows into batchSize-sized multi-VALUES INSERTs", () => {
    const stmts = buildUpsertStatements("postgres", '"t"', cols, ["id"], many, 2);
    expect(stmts).toHaveLength(3); // 2 + 2 + 1
    // first batch: 2 rows → 6 placeholders, restarting $-index per statement
    expect(stmts[0].sql).toContain("VALUES ($1, $2, $3), ($4, $5, $6)");
    expect(stmts[0].params).toHaveLength(6);
    // last batch: 1 row
    expect(stmts[2].params).toHaveLength(3);
    expect(stmts[2].sql).toContain("VALUES ($1, $2, $3)");
  });

  it("resets placeholder numbering per statement", () => {
    const stmts = buildUpsertStatements("postgres", '"t"', cols, ["id"], many, 2);
    // each statement starts at $1
    for (const s of stmts) expect(s.sql).toContain("VALUES ($1, $2, $3)");
  });

  it("a single batch when batchSize >= row count", () => {
    const stmts = buildUpsertStatements("postgres", '"t"', cols, ["id"], many, 100);
    expect(stmts).toHaveLength(1);
  });

  it("returns [] for empty rows", () => {
    expect(buildUpsertStatements("postgres", '"t"', cols, ["id"], [])).toEqual([]);
  });

  it("returns [] when there are no columns", () => {
    expect(buildUpsertStatements("postgres", '"t"', [], ["id"], rows)).toEqual([]);
  });
});
