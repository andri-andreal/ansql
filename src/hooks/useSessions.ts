import { useState, useCallback } from "react";
import { sessionCommands, databaseCommands, queryCommands } from "../lib/tauri-commands";
import type { Connection, SessionInfo, DatabaseInfo, TableInfo, ColumnDefinition, IndexInfo, ForeignKeyInfo, TableGraph, Statement } from "../types";

export interface Session {
  info: SessionInfo;
  databases?: DatabaseInfo[];
  isLoadingDatabases?: boolean;
}

export function useSessions() {
  const [sessions, setSessions] = useState<Map<string, Session>>(new Map());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (connection: Connection) => {
    setError(null);
    setConnecting(connection.id);
    try {
      const sessionInfo = await sessionCommands.connect(connection.id, connection.database);
      const session: Session = { info: sessionInfo, isLoadingDatabases: true };

      setSessions((prev) => {
        const next = new Map(prev);
        next.set(sessionInfo.id, session);
        return next;
      });
      setActiveSessionId(sessionInfo.id);

      // Load databases after connecting
      try {
        const databases = await databaseCommands.getDatabases(sessionInfo.id);
        setSessions((prev) => {
          const next = new Map(prev);
          const existing = next.get(sessionInfo.id);
          if (existing) {
            next.set(sessionInfo.id, {
              ...existing,
              databases: databases.map((name) => ({ name })),
              isLoadingDatabases: false,
            });
          }
          return next;
        });
      } catch (err) {
        console.error("Failed to load databases:", err);
        setSessions((prev) => {
          const next = new Map(prev);
          const existing = next.get(sessionInfo.id);
          if (existing) {
            next.set(sessionInfo.id, { ...existing, isLoadingDatabases: false });
          }
          return next;
        });
      }

      return sessionInfo;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      throw err;
    } finally {
      setConnecting(null);
    }
  }, []);

  const disconnect = useCallback(async (sessionId: string) => {
    setError(null);
    try {
      await sessionCommands.disconnect(sessionId);
      setSessions((prev) => {
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      throw err;
    }
  }, [activeSessionId]);

  const getTables = useCallback(async (sessionId: string, database: string, schema?: string): Promise<TableInfo[]> => {
    try {
      return await databaseCommands.getTables(sessionId, database, schema);
    } catch (err) {
      console.error("Failed to get tables:", err);
      return [];
    }
  }, []);

  const getColumns = useCallback(async (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ): Promise<ColumnDefinition[]> => {
    try {
      return await databaseCommands.getColumns(sessionId, database, table, schema);
    } catch (err) {
      console.error("Failed to get columns:", err);
      return [];
    }
  }, []);

  const getViewDefinition = useCallback(async (
    sessionId: string,
    database: string,
    view: string,
    schema?: string
  ): Promise<string> => {
    try {
      return await databaseCommands.getViewDefinition(sessionId, database, view, schema);
    } catch (err) {
      console.error("Failed to get view definition:", err);
      return "";
    }
  }, []);

  const getIndexes = useCallback(async (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ): Promise<IndexInfo[]> => {
    try {
      return await databaseCommands.getIndexes(sessionId, database, table, schema);
    } catch (err) {
      console.error("Failed to get indexes:", err);
      return [];
    }
  }, []);

  const getForeignKeys = useCallback(async (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ): Promise<ForeignKeyInfo[]> => {
    try {
      return await databaseCommands.getForeignKeys(sessionId, database, table, schema);
    } catch (err) {
      console.error("Failed to get foreign keys:", err);
      return [];
    }
  }, []);

  /** Batched columns+FKs for many tables in one call — drives the ER diagram
   * without the per-table N+1 fan-out. Returns [] on failure (callers degrade). */
  const getSchemaGraph = useCallback(async (
    sessionId: string,
    database: string,
    tables: string[],
    schema?: string
  ): Promise<TableGraph[]> => {
    try {
      return await databaseCommands.getSchemaGraph(sessionId, database, tables, schema);
    } catch (err) {
      console.error("Failed to get schema graph:", err);
      return [];
    }
  }, []);

  const getSession = useCallback((sessionId: string) => {
    return sessions.get(sessionId);
  }, [sessions]);

  const getActiveSession = useCallback(() => {
    if (!activeSessionId) return null;
    return sessions.get(activeSessionId) || null;
  }, [activeSessionId, sessions]);

  const getDatabases = useCallback(async (sessionId: string): Promise<string[]> => {
    try {
      return await databaseCommands.getDatabases(sessionId);
    } catch (err) {
      console.error("Failed to get databases:", err);
      return [];
    }
  }, []);

  const setActiveSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const executeQuery = useCallback(async (sessionId: string, query: string) => {
    try {
      return await queryCommands.executeQuery(sessionId, query);
    } catch (err) {
      console.error("Failed to execute query:", err);
      throw err;
    }
  }, []);

  const commitChanges = useCallback(async (sessionId: string, statements: Statement[]) => {
    try {
      return await queryCommands.commitChanges(sessionId, statements);
    } catch (err) {
      console.error("Failed to commit changes:", err);
      throw err;
    }
  }, []);

  return {
    sessions,
    activeSessionId,
    activeSession: getActiveSession(),
    connecting,
    error,
    connect,
    disconnect,
    getTables,
    getDatabases,
    getColumns,
    getViewDefinition,
    getIndexes,
    getForeignKeys,
    getSchemaGraph,
    getSession,
    setActiveSession,
    setActiveSessionId,
    executeQuery,
    commitChanges,
  };
}
