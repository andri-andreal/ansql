import { describe, it, expect } from "vitest";
import { detectSingleTableSelect, splitTopLevel } from "./sqlSource";

describe("splitTopLevel", () => {
  it("splits on top-level commas", () => {
    expect(splitTopLevel("a = 1, b = 2, c = 3", /,/y)).toEqual(["a = 1", " b = 2", " c = 3"]);
  });

  it("ignores commas inside string literals", () => {
    expect(splitTopLevel("note = 'a,b', x = 1", /,/y)).toEqual(["note = 'a,b'", " x = 1"]);
  });

  it("ignores commas inside parentheses (nested)", () => {
    expect(splitTopLevel("f = concat(a, ',', nested(b, c)), g = 2", /,/y)).toEqual([
      "f = concat(a, ',', nested(b, c))",
      " g = 2",
    ]);
  });

  it("ignores commas inside quoted identifiers", () => {
    expect(splitTopLevel("`a,b` = 1, c = 2", /,/y)).toEqual(["`a,b` = 1", " c = 2"]);
  });

  it("returns the whole string when there is no match", () => {
    expect(splitTopLevel("a = 1", /,/y)).toEqual(["a = 1"]);
  });

  it("keeps empty leading/trailing segments", () => {
    expect(splitTopLevel(",a,", /,/y)).toEqual(["", "a", ""]);
  });
});

