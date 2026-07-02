import { describe, it, expect } from "vitest";
import { buildExplain } from "./explain";

const SQL = "SELECT id, name FROM users WHERE id = 1";

describe("buildExplain", () => {
  describe("postgres", () => {
    it("text prefixes EXPLAIN", () => {
      expect(buildExplain(SQL, "postgres", "text")).toBe(`EXPLAIN ${SQL}`);
    });

    it("json prefixes EXPLAIN (FORMAT JSON)", () => {
      expect(buildExplain(SQL, "postgres", "json")).toBe(`EXPLAIN (FORMAT JSON) ${SQL}`);
    });
  });

  describe("mysql", () => {
    it("text prefixes EXPLAIN", () => {
      expect(buildExplain(SQL, "mysql", "text")).toBe(`EXPLAIN ${SQL}`);
    });

    it("json prefixes EXPLAIN FORMAT=JSON", () => {
      expect(buildExplain(SQL, "mysql", "json")).toBe(`EXPLAIN FORMAT=JSON ${SQL}`);
    });
  });

  describe("sqlite", () => {
    it("text uses EXPLAIN QUERY PLAN", () => {
      expect(buildExplain(SQL, "sqlite", "text")).toBe(`EXPLAIN QUERY PLAN ${SQL}`);
    });

    it("json falls back to EXPLAIN QUERY PLAN (no JSON format)", () => {
      expect(buildExplain(SQL, "sqlite", "json")).toBe(`EXPLAIN QUERY PLAN ${SQL}`);
    });
  });

  describe("sqlserver", () => {
    it("returns the statement unchanged (no inline EXPLAIN)", () => {
      expect(buildExplain(SQL, "sqlserver", "text")).toBe(SQL);
    });

    it("ignores the format (still no plan)", () => {
      expect(buildExplain(SQL, "sqlserver", "json")).toBe(SQL);
    });

    it("still strips a trailing semicolon", () => {
      expect(buildExplain(`${SQL};`, "sqlserver", "text")).toBe(SQL);
    });
  });

  describe("trailing semicolon", () => {
    it("strips a single trailing ;", () => {
      expect(buildExplain(`${SQL};`, "postgres", "text")).toBe(`EXPLAIN ${SQL}`);
    });

    it("strips a trailing ; with surrounding whitespace", () => {
      expect(buildExplain(`  ${SQL} ;  `, "mysql", "json")).toBe(`EXPLAIN FORMAT=JSON ${SQL}`);
    });
  });

  describe("already-EXPLAIN statements", () => {
    it("does not double-prefix an EXPLAIN statement", () => {
      const already = "EXPLAIN SELECT 1";
      expect(buildExplain(already, "postgres", "json")).toBe(already);
    });

    it("is case-insensitive when detecting EXPLAIN", () => {
      const already = "explain analyze SELECT 1";
      expect(buildExplain(already, "postgres", "text")).toBe(already);
    });

    it("strips a trailing ; from an already-EXPLAIN statement", () => {
      expect(buildExplain("EXPLAIN SELECT 1;", "mysql", "text")).toBe("EXPLAIN SELECT 1");
    });

    it("does not treat EXPLAINER (a word starting with explain) as EXPLAIN", () => {
      // word boundary guards against false positives on identifiers
      expect(buildExplain("SELECT * FROM explainers", "postgres", "text")).toBe(
        "EXPLAIN SELECT * FROM explainers",
      );
    });
  });
});
