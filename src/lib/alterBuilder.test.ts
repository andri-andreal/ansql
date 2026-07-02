import { describe, it, expect } from "vitest";
import {
  rawTypeToCatalog,
  diffColumns,
  diffIndexes,
  diffChecks,
  diffUniques,
  diffTableOptions,
  buildAlter,
  supportedOnSqlite,
} from "./alterBuilder";
import type { AlterOp } from "./alterBuilder";
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
function col(overrides: Partial<DesignerColumn> & { id: string; name: string; type: string }): DesignerColumn {
  const defaults: DesignerColumn = {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    nullable: true,
    isPrimaryKey: false,
    isAutoIncrement: false,
    length: null,
    precision: null,
    scale: null,
    defaultValue: null,
  };
  return { ...defaults, ...overrides };
}

function idx(overrides: Partial<DesignerIndex> & { id: string; name: string }): DesignerIndex {
  return {
    id: overrides.id,
    name: overrides.name,
    unique: overrides.unique ?? false,
    columns: overrides.columns ?? [],
  };
}

// ---------------------------------------------------------------------------
// rawTypeToCatalog
// ---------------------------------------------------------------------------
describe("rawTypeToCatalog", () => {
  describe("Postgres long-form types (from information_schema.data_type)", () => {
    it("maps 'character varying' to varchar", () => {
      const r = rawTypeToCatalog("postgres", "character varying");
      expect(r.type).toBe("varchar");
      expect(r.length).toBeNull();
    });

    it("maps 'character varying(120)' to varchar with length 120", () => {
      const r = rawTypeToCatalog("postgres", "character varying(120)");
      expect(r.type).toBe("varchar");
      expect(r.length).toBe(120);
    });

    it("maps 'integer' to int", () => {
      expect(rawTypeToCatalog("postgres", "integer").type).toBe("int");
    });

    it("maps 'bigint' to bigint", () => {
      expect(rawTypeToCatalog("postgres", "bigint").type).toBe("bigint");
    });

    it("maps 'smallint' to smallint", () => {
      expect(rawTypeToCatalog("postgres", "smallint").type).toBe("smallint");
    });

    it("maps 'boolean' to boolean", () => {
      expect(rawTypeToCatalog("postgres", "boolean").type).toBe("boolean");
    });

    it("maps 'numeric' to decimal", () => {
      expect(rawTypeToCatalog("postgres", "numeric").type).toBe("decimal");
    });

    it("maps 'numeric(10,2)' to decimal with precision and scale", () => {
      const r = rawTypeToCatalog("postgres", "numeric(10,2)");
      expect(r.type).toBe("decimal");
      expect(r.precision).toBe(10);
      expect(r.scale).toBe(2);
    });

    it("maps 'decimal' to decimal", () => {
      expect(rawTypeToCatalog("postgres", "decimal").type).toBe("decimal");
    });

    it("maps 'decimal(8,3)' to decimal with precision 8, scale 3", () => {
      const r = rawTypeToCatalog("postgres", "decimal(8,3)");
      expect(r.type).toBe("decimal");
      expect(r.precision).toBe(8);
      expect(r.scale).toBe(3);
    });

    it("maps 'double precision' to double", () => {
      expect(rawTypeToCatalog("postgres", "double precision").type).toBe("double");
    });

    it("maps 'real' to real", () => {
      expect(rawTypeToCatalog("postgres", "real").type).toBe("real");
    });

    it("maps 'timestamp without time zone' to timestamp", () => {
      expect(rawTypeToCatalog("postgres", "timestamp without time zone").type).toBe("timestamp");
    });

    it("maps 'timestamp with time zone' to timestamp", () => {
      expect(rawTypeToCatalog("postgres", "timestamp with time zone").type).toBe("timestamp");
    });

    it("maps 'time without time zone' to time", () => {
      expect(rawTypeToCatalog("postgres", "time without time zone").type).toBe("time");
    });

    it("maps 'date' to date", () => {
      expect(rawTypeToCatalog("postgres", "date").type).toBe("date");
    });

    it("maps 'jsonb' to json", () => {
      expect(rawTypeToCatalog("postgres", "jsonb").type).toBe("json");
    });

    it("maps 'json' to json", () => {
      expect(rawTypeToCatalog("postgres", "json").type).toBe("json");
    });

    it("maps 'bytea' to blob", () => {
      expect(rawTypeToCatalog("postgres", "bytea").type).toBe("blob");
    });

    it("maps 'uuid' to uuid", () => {
      expect(rawTypeToCatalog("postgres", "uuid").type).toBe("uuid");
    });

    it("maps 'text' to text", () => {
      expect(rawTypeToCatalog("postgres", "text").type).toBe("text");
    });
  });

  describe("case-insensitive matching", () => {
    it("maps 'CHARACTER VARYING(50)' regardless of case", () => {
      const r = rawTypeToCatalog("postgres", "CHARACTER VARYING(50)");
      expect(r.type).toBe("varchar");
      expect(r.length).toBe(50);
    });

    it("maps 'TIMESTAMP WITHOUT TIME ZONE' regardless of case", () => {
      expect(rawTypeToCatalog("postgres", "TIMESTAMP WITHOUT TIME ZONE").type).toBe("timestamp");
    });
  });

  describe("short-form / MySQL / SQLite aliases", () => {
    it("maps 'int' to int", () => {
      expect(rawTypeToCatalog("mysql", "int").type).toBe("int");
    });

    it("maps 'int4' to int", () => {
      expect(rawTypeToCatalog("postgres", "int4").type).toBe("int");
    });

    it("maps 'varchar(255)' to varchar with length 255", () => {
      const r = rawTypeToCatalog("mysql", "varchar(255)");
      expect(r.type).toBe("varchar");
      expect(r.length).toBe(255);
    });

    it("maps 'tinyint(1)' to boolean", () => {
      expect(rawTypeToCatalog("mysql", "tinyint(1)").type).toBe("boolean");
    });

    it("maps 'datetime' to timestamp", () => {
      expect(rawTypeToCatalog("mysql", "datetime").type).toBe("timestamp");
    });

    it("maps 'longblob' to blob", () => {
      expect(rawTypeToCatalog("mysql", "longblob").type).toBe("blob");
    });

    it("maps 'blob' to blob", () => {
      expect(rawTypeToCatalog("mysql", "blob").type).toBe("blob");
    });

    it("maps 'double' to double", () => {
      expect(rawTypeToCatalog("mysql", "double").type).toBe("double");
    });

    it("maps 'tinyint(0)' (non-boolean tinyint) to int (fallback)", () => {
      // tinyint(1) is boolean; other tinyints are integer-like
      expect(rawTypeToCatalog("mysql", "tinyint(0)").type).toBe("int");
    });
  });

  describe("unknown types fallback to text", () => {
    it("returns text for unknown type 'geometry'", () => {
      const r = rawTypeToCatalog("postgres", "geometry");
      expect(r.type).toBe("text");
      expect(r.length).toBeNull();
      expect(r.precision).toBeNull();
      expect(r.scale).toBeNull();
    });

    it("does not throw for empty string", () => {
      expect(() => rawTypeToCatalog("sqlite", "")).not.toThrow();
      expect(rawTypeToCatalog("sqlite", "").type).toBe("text");
    });
  });

  describe("precision/scale parsing", () => {
    it("returns null length for non-length types", () => {
      const r = rawTypeToCatalog("postgres", "integer");
      expect(r.length).toBeNull();
      expect(r.precision).toBeNull();
      expect(r.scale).toBeNull();
    });

    it("returns null precision/scale for varchar", () => {
      const r = rawTypeToCatalog("mysql", "varchar(100)");
      expect(r.precision).toBeNull();
      expect(r.scale).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// diffColumns
// ---------------------------------------------------------------------------
describe("diffColumns", () => {
  describe("add column", () => {
    it("detects a new column (id not in original)", () => {
      const orig = [col({ id: "a", name: "id", type: "int", isPrimaryKey: true, nullable: false })];
      const edited = [
        col({ id: "a", name: "id", type: "int", isPrimaryKey: true, nullable: false }),
        col({ id: "b", name: "email", type: "varchar", length: 200 }),
      ];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe("addColumn");
      if (ops[0].kind === "addColumn") {
        expect(ops[0].column.name).toBe("email");
      }
    });
  });

  describe("drop column", () => {
    it("detects a removed column (id in original but not edited)", () => {
      const orig = [
        col({ id: "a", name: "id", type: "int" }),
        col({ id: "b", name: "old_col", type: "text" }),
      ];
      const edited = [col({ id: "a", name: "id", type: "int" })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe("dropColumn");
      if (ops[0].kind === "dropColumn") {
        expect(ops[0].name).toBe("old_col");
      }
    });
  });

  describe("rename column", () => {
    it("detects a rename when same id but different name", () => {
      const orig = [col({ id: "a", name: "old_name", type: "text" })];
      const edited = [col({ id: "a", name: "new_name", type: "text" })];
      const ops = diffColumns(orig, edited);
      const renameOps = ops.filter((o) => o.kind === "renameColumn");
      expect(renameOps).toHaveLength(1);
      if (renameOps[0].kind === "renameColumn") {
        expect(renameOps[0].from).toBe("old_name");
        expect(renameOps[0].to).toBe("new_name");
      }
    });

    it("rename + modify emits renameColumn plus modifyColumn", () => {
      const orig = [col({ id: "a", name: "old_name", type: "text", nullable: true })];
      const edited = [col({ id: "a", name: "new_name", type: "varchar", length: 100, nullable: false })];
      const ops = diffColumns(orig, edited);
      const kinds = ops.map((o) => o.kind);
      expect(kinds).toContain("renameColumn");
      expect(kinds).toContain("modifyColumn");
    });
  });

  describe("modify column", () => {
    it("detects type change", () => {
      const orig = [col({ id: "a", name: "amount", type: "int" })];
      const edited = [col({ id: "a", name: "amount", type: "decimal", precision: 10, scale: 2 })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe("modifyColumn");
      if (ops[0].kind === "modifyColumn") {
        expect(ops[0].typeChanged).toBe(true);
        expect(ops[0].nullChanged).toBe(false);
        expect(ops[0].defaultChanged).toBe(false);
      }
    });

    it("detects nullable change", () => {
      const orig = [col({ id: "a", name: "name", type: "text", nullable: true })];
      const edited = [col({ id: "a", name: "name", type: "text", nullable: false })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe("modifyColumn");
      if (ops[0].kind === "modifyColumn") {
        expect(ops[0].nullChanged).toBe(true);
        expect(ops[0].typeChanged).toBe(false);
      }
    });

    it("detects default change", () => {
      const orig = [col({ id: "a", name: "status", type: "varchar", length: 20, defaultValue: null })];
      const edited = [col({ id: "a", name: "status", type: "varchar", length: 20, defaultValue: "'active'" })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe("modifyColumn");
      if (ops[0].kind === "modifyColumn") {
        expect(ops[0].defaultChanged).toBe(true);
        expect(ops[0].typeChanged).toBe(false);
        expect(ops[0].nullChanged).toBe(false);
      }
    });

    it("emits no ops when nothing changed", () => {
      const c = col({ id: "a", name: "name", type: "text", nullable: true });
      expect(diffColumns([c], [{ ...c }])).toHaveLength(0);
    });

    it("detects length change as typeChanged", () => {
      const orig = [col({ id: "a", name: "slug", type: "varchar", length: 100 })];
      const edited = [col({ id: "a", name: "slug", type: "varchar", length: 200 })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe("modifyColumn");
      if (ops[0].kind === "modifyColumn") {
        expect(ops[0].typeChanged).toBe(true);
      }
    });
  });

  describe("setPrimaryKey", () => {
    it("emits setPrimaryKey when PK column set changes", () => {
      const orig = [
        col({ id: "a", name: "id", type: "int", isPrimaryKey: true }),
        col({ id: "b", name: "code", type: "varchar", length: 20, isPrimaryKey: false }),
      ];
      const edited = [
        col({ id: "a", name: "id", type: "int", isPrimaryKey: false }),
        col({ id: "b", name: "code", type: "varchar", length: 20, isPrimaryKey: true }),
      ];
      const ops = diffColumns(orig, edited);
      const pkOp = ops.find((o) => o.kind === "setPrimaryKey");
      expect(pkOp).toBeDefined();
      if (pkOp && pkOp.kind === "setPrimaryKey") {
        expect(pkOp.columns).toEqual(["code"]);
      }
    });

    it("emits setPrimaryKey with empty columns when PK is cleared", () => {
      const orig = [col({ id: "a", name: "id", type: "int", isPrimaryKey: true })];
      const edited = [col({ id: "a", name: "id", type: "int", isPrimaryKey: false })];
      const ops = diffColumns(orig, edited);
      const pkOp = ops.find((o) => o.kind === "setPrimaryKey");
      expect(pkOp).toBeDefined();
      if (pkOp && pkOp.kind === "setPrimaryKey") {
        expect(pkOp.columns).toEqual([]);
      }
    });

    it("does NOT emit setPrimaryKey when PK is unchanged", () => {
      const orig = [col({ id: "a", name: "id", type: "int", isPrimaryKey: true })];
      const edited = [col({ id: "a", name: "id", type: "int", isPrimaryKey: true })];
      const ops = diffColumns(orig, edited);
      expect(ops.some((o) => o.kind === "setPrimaryKey")).toBe(false);
    });

    it("setPrimaryKey uses the edited column names (after rename)", () => {
      // Rename PK column — setPrimaryKey should use new name
      const orig = [col({ id: "a", name: "old_pk", type: "int", isPrimaryKey: true })];
      const edited = [col({ id: "a", name: "new_pk", type: "int", isPrimaryKey: true })];
      const ops = diffColumns(orig, edited);
      // PK set hasn't changed (still just column "a" is PK), so no setPrimaryKey needed
      // Only renameColumn is expected
      expect(ops.some((o) => o.kind === "setPrimaryKey")).toBe(false);
      expect(ops.some((o) => o.kind === "renameColumn")).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// diffIndexes
// ---------------------------------------------------------------------------
describe("diffIndexes", () => {
  it("detects added index", () => {
    const orig: DesignerIndex[] = [];
    const edited = [idx({ id: "i1", name: "idx_email", unique: true, columns: ["email"] })];
    const ops = diffIndexes(orig, edited);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("addIndex");
    if (ops[0].kind === "addIndex") {
      expect(ops[0].index.name).toBe("idx_email");
    }
  });

  it("detects removed index", () => {
    const orig = [idx({ id: "i1", name: "idx_email", unique: true, columns: ["email"] })];
    const edited: DesignerIndex[] = [];
    const ops = diffIndexes(orig, edited);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("dropIndex");
    if (ops[0].kind === "dropIndex") {
      expect(ops[0].name).toBe("idx_email");
    }
  });

  it("treats a changed index as drop + add", () => {
    const orig = [idx({ id: "i1", name: "idx_x", unique: false, columns: ["x"] })];
    const edited = [idx({ id: "i1", name: "idx_x", unique: true, columns: ["x"] })];
    const ops = diffIndexes(orig, edited);
    expect(ops).toHaveLength(2);
    const kinds = ops.map((o) => o.kind);
    expect(kinds).toContain("dropIndex");
    expect(kinds).toContain("addIndex");
  });

  it("emits no ops when indexes unchanged", () => {
    const i = idx({ id: "i1", name: "idx_x", columns: ["x"] });
    expect(diffIndexes([i], [{ ...i }])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildAlter — MySQL
// ---------------------------------------------------------------------------
describe("buildAlter — MySQL", () => {
  it("ADD COLUMN", () => {
    const newCol = col({ id: "b", name: "email", type: "varchar", length: 200, nullable: true });
    const ops: AlterOp[] = [{ kind: "addColumn", column: newCol }];
    const stmts = buildAlter("mysql", null, "users", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE `users` ADD COLUMN `email` VARCHAR(200);");
    expect(stmts[0].params).toEqual([]);
  });

  it("ADD COLUMN with schema qualification", () => {
    const newCol = col({ id: "b", name: "email", type: "varchar", length: 200 });
    const ops: AlterOp[] = [{ kind: "addColumn", column: newCol }];
    const stmts = buildAlter("mysql", "mydb", "users", ops);
    expect(stmts[0].sql).toMatch(/^ALTER TABLE `mydb`\.`users`/);
  });

  it("DROP COLUMN", () => {
    const ops: AlterOp[] = [{ kind: "dropColumn", name: "old_col" }];
    const stmts = buildAlter("mysql", null, "users", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE `users` DROP COLUMN `old_col`;");
  });

  it("CHANGE COLUMN for rename without other changes", () => {
    const editedCol = col({ id: "a", name: "new_name", type: "text", nullable: true });
    const ops: AlterOp[] = [
      { kind: "renameColumn", from: "old_name", to: "new_name", column: editedCol },
      { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: false, defaultChanged: false, commentChanged: false },
    ];
    const stmts = buildAlter("mysql", null, "t", ops);
    // rename + modify on same column should collapse to a single CHANGE COLUMN
    const changeSql = stmts.find((s) => s.sql.includes("CHANGE COLUMN"));
    expect(changeSql).toBeDefined();
    expect(changeSql!.sql).toBe("ALTER TABLE `t` CHANGE COLUMN `old_name` `new_name` TEXT;");
  });

  it("CHANGE COLUMN for rename + type change", () => {
    const editedCol = col({ id: "a", name: "new_name", type: "varchar", length: 100, nullable: false });
    const ops: AlterOp[] = [
      { kind: "renameColumn", from: "old_name", to: "new_name", column: editedCol },
      { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: true, defaultChanged: false, commentChanged: false },
    ];
    const stmts = buildAlter("mysql", null, "t", ops);
    const changeSql = stmts.find((s) => s.sql.includes("CHANGE COLUMN"));
    expect(changeSql).toBeDefined();
    expect(changeSql!.sql).toBe("ALTER TABLE `t` CHANGE COLUMN `old_name` `new_name` VARCHAR(100) NOT NULL;");
  });

  it("MODIFY COLUMN for type/null change (no rename)", () => {
    const editedCol = col({ id: "a", name: "amount", type: "decimal", precision: 10, scale: 2, nullable: false });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: true, defaultChanged: false, commentChanged: false },
    ];
    const stmts = buildAlter("mysql", null, "orders", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE `orders` MODIFY COLUMN `amount` DECIMAL(10,2) NOT NULL;");
  });

  it("MODIFY COLUMN with DEFAULT", () => {
    const editedCol = col({ id: "a", name: "status", type: "varchar", length: 20, nullable: false, defaultValue: "'active'" });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: false, defaultChanged: true, commentChanged: false },
    ];
    const stmts = buildAlter("mysql", null, "orders", ops);
    expect(stmts[0].sql).toBe("ALTER TABLE `orders` MODIFY COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'active';");
  });

  it("DROP PRIMARY KEY + ADD PRIMARY KEY when original had PK (hasPk=true)", () => {
    const ops: AlterOp[] = [{ kind: "setPrimaryKey", columns: ["id", "code"] }];
    const stmts = buildAlter("mysql", null, "t", ops, { hasPk: true });
    expect(stmts).toHaveLength(2);
    expect(stmts[0].sql).toBe("ALTER TABLE `t` DROP PRIMARY KEY;");
    expect(stmts[1].sql).toBe("ALTER TABLE `t` ADD PRIMARY KEY (`id`, `code`);");
  });

  it("only ADD PRIMARY KEY when original had no PK (hasPk=false)", () => {
    const ops: AlterOp[] = [{ kind: "setPrimaryKey", columns: ["id"] }];
    const stmts = buildAlter("mysql", null, "t", ops, { hasPk: false });
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE `t` ADD PRIMARY KEY (`id`);");
  });

  it("only DROP PRIMARY KEY when new PK is empty (hasPk=true, columns=[])", () => {
    const ops: AlterOp[] = [{ kind: "setPrimaryKey", columns: [] }];
    const stmts = buildAlter("mysql", null, "t", ops, { hasPk: true });
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE `t` DROP PRIMARY KEY;");
  });

  it("ADD INDEX", () => {
    const i = idx({ id: "i1", name: "idx_email", unique: true, columns: ["email"] });
    const ops: AlterOp[] = [{ kind: "addIndex", index: i }];
    const stmts = buildAlter("mysql", null, "users", ops);
    expect(stmts[0].sql).toBe("CREATE UNIQUE INDEX `idx_email` ON `users` (`email`);");
  });

  it("DROP INDEX", () => {
    const ops: AlterOp[] = [{ kind: "dropIndex", name: "idx_old" }];
    const stmts = buildAlter("mysql", null, "users", ops);
    expect(stmts[0].sql).toBe("DROP INDEX `idx_old` ON `users`;");
  });
});

// ---------------------------------------------------------------------------
// buildAlter — Postgres
// ---------------------------------------------------------------------------
describe("buildAlter — Postgres", () => {
  it("ADD COLUMN", () => {
    const newCol = col({ id: "b", name: "email", type: "varchar", length: 200 });
    const ops: AlterOp[] = [{ kind: "addColumn", column: newCol }];
    const stmts = buildAlter("postgres", null, "users", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "users" ADD COLUMN "email" VARCHAR(200);');
  });

  it("DROP COLUMN", () => {
    const ops: AlterOp[] = [{ kind: "dropColumn", name: "old_col" }];
    const stmts = buildAlter("postgres", null, "users", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "users" DROP COLUMN "old_col";');
  });

  it("RENAME COLUMN is a separate statement", () => {
    const renamedCol = col({ id: "a", name: "new_name", type: "text", nullable: true });
    const ops: AlterOp[] = [
      { kind: "renameColumn", from: "old_name", to: "new_name", column: renamedCol },
    ];
    const stmts = buildAlter("postgres", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "t" RENAME COLUMN "old_name" TO "new_name";');
  });

  it("modifyColumn type → ALTER COLUMN c TYPE t USING c::t", () => {
    const editedCol = col({ id: "a", name: "amount", type: "decimal", precision: 10, scale: 2, nullable: true });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: false, defaultChanged: false, commentChanged: false },
    ];
    const stmts = buildAlter("postgres", null, "orders", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(
      'ALTER TABLE "orders" ALTER COLUMN "amount" TYPE DECIMAL(10,2) USING "amount"::DECIMAL(10,2);'
    );
  });

  it("modifyColumn nullChanged → SET NOT NULL", () => {
    const editedCol = col({ id: "a", name: "name", type: "text", nullable: false });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: true, defaultChanged: false, commentChanged: false },
    ];
    const stmts = buildAlter("postgres", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "t" ALTER COLUMN "name" SET NOT NULL;');
  });

  it("modifyColumn nullChanged → DROP NOT NULL", () => {
    const editedCol = col({ id: "a", name: "name", type: "text", nullable: true });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: true, defaultChanged: false, commentChanged: false },
    ];
    const stmts = buildAlter("postgres", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "t" ALTER COLUMN "name" DROP NOT NULL;');
  });

  it("modifyColumn defaultChanged with value → SET DEFAULT", () => {
    const editedCol = col({ id: "a", name: "status", type: "text", nullable: true, defaultValue: "'active'" });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: false, defaultChanged: true, commentChanged: false },
    ];
    const stmts = buildAlter("postgres", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(`ALTER TABLE "t" ALTER COLUMN "status" SET DEFAULT 'active';`);
  });

  it("modifyColumn defaultChanged with null → DROP DEFAULT", () => {
    const editedCol = col({ id: "a", name: "status", type: "text", nullable: true, defaultValue: null });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: false, defaultChanged: true, commentChanged: false },
    ];
    const stmts = buildAlter("postgres", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "t" ALTER COLUMN "status" DROP DEFAULT;');
  });

  it("modifyColumn with multiple changes emits multiple statements", () => {
    const editedCol = col({ id: "a", name: "amt", type: "decimal", precision: 12, scale: 4, nullable: false, defaultValue: "0" });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: true, defaultChanged: true, commentChanged: false },
    ];
    const stmts = buildAlter("postgres", null, "ledger", ops);
    expect(stmts).toHaveLength(3);
    const sqls = stmts.map((s) => s.sql);
    expect(sqls.some((s) => s.includes("TYPE DECIMAL(12,4)"))).toBe(true);
    expect(sqls.some((s) => s.includes("SET NOT NULL"))).toBe(true);
    expect(sqls.some((s) => s.includes("SET DEFAULT 0"))).toBe(true);
  });

  it("setPrimaryKey: DROP CONSTRAINT <table>_pkey + ADD PRIMARY KEY (hasPk=true)", () => {
    const ops: AlterOp[] = [{ kind: "setPrimaryKey", columns: ["id"] }];
    const stmts = buildAlter("postgres", null, "users", ops, { hasPk: true });
    expect(stmts).toHaveLength(2);
    expect(stmts[0].sql).toBe('ALTER TABLE "users" DROP CONSTRAINT "users_pkey";');
    expect(stmts[1].sql).toBe('ALTER TABLE "users" ADD PRIMARY KEY ("id");');
  });

  it("setPrimaryKey with schema: uses table name (not schema) for pkey constraint name", () => {
    const ops: AlterOp[] = [{ kind: "setPrimaryKey", columns: ["id"] }];
    const stmts = buildAlter("postgres", "myschema", "orders", ops, { hasPk: true });
    // Constraint name is just <table>_pkey
    expect(stmts[0].sql).toBe('ALTER TABLE "myschema"."orders" DROP CONSTRAINT "orders_pkey";');
    expect(stmts[1].sql).toBe('ALTER TABLE "myschema"."orders" ADD PRIMARY KEY ("id");');
  });

  it("setPrimaryKey only ADD when hasPk=false", () => {
    const ops: AlterOp[] = [{ kind: "setPrimaryKey", columns: ["id"] }];
    const stmts = buildAlter("postgres", null, "t", ops, { hasPk: false });
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "t" ADD PRIMARY KEY ("id");');
  });

  it("setPrimaryKey only DROP when columns=[] and hasPk=true", () => {
    const ops: AlterOp[] = [{ kind: "setPrimaryKey", columns: [] }];
    const stmts = buildAlter("postgres", null, "t", ops, { hasPk: true });
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "t" DROP CONSTRAINT "t_pkey";');
  });

  it("ADD INDEX (unique)", () => {
    const i = idx({ id: "i1", name: "idx_email", unique: true, columns: ["email"] });
    const ops: AlterOp[] = [{ kind: "addIndex", index: i }];
    const stmts = buildAlter("postgres", null, "users", ops);
    expect(stmts[0].sql).toBe('CREATE UNIQUE INDEX "idx_email" ON "users" ("email");');
  });

  it("DROP INDEX (postgres: no ON clause)", () => {
    const ops: AlterOp[] = [{ kind: "dropIndex", name: "idx_old" }];
    const stmts = buildAlter("postgres", null, "users", ops);
    expect(stmts[0].sql).toBe('DROP INDEX "idx_old";');
  });

  it("schema qualification on ADD COLUMN", () => {
    const newCol = col({ id: "b", name: "note", type: "text" });
    const ops: AlterOp[] = [{ kind: "addColumn", column: newCol }];
    const stmts = buildAlter("postgres", "myschema", "widgets", ops);
    expect(stmts[0].sql).toMatch(/^ALTER TABLE "myschema"\."widgets"/);
  });
});

// ---------------------------------------------------------------------------
// buildAlter — SQLite
// ---------------------------------------------------------------------------
describe("buildAlter — SQLite", () => {
  it("ADD COLUMN", () => {
    const newCol = col({ id: "b", name: "note", type: "text" });
    const ops: AlterOp[] = [{ kind: "addColumn", column: newCol }];
    const stmts = buildAlter("sqlite", null, "items", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "items" ADD COLUMN "note" TEXT;');
  });

  it("RENAME COLUMN", () => {
    const renamedCol = col({ id: "a", name: "new", type: "text", nullable: true });
    const ops: AlterOp[] = [{ kind: "renameColumn", from: "old", to: "new", column: renamedCol }];
    const stmts = buildAlter("sqlite", null, "items", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "items" RENAME COLUMN "old" TO "new";');
  });

  it("DROP COLUMN", () => {
    const ops: AlterOp[] = [{ kind: "dropColumn", name: "old_col" }];
    const stmts = buildAlter("sqlite", null, "items", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe('ALTER TABLE "items" DROP COLUMN "old_col";');
  });

  it("ADD INDEX", () => {
    const i = idx({ id: "i1", name: "idx_x", unique: false, columns: ["x"] });
    const ops: AlterOp[] = [{ kind: "addIndex", index: i }];
    const stmts = buildAlter("sqlite", null, "t", ops);
    expect(stmts[0].sql).toBe('CREATE INDEX "idx_x" ON "t" ("x");');
  });

  it("DROP INDEX (sqlite: no ON clause)", () => {
    const ops: AlterOp[] = [{ kind: "dropIndex", name: "idx_x" }];
    const stmts = buildAlter("sqlite", null, "t", ops);
    expect(stmts[0].sql).toBe('DROP INDEX "idx_x";');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — diffColumns → buildAlter (real pipeline, no hand-built ops)
// ---------------------------------------------------------------------------
describe("Integration: diffColumns → buildAlter", () => {
  describe("MySQL", () => {
    it("rename-only → single CHANGE COLUMN with full spec (not a comment)", () => {
      const original = [col({ id: "c1", name: "username", type: "varchar", length: 100, nullable: false })];
      const edited   = [col({ id: "c1", name: "user_name", type: "varchar", length: 100, nullable: false })];
      const ops = diffColumns(original, edited);
      const stmts = buildAlter("mysql", null, "users", ops);
      expect(stmts).toHaveLength(1);
      // Must be a real SQL statement, not a comment placeholder
      expect(stmts[0].sql).not.toMatch(/^--/);
      expect(stmts[0].sql).toMatch(/CHANGE COLUMN `username` `user_name` VARCHAR\(100\) NOT NULL/);
    });

    it("rename + type change → single CHANGE COLUMN (no separate MODIFY)", () => {
      const original = [col({ id: "c1", name: "amount", type: "int", nullable: true })];
      const edited   = [col({ id: "c1", name: "total",  type: "decimal", precision: 10, scale: 2, nullable: true })];
      const ops = diffColumns(original, edited);
      const stmts = buildAlter("mysql", null, "orders", ops);
      // Should produce exactly ONE statement (CHANGE COLUMN with new type, NOT a MODIFY too)
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toMatch(/CHANGE COLUMN `amount` `total` DECIMAL\(10,2\)/);
      expect(stmts.some((s) => s.sql.includes("MODIFY COLUMN"))).toBe(false);
    });

    it("rename of AUTO_INCREMENT column → CHANGE COLUMN contains AUTO_INCREMENT, no DEFAULT", () => {
      const original = [col({ id: "c1", name: "id",  type: "int", nullable: false, isPrimaryKey: true, isAutoIncrement: true })];
      const edited   = [col({ id: "c1", name: "uid", type: "int", nullable: false, isPrimaryKey: true, isAutoIncrement: true })];
      const ops = diffColumns(original, edited);
      const stmts = buildAlter("mysql", null, "users", ops);
      const changeSql = stmts.find((s) => s.sql.includes("CHANGE COLUMN"));
      expect(changeSql).toBeDefined();
      expect(changeSql!.sql).toMatch(/AUTO_INCREMENT/);
      // No DEFAULT should be emitted for AUTO_INCREMENT columns
      expect(changeSql!.sql).not.toMatch(/DEFAULT/);
    });

    it("modify-only of AUTO_INCREMENT column → MODIFY COLUMN contains AUTO_INCREMENT", () => {
      const original = [col({ id: "c1", name: "id", type: "int",    nullable: false, isPrimaryKey: true, isAutoIncrement: true })];
      const edited   = [col({ id: "c1", name: "id", type: "bigint", nullable: false, isPrimaryKey: true, isAutoIncrement: true })];
      const ops = diffColumns(original, edited);
      const stmts = buildAlter("mysql", null, "users", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toMatch(/MODIFY COLUMN `id` BIGINT NOT NULL AUTO_INCREMENT/);
    });
  });

  describe("Postgres", () => {
    it("rename + type change → RENAME COLUMN statement then ALTER COLUMN <new name> TYPE", () => {
      const original = [col({ id: "c1", name: "amount", type: "int",     nullable: true })];
      const edited   = [col({ id: "c1", name: "total",  type: "decimal", precision: 10, scale: 2, nullable: true })];
      const ops = diffColumns(original, edited);
      const stmts = buildAlter("postgres", null, "orders", ops);
      // Must have both a RENAME and an ALTER COLUMN TYPE
      const renameSql  = stmts.find((s) => s.sql.includes("RENAME COLUMN"));
      const typeSql    = stmts.find((s) => s.sql.includes("TYPE"));
      expect(renameSql).toBeDefined();
      expect(typeSql).toBeDefined();
      // RENAME comes before ALTER COLUMN
      expect(stmts.indexOf(renameSql!)).toBeLessThan(stmts.indexOf(typeSql!));
      // The TYPE statement uses the NEW column name
      expect(typeSql!.sql).toMatch(/"total"/);
      expect(renameSql!.sql).toMatch(/RENAME COLUMN "amount" TO "total"/);
    });
  });
});

// ---------------------------------------------------------------------------
// rawTypeToCatalog — char/character mapping (Change 5)
// ---------------------------------------------------------------------------
describe("rawTypeToCatalog — char/character mapping", () => {
  it("maps MySQL 'char(10)' → varchar with length 10", () => {
    const r = rawTypeToCatalog("mysql", "char(10)");
    expect(r.type).toBe("varchar");
    expect(r.length).toBe(10);
  });

  it("maps Postgres 'character(20)' → varchar with length 20", () => {
    const r = rawTypeToCatalog("postgres", "character(20)");
    expect(r.type).toBe("varchar");
    expect(r.length).toBe(20);
  });

  it("maps bare 'char' (no length) → varchar with null length", () => {
    const r = rawTypeToCatalog("mysql", "char");
    expect(r.type).toBe("varchar");
    expect(r.length).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildAlter — renameTable
// ---------------------------------------------------------------------------
describe("buildAlter — renameTable", () => {
  describe("alone (no other ops)", () => {
    it("MySQL: emits RENAME TABLE <old-qualified> TO <new-qualified>", () => {
      const ops: AlterOp[] = [{ kind: "renameTable", to: "users_v2" }];
      const stmts = buildAlter("mysql", null, "users", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toBe("RENAME TABLE `users` TO `users_v2`;");
      expect(stmts[0].params).toEqual([]);
    });

    it("MySQL: qualifies both old and new names with same db/schema", () => {
      const ops: AlterOp[] = [{ kind: "renameTable", to: "accounts_v2" }];
      const stmts = buildAlter("mysql", "mydb", "accounts", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toBe("RENAME TABLE `mydb`.`accounts` TO `mydb`.`accounts_v2`;");
    });

    it("Postgres: emits ALTER TABLE <old-qualified> RENAME TO <new-bare-quoted>", () => {
      const ops: AlterOp[] = [{ kind: "renameTable", to: "users_v2" }];
      const stmts = buildAlter("postgres", null, "users", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toBe('ALTER TABLE "users" RENAME TO "users_v2";');
      expect(stmts[0].params).toEqual([]);
    });

    it("Postgres: new name is unqualified even when schema present", () => {
      const ops: AlterOp[] = [{ kind: "renameTable", to: "orders_v2" }];
      const stmts = buildAlter("postgres", "myschema", "orders", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toBe('ALTER TABLE "myschema"."orders" RENAME TO "orders_v2";');
    });

    it("SQLite: emits ALTER TABLE <old-qualified> RENAME TO <new-bare-quoted>", () => {
      const ops: AlterOp[] = [{ kind: "renameTable", to: "items_v2" }];
      const stmts = buildAlter("sqlite", null, "items", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toBe('ALTER TABLE "items" RENAME TO "items_v2";');
      expect(stmts[0].params).toEqual([]);
    });
  });

  describe("combined with column add — rename is emitted LAST", () => {
    it("MySQL: addColumn comes before RENAME TABLE", () => {
      const newCol = col({ id: "b", name: "email", type: "varchar", length: 200 });
      const ops: AlterOp[] = [
        { kind: "addColumn", column: newCol },
        { kind: "renameTable", to: "users_v2" },
      ];
      const stmts = buildAlter("mysql", null, "users", ops);
      expect(stmts).toHaveLength(2);
      expect(stmts[0].sql).toContain("ADD COLUMN");
      expect(stmts[1].sql).toBe("RENAME TABLE `users` TO `users_v2`;");
    });

    it("Postgres: addColumn comes before RENAME TO", () => {
      const newCol = col({ id: "b", name: "note", type: "text" });
      const ops: AlterOp[] = [
        { kind: "addColumn", column: newCol },
        { kind: "renameTable", to: "items_v2" },
      ];
      const stmts = buildAlter("postgres", null, "items", ops);
      expect(stmts).toHaveLength(2);
      expect(stmts[0].sql).toContain("ADD COLUMN");
      expect(stmts[1].sql).toBe('ALTER TABLE "items" RENAME TO "items_v2";');
    });

    it("SQLite: addColumn comes before RENAME TO", () => {
      const newCol = col({ id: "b", name: "tag", type: "text" });
      const ops: AlterOp[] = [
        { kind: "addColumn", column: newCol },
        { kind: "renameTable", to: "products_v2" },
      ];
      const stmts = buildAlter("sqlite", null, "products", ops);
      expect(stmts).toHaveLength(2);
      expect(stmts[0].sql).toContain("ADD COLUMN");
      expect(stmts[1].sql).toBe('ALTER TABLE "products" RENAME TO "products_v2";');
    });
  });

  describe("supportedOnSqlite does NOT block renameTable", () => {
    it("renameTable alone is ok on sqlite", () => {
      const ops: AlterOp[] = [{ kind: "renameTable", to: "new_name" }];
      const result = supportedOnSqlite(ops);
      expect(result.ok).toBe(true);
      expect(result.blocked).toHaveLength(0);
    });

    it("renameTable combined with addColumn is ok on sqlite", () => {
      const newCol = col({ id: "b", name: "x", type: "text" });
      const ops: AlterOp[] = [
        { kind: "addColumn", column: newCol },
        { kind: "renameTable", to: "new_name" },
      ];
      const result = supportedOnSqlite(ops);
      expect(result.ok).toBe(true);
      expect(result.blocked).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// supportedOnSqlite
// ---------------------------------------------------------------------------
describe("supportedOnSqlite", () => {
  it("is ok for add/drop/rename column and add/drop index", () => {
    const addCol = col({ id: "b", name: "note", type: "text" });
    const i = idx({ id: "i1", name: "idx_x", columns: ["x"] });
    const ops: AlterOp[] = [
      { kind: "addColumn", column: addCol },
      { kind: "dropColumn", name: "x" },
      { kind: "renameColumn", from: "a", to: "b", column: col({ id: "c", name: "b", type: "text" }) },
      { kind: "addIndex", index: i },
      { kind: "dropIndex", name: "idx_x" },
    ];
    const result = supportedOnSqlite(ops);
    expect(result.ok).toBe(true);
    expect(result.blocked).toHaveLength(0);
  });

  it("blocks modifyColumn (any change)", () => {
    const editedCol = col({ id: "a", name: "x", type: "int", nullable: false });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: false, defaultChanged: false, commentChanged: false },
    ];
    const result = supportedOnSqlite(ops);
    expect(result.ok).toBe(false);
    expect(result.blocked.length).toBeGreaterThan(0);
  });

  it("blocks setPrimaryKey", () => {
    const ops: AlterOp[] = [{ kind: "setPrimaryKey", columns: ["id"] }];
    const result = supportedOnSqlite(ops);
    expect(result.ok).toBe(false);
    expect(result.blocked.length).toBeGreaterThan(0);
  });

  it("reports multiple blocked reasons", () => {
    const editedCol = col({ id: "a", name: "x", type: "int" });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: false, defaultChanged: false, commentChanged: false },
      { kind: "setPrimaryKey", columns: [] },
    ];
    const result = supportedOnSqlite(ops);
    expect(result.ok).toBe(false);
    expect(result.blocked.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT block a modifyColumn whose only change is the comment", () => {
    const editedCol = col({ id: "a", name: "x", type: "int", comment: "hi" });
    const ops: AlterOp[] = [
      {
        kind: "modifyColumn",
        column: editedCol,
        typeChanged: false,
        nullChanged: false,
        defaultChanged: false,
        commentChanged: true,
      },
    ];
    const result = supportedOnSqlite(ops);
    expect(result.ok).toBe(true);
    expect(result.blocked).toHaveLength(0);
  });

  it("still blocks a modifyColumn that changes type AND comment", () => {
    const editedCol = col({ id: "a", name: "x", type: "bigint", comment: "hi" });
    const ops: AlterOp[] = [
      {
        kind: "modifyColumn",
        column: editedCol,
        typeChanged: true,
        nullChanged: false,
        defaultChanged: false,
        commentChanged: true,
      },
    ];
    const result = supportedOnSqlite(ops);
    expect(result.ok).toBe(false);
    expect(result.blocked.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Column comments — diffColumns + buildAlter
// ---------------------------------------------------------------------------
describe("column comments", () => {
  describe("diffColumns: commentChanged", () => {
    it("emits a modifyColumn when ONLY the comment changed", () => {
      const orig = [col({ id: "a", name: "x", type: "int", comment: null })];
      const edited = [col({ id: "a", name: "x", type: "int", comment: "now commented" })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe("modifyColumn");
      if (ops[0].kind === "modifyColumn") {
        expect(ops[0].commentChanged).toBe(true);
        expect(ops[0].typeChanged).toBe(false);
        expect(ops[0].nullChanged).toBe(false);
        expect(ops[0].defaultChanged).toBe(false);
      }
    });

    it("treats '' / null / undefined comments as equal (no op)", () => {
      const orig = [col({ id: "a", name: "x", type: "int", comment: "" })];
      const edited = [col({ id: "a", name: "x", type: "int", comment: null })];
      expect(diffColumns(orig, edited)).toHaveLength(0);

      const orig2 = [col({ id: "a", name: "x", type: "int" })]; // comment undefined
      const edited2 = [col({ id: "a", name: "x", type: "int", comment: "" })];
      expect(diffColumns(orig2, edited2)).toHaveLength(0);
    });

    it("flags commentChanged alongside other changes", () => {
      const orig = [col({ id: "a", name: "x", type: "int", nullable: true, comment: "old" })];
      const edited = [col({ id: "a", name: "x", type: "int", nullable: false, comment: "new" })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      if (ops[0].kind === "modifyColumn") {
        expect(ops[0].nullChanged).toBe(true);
        expect(ops[0].commentChanged).toBe(true);
      }
    });
  });

  describe("MySQL", () => {
    it("comment-only change → MODIFY COLUMN with full spec incl COMMENT", () => {
      const orig = [col({ id: "a", name: "email", type: "varchar", length: 200, nullable: false, comment: null })];
      const edited = [col({ id: "a", name: "email", type: "varchar", length: 200, nullable: false, comment: "User email" })];
      const ops = diffColumns(orig, edited);
      const stmts = buildAlter("mysql", null, "users", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toBe(
        "ALTER TABLE `users` MODIFY COLUMN `email` VARCHAR(200) NOT NULL COMMENT 'User email';",
      );
    });

    it("type change carries the COMMENT in the MODIFY spec", () => {
      const editedCol = col({ id: "a", name: "x", type: "bigint", nullable: false, comment: "big" });
      const ops: AlterOp[] = [
        { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: false, defaultChanged: false, commentChanged: false },
      ];
      const stmts = buildAlter("mysql", null, "t", ops);
      expect(stmts[0].sql).toBe("ALTER TABLE `t` MODIFY COLUMN `x` BIGINT NOT NULL COMMENT 'big';");
    });

    it("rename carries the COMMENT in the CHANGE COLUMN spec", () => {
      const editedCol = col({ id: "a", name: "new", type: "text", nullable: true, comment: "renamed" });
      const ops: AlterOp[] = [
        { kind: "renameColumn", from: "old", to: "new", column: editedCol },
      ];
      const stmts = buildAlter("mysql", null, "t", ops);
      expect(stmts[0].sql).toBe("ALTER TABLE `t` CHANGE COLUMN `old` `new` TEXT COMMENT 'renamed';");
    });

    it("escapes single quotes in the comment", () => {
      const editedCol = col({ id: "a", name: "x", type: "int", nullable: false, comment: "it's fine" });
      const ops: AlterOp[] = [
        { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: false, defaultChanged: false, commentChanged: true },
      ];
      const stmts = buildAlter("mysql", null, "t", ops);
      expect(stmts[0].sql).toContain("COMMENT 'it''s fine'");
    });
  });

  describe("Postgres", () => {
    it("comment-only change → COMMENT ON COLUMN ... IS '<text>'", () => {
      const orig = [col({ id: "a", name: "email", type: "varchar", length: 200, nullable: false, comment: null })];
      const edited = [col({ id: "a", name: "email", type: "varchar", length: 200, nullable: false, comment: "User email" })];
      const ops = diffColumns(orig, edited);
      const stmts = buildAlter("postgres", null, "users", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toBe(`COMMENT ON COLUMN "users"."email" IS 'User email';`);
    });

    it("clearing a comment → COMMENT ON COLUMN ... IS NULL", () => {
      const orig = [col({ id: "a", name: "x", type: "int", nullable: true, comment: "had one" })];
      const edited = [col({ id: "a", name: "x", type: "int", nullable: true, comment: null })];
      const ops = diffColumns(orig, edited);
      const stmts = buildAlter("postgres", null, "t", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toBe(`COMMENT ON COLUMN "t"."x" IS NULL;`);
    });

    it("comment statement is emitted in addition to type/null/default sub-statements", () => {
      const editedCol = col({ id: "a", name: "amt", type: "decimal", precision: 12, scale: 4, nullable: false, defaultValue: "0", comment: "money" });
      const ops: AlterOp[] = [
        { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: true, defaultChanged: true, commentChanged: true },
      ];
      const stmts = buildAlter("postgres", null, "ledger", ops);
      expect(stmts).toHaveLength(4);
      const sqls = stmts.map((s) => s.sql);
      expect(sqls.some((s) => s.includes("TYPE DECIMAL(12,4)"))).toBe(true);
      expect(sqls.some((s) => s.includes("SET NOT NULL"))).toBe(true);
      expect(sqls.some((s) => s.includes("SET DEFAULT 0"))).toBe(true);
      expect(sqls.some((s) => s === `COMMENT ON COLUMN "ledger"."amt" IS 'money';`)).toBe(true);
    });

    it("does NOT emit a comment statement when commentChanged is false", () => {
      const editedCol = col({ id: "a", name: "x", type: "bigint", nullable: true, comment: "unchanged" });
      const ops: AlterOp[] = [
        { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: false, defaultChanged: false, commentChanged: false },
      ];
      const stmts = buildAlter("postgres", null, "t", ops);
      expect(stmts.some((s) => s.sql.includes("COMMENT ON COLUMN"))).toBe(false);
    });

    it("qualifies the COMMENT ON COLUMN with schema", () => {
      const editedCol = col({ id: "a", name: "x", type: "int", nullable: true, comment: "c" });
      const ops: AlterOp[] = [
        { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: false, defaultChanged: false, commentChanged: true },
      ];
      const stmts = buildAlter("postgres", "myschema", "orders", ops);
      expect(stmts[0].sql).toBe(`COMMENT ON COLUMN "myschema"."orders"."x" IS 'c';`);
    });
  });

  describe("SQLite", () => {
    it("comment-only change emits nothing", () => {
      const orig = [col({ id: "a", name: "x", type: "int", nullable: true, comment: null })];
      const edited = [col({ id: "a", name: "x", type: "int", nullable: true, comment: "ignored" })];
      const ops = diffColumns(orig, edited);
      const stmts = buildAlter("sqlite", null, "t", ops);
      expect(stmts).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Extended column attributes — diffColumns + buildAlter
// ---------------------------------------------------------------------------
describe("extended column attributes", () => {
  describe("diffColumns: attrsChanged", () => {
    it("detects an unsigned change", () => {
      const orig = [col({ id: "a", name: "qty", type: "int" })];
      const edited = [col({ id: "a", name: "qty", type: "int", unsigned: true })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      expect(ops[0].kind).toBe("modifyColumn");
      if (ops[0].kind === "modifyColumn") {
        expect(ops[0].attrsChanged).toBe(true);
        expect(ops[0].typeChanged).toBe(false);
      }
    });

    it("detects a charset/collation change", () => {
      const orig = [col({ id: "a", name: "name", type: "varchar", length: 100 })];
      const edited = [col({ id: "a", name: "name", type: "varchar", length: 100, charset: "utf8mb4", collation: "utf8mb4_unicode_ci" })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      if (ops[0].kind === "modifyColumn") expect(ops[0].attrsChanged).toBe(true);
    });

    it("detects an on-update-current-timestamp change", () => {
      const orig = [col({ id: "a", name: "ts", type: "timestamp" })];
      const edited = [col({ id: "a", name: "ts", type: "timestamp", onUpdateCurrentTimestamp: true })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      if (ops[0].kind === "modifyColumn") expect(ops[0].attrsChanged).toBe(true);
    });

    it("detects a generated-expression change", () => {
      const orig = [col({ id: "a", name: "t", type: "int" })];
      const edited = [col({ id: "a", name: "t", type: "int", generated: { expression: "a + b", stored: true } })];
      const ops = diffColumns(orig, edited);
      expect(ops).toHaveLength(1);
      if (ops[0].kind === "modifyColumn") expect(ops[0].attrsChanged).toBe(true);
    });

    it("no op when extended attrs are unchanged", () => {
      const c = col({ id: "a", name: "qty", type: "int", unsigned: true, charset: "utf8mb4" });
      expect(diffColumns([c], [{ ...c }])).toHaveLength(0);
    });
  });

  describe("MySQL MODIFY re-render carries the new attrs", () => {
    it("unsigned change → MODIFY COLUMN INTEGER UNSIGNED", () => {
      const orig = [col({ id: "a", name: "qty", type: "int", nullable: false })];
      const edited = [col({ id: "a", name: "qty", type: "int", nullable: false, unsigned: true })];
      const ops = diffColumns(orig, edited);
      const stmts = buildAlter("mysql", null, "t", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toBe("ALTER TABLE `t` MODIFY COLUMN `qty` INTEGER UNSIGNED NOT NULL;");
    });

    it("charset/collation change → MODIFY COLUMN with CHARACTER SET ... COLLATE ...", () => {
      const orig = [col({ id: "a", name: "name", type: "varchar", length: 100, nullable: false })];
      const edited = [col({ id: "a", name: "name", type: "varchar", length: 100, nullable: false, charset: "utf8mb4", collation: "utf8mb4_unicode_ci" })];
      const ops = diffColumns(orig, edited);
      const stmts = buildAlter("mysql", null, "t", ops);
      expect(stmts[0].sql).toBe(
        "ALTER TABLE `t` MODIFY COLUMN `name` VARCHAR(100) NOT NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
      );
    });

    it("generated column → MODIFY COLUMN with GENERATED clause, no DEFAULT", () => {
      const orig = [col({ id: "a", name: "total", type: "decimal", precision: 12, scale: 2, nullable: false })];
      const edited = [col({ id: "a", name: "total", type: "decimal", precision: 12, scale: 2, nullable: false, generated: { expression: "price * qty", stored: true } })];
      const ops = diffColumns(orig, edited);
      const stmts = buildAlter("mysql", null, "t", ops);
      expect(stmts[0].sql).toBe(
        "ALTER TABLE `t` MODIFY COLUMN `total` DECIMAL(12,2) GENERATED ALWAYS AS (price * qty) STORED NOT NULL;",
      );
    });
  });

  describe("Postgres best-effort", () => {
    it("attrs-only change → explanatory comment (no invalid SQL)", () => {
      const orig = [col({ id: "a", name: "qty", type: "int", nullable: false })];
      const edited = [col({ id: "a", name: "qty", type: "int", nullable: false, unsigned: true })];
      const ops = diffColumns(orig, edited);
      const stmts = buildAlter("postgres", null, "t", ops);
      expect(stmts).toHaveLength(1);
      expect(stmts[0].sql).toMatch(/^-- Postgres:/);
      expect(stmts[0].sql).toContain('"qty"');
    });

    it("type change + attrs change → ALTER COLUMN TYPE, no attrs comment", () => {
      const orig = [col({ id: "a", name: "qty", type: "int", nullable: false })];
      const edited = [col({ id: "a", name: "qty", type: "bigint", nullable: false, unsigned: true })];
      const ops = diffColumns(orig, edited);
      const stmts = buildAlter("postgres", null, "t", ops);
      // type changed, so the column re-render covers it; no extra attrs comment
      expect(stmts.some((s) => s.sql.includes("TYPE BIGINT"))).toBe(true);
      expect(stmts.some((s) => s.sql.startsWith("-- Postgres:"))).toBe(false);
    });
  });

  describe("SQLite", () => {
    it("attrs-only change is blocked by supportedOnSqlite", () => {
      const orig = [col({ id: "a", name: "qty", type: "int" })];
      const edited = [col({ id: "a", name: "qty", type: "int", unsigned: true })];
      const ops = diffColumns(orig, edited);
      const result = supportedOnSqlite(ops);
      expect(result.ok).toBe(false);
      expect(result.blocked.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// diffChecks
// ---------------------------------------------------------------------------
describe("diffChecks", () => {
  const chk = (id: string, name: string, expression: string): DesignerCheck => ({ id, name, expression });

  it("detects an added check", () => {
    const ops = diffChecks([], [chk("c1", "chk_age", "age >= 0")]);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("addCheck");
    if (ops[0].kind === "addCheck") expect(ops[0].check.name).toBe("chk_age");
  });

  it("detects a removed check", () => {
    const ops = diffChecks([chk("c1", "chk_age", "age >= 0")], []);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("dropCheck");
    if (ops[0].kind === "dropCheck") expect(ops[0].name).toBe("chk_age");
  });

  it("treats a changed expression as drop + add", () => {
    const ops = diffChecks([chk("c1", "chk_age", "age >= 0")], [chk("c1", "chk_age", "age > 0")]);
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.kind)).toEqual(["dropCheck", "addCheck"]);
  });

  it("emits nothing when unchanged", () => {
    const c = chk("c1", "chk_age", "age >= 0");
    expect(diffChecks([c], [{ ...c }])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// diffUniques
// ---------------------------------------------------------------------------
describe("diffUniques", () => {
  const uq = (id: string, name: string, columns: string[]): DesignerUnique => ({ id, name, columns });

  it("detects an added unique", () => {
    const ops = diffUniques([], [uq("u1", "uq_email", ["email"])]);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("addUnique");
  });

  it("detects a removed unique", () => {
    const ops = diffUniques([uq("u1", "uq_email", ["email"])], []);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("dropUnique");
    if (ops[0].kind === "dropUnique") expect(ops[0].name).toBe("uq_email");
  });

  it("treats a changed column set as drop + add", () => {
    const ops = diffUniques([uq("u1", "uq_x", ["a"])], [uq("u1", "uq_x", ["a", "b"])]);
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.kind)).toEqual(["dropUnique", "addUnique"]);
  });

  it("emits nothing when unchanged", () => {
    const u = uq("u1", "uq_email", ["email"]);
    expect(diffUniques([u], [{ ...u }])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// diffTableOptions
// ---------------------------------------------------------------------------
describe("diffTableOptions", () => {
  it("emits setTableOptions when an option changes", () => {
    const ops = diffTableOptions({ engine: "MyISAM" }, { engine: "InnoDB" });
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("setTableOptions");
    if (ops[0].kind === "setTableOptions") expect(ops[0].options.engine).toBe("InnoDB");
  });

  it("detects a comment change", () => {
    const ops = diffTableOptions({ comment: "old" }, { comment: "new" });
    expect(ops).toHaveLength(1);
  });

  it("emits nothing when unchanged", () => {
    const o: TableOptions = { engine: "InnoDB", comment: "x" };
    expect(diffTableOptions(o, { ...o })).toHaveLength(0);
  });

  it("treats undefined and {} as equal", () => {
    expect(diffTableOptions(undefined, {})).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildAlter — checks / uniques / table options
// ---------------------------------------------------------------------------
describe("buildAlter — CHECK constraints", () => {
  it("MySQL ADD CHECK", () => {
    const ops: AlterOp[] = [{ kind: "addCheck", check: { id: "c1", name: "chk_age", expression: "age >= 0" } }];
    const stmts = buildAlter("mysql", null, "t", ops);
    expect(stmts[0].sql).toBe("ALTER TABLE `t` ADD CONSTRAINT `chk_age` CHECK (age >= 0);");
  });

  it("MySQL DROP CHECK uses DROP CHECK", () => {
    const ops: AlterOp[] = [{ kind: "dropCheck", name: "chk_age" }];
    const stmts = buildAlter("mysql", null, "t", ops);
    expect(stmts[0].sql).toBe("ALTER TABLE `t` DROP CHECK `chk_age`;");
  });

  it("Postgres ADD CHECK", () => {
    const ops: AlterOp[] = [{ kind: "addCheck", check: { id: "c1", name: "chk_age", expression: "age >= 0" } }];
    const stmts = buildAlter("postgres", null, "t", ops);
    expect(stmts[0].sql).toBe('ALTER TABLE "t" ADD CONSTRAINT "chk_age" CHECK (age >= 0);');
  });

  it("Postgres DROP CHECK uses DROP CONSTRAINT", () => {
    const ops: AlterOp[] = [{ kind: "dropCheck", name: "chk_age" }];
    const stmts = buildAlter("postgres", null, "t", ops);
    expect(stmts[0].sql).toBe('ALTER TABLE "t" DROP CONSTRAINT "chk_age";');
  });

  it("SQLite emits an explanatory comment for ADD CHECK", () => {
    const ops: AlterOp[] = [{ kind: "addCheck", check: { id: "c1", name: "chk_age", expression: "age >= 0" } }];
    const stmts = buildAlter("sqlite", null, "t", ops);
    expect(stmts[0].sql).toMatch(/^-- SQLite:/);
  });
});

describe("buildAlter — named UNIQUE constraints", () => {
  it("MySQL ADD UNIQUE", () => {
    const ops: AlterOp[] = [{ kind: "addUnique", unique: { id: "u1", name: "uq_email", columns: ["email"] } }];
    const stmts = buildAlter("mysql", null, "users", ops);
    expect(stmts[0].sql).toBe("ALTER TABLE `users` ADD CONSTRAINT `uq_email` UNIQUE (`email`);");
  });

  it("MySQL DROP UNIQUE uses DROP INDEX", () => {
    const ops: AlterOp[] = [{ kind: "dropUnique", name: "uq_email" }];
    const stmts = buildAlter("mysql", null, "users", ops);
    expect(stmts[0].sql).toBe("ALTER TABLE `users` DROP INDEX `uq_email`;");
  });

  it("Postgres ADD UNIQUE", () => {
    const ops: AlterOp[] = [{ kind: "addUnique", unique: { id: "u1", name: "uq_email", columns: ["email"] } }];
    const stmts = buildAlter("postgres", null, "users", ops);
    expect(stmts[0].sql).toBe('ALTER TABLE "users" ADD CONSTRAINT "uq_email" UNIQUE ("email");');
  });

  it("Postgres DROP UNIQUE uses DROP CONSTRAINT", () => {
    const ops: AlterOp[] = [{ kind: "dropUnique", name: "uq_email" }];
    const stmts = buildAlter("postgres", null, "users", ops);
    expect(stmts[0].sql).toBe('ALTER TABLE "users" DROP CONSTRAINT "uq_email";');
  });

  it("SQLite emits an explanatory comment for ADD UNIQUE", () => {
    const ops: AlterOp[] = [{ kind: "addUnique", unique: { id: "u1", name: "uq_email", columns: ["email"] } }];
    const stmts = buildAlter("sqlite", null, "users", ops);
    expect(stmts[0].sql).toMatch(/^-- SQLite:/);
  });
});

describe("buildAlter — table options", () => {
  it("MySQL emits one ALTER TABLE with the set options", () => {
    const ops: AlterOp[] = [{ kind: "setTableOptions", options: { engine: "InnoDB", comment: "hello" } }];
    const stmts = buildAlter("mysql", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE `t` ENGINE=InnoDB COMMENT='hello';");
  });

  it("MySQL emits AUTO_INCREMENT and ROW_FORMAT", () => {
    const ops: AlterOp[] = [{ kind: "setTableOptions", options: { rowFormat: "DYNAMIC", autoIncrement: 500 } }];
    const stmts = buildAlter("mysql", null, "t", ops);
    expect(stmts[0].sql).toBe("ALTER TABLE `t` ROW_FORMAT=DYNAMIC AUTO_INCREMENT=500;");
  });

  it("Postgres emits COMMENT ON TABLE for the comment only", () => {
    const ops: AlterOp[] = [{ kind: "setTableOptions", options: { engine: "InnoDB", comment: "pg" } }];
    const stmts = buildAlter("postgres", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(`COMMENT ON TABLE "t" IS 'pg';`);
  });

  it("Postgres clearing the comment → COMMENT ON TABLE ... IS NULL", () => {
    const ops: AlterOp[] = [{ kind: "setTableOptions", options: { comment: "" } }];
    const stmts = buildAlter("postgres", null, "t", ops);
    expect(stmts[0].sql).toBe(`COMMENT ON TABLE "t" IS NULL;`);
  });

  it("Postgres emits nothing when only non-comment options are set", () => {
    const ops: AlterOp[] = [{ kind: "setTableOptions", options: { engine: "InnoDB" } }];
    const stmts = buildAlter("postgres", null, "t", ops);
    expect(stmts).toHaveLength(0);
  });

  it("SQLite emits an explanatory comment", () => {
    const ops: AlterOp[] = [{ kind: "setTableOptions", options: { engine: "InnoDB" } }];
    const stmts = buildAlter("sqlite", null, "t", ops);
    expect(stmts[0].sql).toMatch(/^-- SQLite:/);
  });
});

// ---------------------------------------------------------------------------
// buildAlter — index method/kind/order/prefix (ALTER path)
// ---------------------------------------------------------------------------
describe("buildAlter — addIndex honors method/kind/order/prefix", () => {
  it("MySQL FULLTEXT", () => {
    const ops: AlterOp[] = [
      { kind: "addIndex", index: { id: "i1", name: "ft", unique: false, columns: ["body"], indexKind: "fulltext" } },
    ];
    const stmts = buildAlter("mysql", null, "posts", ops);
    expect(stmts[0].sql).toBe("CREATE FULLTEXT INDEX `ft` ON `posts` (`body`);");
  });

  it("MySQL prefix + DESC", () => {
    const ops: AlterOp[] = [
      { kind: "addIndex", index: { id: "i1", name: "idx", unique: false, columns: ["name"], prefixLengths: { name: 10 }, columnOrders: { name: "DESC" } } },
    ];
    const stmts = buildAlter("mysql", null, "t", ops);
    expect(stmts[0].sql).toBe("CREATE INDEX `idx` ON `t` (`name`(10) DESC);");
  });

  it("Postgres USING gin", () => {
    const ops: AlterOp[] = [
      { kind: "addIndex", index: { id: "i1", name: "idx", unique: false, columns: ["body"], method: "GIN" } },
    ];
    const stmts = buildAlter("postgres", null, "docs", ops);
    expect(stmts[0].sql).toBe('CREATE INDEX "idx" ON "docs" USING gin ("body");');
  });
});

// ---------------------------------------------------------------------------
// buildAlter — SQL Server (T-SQL)
// ---------------------------------------------------------------------------
describe("buildAlter — SQL Server", () => {
  it("ADD COLUMN omits the COLUMN keyword and brackets the type", () => {
    const newCol = col({ id: "b", name: "email", type: "varchar", length: 200, nullable: true });
    const ops: AlterOp[] = [{ kind: "addColumn", column: newCol }];
    const stmts = buildAlter("sqlserver", null, "users", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE [users] ADD [email] NVARCHAR(200) NULL;");
    expect(stmts[0].params).toEqual([]);
  });

  it("ADD COLUMN NOT NULL with an inline DEFAULT constraint", () => {
    const newCol = col({ id: "b", name: "status", type: "varchar", length: 20, nullable: false, defaultValue: "'new'" });
    const ops: AlterOp[] = [{ kind: "addColumn", column: newCol }];
    const stmts = buildAlter("sqlserver", null, "orders", ops);
    expect(stmts[0].sql).toBe(
      "ALTER TABLE [orders] ADD [status] NVARCHAR(20) NOT NULL CONSTRAINT [DF_orders_status] DEFAULT ('new');",
    );
  });

  it("ADD COLUMN with schema qualification", () => {
    const newCol = col({ id: "b", name: "note", type: "text" });
    const ops: AlterOp[] = [{ kind: "addColumn", column: newCol }];
    const stmts = buildAlter("sqlserver", "dbo", "items", ops);
    expect(stmts[0].sql).toMatch(/^ALTER TABLE \[dbo\]\.\[items\] ADD \[note\]/);
  });

  it("DROP COLUMN keeps the COLUMN keyword", () => {
    const ops: AlterOp[] = [{ kind: "dropColumn", name: "old_col" }];
    const stmts = buildAlter("sqlserver", null, "users", ops);
    expect(stmts[0].sql).toBe("ALTER TABLE [users] DROP COLUMN [old_col];");
  });

  it("RENAME COLUMN uses sp_rename with the COLUMN object type", () => {
    const renamedCol = col({ id: "a", name: "new_name", type: "text", nullable: true });
    const ops: AlterOp[] = [
      { kind: "renameColumn", from: "old_name", to: "new_name", column: renamedCol },
    ];
    const stmts = buildAlter("sqlserver", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("EXEC sp_rename '[t].[old_name]', 'new_name', 'COLUMN';");
  });

  it("RENAME COLUMN qualifies the path with the schema", () => {
    const renamedCol = col({ id: "a", name: "b", type: "text", nullable: true });
    const ops: AlterOp[] = [{ kind: "renameColumn", from: "a", to: "b", column: renamedCol }];
    const stmts = buildAlter("sqlserver", "dbo", "t", ops);
    expect(stmts[0].sql).toBe("EXEC sp_rename '[dbo].[t].[a]', 'b', 'COLUMN';");
  });

  it("modifyColumn type/null → single ALTER COLUMN with type + nullability", () => {
    const editedCol = col({ id: "a", name: "amount", type: "decimal", precision: 10, scale: 2, nullable: false });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: true, defaultChanged: false, commentChanged: false },
    ];
    const stmts = buildAlter("sqlserver", null, "orders", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE [orders] ALTER COLUMN [amount] DECIMAL(10,2) NOT NULL;");
  });

  it("modifyColumn null-only → ALTER COLUMN re-renders the type with NULL", () => {
    const editedCol = col({ id: "a", name: "name", type: "text", nullable: true });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: true, defaultChanged: false, commentChanged: false },
    ];
    const stmts = buildAlter("sqlserver", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE [t] ALTER COLUMN [name] NVARCHAR(MAX) NULL;");
  });

  it("modifyColumn defaultChanged with value → DROP then ADD the DF_ constraint", () => {
    const editedCol = col({ id: "a", name: "status", type: "varchar", length: 20, nullable: false, defaultValue: "'active'" });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: false, defaultChanged: true, commentChanged: false },
    ];
    const stmts = buildAlter("sqlserver", null, "t", ops);
    expect(stmts).toHaveLength(2);
    expect(stmts[0].sql).toBe("ALTER TABLE [t] DROP CONSTRAINT [DF_t_status];");
    expect(stmts[1].sql).toBe("ALTER TABLE [t] ADD CONSTRAINT [DF_t_status] DEFAULT ('active') FOR [status];");
  });

  it("modifyColumn defaultChanged cleared → only DROP the DF_ constraint", () => {
    const editedCol = col({ id: "a", name: "status", type: "varchar", length: 20, nullable: false, defaultValue: null });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: false, defaultChanged: true, commentChanged: false },
    ];
    const stmts = buildAlter("sqlserver", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE [t] DROP CONSTRAINT [DF_t_status];");
  });

  it("comment-only change emits nothing", () => {
    const editedCol = col({ id: "a", name: "x", type: "int", nullable: true, comment: "hi" });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: false, nullChanged: false, defaultChanged: false, commentChanged: true },
    ];
    const stmts = buildAlter("sqlserver", null, "t", ops);
    expect(stmts).toHaveLength(0);
  });

  it("setPrimaryKey: DROP CONSTRAINT PK_<table> + ADD CONSTRAINT PK_<table> (hasPk=true)", () => {
    const ops: AlterOp[] = [{ kind: "setPrimaryKey", columns: ["id", "code"] }];
    const stmts = buildAlter("sqlserver", null, "t", ops, { hasPk: true });
    expect(stmts).toHaveLength(2);
    expect(stmts[0].sql).toBe("ALTER TABLE [t] DROP CONSTRAINT [PK_t];");
    expect(stmts[1].sql).toBe("ALTER TABLE [t] ADD CONSTRAINT [PK_t] PRIMARY KEY ([id], [code]);");
  });

  it("setPrimaryKey only ADD when hasPk=false", () => {
    const ops: AlterOp[] = [{ kind: "setPrimaryKey", columns: ["id"] }];
    const stmts = buildAlter("sqlserver", null, "t", ops, { hasPk: false });
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE [t] ADD CONSTRAINT [PK_t] PRIMARY KEY ([id]);");
  });

  it("ADD INDEX (unique) with no USING method", () => {
    const i = idx({ id: "i1", name: "idx_email", unique: true, columns: ["email"] });
    const ops: AlterOp[] = [{ kind: "addIndex", index: i }];
    const stmts = buildAlter("sqlserver", null, "users", ops);
    expect(stmts[0].sql).toBe("CREATE UNIQUE INDEX [idx_email] ON [users] ([email]);");
  });

  it("DROP INDEX requires the ON <table> clause", () => {
    const ops: AlterOp[] = [{ kind: "dropIndex", name: "idx_old" }];
    const stmts = buildAlter("sqlserver", null, "users", ops);
    expect(stmts[0].sql).toBe("DROP INDEX [idx_old] ON [users];");
  });

  it("ADD CHECK / DROP CHECK use CONSTRAINT syntax", () => {
    const addOps: AlterOp[] = [{ kind: "addCheck", check: { id: "c1", name: "chk_age", expression: "age >= 0" } }];
    expect(buildAlter("sqlserver", null, "t", addOps)[0].sql).toBe(
      "ALTER TABLE [t] ADD CONSTRAINT [chk_age] CHECK (age >= 0);",
    );
    const dropOps: AlterOp[] = [{ kind: "dropCheck", name: "chk_age" }];
    expect(buildAlter("sqlserver", null, "t", dropOps)[0].sql).toBe(
      "ALTER TABLE [t] DROP CONSTRAINT [chk_age];",
    );
  });

  it("ADD UNIQUE / DROP UNIQUE use CONSTRAINT syntax", () => {
    const addOps: AlterOp[] = [{ kind: "addUnique", unique: { id: "u1", name: "uq_email", columns: ["email"] } }];
    expect(buildAlter("sqlserver", null, "users", addOps)[0].sql).toBe(
      "ALTER TABLE [users] ADD CONSTRAINT [uq_email] UNIQUE ([email]);",
    );
    const dropOps: AlterOp[] = [{ kind: "dropUnique", name: "uq_email" }];
    expect(buildAlter("sqlserver", null, "users", dropOps)[0].sql).toBe(
      "ALTER TABLE [users] DROP CONSTRAINT [uq_email];",
    );
  });

  it("setTableOptions is a no-op", () => {
    const ops: AlterOp[] = [{ kind: "setTableOptions", options: { engine: "InnoDB", comment: "x" } }];
    const stmts = buildAlter("sqlserver", null, "t", ops);
    expect(stmts).toHaveLength(0);
  });

  it("renameTable uses sp_rename and is emitted LAST", () => {
    const newCol = col({ id: "b", name: "email", type: "varchar", length: 200 });
    const ops: AlterOp[] = [
      { kind: "addColumn", column: newCol },
      { kind: "renameTable", to: "users_v2" },
    ];
    const stmts = buildAlter("sqlserver", null, "users", ops);
    expect(stmts).toHaveLength(2);
    expect(stmts[0].sql).toContain("ADD [email]");
    expect(stmts[1].sql).toBe("EXEC sp_rename '[users]', 'users_v2';");
  });

  it("auto-increment column re-render carries IDENTITY(1,1), no DEFAULT", () => {
    const editedCol = col({ id: "a", name: "id", type: "bigint", nullable: false, isPrimaryKey: true, isAutoIncrement: true });
    const ops: AlterOp[] = [
      { kind: "modifyColumn", column: editedCol, typeChanged: true, nullChanged: false, defaultChanged: false, commentChanged: false },
    ];
    const stmts = buildAlter("sqlserver", null, "users", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE [users] ALTER COLUMN [id] BIGINT IDENTITY(1,1) NOT NULL;");
  });

  it("Integration: diffColumns(add) → buildAlter ADD with IDENTITY", () => {
    const original: DesignerColumn[] = [];
    const edited = [col({ id: "c1", name: "id", type: "int", nullable: false, isAutoIncrement: true })];
    const ops = diffColumns(original, edited);
    const stmts = buildAlter("sqlserver", null, "t", ops);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE [t] ADD [id] INT IDENTITY(1,1) NOT NULL;");
  });
});
