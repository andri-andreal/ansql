import { describe, it, expect } from "vitest";
import { splitStatements, statementAtOffset } from "./statementSplitter";

const texts = (sql: string) => splitStatements(sql).map((s) => s.text);

describe("splitStatements", () => {
  it("splits two simple statements", () => {
    expect(texts("SELECT 1; SELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("keeps a trailing statement with no terminating semicolon", () => {
    expect(texts("SELECT 1; SELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("returns nothing for empty / whitespace input", () => {
    expect(splitStatements("")).toEqual([]);
    expect(splitStatements("   \n\t  ")).toEqual([]);
    expect(splitStatements(";;;")).toEqual([]);
  });

  it("drops comment-only fragments", () => {
    expect(texts("-- just a comment\n")).toEqual([]);
    expect(texts("/* block only */")).toEqual([]);
    expect(texts("SELECT 1; -- trailing comment")).toEqual(["SELECT 1"]);
  });

  it("ignores semicolons inside single-quoted strings", () => {
    expect(texts("SELECT 'a;b'; SELECT 2")).toEqual(["SELECT 'a;b'", "SELECT 2"]);
  });

  it("handles doubled single-quote escapes", () => {
    expect(texts("SELECT 'it''s; ok'; SELECT 2")).toEqual([
      "SELECT 'it''s; ok'",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside double-quoted identifiers", () => {
    expect(texts('SELECT "a;col"; SELECT 2')).toEqual(['SELECT "a;col"', "SELECT 2"]);
  });

  it("ignores semicolons inside backtick identifiers", () => {
    expect(texts("SELECT `weird;name`; SELECT 2")).toEqual([
      "SELECT `weird;name`",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside line comments", () => {
    expect(texts("SELECT 1 -- a; b\n; SELECT 2")).toEqual([
      "SELECT 1 -- a; b",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside block comments", () => {
    expect(texts("SELECT 1 /* a; b; c */; SELECT 2")).toEqual([
      "SELECT 1 /* a; b; c */",
      "SELECT 2",
    ]);
  });

  it("ignores a comment marker that lives inside a string", () => {
    expect(texts("SELECT '-- not a comment;'; SELECT 2")).toEqual([
      "SELECT '-- not a comment;'",
      "SELECT 2",
    ]);
  });

  it("keeps a Postgres $$ dollar-quoted body with internal ';' as ONE statement", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS int AS $$",
      "BEGIN",
      "  RETURN 1;",
      "  RETURN 2;",
      "END;",
      "$$ LANGUAGE plpgsql;",
      "SELECT 1;",
    ].join("\n");
    const r = texts(sql);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain("CREATE FUNCTION");
    expect(r[0]).toContain("RETURN 1;");
    expect(r[0]).toContain("END;");
    expect(r[0]).toContain("$$ LANGUAGE plpgsql");
    expect(r[1]).toBe("SELECT 1");
  });

  it("keeps a tagged dollar-quoted body ($body$ … $body$) as ONE statement", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS int AS $body$",
      "BEGIN RETURN 1; END;",
      "$body$ LANGUAGE plpgsql;",
      "SELECT 2;",
    ].join("\n");
    const r = texts(sql);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain("$body$");
    expect(r[0]).toContain("RETURN 1;");
    expect(r[1]).toBe("SELECT 2");
  });

  it("does not treat a different inner tag as a close of the outer dollar quote", () => {
    const sql = "DO $outer$ SELECT $inner$ a;b $inner$; $outer$; SELECT 9;";
    const r = texts(sql);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain("$outer$");
    expect(r[0]).toContain("$inner$");
    expect(r[0]).toContain("a;b");
    expect(r[1]).toBe("SELECT 9");
  });

  it("handles MySQL DELIMITER // … // with internal semicolons", () => {
    const sql = [
      "DELIMITER //",
      "CREATE PROCEDURE p()",
      "BEGIN",
      "  SELECT 1;",
      "  SELECT 2;",
      "END//",
      "DELIMITER ;",
      "SELECT 3;",
    ].join("\n");
    const r = texts(sql);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain("CREATE PROCEDURE p()");
    expect(r[0]).toContain("SELECT 1;");
    expect(r[0]).toContain("SELECT 2;");
    expect(r[0]).toContain("END");
    // DELIMITER directives themselves are not emitted as statements.
    expect(r.some((s) => /DELIMITER/i.test(s))).toBe(false);
    expect(r[1]).toBe("SELECT 3");
  });

  it("recognises DELIMITER case-insensitively", () => {
    const sql = "delimiter //\nSELECT 1; SELECT 2//\ndelimiter ;\nSELECT 3;";
    const r = texts(sql);
    expect(r).toHaveLength(2);
    expect(r[0]).toContain("SELECT 1;");
    expect(r[0]).toContain("SELECT 2");
    expect(r[1]).toBe("SELECT 3");
  });

  it("does not treat a word containing 'delimiter' mid-statement as a directive", () => {
    // `DELIMITER` only counts at a statement boundary.
    const sql = "SELECT 'DELIMITER //' AS x; SELECT 2;";
    expect(texts(sql)).toEqual(["SELECT 'DELIMITER //' AS x", "SELECT 2"]);
  });

  it("reports correct start/end offsets into the original buffer", () => {
    const sql = "  SELECT 1;  SELECT 2";
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(2);
    // First statement text starts after the leading two spaces.
    expect(sql.slice(stmts[0].start, stmts[0].end)).toBe("SELECT 1");
    expect(stmts[0].start).toBe(2);
    expect(sql.slice(stmts[1].start, stmts[1].end)).toBe("SELECT 2");
  });
});

describe("statementAtOffset", () => {
  const sql = "SELECT 1; SELECT 22; SELECT 333";
  // offsets:   0123456789...

  it("returns the statement containing the offset", () => {
    const s = statementAtOffset(sql, 3); // inside "SELECT 1"
    expect(s?.text).toBe("SELECT 1");
  });

  it("returns the second statement for an offset inside it", () => {
    const idx = sql.indexOf("SELECT 22") + 2;
    expect(statementAtOffset(sql, idx)?.text).toBe("SELECT 22");
  });

  it("returns the trailing statement for the final offset", () => {
    expect(statementAtOffset(sql, sql.length)?.text).toBe("SELECT 333");
  });

  it("returns the nearest preceding statement when the offset is on a separator/gap", () => {
    const semicolon = sql.indexOf(";"); // boundary after "SELECT 1"
    expect(statementAtOffset(sql, semicolon)?.text).toBe("SELECT 1");
    // The space between ';' and the next 'SELECT' is still in the gap.
    expect(statementAtOffset(sql, semicolon + 1)?.text).toBe("SELECT 1");
  });

  it("returns null before the first statement", () => {
    const padded = "   SELECT 1;";
    expect(statementAtOffset(padded, 0)).toBeNull();
  });

  it("returns null when there are no statements", () => {
    expect(statementAtOffset("", 0)).toBeNull();
    expect(statementAtOffset("  -- c\n", 0)).toBeNull();
  });

  it("locates the correct statement across a dollar-quoted body", () => {
    const sql2 = [
      "CREATE FUNCTION f() AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;",
      "SELECT 99;",
    ].join("\n");
    // Offset inside the body's internal RETURN should map to the CREATE stmt.
    const inside = sql2.indexOf("RETURN 1");
    expect(statementAtOffset(sql2, inside)?.text).toContain("CREATE FUNCTION");
    const tail = sql2.indexOf("SELECT 99") + 2;
    expect(statementAtOffset(sql2, tail)?.text).toBe("SELECT 99");
  });
});
