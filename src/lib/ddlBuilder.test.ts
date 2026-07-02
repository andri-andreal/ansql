import { describe, it, expect } from "vitest";
import { renderType, buildCreateTable, quoteStringLiteral } from "./ddlBuilder";
import type {
  DesignerColumn,
  DesignerIndex,
  DesignerCheck,
  DesignerUnique,
  TableOptions,
} from "../types";

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------
function col(overrides: Partial<DesignerColumn> & { name: string; type: string }): DesignerColumn {
  const defaults: DesignerColumn = {
    id: overrides.name,
    name: overrides.name,
    type: overrides.type,
    nullable: false,
    isPrimaryKey: false,
    isAutoIncrement: false,
    length: null,
    precision: null,
    scale: null,
    defaultValue: null,
  };
  return { ...defaults, ...overrides };
}

// ---------------------------------------------------------------------------
// renderType
// ---------------------------------------------------------------------------
describe("renderType", () => {
  describe("varchar with length", () => {
    it("includes length for all dialects", () => {
      const c = col({ name: "n", type: "varchar", length: 120 });
      expect(renderType("mysql", c)).toBe("VARCHAR(120)");
      expect(renderType("postgres", c)).toBe("VARCHAR(120)");
      expect(renderType("sqlite", c)).toBe("VARCHAR(120)");
    });

    it("falls back to VARCHAR(255) when length is null", () => {
      const c = col({ name: "n", type: "varchar" });
      expect(renderType("mysql", c)).toBe("VARCHAR(255)");
    });
  });

  describe("decimal with precision and scale", () => {
    it("includes precision and scale for all dialects", () => {
      const c = col({ name: "n", type: "decimal", precision: 10, scale: 2 });
      expect(renderType("mysql", c)).toBe("DECIMAL(10,2)");
      expect(renderType("postgres", c)).toBe("DECIMAL(10,2)");
      expect(renderType("sqlite", c)).toBe("DECIMAL(10,2)");
    });

    it("omits scale when null", () => {
      const c = col({ name: "n", type: "decimal", precision: 8 });
      expect(renderType("mysql", c)).toBe("DECIMAL(8)");
    });

    it("renders bare DECIMAL when no precision", () => {
      const c = col({ name: "n", type: "decimal" });
      expect(renderType("mysql", c)).toBe("DECIMAL");
    });
  });

  describe("double", () => {
    it("renders DOUBLE for mysql, DOUBLE PRECISION for postgres/sqlite", () => {
      const c = col({ name: "n", type: "double" });
      expect(renderType("mysql", c)).toBe("DOUBLE");
      expect(renderType("postgres", c)).toBe("DOUBLE PRECISION");
      expect(renderType("sqlite", c)).toBe("DOUBLE PRECISION");
    });
  });

  describe("boolean", () => {
    it("is dialect-specific: TINYINT(1) / BOOLEAN / INTEGER", () => {
      const c = col({ name: "n", type: "boolean" });
      expect(renderType("mysql", c)).toBe("TINYINT(1)");
      expect(renderType("postgres", c)).toBe("BOOLEAN");
      expect(renderType("sqlite", c)).toBe("INTEGER");
    });
  });

  describe("uuid", () => {
    it("renders UUID for postgres, VARCHAR(36) for mysql/sqlite", () => {
      const c = col({ name: "n", type: "uuid" });
      expect(renderType("postgres", c)).toBe("UUID");
      expect(renderType("mysql", c)).toBe("VARCHAR(36)");
      expect(renderType("sqlite", c)).toBe("VARCHAR(36)");
    });
  });

  describe("blob", () => {
    it("renders dialect-specific blob types", () => {
      const c = col({ name: "n", type: "blob" });
      expect(renderType("mysql", c)).toBe("LONGBLOB");
      expect(renderType("postgres", c)).toBe("BYTEA");
      expect(renderType("sqlite", c)).toBe("BLOB");
    });
  });

  describe("json", () => {
    it("renders JSON / JSONB / TEXT", () => {
      const c = col({ name: "n", type: "json" });
      expect(renderType("mysql", c)).toBe("JSON");
      expect(renderType("postgres", c)).toBe("JSONB");
      expect(renderType("sqlite", c)).toBe("TEXT");
    });
  });

  describe("timestamp", () => {
    it("renders DATETIME for mysql, TIMESTAMP for postgres/sqlite", () => {
      const c = col({ name: "n", type: "timestamp" });
      expect(renderType("mysql", c)).toBe("DATETIME");
      expect(renderType("postgres", c)).toBe("TIMESTAMP");
      expect(renderType("sqlite", c)).toBe("TIMESTAMP");
    });
  });

  describe("SQL Server (T-SQL) type mapping", () => {
    it("int → INT (not INTEGER)", () => {
      expect(renderType("sqlserver", col({ name: "n", type: "int" }))).toBe("INT");
    });

    it("bigint / smallint unchanged", () => {
      expect(renderType("sqlserver", col({ name: "n", type: "bigint" }))).toBe("BIGINT");
      expect(renderType("sqlserver", col({ name: "n", type: "smallint" }))).toBe("SMALLINT");
    });

    it("decimal(p,s) unchanged", () => {
      const c = col({ name: "n", type: "decimal", precision: 12, scale: 4 });
      expect(renderType("sqlserver", c)).toBe("DECIMAL(12,4)");
    });

    it("real → REAL, double → FLOAT", () => {
      expect(renderType("sqlserver", col({ name: "n", type: "real" }))).toBe("REAL");
      expect(renderType("sqlserver", col({ name: "n", type: "double" }))).toBe("FLOAT");
    });

    it("varchar(n) → NVARCHAR(n) with 255 fallback", () => {
      expect(renderType("sqlserver", col({ name: "n", type: "varchar", length: 120 }))).toBe("NVARCHAR(120)");
      expect(renderType("sqlserver", col({ name: "n", type: "varchar" }))).toBe("NVARCHAR(255)");
    });

    it("text / json → NVARCHAR(MAX)", () => {
      expect(renderType("sqlserver", col({ name: "n", type: "text" }))).toBe("NVARCHAR(MAX)");
      expect(renderType("sqlserver", col({ name: "n", type: "json" }))).toBe("NVARCHAR(MAX)");
    });

    it("boolean → BIT", () => {
      expect(renderType("sqlserver", col({ name: "n", type: "boolean" }))).toBe("BIT");
    });

    it("date → DATE, timestamp → DATETIME2, time → TIME", () => {
      expect(renderType("sqlserver", col({ name: "n", type: "date" }))).toBe("DATE");
      expect(renderType("sqlserver", col({ name: "n", type: "timestamp" }))).toBe("DATETIME2");
      expect(renderType("sqlserver", col({ name: "n", type: "time" }))).toBe("TIME");
    });

    it("blob → VARBINARY(MAX), uuid → UNIQUEIDENTIFIER", () => {
      expect(renderType("sqlserver", col({ name: "n", type: "blob" }))).toBe("VARBINARY(MAX)");
      expect(renderType("sqlserver", col({ name: "n", type: "uuid" }))).toBe("UNIQUEIDENTIFIER");
    });

    it("unknown type → NVARCHAR(MAX)", () => {
      expect(renderType("sqlserver", col({ name: "n", type: "geometry" }))).toBe("NVARCHAR(MAX)");
    });
  });
});

