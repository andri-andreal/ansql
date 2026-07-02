/**
 * Tests for fkBuilder.ts — foreign-key diff + statement builder.
 * Written BEFORE the implementation (TDD red phase).
 */

import { describe, it, expect } from "vitest";
import {
  diffForeignKeys,
  buildForeignKeyStatements,
  fkEditingSupported,
  type FkOp,
} from "./fkBuilder";
import type { DesignerForeignKey } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fk(
  partial: Partial<DesignerForeignKey> & Pick<DesignerForeignKey, "id" | "name" | "columns" | "referencedTable" | "referencedColumns">,
): DesignerForeignKey {
  return {
    referencedSchema: null,
    onDelete: null,
    onUpdate: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// fkEditingSupported
// ---------------------------------------------------------------------------

describe("fkEditingSupported", () => {
  it("returns false for sqlite", () => {
    expect(fkEditingSupported("sqlite")).toBe(false);
  });

  it("returns true for mysql", () => {
    expect(fkEditingSupported("mysql")).toBe(true);
  });

  it("returns true for postgres", () => {
    expect(fkEditingSupported("postgres")).toBe(true);
  });

  it("returns true for sqlserver", () => {
    expect(fkEditingSupported("sqlserver")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// diffForeignKeys
// ---------------------------------------------------------------------------

describe("diffForeignKeys", () => {
  it("emits addFk for a new FK (in edited but not original)", () => {
    const newFk = fk({ id: "1", name: "fk_orders_user", columns: ["user_id"], referencedTable: "users", referencedColumns: ["id"] });
    const ops = diffForeignKeys([], [newFk]);
    expect(ops).toEqual([{ kind: "addFk", fk: newFk }]);
  });

  it("emits dropFk for a removed FK (in original but not edited)", () => {
    const existing = fk({ id: "1", name: "fk_orders_user", columns: ["user_id"], referencedTable: "users", referencedColumns: ["id"] });
    const ops = diffForeignKeys([existing], []);
    expect(ops).toEqual([{ kind: "dropFk", name: "fk_orders_user" }]);
  });

  it("emits nothing when FKs are unchanged", () => {
    const existing = fk({ id: "1", name: "fk_orders_user", columns: ["user_id"], referencedTable: "users", referencedColumns: ["id"] });
    const ops = diffForeignKeys([existing], [existing]);
    expect(ops).toHaveLength(0);
  });

  it("emits drop+add (in that order) for a changed FK", () => {
    const original = fk({ id: "1", name: "fk_orders_user", columns: ["user_id"], referencedTable: "users", referencedColumns: ["id"] });
    const edited = fk({ id: "1", name: "fk_orders_user", columns: ["user_id"], referencedTable: "users", referencedColumns: ["id"], onDelete: "CASCADE" });
    const ops = diffForeignKeys([original], [edited]);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({ kind: "dropFk", name: "fk_orders_user" });
    expect(ops[1]).toEqual({ kind: "addFk", fk: edited });
  });

  it("handles mixed add, drop, and change in one call", () => {
    const keepUnchanged = fk({ id: "keep", name: "fk_keep", columns: ["a"], referencedTable: "t1", referencedColumns: ["id"] });
    const toRemove = fk({ id: "remove", name: "fk_remove", columns: ["b"], referencedTable: "t2", referencedColumns: ["id"] });
    const changedOrig = fk({ id: "change", name: "fk_change", columns: ["c"], referencedTable: "t3", referencedColumns: ["id"] });
    const changedEdit = fk({ id: "change", name: "fk_change_renamed", columns: ["c"], referencedTable: "t3", referencedColumns: ["id"] });
    const toAdd = fk({ id: "add", name: "fk_add", columns: ["d"], referencedTable: "t4", referencedColumns: ["id"] });

    const ops = diffForeignKeys(
      [keepUnchanged, toRemove, changedOrig],
      [keepUnchanged, changedEdit, toAdd],
    );

    // Should have: drop(toRemove), drop(changedOrig)+add(changedEdit), add(toAdd)
    expect(ops.find((o) => o.kind === "dropFk" && o.name === "fk_remove")).toBeTruthy();
    expect(ops.find((o) => o.kind === "dropFk" && o.name === "fk_change")).toBeTruthy();
    expect(ops.find((o) => o.kind === "addFk" && o.fk.name === "fk_change_renamed")).toBeTruthy();
    expect(ops.find((o) => o.kind === "addFk" && o.fk.name === "fk_add")).toBeTruthy();
    // unchanged FK emits nothing
    expect(ops.find((o) => o.kind === "addFk" && o.fk.name === "fk_keep")).toBeFalsy();
    expect(ops.find((o) => o.kind === "dropFk" && o.name === "fk_keep")).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// buildForeignKeyStatements — ADD
// ---------------------------------------------------------------------------

describe("buildForeignKeyStatements — ADD", () => {
  it("MySQL: single column FK with ON DELETE CASCADE + ON UPDATE NO ACTION", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({
        id: "1",
        name: "fk_orders_user",
        columns: ["user_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
      }),
    };
    const stmts = buildForeignKeyStatements("mysql", null, "orders", [op]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(
      "ALTER TABLE `orders` ADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;",
    );
    expect(stmts[0].params).toEqual([]);
  });

  it("Postgres: single column FK with ON DELETE CASCADE + ON UPDATE NO ACTION", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({
        id: "1",
        name: "fk_orders_user",
        columns: ["user_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
      }),
    };
    const stmts = buildForeignKeyStatements("postgres", null, "orders", [op]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(
      'ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;',
    );
    expect(stmts[0].params).toEqual([]);
  });

  it("multi-column FK (MySQL)", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({
        id: "2",
        name: "fk_multi",
        columns: ["tenant_id", "user_id"],
        referencedTable: "users",
        referencedColumns: ["tenant_id", "id"],
      }),
    };
    const stmts = buildForeignKeyStatements("mysql", null, "orders", [op]);
    expect(stmts[0].sql).toBe(
      "ALTER TABLE `orders` ADD CONSTRAINT `fk_multi` FOREIGN KEY (`tenant_id`, `user_id`) REFERENCES `users` (`tenant_id`, `id`);",
    );
  });

  it("schema-qualified owning table + schema-qualified ref table (MySQL)", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({
        id: "3",
        name: "fk_cross_schema",
        columns: ["user_id"],
        referencedTable: "users",
        referencedSchema: "auth",
        referencedColumns: ["id"],
      }),
    };
    const stmts = buildForeignKeyStatements("mysql", "sales", "orders", [op]);
    expect(stmts[0].sql).toBe(
      "ALTER TABLE `sales`.`orders` ADD CONSTRAINT `fk_cross_schema` FOREIGN KEY (`user_id`) REFERENCES `auth`.`users` (`id`);",
    );
  });

  it("cross-schema REFERENCES: referencedSchema overrides the owning schema (Postgres)", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({
        id: "x",
        name: "fk_cross",
        columns: ["user_id"],
        referencedTable: "users",
        referencedSchema: "auth",
        referencedColumns: ["id"],
      }),
    };
    const stmts = buildForeignKeyStatements("postgres", "sales", "orders", [op]);
    expect(stmts[0].sql).toBe(
      'ALTER TABLE "sales"."orders" ADD CONSTRAINT "fk_cross" FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id");',
    );
  });

  it("cross-schema REFERENCES works even when the owning table has no schema (MySQL)", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({
        id: "y",
        name: "fk_cross2",
        columns: ["acct_id"],
        referencedTable: "accounts",
        referencedSchema: "ledger",
        referencedColumns: ["id"],
      }),
    };
    const stmts = buildForeignKeyStatements("mysql", null, "orders", [op]);
    expect(stmts[0].sql).toBe(
      "ALTER TABLE `orders` ADD CONSTRAINT `fk_cross2` FOREIGN KEY (`acct_id`) REFERENCES `ledger`.`accounts` (`id`);",
    );
  });

  it("schema-qualified owning table; ref table inherits owning schema when referencedSchema is null (Postgres)", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({
        id: "4",
        name: "fk_same_schema",
        columns: ["user_id"],
        referencedTable: "users",
        referencedSchema: null,
        referencedColumns: ["id"],
      }),
    };
    const stmts = buildForeignKeyStatements("postgres", "myschema", "orders", [op]);
    expect(stmts[0].sql).toBe(
      'ALTER TABLE "myschema"."orders" ADD CONSTRAINT "fk_same_schema" FOREIGN KEY ("user_id") REFERENCES "myschema"."users" ("id");',
    );
  });

  it("omits ON DELETE / ON UPDATE clauses when both are null", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({
        id: "5",
        name: "fk_no_actions",
        columns: ["cat_id"],
        referencedTable: "categories",
        referencedColumns: ["id"],
      }),
    };
    const stmts = buildForeignKeyStatements("postgres", null, "products", [op]);
    expect(stmts[0].sql).toBe(
      'ALTER TABLE "products" ADD CONSTRAINT "fk_no_actions" FOREIGN KEY ("cat_id") REFERENCES "categories" ("id");',
    );
  });
});

