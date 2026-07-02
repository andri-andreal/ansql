import { describe, it, expect } from "vitest";
import {
  buildSelectQuery,
  type QueryBuilderSpec,
  type BuilderColumn,
  type BuilderJoin,
  type BuilderFilter,
  type BuilderSort,
} from "./sqlQueryBuilder";

/** Minimal spec with sensible empty defaults, overridable per test. */
function spec(partial: Partial<QueryBuilderSpec>): QueryBuilderSpec {
  return {
    fromTable: "users",
    selectedColumns: [],
    joins: [],
    filters: [],
    sorts: [],
    ...partial,
  };
}

describe("buildSelectQuery — projection", () => {
  it("emits SELECT * for empty selectedColumns", () => {
    expect(buildSelectQuery("postgres", spec({}))).toBe('SELECT *\nFROM "users";');
  });

  it("quotes table.column references per dialect (postgres/sqlite use double quotes)", () => {
    const selectedColumns: BuilderColumn[] = [
      { table: "users", column: "id" },
      { table: "users", column: "name" },
    ];
    expect(buildSelectQuery("postgres", spec({ selectedColumns }))).toBe(
      'SELECT "users"."id", "users"."name"\nFROM "users";'
    );
    expect(buildSelectQuery("sqlite", spec({ selectedColumns }))).toBe(
      'SELECT "users"."id", "users"."name"\nFROM "users";'
    );
  });

  it("quotes identifiers with backticks on mysql", () => {
    const selectedColumns: BuilderColumn[] = [{ table: "users", column: "id" }];
    expect(buildSelectQuery("mysql", spec({ selectedColumns }))).toBe(
      "SELECT `users`.`id`\nFROM `users`;"
    );
  });

  it("quotes identifiers with brackets on sqlserver", () => {
    const selectedColumns: BuilderColumn[] = [
      { table: "users", column: "id" },
      { table: "users", column: "name", alias: "n" },
    ];
    expect(buildSelectQuery("sqlserver", spec({ selectedColumns }))).toBe(
      "SELECT [users].[id], [users].[name] AS [n]\nFROM [users];"
    );
  });

  it("renders column aliases with AS", () => {
    const selectedColumns: BuilderColumn[] = [
      { table: "users", column: "id", alias: "user_id" },
      { table: "users", column: "name", alias: null },
    ];
    expect(buildSelectQuery("postgres", spec({ selectedColumns }))).toBe(
      'SELECT "users"."id" AS "user_id", "users"."name"\nFROM "users";'
    );
  });

  it("emits DISTINCT before the projection", () => {
    expect(buildSelectQuery("postgres", spec({ distinct: true }))).toBe(
      'SELECT DISTINCT *\nFROM "users";'
    );
    const selectedColumns: BuilderColumn[] = [{ table: "users", column: "email" }];
    expect(buildSelectQuery("mysql", spec({ distinct: true, selectedColumns }))).toBe(
      "SELECT DISTINCT `users`.`email`\nFROM `users`;"
    );
  });

  it("escapes identifier quote characters in table/column names", () => {
    const selectedColumns: BuilderColumn[] = [{ table: 'we"ird', column: 'c"ol' }];
    expect(buildSelectQuery("postgres", spec({ fromTable: 'we"ird', selectedColumns }))).toBe(
      'SELECT "we""ird"."c""ol"\nFROM "we""ird";'
    );
    const myCols: BuilderColumn[] = [{ table: "t`k", column: "c`l" }];
    expect(buildSelectQuery("mysql", spec({ fromTable: "t`k", selectedColumns: myCols }))).toBe(
      "SELECT `t``k`.`c``l`\nFROM `t``k`;"
    );
  });
});

describe("buildSelectQuery — FROM and schema", () => {
  it("qualifies the table with the schema when present", () => {
    expect(buildSelectQuery("postgres", spec({ fromTable: "users", fromSchema: "public" }))).toBe(
      'SELECT *\nFROM "public"."users";'
    );
  });

  it("ignores null/undefined schema", () => {
    expect(buildSelectQuery("postgres", spec({ fromSchema: null }))).toBe(
      'SELECT *\nFROM "users";'
    );
    expect(buildSelectQuery("postgres", spec({ fromSchema: undefined }))).toBe(
      'SELECT *\nFROM "users";'
    );
  });
});

