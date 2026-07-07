import { describe, expect, it } from "vitest";
import type { QueryResult } from "../types";
import type { DmlSource } from "./rawDmlSource";
import {
  NEW_VALUE_PREFIX,
  buildPreflightPlan,
  readCountValue,
  splitPreviewRows,
} from "./preflightPreview";

const COLS = ["id", "name", "status"];

const update = (partial?: Partial<DmlSource>): DmlSource => ({
  verb: "update",
  schema: null,
  table: "users",
  whereSql: "id = 1",
  setSql: "status = 'inactive'",
  hasLimitTail: false,
  ...partial,
});

const del = (partial?: Partial<DmlSource>): DmlSource => ({
  verb: "delete",
  schema: null,
  table: "users",
  whereSql: "status = 'trial'",
  setSql: null,
  hasLimitTail: false,
  ...partial,
});

describe("buildPreflightPlan — UPDATE", () => {
  it("projects SET expressions as aliased columns (postgres)", () => {
    const plan = buildPreflightPlan("postgres", update(), COLS, 1000);
    expect(plan?.previewSql).toBe(
      `SELECT *, ('inactive') AS "__ansql_new__status" FROM "users" WHERE id = 1 LIMIT 1001`,
    );
    expect(plan?.countSql).toBe(`SELECT COUNT(*) FROM "users" WHERE id = 1`);
    expect(plan?.hasWhere).toBe(true);
    expect(plan?.assignments).toEqual([{ column: "status", exprSql: "'inactive'" }]);
  });

  it("uses backticks + LIMIT for mysql", () => {
    const plan = buildPreflightPlan("mysql", update(), COLS, 10);
    expect(plan?.previewSql).toBe(
      "SELECT *, ('inactive') AS `__ansql_new__status` FROM `users` WHERE id = 1 LIMIT 11",
    );
  });

  it("uses double quotes + LIMIT for sqlite", () => {
    const plan = buildPreflightPlan("sqlite", update(), COLS, 10);
    expect(plan?.previewSql).toBe(
      `SELECT *, ('inactive') AS "__ansql_new__status" FROM "users" WHERE id = 1 LIMIT 11`,
    );
  });

  it("uses brackets + TOP for sqlserver", () => {
    const plan = buildPreflightPlan("sqlserver", update(), COLS, 10);
    expect(plan?.previewSql).toBe(
      "SELECT TOP (11) *, ('inactive') AS [__ansql_new__status] FROM [users] WHERE id = 1",
    );
  });

  it("handles multiple assignments and no WHERE", () => {
    const plan = buildPreflightPlan(
      "postgres",
      update({ whereSql: null, setSql: "name = name || '!', status = NULL" }),
      COLS,
      5,
    );
    expect(plan?.previewSql).toBe(
      `SELECT *, (name || '!') AS "__ansql_new__name", (NULL) AS "__ansql_new__status" FROM "users" LIMIT 6`,
    );
    expect(plan?.countSql).toBe(`SELECT COUNT(*) FROM "users"`);
    expect(plan?.hasWhere).toBe(false);
  });

  it("qualifies the schema", () => {
    const plan = buildPreflightPlan("postgres", update({ schema: "public" }), COLS, 5);
    expect(plan?.previewSql).toContain(`FROM "public"."users"`);
  });

  it("resolves targets case-insensitively to the metadata spelling", () => {
    const plan = buildPreflightPlan("mysql", update({ setSql: "STATUS = 'x'" }), COLS, 5);
    expect(plan?.assignments).toEqual([{ column: "status", exprSql: "'x'" }]);
    expect(plan?.previewSql).toContain("`__ansql_new__status`");
  });

  it("rejects an ambiguous case-insensitive target", () => {
    expect(
      buildPreflightPlan("postgres", update({ setSql: "name = 'x'" }), ["Name", "NAME"], 5),
    ).toBeNull();
  });

  it("rejects an unknown target column", () => {
    expect(buildPreflightPlan("postgres", update({ setSql: "nope = 1" }), COLS, 5)).toBeNull();
  });

  it("rejects a limit tail (the statement may touch fewer rows)", () => {
    expect(buildPreflightPlan("mysql", update({ hasLimitTail: true }), COLS, 5)).toBeNull();
  });

  it("rejects when a real column collides with the alias prefix", () => {
    expect(
      buildPreflightPlan("postgres", update(), [...COLS, `${NEW_VALUE_PREFIX}x`], 5),
    ).toBeNull();
  });

  it("rejects an unparseable SET clause", () => {
    expect(buildPreflightPlan("postgres", update({ setSql: "(a, b) = (1, 2)" }), COLS, 5)).toBeNull();
    expect(buildPreflightPlan("postgres", update({ setSql: null }), COLS, 5)).toBeNull();
  });

  it("rejects an alias that would exceed PostgreSQL's 63-byte limit", () => {
    const long = "c".repeat(64 - NEW_VALUE_PREFIX.length + 1);
    expect(
      buildPreflightPlan("postgres", update({ setSql: `${long} = 1` }), [...COLS, long], 5),
    ).toBeNull();
  });
});

