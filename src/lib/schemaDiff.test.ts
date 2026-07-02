import { describe, it, expect } from "vitest";
import {
  diffSchemas,
  buildDeploymentScript,
  type SchemaSnapshot,
  type TableSnapshot,
  type DiffOp,
  type DiffOpKind,
} from "./schemaDiff";
import type {
  Dialect,
  ColumnDefinition,
  IndexInfo,
  ForeignKeyInfo,
} from "../types";

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

function tbl(overrides: Partial<TableSnapshot> & { name: string }): TableSnapshot {
  return {
    name: overrides.name,
    schema: overrides.schema ?? null,
    columns: overrides.columns ?? [],
    indexes: overrides.indexes ?? [],
    foreignKeys: overrides.foreignKeys ?? [],
  };
}

function snap(
  dialect: Dialect,
  tables: TableSnapshot[],
  overrides: Partial<SchemaSnapshot> = {},
): SchemaSnapshot {
  return {
    dialect,
    database: "db",
    schema: null,
    tables,
    ...overrides,
  };
}

/** Flatten all ops across all table diffs. */
function allOps(source: SchemaSnapshot, target: SchemaSnapshot): DiffOp[] {
  return diffSchemas(source, target).tables.flatMap((t) => t.ops);
}

/** Find the single op of a given kind (asserts exactly one). */
function opOfKind(ops: DiffOp[], kind: DiffOpKind): DiffOp {
  const matches = ops.filter((o) => o.kind === kind);
  expect(matches.length).toBe(1);
  return matches[0];
}

