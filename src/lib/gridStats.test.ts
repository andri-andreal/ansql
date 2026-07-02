import { describe, it, expect } from "vitest";
import {
  aggregateSelection,
  buildColumnStatsSql,
  parseColumnStats,
} from "./gridStats";

describe("aggregateSelection", () => {
  it("returns zeroed/null stats for an empty selection", () => {
    expect(aggregateSelection([])).toEqual({
      count: 0,
      numericCount: 0,
      sum: null,
      avg: null,
      min: null,
      max: null,
    });
  });

  it("computes sum/avg/min/max over numeric values", () => {
    expect(aggregateSelection([1, 2, 3, 4])).toEqual({
      count: 4,
      numericCount: 4,
      sum: 10,
      avg: 2.5,
      min: 1,
      max: 4,
    });
  });

  it("parses numeric strings and trims whitespace", () => {
    expect(aggregateSelection(["10", " 20 ", "30"])).toEqual({
      count: 3,
      numericCount: 3,
      sum: 60,
      avg: 20,
      min: 10,
      max: 30,
    });
  });

  it("counts everything but ignores non-numeric values in numeric stats", () => {
    const r = aggregateSelection([5, "hello", null, undefined, "", 15]);
    expect(r.count).toBe(6);
    expect(r.numericCount).toBe(2);
    expect(r.sum).toBe(20);
    expect(r.avg).toBe(10);
    expect(r.min).toBe(5);
    expect(r.max).toBe(15);
  });

  it("ignores booleans, objects, and non-finite numbers", () => {
    const r = aggregateSelection([true, false, {}, [], NaN, Infinity, 7]);
    expect(r.count).toBe(7);
    expect(r.numericCount).toBe(1);
    expect(r.sum).toBe(7);
    expect(r.min).toBe(7);
    expect(r.max).toBe(7);
  });

  it("returns null numeric stats when nothing is numeric", () => {
    const r = aggregateSelection(["a", "b", null]);
    expect(r).toEqual({
      count: 3,
      numericCount: 0,
      sum: null,
      avg: null,
      min: null,
      max: null,
    });
  });

  it("handles negative numbers for min/max", () => {
    const r = aggregateSelection([-5, -1, -10, -3]);
    expect(r.min).toBe(-10);
    expect(r.max).toBe(-1);
    expect(r.sum).toBe(-19);
  });
});

describe("buildColumnStatsSql", () => {
  it("quotes the column with backticks for mysql", () => {
    expect(buildColumnStatsSql("mysql", "`db`.`users`", "age")).toBe(
      "SELECT COUNT(*) AS total, COUNT(`age`) AS non_null, " +
        "COUNT(DISTINCT `age`) AS distinct_count, " +
        "MIN(`age`) AS min_val, MAX(`age`) AS max_val FROM `db`.`users`",
    );
  });

  it("quotes the column with double quotes for postgres", () => {
    expect(buildColumnStatsSql("postgres", '"public"."users"', "email")).toBe(
      'SELECT COUNT(*) AS total, COUNT("email") AS non_null, ' +
        'COUNT(DISTINCT "email") AS distinct_count, ' +
        'MIN("email") AS min_val, MAX("email") AS max_val FROM "public"."users"',
    );
  });

  it("escapes embedded quote characters in the column name", () => {
    expect(buildColumnStatsSql("postgres", '"t"', 'we"ird')).toContain(
      'COUNT("we""ird")',
    );
  });

  it("quotes the column with brackets for sqlserver", () => {
    expect(buildColumnStatsSql("sqlserver", "[dbo].[users]", "age")).toBe(
      "SELECT COUNT(*) AS total, COUNT([age]) AS non_null, " +
        "COUNT(DISTINCT [age]) AS distinct_count, " +
        "MIN([age]) AS min_val, MAX([age]) AS max_val FROM [dbo].[users]",
    );
  });

  it("escapes a closing bracket in the column name for sqlserver", () => {
    expect(buildColumnStatsSql("sqlserver", "[t]", "we]ird")).toContain(
      "COUNT([we]]ird])",
    );
  });
});

describe("parseColumnStats", () => {
  it("maps a stats row and computes nullPct", () => {
    expect(
      parseColumnStats({
        total: 100,
        non_null: 80,
        distinct_count: 12,
        min_val: 1,
        max_val: 99,
      }),
    ).toEqual({
      total: 100,
      nonNull: 80,
      distinct: 12,
      nullPct: 20,
      min: 1,
      max: 99,
    });
  });

  it("coerces string counts (driver-returned) to numbers", () => {
    const s = parseColumnStats({
      total: "50",
      non_null: "50",
      distinct_count: "50",
      min_val: "a",
      max_val: "z",
    });
    expect(s.total).toBe(50);
    expect(s.nonNull).toBe(50);
    expect(s.distinct).toBe(50);
    expect(s.nullPct).toBe(0);
    expect(s.min).toBe("a");
    expect(s.max).toBe("z");
  });

  it("yields 0 nullPct for an empty table", () => {
    const s = parseColumnStats({
      total: 0,
      non_null: 0,
      distinct_count: 0,
      min_val: null,
      max_val: null,
    });
    expect(s.nullPct).toBe(0);
    expect(s.min).toBeNull();
    expect(s.max).toBeNull();
  });

  it("defaults missing/undefined min/max to null", () => {
    const s = parseColumnStats({ total: 10, non_null: 5, distinct_count: 3 });
    expect(s.min).toBeNull();
    expect(s.max).toBeNull();
    expect(s.nullPct).toBe(50);
  });
});
