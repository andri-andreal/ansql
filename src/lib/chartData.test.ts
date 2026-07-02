import { describe, it, expect } from "vitest";
import { buildChartData, type ChartSpec } from "./chartData";
import type { QueryResult } from "../types";

const result = (
  columns: string[],
  rows: Record<string, unknown>[]
): QueryResult => ({
  columns: columns.map((name) => ({ name, data_type: "text", nullable: true })),
  rows,
  execution_time_ms: 0,
});

const spec = (xColumn: string, yColumns: string[]): ChartSpec => ({
  type: "bar",
  xColumn,
  yColumns,
});

describe("buildChartData", () => {
  it("projects rows to { x, ...yColumns } and coerces y to numbers", () => {
    const r = result(
      ["month", "sales", "visits"],
      [
        { month: "Jan", sales: 10, visits: 100 },
        { month: "Feb", sales: 20, visits: 200 },
      ]
    );
    const { rows, numericYColumns } = buildChartData(r, spec("month", ["sales", "visits"]));
    expect(numericYColumns).toEqual(["sales", "visits"]);
    expect(rows).toEqual([
      { x: "Jan", sales: 10, visits: 100 },
      { x: "Feb", sales: 20, visits: 200 },
    ]);
  });

  it("coerces numeric strings and booleans, non-numeric cells become 0", () => {
    const r = result(
      ["label", "amount"],
      [
        { label: "a", amount: "12.5" },
        { label: "b", amount: "  " },
        { label: "c", amount: true },
      ]
    );
    const { rows, numericYColumns } = buildChartData(r, spec("label", ["amount"]));
    expect(numericYColumns).toEqual(["amount"]);
    expect(rows).toEqual([
      { x: "a", amount: 12.5 },
      { x: "b", amount: 0 },
      { x: "c", amount: 1 },
    ]);
  });

  it("drops y columns that are never numeric", () => {
    const r = result(
      ["name", "city", "qty"],
      [
        { name: "x", city: "NYC", qty: 3 },
        { name: "y", city: "LA", qty: 5 },
      ]
    );
    const { rows, numericYColumns } = buildChartData(r, spec("name", ["city", "qty"]));
    expect(numericYColumns).toEqual(["qty"]);
    // The non-numeric "city" column is absent from the projected rows.
    expect(rows).toEqual([
      { x: "x", qty: 3 },
      { x: "y", qty: 5 },
    ]);
  });

  it("keeps a y column numeric when at least one row coerces", () => {
    const r = result(
      ["k", "v"],
      [
        { k: "a", v: null },
        { k: "b", v: "42" },
      ]
    );
    const { numericYColumns, rows } = buildChartData(r, spec("k", ["v"]));
    expect(numericYColumns).toEqual(["v"]);
    expect(rows).toEqual([
      { x: "a", v: 0 },
      { x: "b", v: 42 },
    ]);
  });

  it("ignores y columns not present in the result and the x column itself", () => {
    const r = result(
      ["x", "y"],
      [{ x: "a", y: 1 }]
    );
    const { numericYColumns } = buildChartData(r, spec("x", ["x", "y", "missing"]));
    expect(numericYColumns).toEqual(["y"]);
  });

  it("stringifies the x value and treats null/undefined as empty string", () => {
    const r = result(
      ["cat", "n"],
      [
        { cat: 5, n: 1 },
        { cat: null, n: 2 },
      ]
    );
    const { rows } = buildChartData(r, spec("cat", ["n"]));
    expect(rows[0].x).toBe("5");
    expect(rows[1].x).toBe("");
  });

  it("handles an empty result set", () => {
    const r = result(["a", "b"], []);
    const { rows, numericYColumns } = buildChartData(r, spec("a", ["b"]));
    expect(rows).toEqual([]);
    // No rows means no column can be proven numeric.
    expect(numericYColumns).toEqual([]);
  });
});
