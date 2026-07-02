import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseCsv,
  parseJson,
  parseXml,
  parseExcel,
  toRowTransfer,
} from "./fileImport";

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------
describe("parseCsv", () => {
  it("parses headers and simple rows", () => {
    const csv = "id,name\n1,Alice\n2,Bob";
    const result = parseCsv(csv);
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      ["1", "Alice"],
      ["2", "Bob"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    const csv = `name,address\nAlice,"123 Main St, Apt 4"\nBob,"456 Oak Ave"`;
    const result = parseCsv(csv);
    expect(result.columns).toEqual(["name", "address"]);
    expect(result.rows[0]).toEqual(["Alice", "123 Main St, Apt 4"]);
  });

  it("handles quoted fields with embedded newlines", () => {
    const csv = `name,bio\nAlice,"line one\nline two"\nBob,simple`;
    const result = parseCsv(csv);
    expect(result.columns).toEqual(["name", "bio"]);
    expect(result.rows[0][1]).toContain("\n");
  });

  it("converts empty cells to null", () => {
    const csv = "a,b,c\n1,,3\n,2,";
    const result = parseCsv(csv);
    expect(result.rows[0]).toEqual(["1", null, "3"]);
    expect(result.rows[1]).toEqual([null, "2", null]);
  });

  it("strips leading BOM", () => {
    const csv = "id,name\n1,Alice";
    const result = parseCsv(csv);
    expect(result.columns[0]).toBe("id"); // not "id"
  });

  it("synthesizes column names when hasHeader is false", () => {
    const csv = "1,Alice\n2,Bob";
    const result = parseCsv(csv, { hasHeader: false });
    expect(result.columns).toEqual(["column_1", "column_2"]);
    expect(result.rows[0]).toEqual(["1", "Alice"]);
    expect(result.rows[1]).toEqual(["2", "Bob"]);
  });

  it("de-duplicates duplicate header names", () => {
    const csv = "id,name,name\n1,Alice,A";
    const result = parseCsv(csv);
    expect(result.columns[0]).toBe("id");
    expect(result.columns[1]).toBe("name");
    expect(result.columns[2]).toBe("name_2"); // de-duped
  });

  it("replaces blank header cells with column_n", () => {
    const csv = ",name,\n1,Alice,x";
    const result = parseCsv(csv);
    expect(result.columns[0]).toBe("column_1");
    expect(result.columns[1]).toBe("name");
    expect(result.columns[2]).toBe("column_3");
  });

  it("skips empty lines", () => {
    const csv = "id,name\n\n1,Alice\n\n2,Bob\n";
    const result = parseCsv(csv);
    expect(result.rows).toHaveLength(2);
  });

  it("does not perform dynamic typing (keeps numeric values as strings)", () => {
    const csv = "id,price\n1,9.99\n2,0";
    const result = parseCsv(csv);
    expect(typeof result.rows[0][0]).toBe("string");
    expect(typeof result.rows[0][1]).toBe("string");
  });

  // --- ImportParseOptions -------------------------------------------------
  it("honors a custom delimiter (semicolon)", () => {
    const csv = "id;name\n1;Alice\n2;Bob";
    const result = parseCsv(csv, { delimiter: ";" });
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      ["1", "Alice"],
      ["2", "Bob"],
    ]);
  });

  it("honors a tab delimiter", () => {
    const csv = "id\tname\n1\tAlice";
    const result = parseCsv(csv, { delimiter: "\t" });
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows[0]).toEqual(["1", "Alice"]);
  });

  it("honors a custom quoteChar (single quote)", () => {
    const csv = "name,note\n'Alice, A','hi'";
    const result = parseCsv(csv, { quoteChar: "'" });
    expect(result.rows[0]).toEqual(["Alice, A", "hi"]);
  });

  it("skips leading rows via skipRows before header detection", () => {
    const csv = "# exported 2026\n# v1\nid,name\n1,Alice\n2,Bob";
    const result = parseCsv(csv, { skipRows: 2 });
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      ["1", "Alice"],
      ["2", "Bob"],
    ]);
  });

  it("headerRow:false synthesizes column names (new option name)", () => {
    const csv = "1,Alice\n2,Bob";
    const result = parseCsv(csv, { headerRow: false });
    expect(result.columns).toEqual(["column_1", "column_2"]);
    expect(result.rows).toEqual([
      ["1", "Alice"],
      ["2", "Bob"],
    ]);
  });

  it("headerRow takes precedence over the legacy hasHeader", () => {
    const csv = "1,Alice\n2,Bob";
    const result = parseCsv(csv, { hasHeader: true, headerRow: false });
    expect(result.columns).toEqual(["column_1", "column_2"]);
  });

  it("combines skipRows with headerRow:false", () => {
    const csv = "junk1\njunk2\n1,Alice";
    const result = parseCsv(csv, { skipRows: 2, headerRow: false });
    expect(result.columns).toEqual(["column_1", "column_2"]);
    expect(result.rows).toEqual([["1", "Alice"]]);
  });
});

