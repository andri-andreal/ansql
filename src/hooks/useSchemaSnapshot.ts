import { useCallback, useRef, useState } from "react";
import type { SchemaSnapshot, TableSnapshot } from "../lib/schemaDiff";
import type {
  ColumnDefinition,
  Dialect,
  ForeignKeyInfo,
  IndexInfo,
  TableGraph,
  TableInfo,
} from "../types";

export interface FetchSnapshotArgs {
  sessionId: string;
  database: string;
  schema?: string | null;
  dialect: Dialect;
  getTables: (s: string, db: string, schema?: string) => Promise<TableInfo[]>;
  getColumns: (s: string, db: string, t: string, schema?: string) => Promise<ColumnDefinition[]>;
  getIndexes: (s: string, db: string, t: string, schema?: string) => Promise<IndexInfo[]>;
  getForeignKeys: (
    s: string,
    db: string,
    t: string,
    schema?: string
  ) => Promise<ForeignKeyInfo[]>;
  /** Optional batched introspection (columns+indexes+FKs for many tables in one
   * call). When provided, used instead of the per-table fan-out — this is what
   * keeps Structure Sync "Compare" fast on large schemas. Falls back to the
   * per-table path when absent or when it returns nothing. */
  getSchemaGraph?: (
    s: string,
    db: string,
    tables: string[],
    schema?: string
  ) => Promise<TableGraph[]>;
}

/**
 * Fetch a full {@link SchemaSnapshot} for a session's database/schema.
 *
 * Pulls base tables (skipping views), then fans out per table over
 * columns/indexes/foreign keys in parallel and assembles the snapshot.
 */
export async function fetchSchemaSnapshot(args: FetchSnapshotArgs): Promise<SchemaSnapshot> {
  const {
    sessionId,
    database,
    schema,
    dialect,
    getTables,
    getColumns,
    getIndexes,
    getForeignKeys,
    getSchemaGraph,
  } = args;

  const schemaArg = schema ?? undefined;

  const allTables = await getTables(sessionId, database, schemaArg);
  // Base tables only — drop views.
  const baseTables = allTables.filter((t) => t.table_type !== "view");

  // Fast path: one batched call for columns+indexes+FKs across all tables
  // (avoids the per-table N+1 that makes Structure Sync "Compare" hang on large
  // schemas). Falls back to the per-table fan-out when unavailable/empty.
  let tables: TableSnapshot[] | null = null;
  if (getSchemaGraph) {
    const graph = await getSchemaGraph(
      sessionId,
      database,
      baseTables.map((t) => t.name),
      schemaArg
    );
    if (graph.length > 0) {
      const byName = new Map(graph.map((g) => [g.name, g]));
      tables = baseTables.map((t) => {
        const g = byName.get(t.name);
        return {
          name: t.name,
          schema: (t.schema ?? schemaArg) ?? null,
          columns: g?.columns ?? [],
          indexes: g?.indexes ?? [],
          foreignKeys: g?.foreign_keys ?? [],
        };
      });
    }
  }

  if (!tables) {
    tables = await Promise.all(
      baseTables.map(async (t) => {
        const tableSchema = t.schema ?? schemaArg;
        const [columns, indexes, foreignKeys] = await Promise.all([
          getColumns(sessionId, database, t.name, tableSchema),
          getIndexes(sessionId, database, t.name, tableSchema),
          getForeignKeys(sessionId, database, t.name, tableSchema),
        ]);
        return {
          name: t.name,
          schema: tableSchema ?? null,
          columns,
          indexes,
          foreignKeys,
        };
      })
    );
  }

  return { dialect, database, schema: schema ?? null, tables };
}

export interface UseSchemaSnapshotResult {
  snapshot: SchemaSnapshot | null;
  loading: boolean;
  error: string | null;
  load: (args: FetchSnapshotArgs) => Promise<SchemaSnapshot | null>;
  reset: () => void;
}

/**
 * Thin hook around {@link fetchSchemaSnapshot} with loading/error state and a
 * latest-wins guard so a stale load can't clobber a newer one.
 */
export function useSchemaSnapshot(): UseSchemaSnapshotResult {
  const [snapshot, setSnapshot] = useState<SchemaSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest-wins guard: only the most recent load may update state.
  const runRef = useRef(0);

  const load = useCallback(
    async (args: FetchSnapshotArgs): Promise<SchemaSnapshot | null> => {
      const run = ++runRef.current;
      setLoading(true);
      setError(null);

      try {
        const result = await fetchSchemaSnapshot(args);
        if (run !== runRef.current) return null;
        setSnapshot(result);
        setLoading(false);
        return result;
      } catch (err) {
        if (run !== runRef.current) return null;
        setError(err instanceof Error ? err.message : String(err));
        setSnapshot(null);
        setLoading(false);
        return null;
      }
    },
    []
  );

  const reset = useCallback(() => {
    // Invalidate any in-flight load so it can't repopulate after reset.
    runRef.current++;
    setSnapshot(null);
    setError(null);
    setLoading(false);
  }, []);

  return { snapshot, loading, error, load, reset };
}
