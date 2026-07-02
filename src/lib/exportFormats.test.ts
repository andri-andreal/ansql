import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildXlsx,
  buildInsertSql,
  buildHtml,
  buildXml,
  buildDelimitedText,
  DEFAULT_SQL_BATCH_SIZE,
} from "./exportFormats";

const columns = ["id", "name", "active"];
const rows: Record<string, unknown>[] = [
  { id: 1, name: "Alice", active: true },
  { id: 2, name: "Bob", active: false },
];

describe("buildXlsx", () => {
  it("produces a parseable workbook with header + rows in column order", () => {
    const bytes = buildXlsx(columns, rows);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    const wb = XLSX.read(bytes, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe(1);
    expect(parsed[0].name).toBe("Alice");
    expect(parsed[1].name).toBe("Bob");

    // Header order matches the requested column order.
    const header = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0];
    expect(header).toEqual(columns);
  });

  it("fills missing keys with blank cells", () => {
    const bytes = buildXlsx(columns, [{ id: 3 }]);
    const wb = XLSX.read(bytes, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(parsed[0].id).toBe(3);
    expect(parsed[0].name).toBeUndefined();
  });
});

describe("buildInsertSql", () => {
  it("returns empty string for no rows / no columns", () => {
    expect(buildInsertSql("t", columns, [], "mysql")).toBe("");
    expect(buildInsertSql("t", [], rows, "mysql")).toBe("");
  });

  it("quotes identifiers with backticks for mysql", () => {
    const sql = buildInsertSql("users", ["id", "name"], [{ id: 1, name: "x" }], "mysql");
    expect(sql).toContain("INSERT INTO `users` (`id`, `name`) VALUES");
  });

  it("quotes identifiers with double quotes for postgres and sqlite", () => {
    const pg = buildInsertSql("users", ["id"], [{ id: 1 }], "postgres");
    expect(pg).toContain('INSERT INTO "users" ("id") VALUES');
    const sq = buildInsertSql("users", ["id"], [{ id: 1 }], "sqlite");
    expect(sq).toContain('INSERT INTO "users" ("id") VALUES');
  });

  it("escapes embedded quotes in identifiers", () => {
    expect(buildInsertSql("a`b", ["c"], [{ c: 1 }], "mysql")).toContain("`a``b`");
    expect(buildInsertSql('a"b', ["c"], [{ c: 1 }], "postgres")).toContain('"a""b"');
  });

  it("quotes identifiers with brackets for sqlserver (doubling ])", () => {
    const sql = buildInsertSql("users", ["id", "name"], [{ id: 1, name: "x" }], "sqlserver");
    expect(sql).toContain("INSERT INTO [users] ([id], [name]) VALUES");
    expect(buildInsertSql("a]b", ["c"], [{ c: 1 }], "sqlserver")).toContain("[a]]b]");
  });

  it("renders BIT 1/0 booleans and does not escape backslashes for sqlserver", () => {
    expect(buildInsertSql("t", ["a"], [{ a: true }], "sqlserver")).toContain("(1)");
    expect(buildInsertSql("t", ["a"], [{ a: false }], "sqlserver")).toContain("(0)");
    // Only MySQL escapes backslashes; sqlserver takes the literal verbatim.
    const ss = buildInsertSql("t", ["a"], [{ a: "c:\\path" }], "sqlserver");
    expect(ss).toContain("('c:\\path')");
    // single quotes are still doubled.
    expect(buildInsertSql("t", ["a"], [{ a: "O'Brien" }], "sqlserver")).toContain("('O''Brien')");
  });

  it("renders NULL, numbers raw, and single-quoted strings", () => {
    const sql = buildInsertSql(
      "t",
      ["a", "b", "c"],
      [{ a: null, b: 42, c: "hi" }],
      "postgres"
    );
    expect(sql).toContain("(NULL, 42, 'hi')");
  });

  it("treats missing keys as NULL", () => {
    const sql = buildInsertSql("t", ["a", "b"], [{ a: 1 }], "postgres");
    expect(sql).toContain("(1, NULL)");
  });

  it("escapes single quotes by doubling them", () => {
    const sql = buildInsertSql("t", ["a"], [{ a: "O'Brien" }], "postgres");
    expect(sql).toContain("('O''Brien')");
  });

  it("escapes backslashes for mysql only", () => {
    const my = buildInsertSql("t", ["a"], [{ a: "c:\\path" }], "mysql");
    expect(my).toContain("('c:\\\\path')");
    const pg = buildInsertSql("t", ["a"], [{ a: "c:\\path" }], "postgres");
    expect(pg).toContain("('c:\\path')");
  });

  it("renders booleans per dialect", () => {
    expect(buildInsertSql("t", ["a"], [{ a: true }], "postgres")).toContain("(TRUE)");
    expect(buildInsertSql("t", ["a"], [{ a: false }], "postgres")).toContain("(FALSE)");
    expect(buildInsertSql("t", ["a"], [{ a: true }], "mysql")).toContain("(1)");
    expect(buildInsertSql("t", ["a"], [{ a: false }], "sqlite")).toContain("(0)");
  });

  it("batches rows into multiple statements", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const sql = buildInsertSql("t", ["id"], many, "postgres", 2);
    const statementCount = (sql.match(/INSERT INTO/g) || []).length;
    expect(statementCount).toBe(3); // 2 + 2 + 1
  });

  it("emits a single statement when rows fit one batch", () => {
    const sql = buildInsertSql("t", columns, rows, "mysql");
    expect((sql.match(/INSERT INTO/g) || []).length).toBe(1);
    expect(DEFAULT_SQL_BATCH_SIZE).toBeGreaterThan(rows.length);
  });
});