// ---------------------------------------------------------------------------
// Table-level: only-source / only-target / same
// ---------------------------------------------------------------------------
describe("diffSchemas — table-level presence", () => {
  it("only-source table produces a create-table op (buildCreateTableDump)", () => {
    const source = snap("postgres", [
      tbl({
        name: "users",
        columns: [
          col({ name: "id", full_type: "integer", is_primary_key: true, nullable: false }),
          col({ name: "email", full_type: "varchar(255)", nullable: false }),
        ],
      }),
    ]);
    const target = snap("postgres", []);

    const result = diffSchemas(source, target);
    expect(result.tables).toHaveLength(1);
    const td = result.tables[0];
    expect(td.table).toBe("users");
    expect(td.status).toBe("only-source");
    expect(td.ops).toHaveLength(1);
    expect(td.ops[0].kind).toBe("create-table");
    // Reuses the dump builder output.
    expect(td.ops[0].sql).toContain('CREATE TABLE "users" (');
    expect(td.ops[0].sql).toContain('"id" integer NOT NULL');
    expect(td.ops[0].sql).toContain('PRIMARY KEY ("id")');
  });

  it("only-target table produces a drop-table op (buildDropTableDump)", () => {
    const source = snap("mysql", []);
    const target = snap("mysql", [tbl({ name: "legacy", schema: "shop" })]);

    const result = diffSchemas(source, target);
    expect(result.tables).toHaveLength(1);
    const td = result.tables[0];
    expect(td.status).toBe("only-target");
    expect(td.ops[0].kind).toBe("drop-table");
    expect(td.ops[0].sql).toBe("DROP TABLE IF EXISTS `shop`.`legacy`;");
  });

  it("identical schemas yield all tables status 'same' with no ops", () => {
    const cols = [
      col({ name: "id", full_type: "integer", is_primary_key: true, nullable: false }),
      col({ name: "name", full_type: "varchar(100)", nullable: false, default_value: "'x'" }),
    ];
    const indexes: IndexInfo[] = [
      { name: "idx_name", columns: ["name"], is_unique: false, is_primary: false },
    ];
    const fks: ForeignKeyInfo[] = [
      { name: "fk_a", columns: ["id"], referenced_table: "other", referenced_columns: ["id"] },
    ];
    const make = () =>
      snap("postgres", [tbl({ name: "users", columns: cols, indexes, foreignKeys: fks })]);

    const result = diffSchemas(make(), make());
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].status).toBe("same");
    expect(result.tables[0].ops).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Column diffs
// ---------------------------------------------------------------------------
describe("diffSchemas — column diffs", () => {
  it("add-column for a column in source not target", () => {
    const source = snap("postgres", [
      tbl({
        name: "t",
        columns: [
          col({ name: "id", full_type: "integer", nullable: false }),
          col({ name: "created_at", full_type: "timestamp", nullable: false, default_value: "now()" }),
        ],
      }),
    ]);
    const target = snap("postgres", [
      tbl({ name: "t", columns: [col({ name: "id", full_type: "integer", nullable: false })] }),
    ]);

    const result = diffSchemas(source, target);
    expect(result.tables[0].status).toBe("different");
    const op = opOfKind(result.tables[0].ops, "add-column");
    expect(op.sql).toBe(
      'ALTER TABLE "t" ADD COLUMN "created_at" timestamp NOT NULL DEFAULT now();',
    );
  });

  it("drop-column for a column in target not source", () => {
    const source = snap("mysql", [
      tbl({ name: "t", columns: [col({ name: "id", full_type: "int", nullable: false })] }),
    ]);
    const target = snap("mysql", [
      tbl({
        name: "t",
        columns: [
          col({ name: "id", full_type: "int", nullable: false }),
          col({ name: "obsolete", full_type: "varchar(10)" }),
        ],
      }),
    ]);

    const op = opOfKind(allOps(source, target), "drop-column");
    expect(op.sql).toBe("ALTER TABLE `t` DROP COLUMN `obsolete`;");
  });

  it("alter-column on type change — MySQL MODIFY COLUMN", () => {
    const source = snap("mysql", [
      tbl({ name: "t", columns: [col({ name: "c", full_type: "varchar(200)", nullable: false })] }),
    ]);
    const target = snap("mysql", [
      tbl({ name: "t", columns: [col({ name: "c", full_type: "varchar(100)", nullable: false })] }),
    ]);

    const op = opOfKind(allOps(source, target), "alter-column");
    expect(op.sql).toBe("ALTER TABLE `t` MODIFY COLUMN `c` varchar(200) NOT NULL;");
  });

  it("alter-column on Postgres emits one statement per changed sub-property", () => {
    const source = snap("postgres", [
      tbl({
        name: "t",
        columns: [col({ name: "c", full_type: "bigint", nullable: false, default_value: "0" })],
      }),
    ]);
    const target = snap("postgres", [
      tbl({
        name: "t",
        columns: [col({ name: "c", full_type: "integer", nullable: true })],
      }),
    ]);

    const op = opOfKind(allOps(source, target), "alter-column");
    expect(op.sql).toContain('ALTER TABLE "t" ALTER COLUMN "c" TYPE bigint USING "c"::bigint;');
    expect(op.sql).toContain('ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL;');
    expect(op.sql).toContain('ALTER TABLE "t" ALTER COLUMN "c" SET DEFAULT 0;');
  });

  it("alter-column Postgres DROP NOT NULL / DROP DEFAULT when source relaxes them", () => {
    const source = snap("postgres", [
      tbl({ name: "t", columns: [col({ name: "c", full_type: "integer", nullable: true })] }),
    ]);
    const target = snap("postgres", [
      tbl({
        name: "t",
        columns: [col({ name: "c", full_type: "integer", nullable: false, default_value: "0" })],
      }),
    ]);

    const op = opOfKind(allOps(source, target), "alter-column");
    expect(op.sql).toContain('ALTER TABLE "t" ALTER COLUMN "c" DROP NOT NULL;');
    expect(op.sql).toContain('ALTER TABLE "t" ALTER COLUMN "c" DROP DEFAULT;');
    expect(op.sql).not.toContain("TYPE");
  });

  it("alter-column on SQLite emits an unsupported comment with the intended change", () => {
    const source = snap("sqlite", [
      tbl({ name: "t", columns: [col({ name: "c", full_type: "INTEGER", nullable: false })] }),
    ]);
    const target = snap("sqlite", [
      tbl({ name: "t", columns: [col({ name: "c", full_type: "TEXT", nullable: true })] }),
    ]);

    const op = opOfKind(allOps(source, target), "alter-column");
    expect(op.sql).toContain("-- SQLite does not support ALTER COLUMN");
    expect(op.sql).toContain("type TEXT -> INTEGER");
    expect(op.sql).toContain("set NOT NULL");
  });

  it("auto-increment-only difference still triggers an alter-column op", () => {
    const source = snap("mysql", [
      tbl({
        name: "t",
        columns: [col({ name: "id", full_type: "int", nullable: false, is_auto_increment: true })],
      }),
    ]);
    const target = snap("mysql", [
      tbl({
        name: "t",
        columns: [col({ name: "id", full_type: "int", nullable: false, is_auto_increment: false })],
      }),
    ]);

    const op = opOfKind(allOps(source, target), "alter-column");
    expect(op.kind).toBe("alter-column");
  });
});

// ---------------------------------------------------------------------------
// Index diffs
// ---------------------------------------------------------------------------
describe("diffSchemas — index diffs", () => {
  const baseCols = [col({ name: "email", full_type: "varchar(255)", nullable: false })];

  it("add-index when an index exists in source not target", () => {
    const idx: IndexInfo = { name: "idx_email", columns: ["email"], is_unique: true, is_primary: false };
    const source = snap("postgres", [tbl({ name: "u", columns: baseCols, indexes: [idx] })]);
    const target = snap("postgres", [tbl({ name: "u", columns: baseCols, indexes: [] })]);

    const op = opOfKind(allOps(source, target), "add-index");
    expect(op.sql).toBe('CREATE UNIQUE INDEX "idx_email" ON "u" ("email");');
  });

  it("drop-index uses ON <table> for MySQL but not for Postgres/SQLite", () => {
    const idx: IndexInfo = { name: "idx_email", columns: ["email"], is_unique: false, is_primary: false };

    const my = allOps(
      snap("mysql", [tbl({ name: "u", columns: baseCols, indexes: [] })]),
      snap("mysql", [tbl({ name: "u", columns: baseCols, indexes: [idx] })]),
    );
    expect(opOfKind(my, "drop-index").sql).toBe("DROP INDEX `idx_email` ON `u`;");

    const pg = allOps(
      snap("postgres", [tbl({ name: "u", columns: baseCols, indexes: [] })]),
      snap("postgres", [tbl({ name: "u", columns: baseCols, indexes: [idx] })]),
    );
    expect(opOfKind(pg, "drop-index").sql).toBe('DROP INDEX "idx_email";');
  });

  it("ignores primary-key indexes (they belong to the table definition)", () => {
    const pkIdx: IndexInfo = { name: "u_pkey", columns: ["id"], is_unique: true, is_primary: true };
    const source = snap("postgres", [tbl({ name: "u", columns: baseCols, indexes: [pkIdx] })]);
    const target = snap("postgres", [tbl({ name: "u", columns: baseCols, indexes: [] })]);

    const ops = allOps(source, target);
    expect(ops.filter((o) => o.kind === "add-index")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Foreign key diffs
// ---------------------------------------------------------------------------
describe("diffSchemas — foreign key diffs", () => {
  const baseCols = [col({ name: "user_id", full_type: "int", nullable: false })];

  it("add-fk emits ALTER TABLE ADD CONSTRAINT with ON DELETE/UPDATE", () => {
    const fk: ForeignKeyInfo = {
      name: "fk_orders_user",
      columns: ["user_id"],
      referenced_table: "users",
      referenced_columns: ["id"],
      on_delete: "CASCADE",
      on_update: "RESTRICT",
    };
    const source = snap("mysql", [tbl({ name: "orders", schema: "shop", columns: baseCols, foreignKeys: [fk] })]);
    const target = snap("mysql", [tbl({ name: "orders", schema: "shop", columns: baseCols, foreignKeys: [] })]);

    const op = opOfKind(allOps(source, target), "add-fk");
    expect(op.sql).toBe(
      "ALTER TABLE `shop`.`orders` ADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `shop`.`users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT;",
    );
  });

  it("drop-fk uses DROP FOREIGN KEY on MySQL and DROP CONSTRAINT on Postgres", () => {
    const fk: ForeignKeyInfo = {
      name: "fk_x",
      columns: ["user_id"],
      referenced_table: "users",
      referenced_columns: ["id"],
    };

    const my = allOps(
      snap("mysql", [tbl({ name: "orders", columns: baseCols, foreignKeys: [] })]),
      snap("mysql", [tbl({ name: "orders", columns: baseCols, foreignKeys: [fk] })]),
    );
    expect(opOfKind(my, "drop-fk").sql).toBe("ALTER TABLE `orders` DROP FOREIGN KEY `fk_x`;");

    const pg = allOps(
      snap("postgres", [tbl({ name: "orders", columns: baseCols, foreignKeys: [] })]),
      snap("postgres", [tbl({ name: "orders", columns: baseCols, foreignKeys: [fk] })]),
    );
    expect(opOfKind(pg, "drop-fk").sql).toBe('ALTER TABLE "orders" DROP CONSTRAINT "fk_x";');
  });
});

// ---------------------------------------------------------------------------
// SQL Server (T-SQL) diffs
// ---------------------------------------------------------------------------
describe("diffSchemas — sqlserver", () => {
  it("create-table reuses the dump builder with [bracket] quoting + IDENTITY", () => {
    const source = snap("sqlserver", [
      tbl({
        name: "users",
        schema: "dbo",
        columns: [
          col({ name: "id", data_type: "int", full_type: "INT", is_primary_key: true, is_auto_increment: true, nullable: false }),
        ],
      }),
    ]);
    const target = snap("sqlserver", [], { schema: "dbo" });

    const op = diffSchemas(source, target).tables[0].ops[0];
    expect(op.kind).toBe("create-table");
    expect(op.sql).toContain("CREATE TABLE [dbo].[users] (");
    expect(op.sql).toContain("[id] INT NOT NULL IDENTITY(1,1)");
  });

  it("drop-table emits DROP TABLE IF EXISTS [schema].[table]", () => {
    const op = allOps(
      snap("sqlserver", []),
      snap("sqlserver", [tbl({ name: "legacy", schema: "dbo" })]),
    )[0];
    expect(op.kind).toBe("drop-table");
    expect(op.sql).toBe("DROP TABLE IF EXISTS [dbo].[legacy];");
  });

  it("add-column omits the COLUMN keyword (T-SQL `ADD [c] spec`)", () => {
    const source = snap("sqlserver", [
      tbl({
        name: "t",
        columns: [
          col({ name: "id", full_type: "INT", nullable: false }),
          col({ name: "note", full_type: "NVARCHAR(MAX)", nullable: true }),
        ],
      }),
    ]);
    const target = snap("sqlserver", [
      tbl({ name: "t", columns: [col({ name: "id", full_type: "INT", nullable: false })] }),
    ]);

    const op = opOfKind(allOps(source, target), "add-column");
    expect(op.sql).toBe("ALTER TABLE [t] ADD [note] NVARCHAR(MAX);");
  });

  it("drop-column keeps the COLUMN keyword", () => {
    const source = snap("sqlserver", [
      tbl({ name: "t", columns: [col({ name: "id", full_type: "INT", nullable: false })] }),
    ]);
    const target = snap("sqlserver", [
      tbl({
        name: "t",
        columns: [
          col({ name: "id", full_type: "INT", nullable: false }),
          col({ name: "obsolete", full_type: "NVARCHAR(10)" }),
        ],
      }),
    ]);

    const op = opOfKind(allOps(source, target), "drop-column");
    expect(op.sql).toBe("ALTER TABLE [t] DROP COLUMN [obsolete];");
  });

  it("alter-column folds type + nullability into one ALTER COLUMN", () => {
    const source = snap("sqlserver", [
      tbl({ name: "t", columns: [col({ name: "c", full_type: "BIGINT", nullable: false })] }),
    ]);
    const target = snap("sqlserver", [
      tbl({ name: "t", columns: [col({ name: "c", full_type: "INT", nullable: true })] }),
    ]);

    const op = opOfKind(allOps(source, target), "alter-column");
    expect(op.sql).toBe("ALTER TABLE [t] ALTER COLUMN [c] BIGINT NOT NULL;");
  });

  it("alter-column flags a default-only change (constraint, not ALTER COLUMN)", () => {
    const source = snap("sqlserver", [
      tbl({ name: "t", columns: [col({ name: "c", full_type: "INT", nullable: false, default_value: "1" })] }),
    ]);
    const target = snap("sqlserver", [
      tbl({ name: "t", columns: [col({ name: "c", full_type: "INT", nullable: false })] }),
    ]);

    const op = opOfKind(allOps(source, target), "alter-column");
    // Type re-assert keeps the op actionable; the default note explains the gap.
    expect(op.sql).toContain("ALTER TABLE [t] ALTER COLUMN [c] INT NOT NULL;");
    expect(op.sql).toContain("SQL Server DEFAULTs are named constraints");
    expect(op.sql).toContain("-> 1");
  });

  it("drop-index requires the ON [table] clause", () => {
    const idx: IndexInfo = { name: "idx_c", columns: ["c"], is_unique: false, is_primary: false };
    const op = opOfKind(
      allOps(
        snap("sqlserver", [tbl({ name: "t", columns: [col({ name: "c", full_type: "INT" })], indexes: [] })]),
        snap("sqlserver", [tbl({ name: "t", columns: [col({ name: "c", full_type: "INT" })], indexes: [idx] })]),
      ),
      "drop-index",
    );
    expect(op.sql).toBe("DROP INDEX [idx_c] ON [t];");
  });

  it("add-fk / drop-fk use [bracket] quoting and DROP CONSTRAINT", () => {
    const fk: ForeignKeyInfo = {
      name: "fk_o_u",
      columns: ["user_id"],
      referenced_table: "users",
      referenced_columns: ["id"],
    };
    const base = [col({ name: "user_id", full_type: "INT", nullable: false })];

    const add = opOfKind(
      allOps(
        snap("sqlserver", [tbl({ name: "orders", schema: "dbo", columns: base, foreignKeys: [fk] })]),
        snap("sqlserver", [tbl({ name: "orders", schema: "dbo", columns: base, foreignKeys: [] })]),
      ),
      "add-fk",
    );
    expect(add.sql).toBe(
      "ALTER TABLE [dbo].[orders] ADD CONSTRAINT [fk_o_u] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users] ([id]);",
    );

    const drop = opOfKind(
      allOps(
        snap("sqlserver", [tbl({ name: "orders", columns: base, foreignKeys: [] })]),
        snap("sqlserver", [tbl({ name: "orders", columns: base, foreignKeys: [fk] })]),
      ),
      "drop-fk",
    );
    expect(drop.sql).toBe("ALTER TABLE [orders] DROP CONSTRAINT [fk_o_u];");
  });
});

// ---------------------------------------------------------------------------
// Dialect mismatch warning
// ---------------------------------------------------------------------------
describe("diffSchemas — dialect mismatch", () => {
  it("emits SQL for the target dialect and prefixes a warning in descriptions", () => {
    const source = snap("postgres", [
      tbl({ name: "t", columns: [col({ name: "id", full_type: "integer", nullable: false })] }),
    ]);
    const target = snap("mysql", []); // table only in source → create

    const result = diffSchemas(source, target);
    const op = result.tables[0].ops[0];
    expect(op.kind).toBe("create-table");
    // SQL uses MySQL (target) quoting.
    expect(op.sql).toContain("CREATE TABLE `t` (");
    expect(op.description).toContain("WARNING dialect mismatch");
    expect(op.description).toContain("source=postgres");
    expect(op.description).toContain("target=mysql");
  });
});

// ---------------------------------------------------------------------------
// buildDeploymentScript ordering
// ---------------------------------------------------------------------------
describe("buildDeploymentScript", () => {
  function op(kind: DiffOpKind, sql: string): DiffOp {
    return { id: `${kind}-${sql}`, table: "t", kind, description: kind, sql };
  }

  it("orders ops: create-table, add-column, alter-column, add-index, add-fk, drop-fk, drop-index, drop-column, drop-table", () => {
    // Provide ops in scrambled order.
    const ops: DiffOp[] = [
      op("drop-table", "DROP TABLE old;"),
      op("add-fk", "ADD FK;"),
      op("create-table", "CREATE TABLE new;"),
      op("drop-column", "DROP COLUMN c;"),
      op("add-index", "ADD INDEX;"),
      op("drop-fk", "DROP FK;"),
      op("alter-column", "ALTER COLUMN;"),
      op("drop-index", "DROP INDEX;"),
      op("add-column", "ADD COLUMN;"),
    ];

    const script = buildDeploymentScript(ops);
    const lines = script.split("\n\n");
    expect(lines[0]).toBe("-- ANSQL schema synchronization script --");
    expect(lines.slice(1)).toEqual([
      "CREATE TABLE new;",
      "ADD COLUMN;",
      "ALTER COLUMN;",
      "ADD INDEX;",
      "ADD FK;",
      "DROP FK;",
      "DROP INDEX;",
      "DROP COLUMN c;",
      "DROP TABLE old;",
    ]);
  });

  it("is a stable sort within the same kind (preserves input order)", () => {
    const ops: DiffOp[] = [
      op("add-column", "ADD COLUMN a;"),
      op("add-column", "ADD COLUMN b;"),
      op("add-column", "ADD COLUMN c;"),
    ];
    const script = buildDeploymentScript(ops);
    expect(script.split("\n\n").slice(1)).toEqual([
      "ADD COLUMN a;",
      "ADD COLUMN b;",
      "ADD COLUMN c;",
    ]);
  });

  it("filters out empty SQL bodies but keeps the header", () => {
    const script = buildDeploymentScript([op("add-column", "")]);
    expect(script).toBe("-- ANSQL schema synchronization script --");
  });

  it("returns just the header for no ops", () => {
    expect(buildDeploymentScript([])).toBe("-- ANSQL schema synchronization script --");
  });
});
