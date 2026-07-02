import { describe, it, expect } from "vitest";
import { buildOrderBy, buildWhere, type SortSpec } from "./whereBuilder";
import type { ColumnFilter } from "./gridFilter";
import type { MutationColumn } from "../types";

const cols: MutationColumn[] = [
  { name: "id", data_type: "int", is_primary_key: true },
  { name: "name", data_type: "varchar", is_primary_key: false },
  { name: "active", data_type: "boolean", is_primary_key: false },
];

const filter = (
  column: string,
  operator: ColumnFilter["operator"],
  value = "",
): ColumnFilter => ({ column, operator, value });

describe("buildOrderBy", () => {
  it("returns empty string for no sorts", () => {
    expect(buildOrderBy([], "mysql")).toBe("");
  });

  it("quotes idents and maps directions (mysql backticks)", () => {
    const sorts: SortSpec[] = [
      { column: "a", direction: "asc" },
      { column: "b", direction: "desc" },
    ];
    expect(buildOrderBy(sorts, "mysql")).toBe("ORDER BY `a` ASC, `b` DESC");
  });

  it("uses double quotes for postgres/sqlite", () => {
    const sorts: SortSpec[] = [{ column: "created_at", direction: "desc" }];
    expect(buildOrderBy(sorts, "postgres")).toBe('ORDER BY "created_at" DESC');
    expect(buildOrderBy(sorts, "sqlite")).toBe('ORDER BY "created_at" DESC');
  });

  it("uses bracket identifiers for sqlserver", () => {
    const sorts: SortSpec[] = [
      { column: "a", direction: "asc" },
      { column: "created_at", direction: "desc" },
    ];
    expect(buildOrderBy(sorts, "sqlserver")).toBe("ORDER BY [a] ASC, [created_at] DESC");
  });
});

describe("buildWhere", () => {
  it("returns empty when there are no filters", () => {
    expect(buildWhere([], "AND", "mysql", cols)).toEqual({ sql: "", params: [] });
  });

  it("skips inactive (empty-value) filters", () => {
    expect(buildWhere([filter("name", "equals", "")], "AND", "mysql", cols)).toEqual({
      sql: "",
      params: [],
    });
  });

  it("maps comparison operators and parameterizes (mysql ?)", () => {
    const filters: ColumnFilter[] = [
      filter("name", "not_equals", "x"),
      filter("id", "gte", "5"),
    ];
    const r = buildWhere(filters, "AND", "mysql", cols);
    expect(r.sql).toBe("WHERE (`name` <> ? AND `id` >= ?)");
    expect(r.params).toEqual(["x", 5]);
  });

  it("uses $n placeholders for postgres", () => {
    const filters: ColumnFilter[] = [
      filter("name", "equals", "ann"),
      filter("id", "lt", "10"),
    ];
    const r = buildWhere(filters, "OR", "postgres", cols);
    expect(r.sql).toBe('WHERE ("name" = $1 OR "id" < $2)');
    expect(r.params).toEqual(["ann", 10]);
  });

  it("uses @Pn placeholders and bracket idents for sqlserver", () => {
    const filters: ColumnFilter[] = [
      filter("name", "equals", "ann"),
      filter("id", "lt", "10"),
    ];
    const r = buildWhere(filters, "OR", "sqlserver", cols);
    expect(r.sql).toBe("WHERE ([name] = @P1 OR [id] < @P2)");
    expect(r.params).toEqual(["ann", 10]);
  });

  it("uses @Pn placeholders for sqlserver LIKE operands (wildcards in params)", () => {
    const filters: ColumnFilter[] = [
      filter("name", "contains", "foo"),
      filter("name", "starts_with", "bar"),
    ];
    const r = buildWhere(filters, "AND", "sqlserver", cols);
    expect(r.sql).toBe("WHERE ([name] LIKE @P1 AND [name] LIKE @P2)");
    expect(r.params).toEqual(["%foo%", "bar%"]);
  });

  it("coerces values by column type for sqlserver (BIT bool / numeric)", () => {
    const filters: ColumnFilter[] = [
      filter("active", "equals", "true"),
      filter("id", "equals", "42"),
    ];
    const r = buildWhere(filters, "AND", "sqlserver", cols);
    expect(r.sql).toBe("WHERE ([active] = @P1 AND [id] = @P2)");
    expect(r.params).toEqual([true, 42]);
  });

  it("wraps LIKE operands with wildcards in params, plain placeholder in sql", () => {
    const filters: ColumnFilter[] = [
      filter("name", "contains", "foo"),
      filter("name", "starts_with", "bar"),
      filter("name", "ends_with", "baz"),
    ];
    const r = buildWhere(filters, "AND", "mysql", cols);
    expect(r.sql).toBe("WHERE (`name` LIKE ? AND `name` LIKE ? AND `name` LIKE ?)");
    expect(r.params).toEqual(["%foo%", "bar%", "%baz"]);
  });

  it("emits valueless operators with no param", () => {
    const filters: ColumnFilter[] = [
      filter("name", "is_null"),
      filter("id", "is_not_null"),
    ];
    const r = buildWhere(filters, "OR", "postgres", cols);
    expect(r.sql).toBe('WHERE ("name" IS NULL OR "id" IS NOT NULL)');
    expect(r.params).toEqual([]);
  });

  it("coerces values by column type (boolean / numeric)", () => {
    const filters: ColumnFilter[] = [
      filter("active", "equals", "true"),
      filter("id", "equals", "42"),
    ];
    const r = buildWhere(filters, "AND", "sqlite", cols);
    expect(r.sql).toBe('WHERE ("active" = ? AND "id" = ?)');
    expect(r.params).toEqual([true, 42]);
  });

  it("mixes valueless and bound conditions, keeping param order", () => {
    const filters: ColumnFilter[] = [
      filter("name", "is_not_null"),
      filter("name", "contains", "q"),
      filter("id", "gt", "1"),
    ];
    const r = buildWhere(filters, "AND", "postgres", cols);
    expect(r.sql).toBe('WHERE ("name" IS NOT NULL AND "name" LIKE $1 AND "id" > $2)');
    expect(r.params).toEqual(["%q%", 1]);
  });
});
