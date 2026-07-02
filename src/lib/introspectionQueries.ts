import { invoke } from "@tauri-apps/api/core";

/**
 * Frontend wrappers for the backend's structural-introspection commands that
 * are NOT exposed through the higher-level hooks (useSessions / tauri-commands).
 *
 * These are the glue between the table-grid FK-dropdown bundle (which calls
 * {@link getFkLookup}) and the explorer's Triggers category (which calls
 * {@link getTriggers}) and the Rust commands registered in
 * `src-tauri/src/commands/session_commands.rs`.
 */

/** A database trigger (mirrors the backend `TriggerInfo` struct). */
export interface TriggerInfo {
  name: string;
  table: string;
  timing?: string | null;
  event?: string | null;
  statement: string;
  schema?: string | null;
}

/**
 * List triggers for a database (optionally scoped to a single table).
 * Backed by the `get_triggers` Tauri command.
 */
export async function getTriggers(
  sessionId: string,
  database: string,
  table?: string,
  schema?: string
): Promise<TriggerInfo[]> {
  return await invoke<TriggerInfo[]>("get_triggers", {
    sessionId,
    database,
    table,
    schema,
  });
}

export interface FkLookupArgs {
  sessionId: string;
  database: string;
  schema?: string;
  table: string;
  valueColumn: string;
  /** Columns to SELECT (value column first, then any label columns). */
  labelColumns: string[];
  search?: string;
  limit?: number;
}

/**
 * Fetch distinct (value, label...) rows from a referenced table for the
 * data-grid FK dropdown. Backed by the `get_fk_lookup` Tauri command.
 */
export async function getFkLookup(
  args: FkLookupArgs
): Promise<Record<string, unknown>[]> {
  return await invoke<Record<string, unknown>[]>("get_fk_lookup", {
    sessionId: args.sessionId,
    database: args.database,
    schema: args.schema,
    table: args.table,
    valueColumn: args.valueColumn,
    labelColumns: args.labelColumns,
    search: args.search,
    limit: args.limit,
  });
}