describe("buildSelectQuery — joins", () => {
  it("emits INNER/LEFT/RIGHT JOIN ... ON with qualified refs", () => {
    const joins: BuilderJoin[] = [
      {
        kind: "LEFT",
        leftTable: "users",
        leftColumn: "id",
        rightTable: "orders",
        rightColumn: "user_id",
      },
    ];
    expect(buildSelectQuery("postgres", spec({ joins }))).toBe(
      'SELECT *\nFROM "users"\nLEFT JOIN "orders" ON "users"."id" = "orders"."user_id";'
    );
  });

  it("emits multiple joins in order", () => {
    const joins: BuilderJoin[] = [
      {
        kind: "INNER",
        leftTable: "users",
        leftColumn: "id",
        rightTable: "orders",
        rightColumn: "user_id",
      },
      {
        kind: "RIGHT",
        leftTable: "orders",
        leftColumn: "product_id",
        rightTable: "products",
        rightColumn: "id",
      },
    ];
    expect(buildSelectQuery("mysql", spec({ joins }))).toBe(
      "SELECT *\nFROM `users`\n" +
        "INNER JOIN `orders` ON `users`.`id` = `orders`.`user_id`\n" +
        "RIGHT JOIN `products` ON `orders`.`product_id` = `products`.`id`;"
    );
  });
});

describe("buildSelectQuery — filters", () => {
  it("maps contains/starts_with/ends_with to LIKE with wildcard wrapping", () => {
    const filters: BuilderFilter[] = [
      { table: "users", column: "name", operator: "contains", value: "ann" },
      { table: "users", column: "email", operator: "starts_with", value: "a", combinator: "AND" },
      { table: "users", column: "code", operator: "ends_with", value: "z", combinator: "AND" },
    ];
    expect(buildSelectQuery("postgres", spec({ filters }))).toBe(
      'SELECT *\nFROM "users"\n' +
        `WHERE "users"."name" LIKE '%ann%' ` +
        `AND "users"."email" LIKE 'a%' ` +
        `AND "users"."code" LIKE '%z';`
    );
  });

  it("maps comparison operators and inlines string literals", () => {
    const filters: BuilderFilter[] = [
      { table: "users", column: "age", operator: "gte", value: "18" },
      { table: "users", column: "status", operator: "not_equals", value: "banned", combinator: "AND" },
    ];
    expect(buildSelectQuery("postgres", spec({ filters }))).toBe(
      'SELECT *\nFROM "users"\n' +
        `WHERE "users"."age" >= '18' AND "users"."status" <> 'banned';`
    );
  });

  it("emits valueless conditions for is_null / is_not_null", () => {
    const filters: BuilderFilter[] = [
      { table: "users", column: "deleted_at", operator: "is_null", value: "" },
      { table: "users", column: "email", operator: "is_not_null", value: "", combinator: "OR" },
    ];
    expect(buildSelectQuery("postgres", spec({ filters }))).toBe(
      'SELECT *\nFROM "users"\n' +
        'WHERE "users"."deleted_at" IS NULL OR "users"."email" IS NOT NULL;'
    );
  });

  it("uses each filter's own combinator (first ignored, defaults to AND)", () => {
    const filters: BuilderFilter[] = [
      { table: "u", column: "a", operator: "equals", value: "1" },
      { table: "u", column: "b", operator: "equals", value: "2", combinator: "OR" },
      { table: "u", column: "c", operator: "equals", value: "3" },
    ];
    expect(buildSelectQuery("postgres", spec({ fromTable: "u", filters }))).toBe(
      'SELECT *\nFROM "u"\n' +
        `WHERE "u"."a" = '1' OR "u"."b" = '2' AND "u"."c" = '3';`
    );
  });

  it("escapes single quotes in string operands; doubles backslashes on mysql only", () => {
    const filters: BuilderFilter[] = [
      { table: "u", column: "name", operator: "equals", value: "O'Brien \\ x" },
    ];
    expect(buildSelectQuery("mysql", spec({ fromTable: "u", filters }))).toBe(
      "SELECT *\nFROM `u`\nWHERE `u`.`name` = 'O''Brien \\\\ x';"
    );
    expect(buildSelectQuery("postgres", spec({ fromTable: "u", filters }))).toBe(
      `SELECT *\nFROM "u"\nWHERE "u"."name" = 'O''Brien \\ x';`
    );
  });
});

