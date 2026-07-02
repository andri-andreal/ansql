// Test fixtures — minimal, valid domain objects with sensible defaults that any
// test can override per-field. Keep these in sync with the types in ../types.

import type {
  ColumnDefinition,
  Connection,
  ForeignKeyInfo,
  IndexInfo,
  QueryResult,
  TableInfo,
} from "../types";

export function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    name: "Local MySQL",
    driver: "mysql",
    host: "localhost",
    port: 3306,
    database: "test",
    username: "root",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeTable(overrides: Partial<TableInfo> = {}): TableInfo {
  return {
    name: "users",
    schema: undefined,
    table_type: "table",
    row_count: 0,
    ...overrides,
  };
}

export function makeColumn(overrides: Partial<ColumnDefinition> = {}): ColumnDefinition {
  return {
    name: "id",
    data_type: "int",
    full_type: "int",
    nullable: false,
    default_value: undefined,
    is_primary_key: true,
    is_unique: false,
    is_auto_increment: true,
    comment: undefined,
    ...overrides,
  };
}

export function makeIndex(overrides: Partial<IndexInfo> = {}): IndexInfo {
  return {
    name: "PRIMARY",
    columns: ["id"],
    is_unique: true,
    is_primary: true,
    type: "BTREE",
    ...overrides,
  };
}

export function makeForeignKey(overrides: Partial<ForeignKeyInfo> = {}): ForeignKeyInfo {
  return {
    name: "fk_users_org",
    columns: ["org_id"],
    referenced_table: "orgs",
    referenced_columns: ["id"],
    on_delete: undefined,
    on_update: undefined,
    ...overrides,
  };
}

export function makeQueryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: [{ name: "id", data_type: "int", nullable: false }],
    rows: [{ id: 1 }],
    affected_rows: undefined,
    execution_time_ms: 1,
    ...overrides,
  };
}
