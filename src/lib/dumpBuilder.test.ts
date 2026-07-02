import { describe, it, expect } from "vitest";
import {
  buildCreateTableDump,
  buildDropTableDump,
  buildInsertDump,
  dumpHeader,
  type DumpTableInput,
} from "./dumpBuilder";
import type { ColumnDefinition, IndexInfo, ForeignKeyInfo } from "../types";

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------
function col(
  overrides: Partial<ColumnDefinition> & { name: string },
): ColumnDefinition {
  const defaults: ColumnDefinition = {
    name: overrides.name,
    data_type: "text",
    full_type: null,
    nullable: true,
    is_primary_key: false,
    is_unique: false,
    is_auto_increment: false,
  };
  return { ...defaults, ...overrides };
}

function table(overrides: Partial<DumpTableInput> & { table: string }): DumpTableInput {
  return {
    schema: null,
    columns: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildCreateTableDump — basic column rendering across dialects
// ---------------------------------------------------------------------------
describe("buildCreateTableDump", () => {
  it("renders PK, NOT NULL, DEFAULT using full_type verbatim (mysql)", () => {
    const sql = buildCreateTableDump(
      "mysql",
      table({
        table: "users",
        columns: [
          col({ name: "id", data_type: "int", full_type: "int", is_primary_key: true, nullable: false }),
          col({ name: "email", full_type: "varchar(255)", nullable: false }),
          col({ name: "status", full_type: "varchar(20)", default_value: "'active'", nullable: false }),
        ],
      }),
    );
    expect(sql).toContain("CREATE TABLE `users` (");
    expect(sql).toContain("`id` int NOT NULL");
    expect(sql).toContain("`email` varchar(255) NOT NULL");
    expect(sql).toContain("`status` varchar(20) NOT NULL DEFAULT 'active'");
    expect(sql).toContain("PRIMARY KEY (`id`)");
    expect(sql.endsWith(";")).toBe(true);
  });

  it("uses double-quote idents for postgres and sqlite", () => {
    const pg = buildCreateTableDump(
      "postgres",
      table({
        table: "users",
        columns: [col({ name: "id", full_type: "integer", is_primary_key: true, nullable: false })],
      }),
    );
    expect(pg).toContain('CREATE TABLE "users" (');
    expect(pg).toContain('"id" integer NOT NULL');
    expect(pg).toContain('PRIMARY KEY ("id")');

    const lite = buildCreateTableDump(
      "sqlite",
      table({
        table: "users",
        columns: [col({ name: "name", full_type: "TEXT", nullable: true })],
      }),
    );
    expect(lite).toContain('CREATE TABLE "users" (');
    // nullable column → no NOT NULL fragment
    expect(lite).toContain('"name" TEXT');
    expect(lite).not.toContain("NOT NULL");
  });

  it("falls back to data_type when full_type is null", () => {
    const sql = buildCreateTableDump(
      "postgres",
      table({
        table: "t",
        columns: [col({ name: "c", data_type: "numeric", full_type: null, nullable: false })],
      }),
    );
    expect(sql).toContain('"c" numeric NOT NULL');
  });

  it("emits a composite PRIMARY KEY clause", () => {
    const sql = buildCreateTableDump(
      "postgres",
      table({
        table: "membership",
        columns: [
          col({ name: "user_id", full_type: "integer", is_primary_key: true, nullable: false }),
          col({ name: "group_id", full_type: "integer", is_primary_key: true, nullable: false }),
        ],
      }),
    );
    expect(sql).toContain('PRIMARY KEY ("user_id", "group_id")');
  });

  // -------------------------------------------------------------------------
  // Auto-increment per dialect
  // -------------------------------------------------------------------------
  it("appends AUTO_INCREMENT for mysql", () => {
    const sql = buildCreateTableDump(
      "mysql",
      table({
        table: "t",
        columns: [
          col({ name: "id", data_type: "int", full_type: "int", is_primary_key: true, is_auto_increment: true, nullable: false }),
        ],
      }),
    );
    expect(sql).toContain("`id` int NOT NULL AUTO_INCREMENT");
    expect(sql).toContain("PRIMARY KEY (`id`)");
  });

  it("substitutes SERIAL/BIGSERIAL/SMALLSERIAL for postgres auto-increment", () => {
    const serial = buildCreateTableDump(
      "postgres",
      table({ table: "t", columns: [col({ name: "id", data_type: "int", full_type: "integer", is_primary_key: true, is_auto_increment: true, nullable: false })] }),
    );
    expect(serial).toContain('"id" SERIAL NOT NULL');

    const big = buildCreateTableDump(
      "postgres",
      table({ table: "t", columns: [col({ name: "id", data_type: "bigint", full_type: "bigint", is_primary_key: true, is_auto_increment: true, nullable: false })] }),
    );
    expect(big).toContain('"id" BIGSERIAL NOT NULL');

    const small = buildCreateTableDump(
      "postgres",
      table({ table: "t", columns: [col({ name: "id", data_type: "smallint", full_type: "smallint", is_primary_key: true, is_auto_increment: true, nullable: false })] }),
    );
    expect(small).toContain('"id" SMALLSERIAL NOT NULL');
  });

  it("emits inline INTEGER PRIMARY KEY AUTOINCREMENT for a single sqlite AI pk (no table-level PK)", () => {
    const sql = buildCreateTableDump(
      "sqlite",
      table({
        table: "t",
        columns: [
          col({ name: "id", data_type: "INTEGER", full_type: "INTEGER", is_primary_key: true, is_auto_increment: true, nullable: false }),
          col({ name: "name", full_type: "TEXT", nullable: true }),
        ],
      }),
    );
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sql).not.toContain("PRIMARY KEY (");
  });

  // -------------------------------------------------------------------------
  // Index + FK emission
  // -------------------------------------------------------------------------
  it("emits CREATE [UNIQUE] INDEX for non-primary indexes and skips primary", () => {
    const indexes: IndexInfo[] = [
      { name: "pk_idx", columns: ["id"], is_unique: true, is_primary: true },
      { name: "idx_email", columns: ["email"], is_unique: true, is_primary: false },
      { name: "idx_name", columns: ["first", "last"], is_unique: false, is_primary: false },
    ];
    const sql = buildCreateTableDump(
      "postgres",
      table({
        table: "users",
        columns: [col({ name: "id", full_type: "integer", is_primary_key: true, nullable: false })],
        indexes,
      }),
    );
    expect(sql).not.toContain("pk_idx");
    expect(sql).toContain('CREATE UNIQUE INDEX "idx_email" ON "users" ("email");');
    expect(sql).toContain('CREATE INDEX "idx_name" ON "users" ("first", "last");');
  });

  it("emits ALTER TABLE ADD CONSTRAINT FOREIGN KEY with ON DELETE/UPDATE", () => {
    const fks: ForeignKeyInfo[] = [
      {
        name: "fk_orders_user",
        columns: ["user_id"],
        referenced_table: "users",
        referenced_columns: ["id"],
        on_delete: "CASCADE",
        on_update: "RESTRICT",
      },
    ];
    const sql = buildCreateTableDump(
      "mysql",
      table({
        table: "orders",
        schema: "shop",
        columns: [col({ name: "user_id", full_type: "int", nullable: false })],
        foreignKeys: fks,
      }),
    );
    expect(sql).toContain(
      "ALTER TABLE `shop`.`orders` ADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `shop`.`users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT;",
    );
  });

  it("omits ON DELETE/UPDATE clauses when absent", () => {
    const fks: ForeignKeyInfo[] = [
      { name: "fk_x", columns: ["a"], referenced_table: "other", referenced_columns: ["b"] },
    ];
    const sql = buildCreateTableDump(
      "postgres",
      table({ table: "t", columns: [col({ name: "a", full_type: "integer", nullable: false })], foreignKeys: fks }),
    );
    expect(sql).toContain('ADD CONSTRAINT "fk_x" FOREIGN KEY ("a") REFERENCES "other" ("b");');
    expect(sql).not.toContain("ON DELETE");
    expect(sql).not.toContain("ON UPDATE");
  });

  it("qualifies the table with its schema when provided", () => {
    const sql = buildCreateTableDump(
      "postgres",
      table({ table: "users", schema: "public", columns: [col({ name: "id", full_type: "integer", nullable: false })] }),
    );
    expect(sql).toContain('CREATE TABLE "public"."users" (');
  });

  // -------------------------------------------------------------------------
  // SQL Server (T-SQL)
  // -------------------------------------------------------------------------
  it("uses [bracket] idents and IDENTITY(1,1) for sqlserver auto-increment", () => {
    const sql = buildCreateTableDump(
      "sqlserver",
      table({
        table: "users",
        schema: "dbo",
        columns: [
          col({ name: "id", data_type: "int", full_type: "INT", is_primary_key: true, is_auto_increment: true, nullable: false }),
          col({ name: "email", full_type: "NVARCHAR(255)", nullable: false }),
          col({ name: "status", full_type: "NVARCHAR(20)", default_value: "'active'", nullable: false }),
        ],
      }),
    );
    expect(sql).toContain("CREATE TABLE [dbo].[users] (");
    expect(sql).toContain("[id] INT NOT NULL IDENTITY(1,1)");
    expect(sql).toContain("[email] NVARCHAR(255) NOT NULL");
    expect(sql).toContain("[status] NVARCHAR(20) NOT NULL DEFAULT 'active'");
    expect(sql).toContain("PRIMARY KEY ([id])");
  });

  it("emits sqlserver [bracket] index + FK statements", () => {
    const indexes: IndexInfo[] = [
      { name: "idx_email", columns: ["email"], is_unique: true, is_primary: false },
    ];
    const fks: ForeignKeyInfo[] = [
      { name: "fk_o_u", columns: ["user_id"], referenced_table: "users", referenced_columns: ["id"], on_delete: "CASCADE" },
    ];
    const sql = buildCreateTableDump(
      "sqlserver",
      table({
        table: "orders",
        schema: "dbo",
        columns: [
          col({ name: "user_id", full_type: "INT", nullable: false }),
          col({ name: "email", full_type: "NVARCHAR(255)", nullable: false }),
        ],
        indexes,
        foreignKeys: fks,
      }),
    );
    expect(sql).toContain('CREATE UNIQUE INDEX [idx_email] ON [dbo].[orders] ([email]);');
    expect(sql).toContain(
      "ALTER TABLE [dbo].[orders] ADD CONSTRAINT [fk_o_u] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users] ([id]) ON DELETE CASCADE;",
    );
  });
});

// ---------------------------------------------------------------------------
// buildDropTableDump
// ---------------------------------------------------------------------------
describe("buildDropTableDump", () => {
  it("builds a qualified DROP TABLE IF EXISTS", () => {
    expect(buildDropTableDump("mysql", "shop", "orders")).toBe(
      "DROP TABLE IF EXISTS `shop`.`orders`;",
    );
    expect(buildDropTableDump("postgres", "public", "users")).toBe(
      'DROP TABLE IF EXISTS "public"."users";',
    );
    expect(buildDropTableDump("sqlite", null, "t")).toBe(
      'DROP TABLE IF EXISTS "t";',
    );
    expect(buildDropTableDump("sqlserver", "dbo", "users")).toBe(
      "DROP TABLE IF EXISTS [dbo].[users];",
    );
  });
});

// ---------------------------------------------------------------------------
// buildInsertDump
// ---------------------------------------------------------------------------
describe("buildInsertDump", () => {
  it("returns '' for empty rows", () => {
    expect(buildInsertDump("postgres", "public", "t", ["a"], [])).toBe("");
  });

  it("schema-qualifies the INSERT target", () => {
    const sql = buildInsertDump(
      "postgres",
      "public",
      "users",
      ["id", "name"],
      [{ id: 1, name: "Ada" }],
    );
    expect(sql).toContain('INSERT INTO "public"."users" ("id", "name") VALUES');
    expect(sql).not.toContain('INSERT INTO "users" (');
    expect(sql).toContain("(1, 'Ada')");
  });

  it("emits a bare (unqualified) INSERT when no schema is given", () => {
    const sql = buildInsertDump("mysql", null, "users", ["id"], [{ id: 7 }]);
    expect(sql).toContain("INSERT INTO `users` (`id`) VALUES");
    expect(sql).toContain("(7)");
  });

  it("schema-qualifies the sqlserver INSERT target with [bracket] quoting", () => {
    const sql = buildInsertDump(
      "sqlserver",
      "dbo",
      "users",
      ["id", "name"],
      [{ id: 1, name: "Ada" }],
    );
    // The qualification rewrite is owned here and is quote-agnostic about the
    // bare table token buildInsertSql emits, so the target is always the
    // bracket-qualified [dbo].[users].
    expect(sql).toContain("INSERT INTO [dbo].[users] (");
    expect(sql).not.toContain('INSERT INTO "users" (');
    expect(sql).not.toContain("INSERT INTO [users] (");
  });

  it("qualifies every batched INSERT statement", () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: i }));
    const sql = buildInsertDump("postgres", "public", "nums", ["id"], rows);
    // Default batch size is 100 → two INSERT statements, both qualified.
    const matches = sql.match(/INSERT INTO "public"\."nums"/g) ?? [];
    expect(matches.length).toBe(2);
    expect(sql).not.toMatch(/INSERT INTO "nums" \(/);
  });
});

// ---------------------------------------------------------------------------
// dumpHeader
// ---------------------------------------------------------------------------
describe("dumpHeader", () => {
  it("produces a comment header with db name and dialect", () => {
    expect(dumpHeader("postgres", "mydb")).toBe("-- ANSQL dump of mydb (postgres) --");
  });
});