describe("buildSelectQuery — sorts and limit", () => {
  it("emits ORDER BY with directions and qualified refs", () => {
    const sorts: BuilderSort[] = [
      { table: "users", column: "name", direction: "asc" },
      { table: "users", column: "created_at", direction: "desc" },
    ];
    expect(buildSelectQuery("postgres", spec({ sorts }))).toBe(
      'SELECT *\nFROM "users"\n' +
        'ORDER BY "users"."name" ASC, "users"."created_at" DESC;'
    );
  });

  it("appends LIMIT for a finite non-negative limit and floors it", () => {
    expect(buildSelectQuery("postgres", spec({ limit: 10 }))).toBe(
      'SELECT *\nFROM "users"\nLIMIT 10;'
    );
    expect(buildSelectQuery("postgres", spec({ limit: 5.9 }))).toBe(
      'SELECT *\nFROM "users"\nLIMIT 5;'
    );
  });

  it("omits LIMIT for null/undefined/negative", () => {
    expect(buildSelectQuery("postgres", spec({ limit: null }))).toBe('SELECT *\nFROM "users";');
    expect(buildSelectQuery("postgres", spec({ limit: undefined }))).toBe(
      'SELECT *\nFROM "users";'
    );
    expect(buildSelectQuery("postgres", spec({ limit: -1 }))).toBe('SELECT *\nFROM "users";');
  });

  it("emits TOP n after the verb for sqlserver instead of a trailing LIMIT", () => {
    expect(buildSelectQuery("sqlserver", spec({ limit: 10 }))).toBe(
      "SELECT TOP 10 *\nFROM [users];"
    );
    // TOP follows DISTINCT and floors the limit; no trailing LIMIT clause.
    expect(buildSelectQuery("sqlserver", spec({ limit: 5.9, distinct: true }))).toBe(
      "SELECT DISTINCT TOP 5 *\nFROM [users];"
    );
    const out = buildSelectQuery("sqlserver", spec({ limit: 25 }));
    expect(out).not.toContain("LIMIT");
  });

  it("omits TOP for null/negative limit on sqlserver", () => {
    expect(buildSelectQuery("sqlserver", spec({ limit: null }))).toBe("SELECT *\nFROM [users];");
    expect(buildSelectQuery("sqlserver", spec({ limit: -1 }))).toBe("SELECT *\nFROM [users];");
  });
});

describe("buildSelectQuery — full query across dialects", () => {
  const fullSpec = spec({
    fromTable: "users",
    fromSchema: "public",
    selectedColumns: [
      { table: "users", column: "id", alias: "uid" },
      { table: "orders", column: "total" },
    ],
    joins: [
      {
        kind: "LEFT",
        leftTable: "users",
        leftColumn: "id",
        rightTable: "orders",
        rightColumn: "user_id",
      },
    ],
    filters: [
      { table: "users", column: "active", operator: "equals", value: "true" },
      { table: "orders", column: "total", operator: "gt", value: "100", combinator: "AND" },
    ],
    sorts: [{ table: "orders", column: "total", direction: "desc" }],
    limit: 25,
    distinct: true,
  });

  it("composes all clauses (postgres)", () => {
    expect(buildSelectQuery("postgres", fullSpec)).toBe(
      'SELECT DISTINCT "users"."id" AS "uid", "orders"."total"\n' +
        'FROM "public"."users"\n' +
        'LEFT JOIN "orders" ON "users"."id" = "orders"."user_id"\n' +
        `WHERE "users"."active" = 'true' AND "orders"."total" > '100'\n` +
        'ORDER BY "orders"."total" DESC\n' +
        "LIMIT 25;"
    );
  });

  it("composes all clauses (mysql)", () => {
    expect(buildSelectQuery("mysql", fullSpec)).toBe(
      "SELECT DISTINCT `users`.`id` AS `uid`, `orders`.`total`\n" +
        "FROM `public`.`users`\n" +
        "LEFT JOIN `orders` ON `users`.`id` = `orders`.`user_id`\n" +
        "WHERE `users`.`active` = 'true' AND `orders`.`total` > '100'\n" +
        "ORDER BY `orders`.`total` DESC\n" +
        "LIMIT 25;"
    );
  });

  it("composes all clauses (sqlite)", () => {
    expect(buildSelectQuery("sqlite", fullSpec)).toBe(
      'SELECT DISTINCT "users"."id" AS "uid", "orders"."total"\n' +
        'FROM "public"."users"\n' +
        'LEFT JOIN "orders" ON "users"."id" = "orders"."user_id"\n' +
        `WHERE "users"."active" = 'true' AND "orders"."total" > '100'\n` +
        'ORDER BY "orders"."total" DESC\n' +
        "LIMIT 25;"
    );
  });

  it("composes all clauses (sqlserver: bracket idents + TOP, no LIMIT)", () => {
    expect(buildSelectQuery("sqlserver", fullSpec)).toBe(
      "SELECT DISTINCT TOP 25 [users].[id] AS [uid], [orders].[total]\n" +
        "FROM [public].[users]\n" +
        "LEFT JOIN [orders] ON [users].[id] = [orders].[user_id]\n" +
        "WHERE [users].[active] = 'true' AND [orders].[total] > '100'\n" +
        "ORDER BY [orders].[total] DESC;"
    );
  });
});