// ---------------------------------------------------------------------------
// buildCreateTable
// ---------------------------------------------------------------------------
describe("buildCreateTable", () => {
  describe("basic MySQL table", () => {
    it("emits PK clause + NOT NULL + normal nullable column", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "username", type: "varchar", length: 100, nullable: false }),
        col({ name: "bio", type: "text", nullable: true }),
      ];
      const stmts = buildCreateTable("mysql", null, "users", columns, []);
      expect(stmts).toHaveLength(1);
      const sql = stmts[0].sql;
      expect(sql).toMatch(/^CREATE TABLE `users`/);
      expect(sql).toContain("`id` INTEGER NOT NULL");
      expect(sql).toContain("`username` VARCHAR(100) NOT NULL");
      expect(sql).toContain("`bio` TEXT");
      // bio is nullable — must NOT have NOT NULL
      expect(sql).not.toMatch(/`bio` TEXT NOT NULL/);
      expect(sql).toContain("PRIMARY KEY (`id`)");
      expect(stmts[0].params).toEqual([]);
    });
  });

  describe("MySQL auto-increment PK", () => {
    it("emits AUTO_INCREMENT keyword + table-level PRIMARY KEY", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false, isAutoIncrement: true }),
        col({ name: "name", type: "varchar", length: 50, nullable: false }),
      ];
      const stmts = buildCreateTable("mysql", null, "things", columns, []);
      const sql = stmts[0].sql;
      expect(sql).toContain("`id` INTEGER NOT NULL AUTO_INCREMENT");
      expect(sql).toContain("PRIMARY KEY (`id`)");
    });
  });

  describe("Postgres auto-increment PK → SERIAL", () => {
    it("uses SERIAL type and emits table-level PRIMARY KEY", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false, isAutoIncrement: true }),
        col({ name: "email", type: "varchar", length: 200, nullable: false }),
      ];
      const stmts = buildCreateTable("postgres", null, "accounts", columns, []);
      const sql = stmts[0].sql;
      expect(sql).toMatch(/^CREATE TABLE "accounts"/);
      expect(sql).toContain('"id" SERIAL');
      expect(sql).not.toContain("AUTO_INCREMENT");
      expect(sql).toContain('PRIMARY KEY ("id")');
    });
  });

  describe("Postgres bigint auto-increment → BIGSERIAL", () => {
    it("uses BIGSERIAL for bigint", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "bigint", isPrimaryKey: true, nullable: false, isAutoIncrement: true }),
      ];
      const stmts = buildCreateTable("postgres", null, "t", columns, []);
      expect(stmts[0].sql).toContain('"id" BIGSERIAL');
    });
  });

  describe("Postgres smallint auto-increment → SMALLSERIAL", () => {
    it("uses SMALLSERIAL for smallint", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "smallint", isPrimaryKey: true, nullable: false, isAutoIncrement: true }),
      ];
      const stmts = buildCreateTable("postgres", null, "t", columns, []);
      expect(stmts[0].sql).toContain('"id" SMALLSERIAL');
    });
  });

  describe("SQLite auto-increment PK → inline INTEGER PRIMARY KEY AUTOINCREMENT", () => {
    it("emits inline form and NO separate PK clause", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false, isAutoIncrement: true }),
        col({ name: "label", type: "text", nullable: true }),
      ];
      const stmts = buildCreateTable("sqlite", null, "notes", columns, []);
      const sql = stmts[0].sql;
      expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
      // Must NOT have a separate table-level PK clause
      expect(sql).not.toMatch(/PRIMARY KEY \("id"\)/);
    });
  });

  describe("SQLite non-auto-increment single PK (e.g. varchar PK)", () => {
    it("emits table-level PRIMARY KEY clause and does NOT contain AUTOINCREMENT", () => {
      const columns: DesignerColumn[] = [
        col({ name: "slug", type: "varchar", length: 100, isPrimaryKey: true, nullable: false, isAutoIncrement: false }),
        col({ name: "title", type: "text", nullable: false }),
      ];
      const stmts = buildCreateTable("sqlite", null, "pages", columns, []);
      const sql = stmts[0].sql;
      expect(sql).toContain('PRIMARY KEY ("slug")');
      expect(sql).not.toContain("AUTOINCREMENT");
    });
  });

  describe("index generation", () => {
    it("emits CREATE UNIQUE INDEX for a unique index", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "email", type: "varchar", length: 255, nullable: false }),
      ];
      const indexes: DesignerIndex[] = [
        { id: "idx1", name: "idx_email", unique: true, columns: ["email"] },
      ];
      const stmts = buildCreateTable("postgres", null, "users", columns, indexes);
      expect(stmts).toHaveLength(2);
      expect(stmts[1].sql).toBe('CREATE UNIQUE INDEX "idx_email" ON "users" ("email");');
    });

    it("emits CREATE INDEX (non-unique) for a non-unique index", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "status", type: "varchar", length: 32, nullable: true }),
      ];
      const indexes: DesignerIndex[] = [
        { id: "idx2", name: "idx_status", unique: false, columns: ["status"] },
      ];
      const stmts = buildCreateTable("mysql", null, "jobs", columns, indexes);
      expect(stmts).toHaveLength(2);
      expect(stmts[1].sql).toBe("CREATE INDEX `idx_status` ON `jobs` (`status`);");
    });
  });

  describe("schema qualification", () => {
    it("qualifies table with schema for postgres", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", nullable: false }),
      ];
      const stmts = buildCreateTable("postgres", "myschema", "widgets", columns, []);
      expect(stmts[0].sql).toMatch(/^CREATE TABLE "myschema"\."widgets"/);
    });

    it("qualifies table with db for mysql", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", nullable: false }),
      ];
      const stmts = buildCreateTable("mysql", "mydb", "widgets", columns, []);
      expect(stmts[0].sql).toMatch(/^CREATE TABLE `mydb`\.`widgets`/);
    });

    it("qualifies index ON with schema for postgres", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", nullable: false }),
        col({ name: "name", type: "text", nullable: true }),
      ];
      const indexes: DesignerIndex[] = [
        { id: "i1", name: "idx_name", unique: false, columns: ["name"] },
      ];
      const stmts = buildCreateTable("postgres", "myschema", "widgets", columns, indexes);
      expect(stmts[1].sql).toContain('ON "myschema"."widgets"');
    });
  });

  describe("DEFAULT value", () => {
    it("includes DEFAULT when defaultValue is set", () => {
      const columns: DesignerColumn[] = [
        col({ name: "status", type: "varchar", length: 20, nullable: false, defaultValue: "'active'" }),
      ];
      const stmts = buildCreateTable("mysql", null, "orders", columns, []);
      expect(stmts[0].sql).toContain("DEFAULT 'active'");
    });

    it("Postgres: suppresses DEFAULT on auto-increment column even when defaultValue is set", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false, isAutoIncrement: true, defaultValue: "0" }),
        col({ name: "label", type: "text", nullable: true }),
      ];
      const stmts = buildCreateTable("postgres", null, "things", columns, []);
      const sql = stmts[0].sql;
      expect(sql).toContain("SERIAL");
      expect(sql).not.toContain("DEFAULT");
    });

    it("MySQL: suppresses DEFAULT on auto-increment column even when defaultValue is set", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false, isAutoIncrement: true, defaultValue: "0" }),
        col({ name: "label", type: "text", nullable: true }),
      ];
      const stmts = buildCreateTable("mysql", null, "things", columns, []);
      const sql = stmts[0].sql;
      expect(sql).toContain("AUTO_INCREMENT");
      expect(sql).not.toContain("DEFAULT");
    });
  });

  describe("multi-column primary key", () => {
    it("emits all PK columns in table-level PK clause", () => {
      const columns: DesignerColumn[] = [
        col({ name: "order_id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "product_id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "qty", type: "int", nullable: false }),
      ];
      const stmts = buildCreateTable("postgres", null, "order_items", columns, []);
      expect(stmts[0].sql).toContain('PRIMARY KEY ("order_id", "product_id")');
    });
  });

  // -------------------------------------------------------------------------
  // SQL Server (T-SQL)
  // -------------------------------------------------------------------------
  describe("SQL Server (T-SQL)", () => {
    it("brackets identifiers and renders T-SQL types", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "name", type: "varchar", length: 100, nullable: false }),
        col({ name: "bio", type: "text", nullable: true }),
      ];
      const stmts = buildCreateTable("sqlserver", null, "users", columns, []);
      expect(stmts).toHaveLength(1);
      const sql = stmts[0].sql;
      expect(sql).toMatch(/^CREATE TABLE \[users\]/);
      expect(sql).toContain("[id] INT NOT NULL");
      expect(sql).toContain("[name] NVARCHAR(100) NOT NULL");
      expect(sql).toContain("[bio] NVARCHAR(MAX)");
      expect(sql).not.toMatch(/\[bio\] NVARCHAR\(MAX\) NOT NULL/);
      expect(sql).toContain("PRIMARY KEY ([id])");
    });

    it("auto-increment uses IDENTITY(1,1) (no SERIAL, no AUTO_INCREMENT)", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false, isAutoIncrement: true }),
        col({ name: "name", type: "varchar", length: 50, nullable: false }),
      ];
      const sql = buildCreateTable("sqlserver", null, "things", columns, [])[0].sql;
      expect(sql).toContain("[id] INT IDENTITY(1,1) NOT NULL");
      expect(sql).not.toContain("SERIAL");
      expect(sql).not.toContain("AUTO_INCREMENT");
      expect(sql).toContain("PRIMARY KEY ([id])");
    });

    it("bigint auto-increment → BIGINT IDENTITY(1,1)", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "bigint", isPrimaryKey: true, nullable: false, isAutoIncrement: true }),
      ];
      const sql = buildCreateTable("sqlserver", null, "t", columns, [])[0].sql;
      expect(sql).toContain("[id] BIGINT IDENTITY(1,1) NOT NULL");
    });

    it("suppresses DEFAULT on an auto-increment column", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false, isAutoIncrement: true, defaultValue: "0" }),
      ];
      const sql = buildCreateTable("sqlserver", null, "t", columns, [])[0].sql;
      expect(sql).toContain("IDENTITY(1,1)");
      expect(sql).not.toContain("DEFAULT");
    });

    it("renders DEFAULT for a non-identity column", () => {
      const columns: DesignerColumn[] = [
        col({ name: "status", type: "varchar", length: 20, nullable: false, defaultValue: "'active'" }),
      ];
      const sql = buildCreateTable("sqlserver", null, "orders", columns, [])[0].sql;
      expect(sql).toContain("DEFAULT 'active'");
    });

    it("qualifies the table with a schema using brackets", () => {
      const columns: DesignerColumn[] = [col({ name: "id", type: "int", nullable: false })];
      const sql = buildCreateTable("sqlserver", "dbo", "widgets", columns, [])[0].sql;
      expect(sql).toMatch(/^CREATE TABLE \[dbo\]\.\[widgets\]/);
    });

    it("emits a plain CREATE [UNIQUE] INDEX with no USING method", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "email", type: "varchar", length: 255, nullable: false }),
      ];
      const indexes: DesignerIndex[] = [
        { id: "i1", name: "idx_email", unique: true, columns: ["email"], method: "BTREE" },
      ];
      const stmts = buildCreateTable("sqlserver", null, "users", columns, indexes);
      expect(stmts).toHaveLength(2);
      expect(stmts[1].sql).toBe("CREATE UNIQUE INDEX [idx_email] ON [users] ([email]);");
      expect(stmts[1].sql).not.toContain("USING");
    });

    it("honors per-column DESC order in an index", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "created", type: "timestamp", nullable: false }),
      ];
      const indexes: DesignerIndex[] = [
        { id: "i1", name: "idx_created", unique: false, columns: ["created"], columnOrders: { created: "DESC" } },
      ];
      const stmts = buildCreateTable("sqlserver", null, "events", columns, indexes);
      expect(stmts[1].sql).toBe("CREATE INDEX [idx_created] ON [events] ([created] DESC);");
    });

    it("emits named UNIQUE and CHECK constraints", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "email", type: "varchar", length: 200, nullable: false }),
        col({ name: "age", type: "int", nullable: false }),
      ];
      const uniques: DesignerUnique[] = [{ id: "u1", name: "uq_email", columns: ["email"] }];
      const checks: DesignerCheck[] = [{ id: "c1", name: "chk_age", expression: "age >= 0" }];
      const sql = buildCreateTable("sqlserver", null, "users", columns, [], checks, uniques)[0].sql;
      expect(sql).toContain("CONSTRAINT [uq_email] UNIQUE ([email])");
      expect(sql).toContain("CONSTRAINT [chk_age] CHECK (age >= 0)");
    });

    it("does NOT emit MySQL-only inline COMMENT or table options", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", nullable: false, comment: "ignored" }),
      ];
      const options: TableOptions = { engine: "InnoDB", comment: "x" };
      const stmts = buildCreateTable("sqlserver", null, "t", columns, [], [], [], options);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).not.toContain("COMMENT");
      expect(stmts[0].sql).not.toContain("ENGINE");
    });

    it("escapes a closing bracket in an identifier by doubling it", () => {
      const columns: DesignerColumn[] = [col({ name: "we]rd", type: "int", nullable: false })];
      const sql = buildCreateTable("sqlserver", null, "t", columns, [])[0].sql;
      expect(sql).toContain("[we]]rd] INT NOT NULL");
    });
  });

  // -------------------------------------------------------------------------
  // Column comments
  // -------------------------------------------------------------------------
  describe("column comments", () => {
    it("MySQL: appends COMMENT '<text>' inline on the column line", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "email", type: "varchar", length: 200, nullable: false, comment: "User email" }),
      ];
      const stmts = buildCreateTable("mysql", null, "users", columns, []);
      expect(stmts).toHaveLength(1);
      const sql = stmts[0].sql;
      expect(sql).toContain("`email` VARCHAR(200) NOT NULL COMMENT 'User email'");
      // id has no comment → no COMMENT on its line
      expect(sql).toMatch(/`id` INTEGER NOT NULL,/);
    });

    it("MySQL: escapes embedded single quote in the comment", () => {
      const columns: DesignerColumn[] = [
        col({ name: "note", type: "text", nullable: true, comment: "It's a note" }),
      ];
      const stmts = buildCreateTable("mysql", null, "t", columns, []);
      expect(stmts[0].sql).toContain("COMMENT 'It''s a note'");
    });

    it("Postgres: emits COMMENT ON COLUMN statements after CREATE TABLE", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ name: "email", type: "varchar", length: 200, nullable: false, comment: "User email" }),
      ];
      const stmts = buildCreateTable("postgres", null, "users", columns, []);
      // CREATE TABLE then one COMMENT ON COLUMN
      expect(stmts).toHaveLength(2);
      expect(stmts[0].sql).toMatch(/^CREATE TABLE "users"/);
      // CREATE itself must NOT carry an inline COMMENT
      expect(stmts[0].sql).not.toContain("COMMENT");
      expect(stmts[1].sql).toBe(
        `COMMENT ON COLUMN "users"."email" IS 'User email';`,
      );
      expect(stmts[1].params).toEqual([]);
    });

    it("Postgres: qualifies the COMMENT ON COLUMN table with the schema", () => {
      const columns: DesignerColumn[] = [
        col({ name: "name", type: "text", nullable: true, comment: "the name" }),
      ];
      const stmts = buildCreateTable("postgres", "myschema", "widgets", columns, []);
      expect(stmts).toHaveLength(2);
      expect(stmts[1].sql).toBe(
        `COMMENT ON COLUMN "myschema"."widgets"."name" IS 'the name';`,
      );
    });

    it("Postgres: one COMMENT ON COLUMN per commented column (skips uncommented)", () => {
      const columns: DesignerColumn[] = [
        col({ name: "a", type: "int", nullable: true, comment: "alpha" }),
        col({ name: "b", type: "int", nullable: true }),
        col({ name: "c", type: "int", nullable: true, comment: "gamma" }),
      ];
      const stmts = buildCreateTable("postgres", null, "t", columns, []);
      const comments = stmts.filter((s) => s.sql.startsWith("COMMENT ON COLUMN"));
      expect(comments).toHaveLength(2);
      expect(comments[0].sql).toBe(`COMMENT ON COLUMN "t"."a" IS 'alpha';`);
      expect(comments[1].sql).toBe(`COMMENT ON COLUMN "t"."c" IS 'gamma';`);
    });

    it("SQLite: ignores comments entirely (no COMMENT keyword anywhere)", () => {
      const columns: DesignerColumn[] = [
        col({ name: "id", type: "int", isPrimaryKey: true, nullable: false, comment: "ignored" }),
      ];
      const stmts = buildCreateTable("sqlite", null, "t", columns, []);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).not.toContain("COMMENT");
    });

    it("treats empty-string / null comment as no comment (MySQL + Postgres)", () => {
      const mysqlStmts = buildCreateTable("mysql", null, "t", [
        col({ name: "a", type: "int", nullable: true, comment: "" }),
        col({ name: "b", type: "int", nullable: true, comment: null }),
      ], []);
      expect(mysqlStmts).toHaveLength(1);
      expect(mysqlStmts[0].sql).not.toContain("COMMENT");

      const pgStmts = buildCreateTable("postgres", null, "t", [
        col({ name: "a", type: "int", nullable: true, comment: "" }),
        col({ name: "b", type: "int", nullable: true, comment: null }),
      ], []);
      expect(pgStmts).toHaveLength(1);
      expect(pgStmts.some((s) => s.sql.includes("COMMENT"))).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// quoteStringLiteral
// ---------------------------------------------------------------------------
describe("quoteStringLiteral", () => {
  it("wraps a plain string in single quotes for all dialects", () => {
    expect(quoteStringLiteral("mysql", "hello")).toBe("'hello'");
    expect(quoteStringLiteral("postgres", "hello")).toBe("'hello'");
    expect(quoteStringLiteral("sqlite", "hello")).toBe("'hello'");
  });

  it("doubles embedded single quotes for all dialects", () => {
    expect(quoteStringLiteral("mysql", "O'Brien")).toBe("'O''Brien'");
    expect(quoteStringLiteral("postgres", "O'Brien")).toBe("'O''Brien'");
    expect(quoteStringLiteral("sqlite", "O'Brien")).toBe("'O''Brien'");
  });

  it("MySQL: doubles backslashes AND single quotes", () => {
    expect(quoteStringLiteral("mysql", "C:\\Users\\O'Brien")).toBe(
      "'C:\\\\Users\\\\O''Brien'",
    );
  });

  it("Postgres/SQLite: leaves backslashes as-is, only doubles single quotes", () => {
    expect(quoteStringLiteral("postgres", "C:\\path")).toBe("'C:\\path'");
    expect(quoteStringLiteral("sqlite", "C:\\path")).toBe("'C:\\path'");
  });
});

// ---------------------------------------------------------------------------
// Extended column attributes (unsigned / zerofill / charset / on-update / generated)
// ---------------------------------------------------------------------------
describe("buildCreateTable — extended column attributes", () => {
  describe("MySQL UNSIGNED / ZEROFILL", () => {
    it("appends UNSIGNED after the numeric type", () => {
      const columns = [col({ name: "qty", type: "int", nullable: false, unsigned: true })];
      const sql = buildCreateTable("mysql", null, "t", columns, [])[0].sql;
      expect(sql).toContain("`qty` INTEGER UNSIGNED NOT NULL");
    });

    it("ZEROFILL implies UNSIGNED and follows it", () => {
      const columns = [col({ name: "code", type: "int", nullable: false, zerofill: true })];
      const sql = buildCreateTable("mysql", null, "t", columns, [])[0].sql;
      expect(sql).toContain("`code` INTEGER UNSIGNED ZEROFILL NOT NULL");
    });

    it("applies UNSIGNED to DECIMAL", () => {
      const columns = [col({ name: "amt", type: "decimal", precision: 10, scale: 2, nullable: false, unsigned: true })];
      const sql = buildCreateTable("mysql", null, "t", columns, [])[0].sql;
      expect(sql).toContain("`amt` DECIMAL(10,2) UNSIGNED NOT NULL");
    });

    it("does NOT apply UNSIGNED on Postgres", () => {
      const columns = [col({ name: "qty", type: "int", nullable: false, unsigned: true })];
      const sql = buildCreateTable("postgres", null, "t", columns, [])[0].sql;
      expect(sql).not.toContain("UNSIGNED");
    });

    it("does NOT apply UNSIGNED to a non-numeric type", () => {
      const columns = [col({ name: "name", type: "varchar", length: 50, nullable: false, unsigned: true })];
      const sql = buildCreateTable("mysql", null, "t", columns, [])[0].sql;
      expect(sql).not.toContain("UNSIGNED");
    });
  });

  describe("MySQL per-column CHARACTER SET / COLLATE", () => {
    it("emits CHARACTER SET and COLLATE for MySQL", () => {
      const columns = [col({ name: "name", type: "varchar", length: 100, nullable: false, charset: "utf8mb4", collation: "utf8mb4_unicode_ci" })];
      const sql = buildCreateTable("mysql", null, "t", columns, [])[0].sql;
      expect(sql).toContain("`name` VARCHAR(100) NOT NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    });

    it("ignores charset/collation on Postgres", () => {
      const columns = [col({ name: "name", type: "varchar", length: 100, nullable: false, charset: "utf8mb4", collation: "utf8mb4_unicode_ci" })];
      const sql = buildCreateTable("postgres", null, "t", columns, [])[0].sql;
      expect(sql).not.toContain("CHARACTER SET");
      expect(sql).not.toContain("COLLATE");
    });
  });

  describe("MySQL ON UPDATE CURRENT_TIMESTAMP", () => {
    it("emits ON UPDATE CURRENT_TIMESTAMP for a timestamp column", () => {
      const columns = [col({ name: "updated_at", type: "timestamp", nullable: false, defaultValue: "CURRENT_TIMESTAMP", onUpdateCurrentTimestamp: true })];
      const sql = buildCreateTable("mysql", null, "t", columns, [])[0].sql;
      expect(sql).toContain("`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    });

    it("does NOT emit ON UPDATE for a non-timestamp column", () => {
      const columns = [col({ name: "n", type: "int", nullable: false, onUpdateCurrentTimestamp: true })];
      const sql = buildCreateTable("mysql", null, "t", columns, [])[0].sql;
      expect(sql).not.toContain("ON UPDATE");
    });

    it("does NOT emit ON UPDATE on Postgres", () => {
      const columns = [col({ name: "updated_at", type: "timestamp", nullable: false, onUpdateCurrentTimestamp: true })];
      const sql = buildCreateTable("postgres", null, "t", columns, [])[0].sql;
      expect(sql).not.toContain("ON UPDATE");
    });
  });

  describe("GENERATED columns", () => {
    it("MySQL: emits GENERATED ALWAYS AS (...) STORED with no DEFAULT", () => {
      const columns = [
        col({ name: "price", type: "decimal", precision: 10, scale: 2, nullable: false }),
        col({ name: "qty", type: "int", nullable: false }),
        col({ name: "total", type: "decimal", precision: 12, scale: 2, nullable: false, defaultValue: "0", generated: { expression: "price * qty", stored: true } }),
      ];
      const sql = buildCreateTable("mysql", null, "t", columns, [])[0].sql;
      expect(sql).toContain("`total` DECIMAL(12,2) GENERATED ALWAYS AS (price * qty) STORED NOT NULL");
      // generated columns never carry DEFAULT
      expect(sql).not.toContain("DEFAULT 0");
    });

    it("emits VIRTUAL for a non-stored generated column", () => {
      const columns = [col({ name: "full", type: "varchar", length: 200, nullable: true, generated: { expression: "CONCAT(a, b)", stored: false } })];
      const sql = buildCreateTable("mysql", null, "t", columns, [])[0].sql;
      expect(sql).toContain("GENERATED ALWAYS AS (CONCAT(a, b)) VIRTUAL");
    });

    it("Postgres: emits the generated clause (STORED)", () => {
      const columns = [col({ name: "total", type: "decimal", precision: 12, scale: 2, nullable: false, generated: { expression: "price * qty", stored: true } })];
      const sql = buildCreateTable("postgres", null, "t", columns, [])[0].sql;
      expect(sql).toContain('"total" DECIMAL(12,2) GENERATED ALWAYS AS (price * qty) STORED NOT NULL');
    });
  });
});

// ---------------------------------------------------------------------------
// Named UNIQUE constraints
// ---------------------------------------------------------------------------
describe("buildCreateTable — named UNIQUE constraints", () => {
  const cols = [
    col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
    col({ name: "email", type: "varchar", length: 200, nullable: false }),
  ];

  it("MySQL: emits CONSTRAINT <name> UNIQUE (...)", () => {
    const uniques: DesignerUnique[] = [{ id: "u1", name: "uq_email", columns: ["email"] }];
    const sql = buildCreateTable("mysql", null, "users", cols, [], [], uniques)[0].sql;
    expect(sql).toContain("CONSTRAINT `uq_email` UNIQUE (`email`)");
  });

  it("Postgres: emits CONSTRAINT <name> UNIQUE (...)", () => {
    const uniques: DesignerUnique[] = [{ id: "u1", name: "uq_email", columns: ["email"] }];
    const sql = buildCreateTable("postgres", null, "users", cols, [], [], uniques)[0].sql;
    expect(sql).toContain('CONSTRAINT "uq_email" UNIQUE ("email")');
  });

  it("SQLite: emits CONSTRAINT <name> UNIQUE (...)", () => {
    const uniques: DesignerUnique[] = [{ id: "u1", name: "uq_email", columns: ["email"] }];
    const sql = buildCreateTable("sqlite", null, "users", cols, [], [], uniques)[0].sql;
    expect(sql).toContain('CONSTRAINT "uq_email" UNIQUE ("email")');
  });

  it("supports multi-column unique", () => {
    const uniques: DesignerUnique[] = [{ id: "u1", name: "uq_two", columns: ["email", "id"] }];
    const sql = buildCreateTable("mysql", null, "users", cols, [], [], uniques)[0].sql;
    expect(sql).toContain("CONSTRAINT `uq_two` UNIQUE (`email`, `id`)");
  });
});

// ---------------------------------------------------------------------------
// CHECK constraints
// ---------------------------------------------------------------------------
describe("buildCreateTable — CHECK constraints", () => {
  const cols = [col({ name: "age", type: "int", nullable: false })];

  it("MySQL: emits CONSTRAINT <name> CHECK (expr)", () => {
    const checks: DesignerCheck[] = [{ id: "c1", name: "chk_age", expression: "age >= 0" }];
    const sql = buildCreateTable("mysql", null, "people", cols, [], checks)[0].sql;
    expect(sql).toContain("CONSTRAINT `chk_age` CHECK (age >= 0)");
  });

  it("Postgres: emits CONSTRAINT <name> CHECK (expr)", () => {
    const checks: DesignerCheck[] = [{ id: "c1", name: "chk_age", expression: "age >= 0" }];
    const sql = buildCreateTable("postgres", null, "people", cols, [], checks)[0].sql;
    expect(sql).toContain('CONSTRAINT "chk_age" CHECK (age >= 0)');
  });

  it("SQLite: emits CONSTRAINT <name> CHECK (expr)", () => {
    const checks: DesignerCheck[] = [{ id: "c1", name: "chk_age", expression: "age >= 0" }];
    const sql = buildCreateTable("sqlite", null, "people", cols, [], checks)[0].sql;
    expect(sql).toContain('CONSTRAINT "chk_age" CHECK (age >= 0)');
  });

  it("emits both uniques and checks together", () => {
    const uniques: DesignerUnique[] = [{ id: "u1", name: "uq_age", columns: ["age"] }];
    const checks: DesignerCheck[] = [{ id: "c1", name: "chk_age", expression: "age >= 0" }];
    const sql = buildCreateTable("postgres", null, "people", cols, [], checks, uniques)[0].sql;
    expect(sql).toContain('CONSTRAINT "uq_age" UNIQUE ("age")');
    expect(sql).toContain('CONSTRAINT "chk_age" CHECK (age >= 0)');
  });

  it("skips empty-expression checks", () => {
    const checks: DesignerCheck[] = [{ id: "c1", name: "chk_empty", expression: "" }];
    const sql = buildCreateTable("postgres", null, "people", cols, [], checks)[0].sql;
    expect(sql).not.toContain("chk_empty");
  });
});

// ---------------------------------------------------------------------------
// Table options
// ---------------------------------------------------------------------------
describe("buildCreateTable — table options", () => {
  const cols = [col({ name: "id", type: "int", isPrimaryKey: true, nullable: false })];

  it("MySQL: emits trailing ENGINE/CHARSET/COLLATE/ROW_FORMAT/AUTO_INCREMENT/COMMENT in order", () => {
    const options: TableOptions = {
      engine: "InnoDB",
      charset: "utf8mb4",
      collation: "utf8mb4_unicode_ci",
      rowFormat: "DYNAMIC",
      autoIncrement: 1000,
      comment: "my table",
    };
    const sql = buildCreateTable("mysql", null, "t", cols, [], [], [], options)[0].sql;
    expect(sql).toContain(
      "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC AUTO_INCREMENT=1000 COMMENT='my table'",
    );
    // the options clause sits before the trailing semicolon
    expect(sql.trimEnd().endsWith("COMMENT='my table';")).toBe(true);
  });

  it("MySQL: only set options appear", () => {
    const options: TableOptions = { engine: "InnoDB" };
    const sql = buildCreateTable("mysql", null, "t", cols, [], [], [], options)[0].sql;
    expect(sql).toContain("ENGINE=InnoDB");
    expect(sql).not.toContain("CHARSET");
    expect(sql).not.toContain("AUTO_INCREMENT");
  });

  it("MySQL: escapes single quotes in the table comment", () => {
    const options: TableOptions = { comment: "it's mine" };
    const sql = buildCreateTable("mysql", null, "t", cols, [], [], [], options)[0].sql;
    expect(sql).toContain("COMMENT='it''s mine'");
  });

  it("Postgres: emits a separate COMMENT ON TABLE statement (no ENGINE/CHARSET)", () => {
    const options: TableOptions = { engine: "InnoDB", charset: "utf8mb4", comment: "pg table" };
    const stmts = buildCreateTable("postgres", null, "t", cols, [], [], [], options);
    expect(stmts[0].sql).not.toContain("ENGINE");
    expect(stmts[0].sql).not.toContain("CHARSET");
    const comment = stmts.find((s) => s.sql.startsWith("COMMENT ON TABLE"));
    expect(comment).toBeDefined();
    expect(comment!.sql).toBe(`COMMENT ON TABLE "t" IS 'pg table';`);
  });

  it("Postgres: no COMMENT ON TABLE when comment is unset", () => {
    const options: TableOptions = { engine: "InnoDB" };
    const stmts = buildCreateTable("postgres", null, "t", cols, [], [], [], options);
    expect(stmts.some((s) => s.sql.startsWith("COMMENT ON TABLE"))).toBe(false);
  });

  it("SQLite: ignores table options entirely", () => {
    const options: TableOptions = { engine: "InnoDB", charset: "utf8mb4", comment: "x" };
    const stmts = buildCreateTable("sqlite", null, "t", cols, [], [], [], options);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).not.toContain("ENGINE");
    expect(stmts[0].sql).not.toContain("COMMENT");
  });
});

// ---------------------------------------------------------------------------
// Index method / kind / order / prefix
// ---------------------------------------------------------------------------
describe("buildCreateTable — index method/kind/order/prefix", () => {
  const cols = [
    col({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
    col({ name: "body", type: "text", nullable: true }),
    col({ name: "name", type: "varchar", length: 200, nullable: true }),
  ];

  it("MySQL FULLTEXT index", () => {
    const indexes: DesignerIndex[] = [
      { id: "i1", name: "ft_body", unique: false, columns: ["body"], indexKind: "fulltext" },
    ];
    const stmts = buildCreateTable("mysql", null, "posts", cols, indexes);
    expect(stmts[1].sql).toBe("CREATE FULLTEXT INDEX `ft_body` ON `posts` (`body`);");
  });

  it("MySQL SPATIAL index", () => {
    const indexes: DesignerIndex[] = [
      { id: "i1", name: "sp_geo", unique: false, columns: ["name"], indexKind: "spatial" },
    ];
    const stmts = buildCreateTable("mysql", null, "places", cols, indexes);
    expect(stmts[1].sql).toBe("CREATE SPATIAL INDEX `sp_geo` ON `places` (`name`);");
  });

  it("MySQL USING BTREE follows the column list", () => {
    const indexes: DesignerIndex[] = [
      { id: "i1", name: "idx_name", unique: false, columns: ["name"], method: "BTREE" },
    ];
    const stmts = buildCreateTable("mysql", null, "t", cols, indexes);
    expect(stmts[1].sql).toBe("CREATE INDEX `idx_name` ON `t` (`name`) USING BTREE;");
  });

  it("MySQL per-column prefix length and DESC order", () => {
    const indexes: DesignerIndex[] = [
      {
        id: "i1",
        name: "idx_prefix",
        unique: false,
        columns: ["name"],
        prefixLengths: { name: 10 },
        columnOrders: { name: "DESC" },
      },
    ];
    const stmts = buildCreateTable("mysql", null, "t", cols, indexes);
    expect(stmts[1].sql).toBe("CREATE INDEX `idx_prefix` ON `t` (`name`(10) DESC);");
  });

  it("Postgres USING gin precedes the column list", () => {
    const indexes: DesignerIndex[] = [
      { id: "i1", name: "idx_gin", unique: false, columns: ["body"], method: "GIN" },
    ];
    const stmts = buildCreateTable("postgres", null, "docs", cols, indexes);
    expect(stmts[1].sql).toBe('CREATE INDEX "idx_gin" ON "docs" USING gin ("body");');
  });

  it("Postgres ASC order on a column", () => {
    const indexes: DesignerIndex[] = [
      { id: "i1", name: "idx_name", unique: false, columns: ["name"], columnOrders: { name: "ASC" } },
    ];
    const stmts = buildCreateTable("postgres", null, "t", cols, indexes);
    expect(stmts[1].sql).toBe('CREATE INDEX "idx_name" ON "t" ("name" ASC);');
  });

  it("Postgres ignores MySQL prefix lengths", () => {
    const indexes: DesignerIndex[] = [
      { id: "i1", name: "idx_name", unique: false, columns: ["name"], prefixLengths: { name: 10 } },
    ];
    const stmts = buildCreateTable("postgres", null, "t", cols, indexes);
    expect(stmts[1].sql).toBe('CREATE INDEX "idx_name" ON "t" ("name");');
  });

  it("unique index still honors method/order (MySQL)", () => {
    const indexes: DesignerIndex[] = [
      { id: "i1", name: "uq_name", unique: true, columns: ["name"], method: "BTREE", columnOrders: { name: "DESC" } },
    ];
    const stmts = buildCreateTable("mysql", null, "t", cols, indexes);
    expect(stmts[1].sql).toBe("CREATE UNIQUE INDEX `uq_name` ON `t` (`name` DESC) USING BTREE;");
  });
});
