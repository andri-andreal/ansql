import { describe, it, expect } from "vitest";
import {
  matchesFilter,
  rowMatchesFilters,
  rowMatchesSearch,
  applyGridFilters,
  isFilterActive,
  type ColumnFilter,
} from "./gridFilter";

const f = (
  operator: ColumnFilter["operator"],
  value = "",
  column = "c"
): ColumnFilter => ({ column, operator, value });

describe("matchesFilter", () => {
  it("contains is case-insensitive", () => {
    expect(matchesFilter("Hello World", f("contains", "world"))).toBe(true);
    expect(matchesFilter("Hello", f("contains", "xyz"))).toBe(false);
  });

  it("equals / not_equals", () => {
    expect(matchesFilter("abc", f("equals", "ABC"))).toBe(true);
    expect(matchesFilter("abc", f("not_equals", "ABC"))).toBe(false);
    expect(matchesFilter("abc", f("not_equals", "x"))).toBe(true);
  });

  it("starts_with / ends_with", () => {
    expect(matchesFilter("foobar", f("starts_with", "foo"))).toBe(true);
    expect(matchesFilter("foobar", f("ends_with", "bar"))).toBe(true);
    expect(matchesFilter("foobar", f("starts_with", "bar"))).toBe(false);
  });

  it("numeric comparisons compare numerically", () => {
    expect(matchesFilter(5, f("gt", "10"))).toBe(false);
    expect(matchesFilter(50, f("gt", "10"))).toBe(true);
    expect(matchesFilter("9", f("lt", "10"))).toBe(true); // numeric, not lexical
    expect(matchesFilter(10, f("gte", "10"))).toBe(true);
    expect(matchesFilter(10, f("lte", "10"))).toBe(true);
  });

  it("falls back to string comparison for non-numeric operands", () => {
    expect(matchesFilter("banana", f("gt", "apple"))).toBe(true);
    expect(matchesFilter("apple", f("lt", "banana"))).toBe(true);
  });

  it("is_null / is_not_null", () => {
    expect(matchesFilter(null, f("is_null"))).toBe(true);
    expect(matchesFilter(undefined, f("is_null"))).toBe(true);
    expect(matchesFilter("x", f("is_null"))).toBe(false);
    expect(matchesFilter(null, f("is_not_null"))).toBe(false);
    expect(matchesFilter("x", f("is_not_null"))).toBe(true);
  });

  it("null cell never matches value-based operators", () => {
    expect(matchesFilter(null, f("contains", "a"))).toBe(false);
    expect(matchesFilter(null, f("equals", ""))).toBe(false);
  });

  it("serializes object cell values", () => {
    expect(matchesFilter({ a: 1 }, f("contains", '"a":1'))).toBe(true);
  });
});

describe("isFilterActive", () => {
  it("valueless operators are always active", () => {
    expect(isFilterActive(f("is_null"))).toBe(true);
  });
  it("value operators need a non-empty value", () => {
    expect(isFilterActive(f("contains", ""))).toBe(false);
    expect(isFilterActive(f("contains", "x"))).toBe(true);
  });
});

describe("rowMatchesFilters", () => {
  it("ANDs all active filters and ignores inactive ones", () => {
    const row = { a: "hello", b: 5 };
    const filters: ColumnFilter[] = [
      { column: "a", operator: "contains", value: "ell" },
      { column: "b", operator: "gt", value: "3" },
      { column: "a", operator: "contains", value: "" }, // inactive, ignored
    ];
    expect(rowMatchesFilters(row, filters)).toBe(true);
    expect(
      rowMatchesFilters(row, [{ column: "b", operator: "gt", value: "10" }])
    ).toBe(false);
  });
});

describe("rowMatchesSearch", () => {
  it("matches across columns, ignores nulls", () => {
    const row = { a: "alpha", b: null };
    expect(rowMatchesSearch(row, ["a", "b"], "pha")).toBe(true);
    expect(rowMatchesSearch(row, ["a", "b"], "zzz")).toBe(false);
    expect(rowMatchesSearch(row, ["a", "b"], "")).toBe(true);
  });
});

describe("applyGridFilters", () => {
  const rows = [
    { a: "apple", n: 1 },
    { a: "banana", n: 2 },
    { a: "cherry", n: 3 },
  ];
  it("returns same array reference when nothing active", () => {
    expect(applyGridFilters(rows, ["a", "n"], "", [])).toBe(rows);
  });
  it("combines search AND filters", () => {
    const out = applyGridFilters(rows, ["a", "n"], "a", [
      { column: "n", operator: "gte", value: "2" },
    ]);
    expect(out.map((r) => r.a)).toEqual(["banana"]);
  });
});
