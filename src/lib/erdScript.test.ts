import { describe, it, expect } from "vitest";
import { buildModelScript } from "./erdScript";
import { dumpHeader, type DumpTableInput } from "./dumpBuilder";
import type { ColumnDefinition } from "../types";

// ---------------------------------------------------------------------------
// Helper factories (mirror dumpBuilder.test.ts)
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

function table(
  overrides: Partial<DumpTableInput> & { table: string },
): DumpTableInput {
  return {
    schema: null,
    columns: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  };
}

describe("buildModelScript", () => {
  it("emits the header followed by each table's CREATE TABLE plus FK", () => {
    const tables: DumpTableInput[] = [
      table({
        table: "users",
        columns: [
          col({
            name: "id",
            data_type: "int",
            full_type: "int",
            is_primary_key: true,
            nullable: false,
          }),
          col({ name: "email", full_type: "varchar(255)", nullable: false }),
        ],
      }),
      table({
        table: "posts",
        columns: [
          col({
            name: "id",
            data_type: "int",
            full_type: "int",
            is_primary_key: true,
            nullable: false,
          }),
          col({
            name: "user_id",
            data_type: "int",
            full_type: "int",
            nullable: false,
          }),
        ],
        foreignKeys: [
          {
            name: "fk_posts_user",
            columns: ["user_id"],
            referenced_table: "users",
            referenced_columns: ["id"],
            on_delete: "CASCADE",
          },
        ],
      }),
    ];

    const script = buildModelScript("mysql", tables);

    // Header is present and leads the script.
    expect(script.startsWith(dumpHeader("mysql", "model"))).toBe(true);

    // Each table contributes its CREATE TABLE.
    expect(script).toContain("CREATE TABLE `users` (");
    expect(script).toContain("CREATE TABLE `posts` (");

    // The foreign key is forward-engineered via the reused dump builder.
    expect(script).toContain(
      "ALTER TABLE `posts` ADD CONSTRAINT `fk_posts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;",
    );

    // Blocks are blank-line separated.
    expect(script).toContain("\n\n");
  });

  it("returns just the header for an empty model", () => {
    const script = buildModelScript("postgres", []);
    expect(script).toBe(dumpHeader("postgres", "model"));
  });
});