const htmlCols = [{ name: "id" }, { name: "name" }];

describe("buildHtml", () => {
  it("emits a table with thead, tbody, and rows in column order", () => {
    const html = buildHtml(htmlCols, [{ id: 1, name: "Alice" }]);
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<th>id</th>");
    expect(html).toContain("<th>name</th>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("<td>Alice</td>");
    // header precedes the data row
    expect(html.indexOf("<thead>")).toBeLessThan(html.indexOf("<tbody>"));
  });

  it("escapes HTML special characters in headers and cells", () => {
    const html = buildHtml([{ name: "a<b>" }], [{ "a<b>": '<script>&"\'' }]);
    expect(html).toContain("<th>a&lt;b&gt;</th>");
    expect(html).toContain("<td>&lt;script&gt;&amp;&quot;&#39;</td>");
    expect(html).not.toContain("<script>");
  });

  it("renders missing/null cells as empty and keeps an empty tbody with no rows", () => {
    const html = buildHtml(htmlCols, [{ id: 1, name: null }]);
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("<td></td>");

    const empty = buildHtml(htmlCols, []);
    expect(empty).toContain("<tbody>");
    expect(empty).toContain("</tbody>");
    expect(empty).not.toContain("<tr>\n      <td>");
  });
});

describe("buildXml", () => {
  it("wraps rows in default <rows>/<row> with per-column tags", () => {
    const xml = buildXml(htmlCols, [{ id: 1, name: "Alice" }]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<rows>");
    expect(xml).toContain("</rows>");
    expect(xml).toContain("<row>");
    expect(xml).toContain("<id>1</id>");
    expect(xml).toContain("<name>Alice</name>");
  });

  it("honors custom root and row tags", () => {
    const xml = buildXml([{ name: "x" }], [{ x: 1 }], "data", "item");
    expect(xml).toContain("<data>");
    expect(xml).toContain("</data>");
    expect(xml).toContain("<item>");
    expect(xml).toContain("</item>");
  });

  it("escapes XML special characters in cell text", () => {
    const xml = buildXml([{ name: "v" }], [{ v: '<a>&"\'' }]);
    expect(xml).toContain("<v>&lt;a&gt;&amp;&quot;&#39;</v>");
  });

  it("emits empty element for null and an empty body with no rows", () => {
    const xml = buildXml([{ name: "v" }], [{ v: null }]);
    expect(xml).toContain("<v></v>");

    const empty = buildXml(htmlCols, []);
    expect(empty).toContain("<rows>");
    expect(empty).toContain("</rows>");
    expect(empty).not.toContain("<row>");
  });
});

describe("buildDelimitedText", () => {
  it("defaults to comma-delimited CSV with a header row", () => {
    const out = buildDelimitedText(htmlCols, [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    expect(out).toBe("id,name\n1,Alice\n2,Bob");
  });

  it("omits headers when includeHeaders is false", () => {
    const out = buildDelimitedText(htmlCols, [{ id: 1, name: "Alice" }], {
      includeHeaders: false,
    });
    expect(out).toBe("1,Alice");
  });

  it("supports a custom delimiter, line break, and quote char", () => {
    const out = buildDelimitedText(htmlCols, [{ id: 1, name: "Alice" }], {
      delimiter: "\t",
      lineBreak: "\r\n",
    });
    expect(out).toBe("id\tname\r\n1\tAlice");
  });

  it("quotes fields containing the delimiter, quote char, or newlines", () => {
    const out = buildDelimitedText([{ name: "v" }], [{ v: "a,b" }], {
      includeHeaders: false,
    });
    expect(out).toBe('"a,b"');

    const nl = buildDelimitedText([{ name: "v" }], [{ v: "line1\nline2" }], {
      includeHeaders: false,
    });
    expect(nl).toBe('"line1\nline2"');
  });

  it("doubles embedded quote chars (RFC 4180 style)", () => {
    const out = buildDelimitedText([{ name: "v" }], [{ v: 'say "hi"' }], {
      includeHeaders: false,
    });
    expect(out).toBe('"say ""hi"""');
  });

  it("substitutes the NULL token and quotes it when it contains the delimiter", () => {
    const out = buildDelimitedText([{ name: "v" }], [{ v: null }], {
      includeHeaders: false,
      nullToken: "\\N",
    });
    expect(out).toBe("\\N");

    const quoted = buildDelimitedText([{ name: "v" }], [{ v: undefined }], {
      includeHeaders: false,
      nullToken: "a,b",
    });
    expect(quoted).toBe('"a,b"');
  });

  it("uses a custom quote char for qualification and escaping", () => {
    const out = buildDelimitedText([{ name: "v" }], [{ v: "a,b'c" }], {
      includeHeaders: false,
      quoteChar: "'",
    });
    expect(out).toBe("'a,b''c'");
  });
});