// ---------------------------------------------------------------------------
// parseXml
// ---------------------------------------------------------------------------
describe("parseXml", () => {
  it("parses element-per-field records (<rows><row><col>..</col></row></rows>)", () => {
    const xml = `<rows>
      <row><id>1</id><name>Alice</name></row>
      <row><id>2</id><name>Bob</name></row>
    </rows>`;
    const result = parseXml(xml);
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      ["1", "Alice"],
      ["2", "Bob"],
    ]);
  });

  it("parses attribute-per-field records (<table><record .../></table>)", () => {
    const xml = `<table>
      <record id="1" name="Alice"/>
      <record id="2" name="Bob"/>
    </table>`;
    const result = parseXml(xml);
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      ["1", "Alice"],
      ["2", "Bob"],
    ]);
  });

  it("mixes attributes and child elements; columns are the union (first-seen)", () => {
    const xml = `<rows>
      <row id="1"><name>Alice</name></row>
      <row id="2"><name>Bob</name><extra>x</extra></row>
    </rows>`;
    const result = parseXml(xml);
    // attributes first, then child elements, union in first-seen order
    expect(result.columns).toEqual(["id", "name", "extra"]);
    const extraIdx = result.columns.indexOf("extra");
    expect(result.rows[0][extraIdx]).toBeNull(); // missing in first record
    expect(result.rows[1][extraIdx]).toBe("x");
  });

  it("skips the XML declaration and comments", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <!-- exported rows -->
      <rows><row><id>1</id></row></rows>`;
    const result = parseXml(xml);
    expect(result.columns).toEqual(["id"]);
    expect(result.rows).toEqual([["1"]]);
  });

  it("decodes predefined and numeric entities", () => {
    const xml = `<rows><row><label>A &amp; B &lt; C</label><emoji>&#65;</emoji></row></rows>`;
    const result = parseXml(xml);
    expect(result.rows[0][0]).toBe("A & B < C");
    expect(result.rows[0][1]).toBe("A");
  });

  it("reads CDATA text content", () => {
    const xml = `<rows><row><body><![CDATA[<b>bold</b> & raw]]></body></row></rows>`;
    const result = parseXml(xml);
    expect(result.rows[0][0]).toBe("<b>bold</b> & raw");
  });

  it("converts empty/whitespace fields to null", () => {
    const xml = `<rows><row><a>1</a><b></b><c>   </c></row></rows>`;
    const result = parseXml(xml);
    expect(result.rows[0]).toEqual(["1", null, null]);
  });

  it("treats top-level same-tag records as rows when there is no single wrapper", () => {
    const xml = `<row><id>1</id></row><row><id>2</id></row>`;
    const result = parseXml(xml);
    expect(result.columns).toEqual(["id"]);
    expect(result.rows).toEqual([["1"], ["2"]]);
  });

  it("throws on malformed XML (mismatched closing tag)", () => {
    expect(() => parseXml("<rows><row></rowX></rows>")).toThrow(/parse/i);
  });

  it("throws on an unclosed tag", () => {
    expect(() => parseXml("<rows><row><id>1</id>")).toThrow(/parse|unclosed/i);
  });
});

