import { describe, it, expect } from "vitest";
import {
  validateCell,
  validateRow,
  parseMaxLength,
  dateKind,
  type ValidationColumn,
} from "./validators";

const col = (over: Partial<ValidationColumn>): ValidationColumn => ({
  name: "c",
  data_type: "text",
  nullable: true,
  ...over,
});

describe("parseMaxLength", () => {
  it("reads varchar/char length from full_type", () => {
    expect(parseMaxLength(col({ data_type: "varchar", full_type: "varchar(255)" }))).toBe(255);
    expect(parseMaxLength(col({ data_type: "char", full_type: "char(10)" }))).toBe(10);
  });
  it("returns null for unsized or non-string types", () => {
    expect(parseMaxLength(col({ data_type: "text", full_type: "text" }))).toBeNull();
    expect(parseMaxLength(col({ data_type: "int", full_type: "int(11)" }))).toBeNull();
  });
});

describe("dateKind", () => {
  it("maps types", () => {
    expect(dateKind("date")).toBe("date");
    expect(dateKind("datetime")).toBe("datetime");
    expect(dateKind("timestamp")).toBe("datetime");
    expect(dateKind("time")).toBe("time");
    expect(dateKind("varchar")).toBeNull();
  });
});

describe("validateCell NOT NULL", () => {
  it("blocks empty required column on insert", () => {
    expect(validateCell(col({ nullable: false }), null, true)).toMatch(/NOT NULL/);
    expect(validateCell(col({ nullable: false }), "", true)).toMatch(/NOT NULL/);
  });
  it("allows empty when nullable, has default, or auto-increment", () => {
    expect(validateCell(col({ nullable: true }), null, true)).toBeNull();
    expect(validateCell(col({ nullable: false, default_value: "0" }), null, true)).toBeNull();
    expect(validateCell(col({ nullable: false, is_auto_increment: true }), null, true)).toBeNull();
  });
  it("does not enforce NOT NULL on update", () => {
    expect(validateCell(col({ nullable: false }), null, false)).toBeNull();
  });
});

describe("validateCell length", () => {
  it("rejects over-length strings", () => {
    const c = col({ data_type: "varchar", full_type: "varchar(3)" });
    expect(validateCell(c, "abcd", false)).toMatch(/max length 3/);
    expect(validateCell(c, "abc", false)).toBeNull();
  });
});

describe("validateCell numeric", () => {
  it("rejects non-numbers in numeric columns", () => {
    expect(validateCell(col({ data_type: "int" }), "abc", false)).toMatch(/number/);
    expect(validateCell(col({ data_type: "int" }), "42", false)).toBeNull();
  });
  it("rejects decimals in integer columns", () => {
    expect(validateCell(col({ data_type: "int" }), "1.5", false)).toMatch(/whole number/);
    expect(validateCell(col({ data_type: "decimal", full_type: "decimal(10,2)" }), "1.5", false)).toBeNull();
  });
});

describe("validateCell dates", () => {
  it("validates date format", () => {
    expect(validateCell(col({ data_type: "date" }), "2024-01-02", false)).toBeNull();
    expect(validateCell(col({ data_type: "date" }), "01/02/2024", false)).toMatch(/date/);
  });
  it("validates datetime format (space or T)", () => {
    expect(validateCell(col({ data_type: "datetime" }), "2024-01-02 03:04:05", false)).toBeNull();
    expect(validateCell(col({ data_type: "timestamp" }), "2024-01-02T03:04", false)).toBeNull();
    expect(validateCell(col({ data_type: "datetime" }), "nope", false)).toMatch(/date-time/);
  });
  it("validates time format", () => {
    expect(validateCell(col({ data_type: "time" }), "03:04:05", false)).toBeNull();
    expect(validateCell(col({ data_type: "time" }), "3pm", false)).toMatch(/time/);
  });
});

describe("validateRow", () => {
  const cols: ValidationColumn[] = [
    { name: "id", data_type: "int", nullable: false, is_auto_increment: true, is_primary_key: true },
    { name: "name", data_type: "varchar", full_type: "varchar(5)", nullable: false },
    { name: "age", data_type: "int", nullable: true },
  ];
  it("collects per-cell errors on insert", () => {
    const errs = validateRow(cols, { id: null, name: "", age: "x" }, true);
    const byCol = Object.fromEntries(errs.map((e) => [e.column, e.message]));
    expect(byCol.id).toBeUndefined(); // auto-increment skipped
    expect(byCol.name).toMatch(/NOT NULL/);
    expect(byCol.age).toMatch(/number/);
  });
  it("limits to changed columns when provided", () => {
    const errs = validateRow(cols, { name: "toolong", age: 1 }, false, new Set(["name"]));
    expect(errs).toHaveLength(1);
    expect(errs[0].column).toBe("name");
  });
});
