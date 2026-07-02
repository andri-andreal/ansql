import { describe, it, expect } from "vitest";
import { parseEnumType } from "./enumType";

describe("parseEnumType", () => {
  it("parses a basic ENUM", () => {
    expect(parseEnumType("enum('a','b','c')")).toEqual({
      kind: "enum",
      values: ["a", "b", "c"],
    });
  });

  it("parses a basic SET", () => {
    expect(parseEnumType("set('x','y')")).toEqual({
      kind: "set",
      values: ["x", "y"],
    });
  });

  it("is case-insensitive on the type keyword", () => {
    expect(parseEnumType("ENUM('A')")).toEqual({ kind: "enum", values: ["A"] });
    expect(parseEnumType("Set('Y')")).toEqual({ kind: "set", values: ["Y"] });
  });

  it("returns null for non-enum/set types", () => {
    expect(parseEnumType("varchar(255)")).toBeNull();
    expect(parseEnumType("int")).toBeNull();
    expect(parseEnumType("")).toBeNull();
    expect(parseEnumType(null)).toBeNull();
    expect(parseEnumType(undefined)).toBeNull();
  });

  it("handles doubled-quote escapes", () => {
    expect(parseEnumType("enum('it''s','ok')")).toEqual({
      kind: "enum",
      values: ["it's", "ok"],
    });
  });

  it("handles backslash-quote escapes", () => {
    expect(parseEnumType("enum('a\\'b')")).toEqual({
      kind: "enum",
      values: ["a'b"],
    });
  });

  it("preserves values containing commas", () => {
    expect(parseEnumType("set('a,b','c')")).toEqual({
      kind: "set",
      values: ["a,b", "c"],
    });
  });

  it("handles whitespace between members", () => {
    expect(parseEnumType("enum('a', 'b', 'c')")).toEqual({
      kind: "enum",
      values: ["a", "b", "c"],
    });
  });

  it("returns empty values for a malformed/empty body", () => {
    expect(parseEnumType("enum()")).toEqual({ kind: "enum", values: [] });
  });
});
