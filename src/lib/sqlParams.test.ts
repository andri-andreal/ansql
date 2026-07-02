import { describe, it, expect } from "vitest";
import {
  extractParamNames,
  applyParamsAsPlaceholders,
  applyParamsRaw,
} from "./sqlParams";

describe("extractParamNames", () => {
  it("returns names in first-appearance order", () => {
    const sql = "SELECT * FROM t WHERE a = [$alpha] AND b = [$beta]";
    expect(extractParamNames(sql)).toEqual(["alpha", "beta"]);
  });

  it("de-duplicates repeated names keeping first position", () => {
    const sql =
      "SELECT * FROM t WHERE a = [$id] OR b = [$name] OR c = [$id]";
    expect(extractParamNames(sql)).toEqual(["id", "name"]);
  });

  it("supports digits and underscores in names", () => {
    const sql = "WHERE x = [$user_id_2]";
    expect(extractParamNames(sql)).toEqual(["user_id_2"]);
  });

  it("returns empty array when there are no placeholders", () => {
    expect(extractParamNames("SELECT 1")).toEqual([]);
  });
});

describe("applyParamsAsPlaceholders — mysql / sqlite", () => {
  it("emits positional ? and collects values in order (mysql)", () => {
    const sql = "SELECT * FROM t WHERE a = [$a] AND b = [$b]";
    const out = applyParamsAsPlaceholders(sql, { a: "1", b: "two" }, "mysql");
    expect(out.sql).toBe("SELECT * FROM t WHERE a = ? AND b = ?");
    expect(out.params).toEqual(["1", "two"]);
  });

  it("repeats ? and pushes the value once per occurrence (mysql)", () => {
    const sql = "WHERE a = [$id] OR b = [$id]";
    const out = applyParamsAsPlaceholders(sql, { id: "7" }, "mysql");
    expect(out.sql).toBe("WHERE a = ? OR b = ?");
    expect(out.params).toEqual(["7", "7"]);
  });

  it("behaves identically for sqlite", () => {
    const sql = "WHERE a = [$a] AND b = [$a]";
    const out = applyParamsAsPlaceholders(sql, { a: "x" }, "sqlite");
    expect(out.sql).toBe("WHERE a = ? AND b = ?");
    expect(out.params).toEqual(["x", "x"]);
  });

  it("defaults missing values to empty string", () => {
    const sql = "WHERE a = [$a] AND b = [$b]";
    const out = applyParamsAsPlaceholders(sql, { a: "1" }, "mysql");
    expect(out.params).toEqual(["1", ""]);
  });
});

describe("applyParamsAsPlaceholders — postgres", () => {
  it("emits $1..$n in first-appearance order", () => {
    const sql = "SELECT * FROM t WHERE a = [$a] AND b = [$b]";
    const out = applyParamsAsPlaceholders(sql, { a: "1", b: "two" }, "postgres");
    expect(out.sql).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
    expect(out.params).toEqual(["1", "two"]);
  });

  it("reuses the same $n for a repeated name and pushes value once", () => {
    const sql = "WHERE a = [$id] OR b = [$name] OR c = [$id]";
    const out = applyParamsAsPlaceholders(
      sql,
      { id: "7", name: "ana" },
      "postgres"
    );
    expect(out.sql).toBe("WHERE a = $1 OR b = $2 OR c = $1");
    expect(out.params).toEqual(["7", "ana"]);
  });

  it("defaults missing values to empty string", () => {
    const sql = "WHERE a = [$a]";
    const out = applyParamsAsPlaceholders(sql, {}, "postgres");
    expect(out.sql).toBe("WHERE a = $1");
    expect(out.params).toEqual([""]);
  });
});

describe("applyParamsRaw", () => {
  it("substitutes raw values literally", () => {
    const sql = "SELECT * FROM [$table] WHERE id = [$id]";
    const out = applyParamsRaw(sql, { table: "users", id: "42" });
    expect(out).toBe("SELECT * FROM users WHERE id = 42");
  });

  it("substitutes every occurrence of a repeated name", () => {
    const sql = "WHERE a = [$v] OR b = [$v]";
    expect(applyParamsRaw(sql, { v: "ok" })).toBe("WHERE a = ok OR b = ok");
  });

  it("defaults missing values to empty string", () => {
    expect(applyParamsRaw("x = [$missing]", {})).toBe("x = ");
  });
});
