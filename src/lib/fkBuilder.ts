/**
 * Foreign-key diff + statement builder for the Table Designer.
 *
 * Exports:
 * - FkOp            — discriminated union (addFk | dropFk)
 * - diffForeignKeys — id-based diff of DesignerForeignKey arrays → FkOp[]
 * - buildForeignKeyStatements — turns FkOp[] into dialect-correct Statement[]
 * - fkEditingSupported       — returns false for SQLite (no ALTER TABLE FK support)
 *
 * Design rules:
 * - Pure functions only — no React, no Tauri calls.
 * - Identifier quoting and schema-qualification delegate to alterBuilder helpers
 *   (quoteIdent from mutationBuilder; qualified is re-implemented here to avoid
 *   importing the private helper from alterBuilder).
 * - SQLite emits NOTHING for FK ops (sqlite cannot add/drop FKs via ALTER TABLE).
 * - A changed FK (same id, any field differs) = drop old + add new, mirroring
 *   how diffIndexes treats a changed index in alterBuilder.ts.
 */

import type { Dialect, Statement, DesignerForeignKey } from "../types";
import { quoteIdent } from "./mutationBuilder";

// ---------------------------------------------------------------------------
// FkOp discriminated union
// ---------------------------------------------------------------------------

export type FkOp =
  | { kind: "addFk"; fk: DesignerForeignKey }
  | { kind: "dropFk"; name: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Qualify a table name with optional schema, both quoted. */
function qualified(dialect: Dialect, schema: string | null, table: string): string {
  if (schema) {
    return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, table)}`;
  }
  return quoteIdent(dialect, table);
}

/** Returns true if every field of two DesignerForeignKey objects is equal. */
function fkEquals(a: DesignerForeignKey, b: DesignerForeignKey): boolean {
  return (
    a.name === b.name &&
    a.columns.length === b.columns.length &&
    a.columns.every((c, i) => c === b.columns[i]) &&
    a.referencedTable === b.referencedTable &&
    (a.referencedSchema ?? null) === (b.referencedSchema ?? null) &&
    a.referencedColumns.length === b.referencedColumns.length &&
    a.referencedColumns.every((c, i) => c === b.referencedColumns[i]) &&
    (a.onDelete ?? null) === (b.onDelete ?? null) &&
    (a.onUpdate ?? null) === (b.onUpdate ?? null)
  );
}

// ---------------------------------------------------------------------------
// diffForeignKeys
// ---------------------------------------------------------------------------

/**
 * Produce an FkOp[] from id-based FK diff.
 *
 * Rules (mirror diffIndexes in alterBuilder.ts):
 * - id in edited but not original → addFk
 * - id in original but not edited → dropFk (uses original name)
 * - same id, any field differs   → dropFk (old name) + addFk (new fk)
 * - same id, identical           → no op
 */
export function diffForeignKeys(
  original: DesignerForeignKey[],
  edited: DesignerForeignKey[],
): FkOp[] {
  const ops: FkOp[] = [];

  const origById = new Map(original.map((fk) => [fk.id, fk]));
  const editedById = new Map(edited.map((fk) => [fk.id, fk]));

  // Drops and drop+add for changed
  for (const orig of original) {
    const edit = editedById.get(orig.id);
    if (!edit) {
      // Removed entirely
      ops.push({ kind: "dropFk", name: orig.name });
    } else {
      // Present in both — check for changes
      if (!fkEquals(orig, edit)) {
        ops.push({ kind: "dropFk", name: orig.name });
        ops.push({ kind: "addFk", fk: edit });
      }
    }
  }

  // Adds: in edited but not in original
  for (const edit of edited) {
    if (!origById.has(edit.id)) {
      ops.push({ kind: "addFk", fk: edit });
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// fkEditingSupported
// ---------------------------------------------------------------------------

/**
 * Returns false for SQLite (no ALTER TABLE ADD/DROP FOREIGN KEY support).
 * The UI should disable the FK tab when this returns false.
 */
export function fkEditingSupported(dialect: Dialect): boolean {
  return dialect !== "sqlite";
}

// ---------------------------------------------------------------------------
// buildForeignKeyStatements
// ---------------------------------------------------------------------------

/**
 * Generate dialect-correct ALTER TABLE statements from FkOp[].
 *
 * Returns Statement[] (sql + params: []) compatible with commit_changes.
 *
 * ADD (MySQL + Postgres):
 *   ALTER TABLE <qualified-table> ADD CONSTRAINT <quoted-name>
 *     FOREIGN KEY (<quoted-cols>) REFERENCES <qualified-ref-table> (<quoted-ref-cols>)
 *     [ON DELETE <x>] [ON UPDATE <y>];
 *   The referenced table is qualified with referencedSchema if present,
 *   otherwise with the same schema as the owning table (mirrors the Rust
 *   generate_foreign_keys behaviour for same-schema transfers).
 *
 * DROP:
 *   MySQL              → ALTER TABLE <t> DROP FOREIGN KEY <name>;
 *   Postgres / SQL Server → ALTER TABLE <t> DROP CONSTRAINT <name>;
 *
 * SQLite: returns [] for every op — FK constraints cannot be added/dropped
 *   via ALTER TABLE in SQLite.
 */
export function buildForeignKeyStatements(
  dialect: Dialect,
  schema: string | null,
  table: string,
  ops: FkOp[],
): Statement[] {
  if (dialect === "sqlite") {
    return [];
  }

  const qualTable = qualified(dialect, schema, table);
  const stmts: Statement[] = [];

  for (const op of ops) {
    switch (op.kind) {
      case "addFk": {
        const { fk } = op;
        const cols = fk.columns.map((c) => quoteIdent(dialect, c)).join(", ");
        const refCols = fk.referencedColumns.map((c) => quoteIdent(dialect, c)).join(", ");
        // Resolve the referenced table's schema:
        // explicit referencedSchema wins; otherwise fall back to owning table's schema.
        const refSchema = (fk.referencedSchema ?? null) !== null ? fk.referencedSchema! : schema;
        const qualRef = qualified(dialect, refSchema, fk.referencedTable);
        let sql =
          `ALTER TABLE ${qualTable} ADD CONSTRAINT ${quoteIdent(dialect, fk.name)} ` +
          `FOREIGN KEY (${cols}) REFERENCES ${qualRef} (${refCols})`;
        if (fk.onDelete) {
          sql += ` ON DELETE ${fk.onDelete}`;
        }
        if (fk.onUpdate) {
          sql += ` ON UPDATE ${fk.onUpdate}`;
        }
        sql += ";";
        stmts.push({ sql, params: [] });
        break;
      }

      case "dropFk": {
        let sql: string;
        if (dialect === "mysql") {
          sql = `ALTER TABLE ${qualTable} DROP FOREIGN KEY ${quoteIdent(dialect, op.name)};`;
        } else {
          // postgres / sqlserver — both drop an FK by its constraint name.
          sql = `ALTER TABLE ${qualTable} DROP CONSTRAINT ${quoteIdent(dialect, op.name)};`;
        }
        stmts.push({ sql, params: [] });
        break;
      }
    }
  }

  return stmts;
}