describe("detectSingleTableSelect — accepted (editable)", () => {
  it("plain SELECT * from a bare table", () => {
    expect(detectSingleTableSelect("SELECT * FROM users")).toEqual({
      schema: null,
      table: "users",
      whereSql: null,
    });
  });

  it("explicit column list is still editable", () => {
    expect(detectSingleTableSelect("SELECT id, name, email FROM users")).toEqual({
      schema: null,
      table: "users",
      whereSql: null,
    });
  });

  it("is case-insensitive on keywords", () => {
    expect(detectSingleTableSelect("select * from users")).toEqual({
      schema: null,
      table: "users",
      whereSql: null,
    });
  });

  it("tolerates a trailing semicolon", () => {
    expect(detectSingleTableSelect("SELECT * FROM users;")).toEqual({
      schema: null,
      table: "users",
      whereSql: null,
    });
  });

  it("tolerates surrounding/inner whitespace and newlines", () => {
    expect(detectSingleTableSelect("  SELECT *\n  FROM\n    users\n")).toEqual({
      schema: null,
      table: "users",
      whereSql: null,
    });
  });

  it("schema-qualified table", () => {
    expect(detectSingleTableSelect("SELECT * FROM public.users")).toEqual({
      schema: "public",
      table: "users",
      whereSql: null,
    });
  });

  it("schema-qualified with whitespace around the dot", () => {
    expect(detectSingleTableSelect("SELECT * FROM public . users")).toEqual({
      schema: "public",
      table: "users",
      whereSql: null,
    });
  });

  it("double-quoted identifiers are unquoted", () => {
    expect(detectSingleTableSelect('SELECT * FROM "My Schema"."User Table"')).toEqual({
      schema: "My Schema",
      table: "User Table",
      whereSql: null,
    });
  });

  it("backtick identifiers are unquoted (mysql)", () => {
    expect(detectSingleTableSelect("SELECT * FROM `mydb`.`orders`")).toEqual({
      schema: "mydb",
      table: "orders",
      whereSql: null,
    });
  });

  it("bracket identifiers are unquoted (sql-server style)", () => {
    expect(detectSingleTableSelect("SELECT * FROM [dbo].[Orders]")).toEqual({
      schema: "dbo",
      table: "Orders",
      whereSql: null,
    });
  });

  it("doubled inner quotes collapse to one", () => {
    expect(detectSingleTableSelect('SELECT * FROM "we""ird"')).toEqual({
      schema: null,
      table: 'we"ird',
      whereSql: null,
    });
  });

  it("table alias is ignored (implicit alias)", () => {
    expect(detectSingleTableSelect("SELECT u.* FROM users u")).toEqual({
      schema: null,
      table: "users",
      whereSql: null,
    });
  });

  it("table alias is ignored (AS alias)", () => {
    expect(detectSingleTableSelect("SELECT * FROM users AS u")).toEqual({
      schema: null,
      table: "users",
      whereSql: null,
    });
  });

  it("schema-qualified table with alias", () => {
    expect(detectSingleTableSelect("SELECT * FROM public.users AS u")).toEqual({
      schema: "public",
      table: "users",
      whereSql: null,
    });
  });

  it("captures a simple WHERE clause", () => {
    expect(detectSingleTableSelect("SELECT * FROM users WHERE id = 1")).toEqual({
      schema: null,
      table: "users",
      whereSql: "id = 1",
    });
  });

  it("captures a compound WHERE clause (AND/OR)", () => {
    expect(
      detectSingleTableSelect("SELECT * FROM users WHERE age > 18 AND active = true"),
    ).toEqual({
      schema: null,
      table: "users",
      whereSql: "age > 18 AND active = true",
    });
  });

  it("captures WHERE but stops before ORDER BY", () => {
    expect(
      detectSingleTableSelect("SELECT * FROM users WHERE id > 5 ORDER BY name DESC"),
    ).toEqual({
      schema: null,
      table: "users",
      whereSql: "id > 5",
    });
  });

  it("captures WHERE but stops before LIMIT", () => {
    expect(
      detectSingleTableSelect("SELECT * FROM users WHERE active = 1 LIMIT 100"),
    ).toEqual({
      schema: null,
      table: "users",
      whereSql: "active = 1",
    });
  });

  it("captures WHERE but stops before LIMIT/OFFSET", () => {
    expect(
      detectSingleTableSelect("SELECT * FROM t WHERE x = 1 LIMIT 10 OFFSET 20"),
    ).toEqual({ schema: null, table: "t", whereSql: "x = 1" });
  });

  it("ORDER BY / LIMIT without WHERE is still editable (whereSql null)", () => {
    expect(detectSingleTableSelect("SELECT * FROM users ORDER BY id LIMIT 50")).toEqual({
      schema: null,
      table: "users",
      whereSql: null,
    });
  });

  it("WHERE with a parenthesised subquery is kept verbatim as where text", () => {
    expect(
      detectSingleTableSelect(
        "SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customers) ORDER BY id",
      ),
    ).toEqual({
      schema: null,
      table: "orders",
      whereSql: "customer_id IN (SELECT id FROM customers)",
    });
  });

  it("ignores ORDER BY / GROUP-ish keywords that appear inside a string literal in WHERE", () => {
    expect(
      detectSingleTableSelect("SELECT * FROM t WHERE note = 'order by limit' LIMIT 5"),
    ).toEqual({
      schema: null,
      table: "t",
      whereSql: "note = 'order by limit'",
    });
  });

  it("strips line comments before parsing", () => {
    const sql = "-- pick everyone\nSELECT * FROM users -- trailing\nWHERE id = 1";
    expect(detectSingleTableSelect(sql)).toEqual({
      schema: null,
      table: "users",
      whereSql: "id = 1",
    });
  });

  it("strips block comments before parsing", () => {
    const sql = "SELECT * /* all cols */ FROM users /* base */ WHERE id = 1";
    expect(detectSingleTableSelect(sql)).toEqual({
      schema: null,
      table: "users",
      whereSql: "id = 1",
    });
  });

  it("a non-aggregate function in the projection is fine", () => {
    expect(detectSingleTableSelect("SELECT lower(name) FROM users")).toEqual({
      schema: null,
      table: "users",
      whereSql: null,
    });
  });

  it("an aggregate alongside other columns is not aggregate-only (still editable)", () => {
    expect(detectSingleTableSelect("SELECT id, count(*) FROM users")).toEqual({
      schema: null,
      table: "users",
      whereSql: null,
    });
  });

  it("a column literally named 'count' (not a call) is fine", () => {
    expect(detectSingleTableSelect("SELECT count FROM inventory")).toEqual({
      schema: null,
      table: "inventory",
      whereSql: null,
    });
  });
});