// ---------------------------------------------------------------------------
// parseJson
// ---------------------------------------------------------------------------
describe("parseJson", () => {
  it("parses array-of-objects with uniform keys", () => {
    const json = JSON.stringify([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    const result = parseJson(json);
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      [1, "Alice"],
      [2, "Bob"],
    ]);
  });

  it("handles ragged keys — missing key becomes null", () => {
    const json = JSON.stringify([
      { id: 1, name: "Alice" },
      { id: 2 }, // name missing
      { id: 3, name: "Carol", extra: true }, // extra key added
    ]);
    const result = parseJson(json);
    // columns should be union in first-seen order
    expect(result.columns).toContain("id");
    expect(result.columns).toContain("name");
    expect(result.columns).toContain("extra");
    // second row: name should be null
    const nameIdx = result.columns.indexOf("name");
    expect(result.rows[1][nameIdx]).toBeNull();
  });

  it("preserves nested object/array values as-is", () => {
    const json = JSON.stringify([{ id: 1, meta: { x: 1 }, tags: [1, 2] }]);
    const result = parseJson(json);
    const metaIdx = result.columns.indexOf("meta");
    const tagsIdx = result.columns.indexOf("tags");
    expect(result.rows[0][metaIdx]).toEqual({ x: 1 });
    expect(result.rows[0][tagsIdx]).toEqual([1, 2]);
  });

  it("parses array-of-arrays using first row as header", () => {
    const json = JSON.stringify([
      ["id", "name"],
      [1, "Alice"],
      [2, "Bob"],
    ]);
    const result = parseJson(json);
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      [1, "Alice"],
      [2, "Bob"],
    ]);
  });

  it("throws a clear error for a non-array root", () => {
    const json = JSON.stringify({ id: 1, name: "Alice" });
    expect(() => parseJson(json)).toThrow(/array/i);
  });

  it("throws a clear error for a primitive root", () => {
    expect(() => parseJson("42")).toThrow(/array/i);
  });
});