describe("buildPreflightPlan — DELETE", () => {
  it("previews with the plain snapshot SELECT", () => {
    const plan = buildPreflightPlan("postgres", del(), COLS, 100);
    expect(plan?.previewSql).toBe(
      `SELECT * FROM "users" WHERE status = 'trial' LIMIT 101`,
    );
    expect(plan?.assignments).toEqual([]);
    expect(plan?.countSql).toBe(`SELECT COUNT(*) FROM "users" WHERE status = 'trial'`);
  });

  it("rejects a limit tail", () => {
    expect(buildPreflightPlan("mysql", del({ hasLimitTail: true }), COLS, 5)).toBeNull();
  });
});

describe("splitPreviewRows", () => {
  const assignments = [{ column: "status", exprSql: "'inactive'" }];

  it("strips preview columns from before and overlays them into after", () => {
    const rows = [
      { id: 1, name: "a", status: "active", [`${NEW_VALUE_PREFIX}status`]: "inactive" },
    ];
    expect(splitPreviewRows(rows, assignments)).toEqual([
      {
        before: { id: 1, name: "a", status: "active" },
        after: { id: 1, name: "a", status: "inactive" },
        changedColumns: ["status"],
      },
    ]);
  });

  it("reports no change when the predicted value equals the current one", () => {
    const rows = [
      { id: 1, name: "a", status: "inactive", [`${NEW_VALUE_PREFIX}status`]: "inactive" },
    ];
    expect(splitPreviewRows(rows, assignments)[0].changedColumns).toEqual([]);
  });

  it("detects value→NULL and NULL→value changes", () => {
    const toNull = splitPreviewRows(
      [{ id: 1, status: "x", [`${NEW_VALUE_PREFIX}status`]: null }],
      assignments,
    );
    expect(toNull[0].changedColumns).toEqual(["status"]);
    const fromNull = splitPreviewRows(
      [{ id: 1, status: null, [`${NEW_VALUE_PREFIX}status`]: "x" }],
      assignments,
    );
    expect(fromNull[0].changedColumns).toEqual(["status"]);
  });

  it("returns after: null for DELETE (no assignments)", () => {
    expect(splitPreviewRows([{ id: 1, status: "trial" }], [])).toEqual([
      { before: { id: 1, status: "trial" }, after: null, changedColumns: [] },
    ]);
  });
});

describe("readCountValue", () => {
  const result = (rows: Record<string, unknown>[]): QueryResult => ({
    columns: [],
    rows,
    execution_time_ms: 0,
  });

  it("reads a numeric count", () => {
    expect(readCountValue(result([{ "COUNT(*)": 42 }]))).toBe(42);
  });

  it("coerces a string count (bigint drivers)", () => {
    expect(readCountValue(result([{ count: "1247" }]))).toBe(1247);
  });

  it("returns null for empty or unreadable results", () => {
    expect(readCountValue(result([]))).toBeNull();
    expect(readCountValue(result([{ count: "abc" }]))).toBeNull();
    expect(readCountValue(result([{}]))).toBeNull();
  });
});