// ---------------------------------------------------------------------------
// buildForeignKeyStatements — SQL Server (T-SQL) ADD
// ---------------------------------------------------------------------------

describe("buildForeignKeyStatements — SQL Server ADD", () => {
  it("brackets identifiers and emits ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({
        id: "1",
        name: "fk_orders_user",
        columns: ["user_id"],
        referencedTable: "users",
        referencedColumns: ["id"],
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
      }),
    };
    const stmts = buildForeignKeyStatements("sqlserver", null, "orders", [op]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(
      "ALTER TABLE [orders] ADD CONSTRAINT [fk_orders_user] FOREIGN KEY ([user_id]) REFERENCES [users] ([id]) ON DELETE CASCADE ON UPDATE NO ACTION;",
    );
    expect(stmts[0].params).toEqual([]);
  });

  it("cross-schema REFERENCES with bracket quoting", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({
        id: "2",
        name: "fk_cross",
        columns: ["user_id"],
        referencedTable: "users",
        referencedSchema: "auth",
        referencedColumns: ["id"],
      }),
    };
    const stmts = buildForeignKeyStatements("sqlserver", "dbo", "orders", [op]);
    expect(stmts[0].sql).toBe(
      "ALTER TABLE [dbo].[orders] ADD CONSTRAINT [fk_cross] FOREIGN KEY ([user_id]) REFERENCES [auth].[users] ([id]);",
    );
  });
});

