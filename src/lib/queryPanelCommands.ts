import { invoke } from "@tauri-apps/api/core";

/**
 * Backend-call wrappers used by the query module's History / Favorites /
 * autocomplete features.
 *
 * NOTE for integration: these intentionally live here (not in the shared
 * src/lib/tauri-commands.ts, which this module may not edit). The command names
 * below follow the issue spec (`save_favorite_query`, `get_favorite_queries`,
 * `delete_favorite_query`). The existing `favoriteCommands` in
 * src/lib/tauri-commands.ts instead targets `create_favorite` / `get_favorites`
 * / `delete_favorite`. Integration should reconcile to whatever the Rust side
 * actually exposes — either point these wrappers at the existing commands, or
 * register the spec'd command names on the backend.
 */

// --- Local types (defined here to avoid editing shared src/types/index.ts) ---

/** Mirror of the shared `QueryHistory` type (kept local for file ownership). */
export interface QueryHistoryEntry {
  id: string;
  connection_id: string;
  database?: string;
  query: string;
  execution_time_ms: number;
  row_count?: number;
  success: boolean;
  error_message?: string;
  created_at: string;
}

/** Mirror of the shared `FavoriteQuery` type (kept local for file ownership). */
export interface FavoriteQueryEntry {
  id: string;
  name: string;
  description?: string;
  connection_id?: string;
  database?: string;
  query: string;
  folder_id?: string;
  created_at: string;
  updated_at: string;
}

/** Minimal table shape needed by autocomplete (subset of shared `TableInfo`). */
export interface SchemaTable {
  name: string;
  schema?: string;
  table_type: string;
}

/** Minimal column shape needed by autocomplete (subset of `ColumnDefinition`). */
export interface SchemaColumn {
  name: string;
  data_type: string;
  full_type?: string | null;
  nullable: boolean;
  is_primary_key: boolean;
}

// --- History ---

export async function getQueryHistory(
  connectionId?: string,
  limit?: number
): Promise<QueryHistoryEntry[]> {
  return await invoke<QueryHistoryEntry[]>("get_query_history", {
    connectionId,
    limit,
  });
}

export async function clearQueryHistory(connectionId?: string): Promise<void> {
  return await invoke("clear_query_history", { connectionId });
}

// --- Favorites ---

export async function getFavoriteQueries(
  connectionId?: string
): Promise<FavoriteQueryEntry[]> {
  return await invoke<FavoriteQueryEntry[]>("get_favorite_queries", {
    connectionId,
  });
}

export async function saveFavoriteQuery(favorite: {
  name: string;
  description?: string;
  connection_id?: string;
  database?: string;
  query: string;
}): Promise<FavoriteQueryEntry> {
  return await invoke<FavoriteQueryEntry>("save_favorite_query", {
    name: favorite.name,
    description: favorite.description,
    connectionId: favorite.connection_id,
    // Backend command parameter is `database_name` (-> camelCase `databaseName`).
    databaseName: favorite.database,
    query: favorite.query,
  });
}

export async function deleteFavoriteQuery(id: string): Promise<void> {
  return await invoke("delete_favorite_query", { id });
}

// --- Schema (for autocomplete) ---

export async function getTables(
  sessionId: string,
  database: string,
  schema?: string
): Promise<SchemaTable[]> {
  return await invoke<SchemaTable[]>("get_tables", { sessionId, database, schema });
}

export async function getColumns(
  sessionId: string,
  database: string,
  table: string,
  schema?: string
): Promise<SchemaColumn[]> {
  return await invoke<SchemaColumn[]>("get_columns", {
    sessionId,
    database,
    table,
    schema,
  });
}