describe("detectSingleTableSelect — rejected (read-only)", () => {
  it("returns null for empty / whitespace / comment-only input", () => {
    expect(detectSingleTableSelect("")).toBeNull();
    expect(detectSingleTableSelect("   \n  ")).toBeNull();
    expect(detectSingleTableSelect("-- just a comment")).toBeNull();
    expect(detectSingleTableSelect("/* block only */")).toBeNull();
  });

  it("rejects non-SELECT statements", () => {
    expect(detectSingleTableSelect("INSERT INTO users (id) VALUES (1)")).toBeNull();
    expect(detectSingleTableSelect("UPDATE users SET x = 1")).toBeNull();
    expect(detectSingleTableSelect("DELETE FROM users")).toBeNull();
    expect(detectSingleTableSelect("CREATE TABLE t (id int)")).toBeNull();
  });

  it("rejects a WITH (CTE) statement", () => {
    expect(
      detectSingleTableSelect("WITH x AS (SELECT * FROM users) SELECT * FROM x"),
    ).toBeNull();
  });

  it("rejects a SELECT with no FROM", () => {
    expect(detectSingleTableSelect("SELECT 1")).toBeNull();
    expect(detectSingleTableSelect("SELECT now()")).toBeNull();
  });

  it("rejects SELECT DISTINCT", () => {
    expect(detectSingleTableSelect("SELECT DISTINCT name FROM users")).toBeNull();
    expect(detectSingleTableSelect("SELECT DISTINCT ON (a) a, b FROM t")).toBeNull();
  });

  it("rejects an aggregate-only projection", () => {
    expect(detectSingleTableSelect("SELECT count(*) FROM users")).toBeNull();
    expect(detectSingleTableSelect("SELECT COUNT(*) FROM users")).toBeNull();
    expect(detectSingleTableSelect("SELECT max(price) FROM products")).toBeNull();
    expect(detectSingleTableSelect("SELECT sum(amount) AS total FROM orders")).toBeNull();
    expect(detectSingleTableSelect("SELECT avg(score) s FROM exams")).toBeNull();
  });

  it("rejects an INNER/LEFT/etc JOIN", () => {
    expect(
      detectSingleTableSelect("SELECT * FROM a JOIN b ON a.id = b.a_id"),
    ).toBeNull();
    expect(
      detectSingleTableSelect("SELECT * FROM a LEFT JOIN b ON a.id = b.a_id"),
    ).toBeNull();
    expect(
      detectSingleTableSelect(
        "SELECT * FROM users u INNER JOIN orders o ON o.uid = u.id WHERE u.id = 1",
      ),
    ).toBeNull();
  });

  it("rejects comma-separated multiple FROM tables (implicit cross join)", () => {
    expect(detectSingleTableSelect("SELECT * FROM a, b")).toBeNull();
    expect(
      detectSingleTableSelect("SELECT * FROM a, b WHERE a.id = b.a_id"),
    ).toBeNull();
    expect(detectSingleTableSelect("SELECT * FROM public.a, public.b")).toBeNull();
  });

  it("rejects GROUP BY", () => {
    expect(
      detectSingleTableSelect("SELECT dept, count(*) FROM emp GROUP BY dept"),
    ).toBeNull();
  });

  it("rejects HAVING", () => {
    expect(
      detectSingleTableSelect(
        "SELECT dept FROM emp GROUP BY dept HAVING count(*) > 1",
      ),
    ).toBeNull();
  });

  it("rejects UNION / INTERSECT / EXCEPT", () => {
    expect(
      detectSingleTableSelect("SELECT id FROM a UNION SELECT id FROM b"),
    ).toBeNull();
    expect(
      detectSingleTableSelect("SELECT id FROM a UNION ALL SELECT id FROM b"),
    ).toBeNull();
    expect(
      detectSingleTableSelect("SELECT id FROM a INTERSECT SELECT id FROM b"),
    ).toBeNull();
    expect(
      detectSingleTableSelect("SELECT id FROM a EXCEPT SELECT id FROM b"),
    ).toBeNull();
  });

  it("rejects a subquery in FROM (derived table)", () => {
    expect(
      detectSingleTableSelect("SELECT * FROM (SELECT * FROM users) AS sub"),
    ).toBeNull();
    expect(
      detectSingleTableSelect("SELECT * FROM ( SELECT id FROM users ) u WHERE u.id = 1"),
    ).toBeNull();
  });

  it("rejects garbage / unparseable table reference", () => {
    expect(detectSingleTableSelect("SELECT * FROM")).toBeNull();
    expect(detectSingleTableSelect("SELECT * FROM 123abc !!")).toBeNull();
  });
});