// ---------------------------------------------------------------------------
// buildForeignKeyStatements — DROP
// ---------------------------------------------------------------------------

describe("buildForeignKeyStatements — DROP", () => {
  it("MySQL: DROP FOREIGN KEY", () => {
    const op: FkOp = { kind: "dropFk", name: "fk_orders_user" };
    const stmts = buildForeignKeyStatements("mysql", null, "orders", [op]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(
      "ALTER TABLE `orders` DROP FOREIGN KEY `fk_orders_user`;",
    );
    expect(stmts[0].params).toEqual([]);
  });

  it("Postgres: DROP CONSTRAINT", () => {
    const op: FkOp = { kind: "dropFk", name: "fk_orders_user" };
    const stmts = buildForeignKeyStatements("postgres", null, "orders", [op]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe(
      'ALTER TABLE "orders" DROP CONSTRAINT "fk_orders_user";',
    );
    expect(stmts[0].params).toEqual([]);
  });

  it("MySQL DROP with schema-qualified table", () => {
    const op: FkOp = { kind: "dropFk", name: "fk_orders_user" };
    const stmts = buildForeignKeyStatements("mysql", "sales", "orders", [op]);
    expect(stmts[0].sql).toBe(
      "ALTER TABLE `sales`.`orders` DROP FOREIGN KEY `fk_orders_user`;",
    );
  });

  it("Postgres DROP with schema-qualified table", () => {
    const op: FkOp = { kind: "dropFk", name: "fk_orders_user" };
    const stmts = buildForeignKeyStatements("postgres", "sales", "orders", [op]);
    expect(stmts[0].sql).toBe(
      'ALTER TABLE "sales"."orders" DROP CONSTRAINT "fk_orders_user";',
    );
  });

  it("SQL Server: DROP CONSTRAINT", () => {
    const op: FkOp = { kind: "dropFk", name: "fk_orders_user" };
    const stmts = buildForeignKeyStatements("sqlserver", null, "orders", [op]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toBe("ALTER TABLE [orders] DROP CONSTRAINT [fk_orders_user];");
    expect(stmts[0].params).toEqual([]);
  });

  it("SQL Server DROP with schema-qualified table", () => {
    const op: FkOp = { kind: "dropFk", name: "fk_orders_user" };
    const stmts = buildForeignKeyStatements("sqlserver", "dbo", "orders", [op]);
    expect(stmts[0].sql).toBe("ALTER TABLE [dbo].[orders] DROP CONSTRAINT [fk_orders_user];");
  });
});

// ---------------------------------------------------------------------------
// buildForeignKeyStatements — SQLite
// ---------------------------------------------------------------------------

describe("buildForeignKeyStatements — SQLite", () => {
  it("returns empty array for addFk", () => {
    const op: FkOp = {
      kind: "addFk",
      fk: fk({ id: "1", name: "fk_x", columns: ["a"], referencedTable: "t", referencedColumns: ["id"] }),
    };
    expect(buildForeignKeyStatements("sqlite", null, "orders", [op])).toEqual([]);
  });

  it("returns empty array for dropFk", () => {
    const op: FkOp = { kind: "dropFk", name: "fk_x" };
    expect(buildForeignKeyStatements("sqlite", null, "orders", [op])).toEqual([]);
  });

  it("returns empty array for mixed ops", () => {
    const addOp: FkOp = {
      kind: "addFk",
      fk: fk({ id: "1", name: "fk_x", columns: ["a"], referencedTable: "t", referencedColumns: ["id"] }),
    };
    const dropOp: FkOp = { kind: "dropFk", name: "fk_y" };
    expect(buildForeignKeyStatements("sqlite", null, "orders", [addOp, dropOp])).toEqual([]);
  });
});