// ---------------------------------------------------------------------------
// parseExcel
// ---------------------------------------------------------------------------
describe("parseExcel", () => {
  /** Build a minimal in-memory xlsx workbook with one sheet. */
  function makeWorkbook(
    data: unknown[][],
    sheetName = "Sheet1"
  ): Uint8Array {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return new Uint8Array(buf);
  }

  it("round-trips a simple header + rows", () => {
    const bytes = makeWorkbook([
      ["id", "name"],
      [1, "Alice"],
      [2, "Bob"],
    ]);
    const result = parseExcel(bytes);
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      [1, "Alice"],
      [2, "Bob"],
    ]);
  });

  it("populates sheetNames from the workbook", () => {
    const ws1 = XLSX.utils.aoa_to_sheet([["a"], [1]]);
    const ws2 = XLSX.utils.aoa_to_sheet([["b"], [2]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Alpha");
    XLSX.utils.book_append_sheet(wb, ws2, "Beta");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const bytes = new Uint8Array(buf);

    const result = parseExcel(bytes);
    expect(result.sheetNames).toEqual(["Alpha", "Beta"]);
  });

  it("reads the named sheet when sheetName is provided", () => {
    const ws1 = XLSX.utils.aoa_to_sheet([["a"], [1]]);
    const ws2 = XLSX.utils.aoa_to_sheet([["b"], [2]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Alpha");
    XLSX.utils.book_append_sheet(wb, ws2, "Beta");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const bytes = new Uint8Array(buf);

    const result = parseExcel(bytes, "Beta");
    expect(result.columns).toEqual(["b"]);
    expect(result.rows).toEqual([[2]]);
  });

  it("converts empty cells to null via defval", () => {
    const bytes = makeWorkbook([
      ["a", "b", "c"],
      [1, null, 3],
    ]);
    const result = parseExcel(bytes);
    expect(result.rows[0]).toEqual([1, null, 3]);
  });

  it("converts Excel date serials to ISO-style SQL strings, not raw numbers", () => {
    // A pure-date cell (midnight) and a datetime cell. Built from JS Dates so
    // SheetJS writes proper date-typed cells; cellDates reads them back as Dates.
    const dateOnly = new Date(2023, 2, 15); // 2023-03-15 00:00:00 local
    const dateTime = new Date(2023, 2, 15, 13, 45, 30); // 2023-03-15 13:45:30 local
    const bytes = makeWorkbook([
      ["d", "dt"],
      [dateOnly, dateTime],
    ]);
    const result = parseExcel(bytes);

    // Must be formatted strings, never raw serial numbers.
    expect(typeof result.rows[0][0]).toBe("string");
    expect(typeof result.rows[0][1]).toBe("string");
    expect(result.rows[0][0]).toBe("2023-03-15");
    expect(result.rows[0][1]).toBe("2023-03-15 13:45:30");
  });
});

// ---------------------------------------------------------------------------
// toRowTransfer
// ---------------------------------------------------------------------------
describe("toRowTransfer", () => {
  const parsed = {
    columns: ["src_id", "src_name", "src_extra"],
    rows: [
      ["1", "Alice", "X"],
      ["2", "Bob", null],
    ],
  };

  const mapping = [
    { source: "src_id", target: "id" },
    { source: "src_name", target: "name" },
    { source: "src_extra", target: "" }, // skipped
  ];

  const opts = {
    targetTable: "people",
    targetSchema: "public",
    conflict: "append" as const,
    createIfMissing: false,
    batchSize: 100,
  };

  it("emits SOURCE-aligned columns/rows and a target-renamed mapping (renamed/skipped cols import correctly)", () => {
    const src = {
      columns: ["full_name", "age", "junk"],
      rows: [
        ["Alice", "30", "x"],
        ["Bob", "40", "y"],
      ],
    };
    const map = [
      { source: "full_name", target: "name" },
      { source: "age", target: "age" },
      { source: "junk", target: "" }, // skipped
    ];
    const transfer = toRowTransfer(src, map, opts);

    // columns = SOURCE names, all of them, in source order
    expect(transfer.columns.map((c) => c.name)).toEqual([
      "full_name",
      "age",
      "junk",
    ]);
    // every column's data_type is "" so the backend infers
    for (const c of transfer.columns) expect(c.data_type).toBe("");
    // rows are the raw, unfiltered, unreordered source rows
    expect(transfer.rows).toEqual(src.rows);
    // mapping drops the skip and keeps source→target renames
    expect(transfer.mapping).toHaveLength(2);
    expect(transfer.mapping).toContainEqual({ source: "full_name", target: "name" });
    expect(transfer.mapping).toContainEqual({ source: "age", target: "age" });
    expect(transfer.mapping.some((m) => m.target === "")).toBe(false);
  });

  it("produces a RowTransfer with correct field names/casing", () => {
    const transfer = toRowTransfer(parsed, mapping, opts);
    // required top-level fields
    expect(transfer).toHaveProperty("source_dialect");
    expect(transfer).toHaveProperty("target_table", "people");
    expect(transfer).toHaveProperty("target_schema", "public");
    expect(transfer).toHaveProperty("columns");
    expect(transfer).toHaveProperty("rows");
    expect(transfer).toHaveProperty("mapping");
    expect(transfer).toHaveProperty("conflict", "append");
    expect(transfer).toHaveProperty("create_if_missing", false);
    expect(transfer).toHaveProperty("batch_size", 100);
  });

  it("excludes skipped mappings (target === '') but keeps all SOURCE columns", () => {
    const transfer = toRowTransfer(parsed, mapping, opts);
    // columns are the SOURCE columns (all of them), not the targets
    expect(transfer.columns.map((c) => c.name)).toEqual([
      "src_id",
      "src_name",
      "src_extra",
    ]);
    // mapping should only include the non-skipped entries
    expect(transfer.mapping).toHaveLength(2);
    expect(transfer.mapping.map((m) => m.target)).toContain("id");
    expect(transfer.mapping.map((m) => m.target)).toContain("name");
    expect(transfer.mapping.some((m) => m.target === "")).toBe(false);
  });

  it("passes rows through raw (source-aligned, unfiltered, unreordered)", () => {
    const transfer = toRowTransfer(parsed, mapping, opts);
    // rows are the original source rows; the backend selects/renames via mapping
    expect(transfer.rows).toEqual(parsed.rows);
  });

  it("sets data_type to empty string for each column (backend infers)", () => {
    const transfer = toRowTransfer(parsed, mapping, opts);
    for (const col of transfer.columns) {
      expect(col.data_type).toBe("");
    }
  });

  it("passes through conflict/create_if_missing/batch_size flags", () => {
    const t1 = toRowTransfer(parsed, mapping, {
      ...opts,
      conflict: "truncate",
      createIfMissing: true,
      batchSize: 500,
    });
    expect(t1.conflict).toBe("truncate");
    expect(t1.create_if_missing).toBe(true);
    expect(t1.batch_size).toBe(500);
  });

  it("target_schema is null when not provided", () => {
    const t = toRowTransfer(parsed, mapping, {
      targetTable: "people",
      conflict: "append",
      createIfMissing: false,
      batchSize: 50,
    });
    expect(t.target_schema).toBeNull();
  });
});
