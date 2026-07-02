// useAppState — single source of truth for the app shell.
// Holds all UI state, the vault gate, AI dock, focus mode, modal state, and
// every "open / create / execute" handler. The components in src/components/shell
// consume this hook so that App.tsx stays a thin composition root.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import {
  connectionCommands,
  queryCommands,
  redisCommands,
  mongoCommands,
  vaultCommands,
} from "../lib/tauri-commands";
import type { ConnectionSecrets } from "../components/connection/ConnectionForm";
import { exportConnections, importConnections } from "../lib/connectionIO";
import { clipboardStore } from "../lib/clipboardStore";
import { quoteIdent } from "../lib/mutationBuilder";
import {
  getRoutineDefinitionQuery,
  type RoutineKind,
} from "../lib/routineBuilder";
import { getTriggers, type TriggerInfo } from "../lib/introspectionQueries";
import { buildAskAiMessages, buildSchemaSummary, type AskAiAction, type AskAiContext } from "../lib/aiPrompts";
import { resolveToolbarState, type MainView } from "../lib/toolbarState";
import { useTranslation } from "../i18n";
import { useDialogs } from "../components/ui";
import { useAiConfig } from "./useAiConfig";
import { useConnections } from "./useConnections";
import { useSessions } from "./useSessions";
import { useActionJournal, type ActionJournalApi } from "./useActionJournal";
import { useWorkspaceTabs } from "./useWorkspaceTabs";
import { useExport } from "./useExport";
import { useTheme } from "./useTheme";
import type { ExportFormat } from "../components/common/AppHeader";
import type { ExportTextOptions } from "../lib/exportFormats";
import type { AiMessage } from "../lib/aiProviders";
import type { InfoPaneTarget } from "../components/common/InfoPane";
import type { Connection, SessionInfo, SourceRef, TableInfo, QueryResult, Statement, Dialect } from "../types";
import { isSqlDriver, toDialect } from "../types";

// --- UI-only state container ---------------------------------------------

export interface AppState {
  // Theme
  theme: ReturnType<typeof useTheme>["theme"];
  toggleTheme: () => void;

  // Connections + sessions
  connections: ReturnType<typeof useConnections>["connections"];
  loadConnections: ReturnType<typeof useConnections>["loadConnections"];
  createConnection: ReturnType<typeof useConnections>["createConnection"];
  updateConnection: ReturnType<typeof useConnections>["updateConnection"];
  deleteConnection: ReturnType<typeof useConnections>["deleteConnection"];
  sessions: Map<string, { info: SessionInfo }>;
  sessionsList: SessionInfo[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  connect: (connection: Connection) => Promise<SessionInfo>;
  disconnect: (id: string) => Promise<void>;
  getTables: ReturnType<typeof useSessions>["getTables"];
  getDatabases: ReturnType<typeof useSessions>["getDatabases"];
  getColumns: ReturnType<typeof useSessions>["getColumns"];
  getIndexes: ReturnType<typeof useSessions>["getIndexes"];
  getForeignKeys: ReturnType<typeof useSessions>["getForeignKeys"];
  getSchemaGraph: ReturnType<typeof useSessions>["getSchemaGraph"];
  getViewDefinition: ReturnType<typeof useSessions>["getViewDefinition"];
  getTriggers: (sessionId: string, database: string, table: string, schema?: string) => Promise<TriggerInfo[]>;
  executeQuery: ReturnType<typeof useSessions>["executeQuery"];
  commitChanges: ReturnType<typeof useSessions>["commitChanges"];
  /** Time Machine: action journal + LIFO undo/redo over reversible mutations. */
  journal: ActionJournalApi;
  ensureSession: (
    connectionId: string,
    database?: string
  ) => Promise<{ sessionId: string; database: string | null } | undefined>;
  handleConnectionChange: (connectionId: string, database?: string) => Promise<void>;

  // Workspace tabs
  ws: ReturnType<typeof useWorkspaceTabs>;

  // Vault gate
  vaultLocked: boolean;
  vaultGateChecked: boolean;
  unlockError: string | null;
  unlockBusy: boolean;
  handleVaultUnlock: (password: string) => Promise<void>;
  handleVaultReset: () => Promise<void>;

  // Modals / drawers
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  /** Time Machine timeline panel visibility. */
  showTimeline: boolean;
  setShowTimeline: (v: boolean) => void;
  showConnectionForm: boolean;
  setShowConnectionForm: (v: boolean) => void;
  editingConnection: Connection | undefined;
  setEditingConnection: (c: Connection | undefined) => void;
  connectError: string | null;
  setConnectError: (msg: string | null) => void;
  transferState: {
    sourceSession: SessionInfo;
    sourceDatabase: string;
    sourceTables: TableInfo[];
    preselected: string[];
  } | null;
  setTransferState: (
    s: {
      sourceSession: SessionInfo;
      sourceDatabase: string;
      sourceTables: TableInfo[];
      preselected: string[];
    } | null
  ) => void;
  exportTextDialog: "csv" | "txt" | null;
  setExportTextDialog: (v: "csv" | "txt" | null) => void;
  userManager: { sessionId: string; dialect: Dialect } | null;
  setUserManager: (s: { sessionId: string; dialect: Dialect } | null) => void;
  backupState: {
    sessionId: string;
    database: string;
    schema: string | null;
    dialect: Dialect;
    tables: string[];
  } | null;
  setBackupState: (
    s: {
      sessionId: string;
      database: string;
      schema: string | null;
      dialect: Dialect;
      tables: string[];
    } | null
  ) => void;
  executeSqlFileState: { sessionId: string; title: string } | null;
  setExecuteSqlFileState: (s: { sessionId: string; title: string } | null) => void;
  tableRefresh: number;
  bumpTableRefresh: () => void;

  // Right docks
  showAi: boolean;
  setShowAi: React.Dispatch<React.SetStateAction<boolean>>;
  aiSeed: AiMessage[] | null;
  aiSeedKey: number;
  aiConfig: ReturnType<typeof useAiConfig>["config"];
  aiConfigured: boolean;
  showInfo: boolean;
  setShowInfo: React.Dispatch<React.SetStateAction<boolean>>;
  infoTarget: InfoPaneTarget | null;
  handleSelectObject: (target: InfoPaneTarget | null) => void;
  focusMode: boolean;
  setFocusMode: React.Dispatch<React.SetStateAction<boolean>>;

  // Active query result (for header Export)
  activeResult: QueryResult | null;
  setActiveResult: (r: QueryResult | null) => void;
  insertSqlRef: React.MutableRefObject<((sql: string) => void) | null>;

  // Toolbar capabilities
  canOpenRoutine: boolean;
  canManageUsers: boolean;
  toolbar: ReturnType<typeof resolveToolbarState>;
  mainView: MainView;

  // Open handlers (open tab)
  handleSelectTable: (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ) => void;
  handleEditTable: (
    sessionId: string,
    database: string,
    table: string,
    schema: string | null,
    whereSql: string | null
  ) => void;
  handleSelectTableList: (sessionId: string, database: string) => void;
  handleOpenErd: (sessionId: string, database: string, schema?: string) => void;
  handleOpenStructureSync: (sourceSessionId?: string, sourceDatabase?: string) => void;
  handleOpenDataSync: (sourceSessionId?: string, sourceDatabase?: string) => void;
  handleOpenServerMonitor: (sessionId: string) => void;
  handleOpenDashboards: () => void;
  handleNewQuery: (initialQuery?: string, connectionId?: string, database?: string) => Promise<void>;
  handleCopyTables: (sessionId: string, database: string, tabs: TableInfo[]) => void;
  handleTransferTables: (sessionId: string, database: string, tabs: TableInfo[]) => void;
  handleDeleteTables: (
    sessionId: string,
    database: string,
    tabs: TableInfo[],
    force: boolean
  ) => Promise<void>;
  handleNewTable: (sessionId: string, database: string, schema?: string) => void;
  handleEditStructure: (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ) => Promise<void>;
  handleNewView: (sessionId: string, database: string, schema?: string) => void;
  handleEditView: (
    sessionId: string,
    database: string,
    view: string,
    schema?: string
  ) => Promise<void>;
  handleNewRoutine: (
    sessionId: string,
    database: string,
    kind: RoutineKind,
    schema?: string
  ) => void;
  handleEditRoutine: (
    sessionId: string,
    database: string,
    name: string,
    kind: RoutineKind,
    schema?: string
  ) => Promise<void>;
  handleNewTrigger: (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ) => void;
  handleEditTrigger: (
    sessionId: string,
    database: string,
    trigger: TriggerInfo,
    schema?: string
  ) => void;
  handleNewEvent: (sessionId: string, database: string) => void;
  handleEditEvent: (
    sessionId: string,
    database: string,
    name: string,
    statement?: string
  ) => void;
  handleNewSequence: (sessionId: string, database: string, schema?: string) => void;
  handleEditSequence: (
    sessionId: string,
    database: string,
    name: string,
    schema?: string
  ) => void;
  handleNewMaterializedView: (sessionId: string, database: string, schema?: string) => void;

  // AI Assistant
  getSchemaContext: () => Promise<string | null>;
  handleAskAi: (action: AskAiAction, sql: string, ctx: AskAiContext) => void;
  handleInsertSqlFromAi: (sql: string) => void;
  handleRegisterInsertSql: (insert: ((sql: string) => void) | null) => void;

  // Users / roles
  handleOpenUsers: (sessionId: string) => void;

  // Backup / execute SQL
  handleOpenBackup: (sessionId: string, database: string, schema?: string) => Promise<void>;
  handleOpenExecuteSqlFile: (sessionId: string, title?: string) => void;
  commitChangesForModal: (
    sessionId: string,
    statements: { sql: string; params: unknown[] }[]
  ) => Promise<unknown>;
  handleApplyDesigner: (statements: Statement[], sessionId: string) => Promise<void>;

  // Connection CRUD (for header / dialog)
  handleSaveConnection: (
    connection: Omit<Connection, "id" | "created_at" | "updated_at">,
    secrets?: ConnectionSecrets
  ) => Promise<void>;
  handleEditConnection: (connection: Connection) => void;
  handleTest: (
    connection: Omit<Connection, "id" | "created_at" | "updated_at"> & ConnectionSecrets
  ) => Promise<boolean>;
  handleConnect: (connection: Connection) => Promise<SessionInfo>;
  handleOpenRedis: (connection: Connection) => Promise<void>;
  handleOpenMongo: (connection: Connection) => Promise<void>;
  handleExportConnections: () => Promise<void>;
  handleImportConnections: () => Promise<void>;

  // Header export
  handleHeaderExport: (format: ExportFormat) => Promise<void>;
  handleExportTextConfirm: (options: ExportTextOptions) => Promise<void>;

  // Query execution with request id (for cancellation)
  executeQueryWithRequestId: (sessionId: string, sql: string, requestId: string) => Promise<QueryResult>;
  cancelQueryById: (requestId: string) => Promise<void>;

  // Derived (active session / connection)
  activeSession: SessionInfo | null;
  activeConnection: Connection | undefined;
}

export function useAppState(): AppState {
  const { t } = useTranslation();
  const dialogs = useDialogs();
  const { theme, toggleTheme } = useTheme();
  const { config: aiConfig, isConfigured: aiConfigured } = useAiConfig();

  // --- Connections & sessions --------------------------------------------
  const {
    connections,
    loadConnections,
    createConnection,
    updateConnection,
    deleteConnection,
  } = useConnections();

  const {
    sessions,
    activeSessionId,
    connect,
    disconnect,
    getTables,
    getDatabases,
    getColumns,
    getIndexes,
    getForeignKeys,
    getSchemaGraph,
    getViewDefinition,
    executeQuery,
    commitChanges,
    setActiveSessionId,
  } = useSessions();

  const sessionsList: SessionInfo[] = useMemo(
    () => Array.from(sessions.values()).map((s) => s.info),
    [sessions]
  );

  // Time Machine: resolve a live session for an entry's connection, preferring
  // one on the same database, falling back to any session on that connection.
  const resolveSessionId = useCallback(
    (connectionId: string | undefined, database: string | undefined): string | null => {
      if (!connectionId) return null;
      let fallback: string | null = null;
      for (const [id, s] of sessions) {
        if (s.info.connection_id !== connectionId) continue;
        if (!database || s.info.database === database) return id;
        fallback = id;
      }
      return fallback;
    },
    [sessions]
  );

  const journal = useActionJournal({ commitChanges, resolveSessionId });

  // Load the most recent journal entries once on startup.
  useEffect(() => {
    void journal.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Triggers aren't surfaced through useSessions (they're per-table); expose
  // a thin wrapper that calls the introspection query directly.
  const getTriggersForTable = useCallback(
    (sessionId: string, database: string, table: string, schema?: string) =>
      getTriggers(sessionId, database, table, schema),
    []
  );

  const ws = useWorkspaceTabs();

  // --- Modals / drawers ---------------------------------------------------
  const [showSettings, setShowSettings] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | undefined>();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [transferState, setTransferState] = useState<AppState["transferState"]>(null);
  const [exportTextDialog, setExportTextDialog] = useState<"csv" | "txt" | null>(null);
  const [userManager, setUserManager] = useState<AppState["userManager"]>(null);
  const [backupState, setBackupState] = useState<AppState["backupState"]>(null);
  const [executeSqlFileState, setExecuteSqlFileState] = useState<AppState["executeSqlFileState"]>(null);
  const [tableRefresh, setTableRefresh] = useState(0);
  const bumpTableRefresh = useCallback(() => setTableRefresh((n) => n + 1), []);

  // --- Right docks --------------------------------------------------------
  const [showAi, setShowAi] = useState(false);
  const [aiSeed, setAiSeed] = useState<AiMessage[] | null>(null);
  const [aiSeedKey, setAiSeedKey] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [infoTarget, setInfoTarget] = useState<InfoPaneTarget | null>(null);
  const [focusMode, setFocusMode] = useState(false);

  // --- Active query result + AI insert bridge ----------------------------
  const [activeResult, setActiveResult] = useState<QueryResult | null>(null);
  const insertSqlRef = useRef<((sql: string) => void) | null>(null);

  // --- Vault gate ---------------------------------------------------------
  const [vaultLocked, setVaultLocked] = useState(false);
  const [vaultGateChecked, setVaultGateChecked] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mode = await vaultCommands.vaultMode();
        const locked = mode === "master" ? await vaultCommands.isVaultLocked() : false;
        if (!cancelled) setVaultLocked(locked);
      } catch (err) {
        console.error("Vault mode check failed:", err);
      } finally {
        if (!cancelled) setVaultGateChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleVaultUnlock = useCallback(
    async (password: string) => {
      setUnlockBusy(true);
      setUnlockError(null);
      try {
        const ok = await vaultCommands.unlockVault(password);
        if (!ok) {
          setUnlockError(t("shell.incorrectMasterPassword"));
          return;
        }
        const stillLocked = await vaultCommands.isVaultLocked();
        if (stillLocked) {
          setUnlockError(t("shell.incorrectMasterPassword"));
          return;
        }
        setVaultLocked(false);
      } catch (err) {
        setUnlockError(err instanceof Error ? err.message : String(err));
      } finally {
        setUnlockBusy(false);
      }
    },
    [t]
  );

  const handleVaultReset = useCallback(async () => {
    const confirmed = await dialogs.confirm({ title: t("shell.resetVaultConfirm"), danger: true });
    if (!confirmed) return;
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      await vaultCommands.resetVault();
      setVaultLocked(false);
      await loadConnections();
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnlockBusy(false);
    }
  }, [dialogs, loadConnections, t]);

  // --- Session resolution -------------------------------------------------
  const ensureSession = useCallback(
    async (
      connectionId: string,
      database?: string
    ): Promise<{ sessionId: string; database: string | null } | undefined> => {
      const connection = connections.find((c) => c.id === connectionId);
      if (!connection) return undefined;
      const existing = Array.from(sessions.values())
        .map((s) => s.info)
        .find((s) => s.connection_id === connectionId && s.database === database);
      if (existing) {
        setActiveSessionId(existing.id);
        return { sessionId: existing.id, database: existing.database ?? null };
      }
      try {
        const connectionWithDb = { ...connection, database };
        const info = await connect(connectionWithDb);
        return { sessionId: info.id, database: info.database ?? null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setConnectError(t("shell.failedToConnect", { name: connection.name, message: msg }));
        return undefined;
      }
    },
    [connections, sessions, connect, setActiveSessionId, t]
  );

  const handleConnectionChange = useCallback(
    async (connectionId: string, database?: string) => {
      await ensureSession(connectionId, database);
    },
    [ensureSession]
  );

  // --- requestId-aware query exec (for cancellation) ---------------------
  const executeQueryWithRequestId = useCallback(
    (sessionId: string, sql: string, requestId: string) =>
      queryCommands.executeQuery(sessionId, sql, requestId),
    []
  );
  const cancelQueryById = useCallback(
    (requestId: string) => queryCommands.cancelQuery(requestId),
    []
  );

  // --- Dialect resolution -------------------------------------------------
  const dialectOf = useCallback(
    (sessionId: string): Dialect | null => {
      const session = sessionsList.find((s) => s.id === sessionId);
      const conn = session ? connections.find((c) => c.id === session.connection_id) : undefined;
      return conn && isSqlDriver(conn.driver) ? toDialect(conn.driver) : null;
    },
    [sessionsList, connections]
  );

  // --- Active session / connection ---------------------------------------
  const activeSession = sessionsList.find((s) => s.id === activeSessionId) ?? null;
  const activeConnection = activeSession
    ? connections.find((c) => c.id === activeSession.connection_id)
    : undefined;
  const canOpenRoutine = !!activeSession?.database && activeConnection?.driver !== "sqlite";
  const canManageUsers = !!activeSession && activeConnection?.driver !== "sqlite";

  // --- Open handlers (all funnel into ws.openTab) ------------------------
  const handleSelectTable = useCallback(
    (sessionId: string, database: string, table: string, schema?: string) => {
      const session = sessionsList.find((s) => s.id === sessionId);
      const connection = session
        ? connections.find((c) => c.id === session.connection_id)
        : undefined;
      ws.openTab({
        kind: "table",
        payload: {
          sessionId,
          connectionId: connection?.id ?? "",
          database,
          table,
          schema,
          driver: connection?.driver ?? "mysql",
          focus: "data",
        },
      });
    },
    [sessionsList, connections, ws]
  );

  const handleEditTable = useCallback(
    (
      sessionId: string,
      database: string,
      table: string,
      schema: string | null,
      whereSql: string | null
    ) => {
      const session = sessionsList.find((s) => s.id === sessionId);
      const connection = session
        ? connections.find((c) => c.id === session.connection_id)
        : undefined;
      ws.openTab({
        kind: "table",
        payload: {
          sessionId,
          connectionId: connection?.id ?? "",
          database,
          table,
          schema: schema ?? undefined,
          driver: connection?.driver ?? "mysql",
          focus: "data",
          initialWhereSql: whereSql ?? undefined,
        },
      });
    },
    [sessionsList, connections, ws]
  );

  const handleSelectTableList = useCallback(
    (sessionId: string, database: string) => {
      ws.openTab({ kind: "table-list", payload: { sessionId, database } });
    },
    [ws]
  );

  const handleOpenErd = useCallback(
    (sessionId: string, database: string, schema?: string) => {
      ws.openTab({ kind: "erd", payload: { sessionId, database, schema } });
    },
    [ws]
  );

  const handleOpenStructureSync = useCallback(
    (sourceSessionId?: string, sourceDatabase?: string) => {
      ws.openTab({
        kind: "structure-sync",
        payload: { sourceSessionId, sourceDatabase },
      });
    },
    [ws]
  );

  const handleOpenDataSync = useCallback(
    (sourceSessionId?: string, sourceDatabase?: string) => {
      ws.openTab({
        kind: "data-sync",
        payload: { sourceSessionId, sourceDatabase },
      });
    },
    [ws]
  );

  const handleOpenServerMonitor = useCallback(
    (sessionId: string) => {
      if (dialectOf(sessionId) === "sqlite") return;
      ws.openTab({ kind: "server-monitor", payload: { sessionId } });
    },
    [dialectOf, ws]
  );

  const handleOpenDashboards = useCallback(() => {
    ws.openTab({ kind: "dashboard", payload: {} });
  }, [ws]);

  const handleCopyTables = useCallback(
    (sessionId: string, database: string, selectedTabs: TableInfo[]) => {
      const session = sessionsList.find((s) => s.id === sessionId);
      const conn = session ? connections.find((c) => c.id === session.connection_id) : undefined;
      if (!session || !conn || selectedTabs.length === 0) return;
      const source: SourceRef = {
        sessionId: session.id,
        connectionId: conn.id,
        dbType: conn.driver,
        database,
        schema: null,
      };
      clipboardStore.set({
        kind: "table-ref",
        source,
        tables: selectedTabs.map((t) => ({ name: t.name, schema: t.schema ?? null })),
      });
    },
    [sessionsList, connections]
  );

  const handleTransferTables = useCallback(
    (sessionId: string, database: string, selectedTabs: TableInfo[]) => {
      const session = sessionsList.find((s) => s.id === sessionId);
      if (!session) return;
      const preselected = selectedTabs.map((t) => t.name);
      getTables(sessionId, database)
        .then((all) =>
          setTransferState({
            sourceSession: session,
            sourceDatabase: database,
            sourceTables: all.length ? all : selectedTabs,
            preselected,
          })
        )
        .catch(() =>
          setTransferState({
            sourceSession: session,
            sourceDatabase: database,
            sourceTables: selectedTabs,
            preselected,
          })
        );
    },
    [sessionsList, getTables]
  );

  const handleDeleteTables = useCallback(
    async (
      sessionId: string,
      database: string,
      selectedTabs: TableInfo[],
      force: boolean
    ) => {
      const session = sessionsList.find((s) => s.id === sessionId);
      const conn = session ? connections.find((c) => c.id === session.connection_id) : undefined;
      if (!session || !conn || selectedTabs.length === 0) return;
      const dialect = toDialect(conn.driver);
      const qualify = (t: TableInfo) =>
        dialect === "mysql"
          ? `${quoteIdent(dialect, database)}.${quoteIdent(dialect, t.name)}`
          : t.schema
            ? `${quoteIdent(dialect, t.schema)}.${quoteIdent(dialect, t.name)}`
            : quoteIdent(dialect, t.name);
      const cascade = force && dialect === "postgres" ? " CASCADE" : "";
      const failures: string[] = [];
      for (const t of selectedTabs) {
        const kind = (t.table_type ?? "").toLowerCase().includes("view") ? "VIEW" : "TABLE";
        try {
          await executeQuery(sessionId, `DROP ${kind} IF EXISTS ${qualify(t)}${cascade}`);
        } catch (err) {
          failures.push(`${t.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (failures.length > 0) throw new Error(failures.join("\n"));
    },
    [sessionsList, connections, executeQuery]
  );

  const handleNewTable = useCallback(
    (sessionId: string, database: string, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (!dialect) return;
      ws.openTab({
        kind: "table-designer",
        payload: { mode: "create", sessionId, database, schema, dialect },
      });
    },
    [dialectOf, ws]
  );

  const handleEditStructure = useCallback(
    async (sessionId: string, database: string, table: string, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (!dialect) return;
      const [originalColumns, originalIndexes, originalForeignKeys] = await Promise.all([
        getColumns(sessionId, database, table, schema),
        getIndexes(sessionId, database, table, schema),
        getForeignKeys(sessionId, database, table, schema),
      ]);
      if (originalColumns.length === 0) {
        setConnectError(t("shell.couldNotReadStructure", { table }));
        return;
      }
      ws.openTab({
        kind: "table-designer",
        payload: {
          mode: "alter",
          sessionId,
          database,
          schema,
          dialect,
          tableName: table,
          originalColumns,
          originalIndexes,
          originalForeignKeys,
        },
      });
    },
    [dialectOf, getColumns, getIndexes, getForeignKeys, ws, t]
  );

  const handleNewView = useCallback(
    (sessionId: string, database: string, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (!dialect) return;
      ws.openTab({
        kind: "view-designer",
        payload: { mode: "create", sessionId, database, schema, dialect },
      });
    },
    [dialectOf, ws]
  );

  const handleEditView = useCallback(
    async (sessionId: string, database: string, view: string, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (!dialect) return;
      const def = await getViewDefinition(sessionId, database, view, schema);
      let body = def;
      if (dialect === "sqlite") {
        const match = def.match(/^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?VIEW\b[\s\S]*?\bAS\b\s*([\s\S]*)$/i);
        if (match) body = match[1].trim();
      }
      ws.openTab({
        kind: "view-designer",
        payload: { mode: "edit", sessionId, database, schema, dialect, viewName: view, initialBody: body },
      });
    },
    [dialectOf, getViewDefinition, ws]
  );

  const handleNewRoutine = useCallback(
    (sessionId: string, database: string, kind: RoutineKind, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (!dialect || dialect === "sqlite") return;
      ws.openTab({
        kind: "routine-editor",
        payload: { mode: "create", sessionId, database, schema, dialect, kind },
      });
    },
    [dialectOf, ws]
  );

  const extractRoutineDefinition = (result: QueryResult, kind: RoutineKind): string => {
    const row = result.rows[0];
    if (!row) return "";
    const preferredKeys =
      kind === "procedure"
        ? ["Create Procedure", "definition", "pg_get_functiondef"]
        : ["Create Function", "definition", "pg_get_functiondef"];
    for (const key of preferredKeys) {
      const v = row[key];
      if (typeof v === "string" && v.trim() !== "") return v;
    }
    let best = "";
    for (const v of Object.values(row)) {
      if (typeof v === "string" && v.length > best.length) best = v;
    }
    return best;
  };

  const handleEditRoutine = useCallback(
    async (sessionId: string, database: string, name: string, kind: RoutineKind, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (!dialect || dialect === "sqlite") return;
      const qualifier = dialect === "mysql" ? database : schema;
      try {
        const sql = getRoutineDefinitionQuery(dialect, qualifier, name, kind);
        if (!sql) return;
        const result = await executeQuery(sessionId, sql);
        const def = extractRoutineDefinition(result, kind);
        if (!def) {
          setConnectError(t("shell.couldNotReadDefinition", { name }));
          return;
        }
        ws.openTab({
          kind: "routine-editor",
          payload: {
            mode: "edit",
            sessionId,
            database,
            schema,
            dialect,
            kind,
            routineName: name,
            initialBody: def,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setConnectError(t("shell.couldNotReadDefinitionDetail", { name, message: msg }));
      }
    },
    [dialectOf, executeQuery, ws, t]
  );

  const handleNewTrigger = useCallback(
    (sessionId: string, database: string, table: string, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (!dialect) return;
      ws.openTab({
        kind: "trigger-designer",
        payload: { mode: "create", sessionId, database, schema, dialect, table },
      });
    },
    [dialectOf, ws]
  );

  const handleEditTrigger = useCallback(
    (sessionId: string, database: string, trigger: TriggerInfo, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (!dialect) return;
      ws.openTab({
        kind: "trigger-designer",
        payload: {
          mode: "edit",
          sessionId,
          database,
          schema: schema ?? trigger.schema ?? undefined,
          dialect,
          table: trigger.table,
          existing: trigger,
        },
      });
    },
    [dialectOf, ws]
  );

  const handleNewEvent = useCallback(
    (sessionId: string, database: string) => {
      const dialect = dialectOf(sessionId);
      if (dialect !== "mysql") return;
      ws.openTab({
        kind: "event-designer",
        payload: { mode: "create", sessionId, database, dialect },
      });
    },
    [dialectOf, ws]
  );

  const handleEditEvent = useCallback(
    (sessionId: string, database: string, name: string, statement?: string) => {
      const dialect = dialectOf(sessionId);
      if (dialect !== "mysql") return;
      ws.openTab({
        kind: "event-designer",
        payload: {
          mode: "edit",
          sessionId,
          database,
          dialect,
          existing: { name, statement },
        },
      });
    },
    [dialectOf, ws]
  );

  const handleNewSequence = useCallback(
    (sessionId: string, database: string, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (dialect !== "postgres") return;
      ws.openTab({
        kind: "sequence-designer",
        payload: { mode: "create", sessionId, database, schema, dialect },
      });
    },
    [dialectOf, ws]
  );

  const handleEditSequence = useCallback(
    (sessionId: string, database: string, name: string, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (dialect !== "postgres") return;
      ws.openTab({
        kind: "sequence-designer",
        payload: {
          mode: "edit",
          sessionId,
          database,
          schema,
          dialect,
          existing: { name },
        },
      });
    },
    [dialectOf, ws]
  );

  const handleNewMaterializedView = useCallback(
    (sessionId: string, database: string, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (dialect !== "postgres") return;
      ws.openTab({
        kind: "view-designer",
        payload: { mode: "create", sessionId, database, schema, dialect, materialized: true },
      });
    },
    [dialectOf, ws]
  );

  const handleNewQuery = useCallback(
    async (initialQuery?: string, connectionId?: string, database?: string) => {
      let sessionId: string | null = activeSessionId;
      const activeSessionInfo = sessionsList.find((s) => s.id === activeSessionId);
      let db: string | null = activeSessionInfo?.database ?? null;
      if (connectionId) {
        const res = await ensureSession(connectionId, database);
        if (res) {
          sessionId = res.sessionId;
          db = res.database;
        }
      }
      ws.openTab({
        kind: "query",
        payload: {
          sessionId,
          database: db,
          content: initialQuery ?? "",
          results: [],
          activeResultId: null,
          error: null,
          showResults: true,
          resultsPanelHeight: 300,
        },
      });
    },
    [activeSessionId, sessionsList, ensureSession, ws]
  );

  // --- AI Assistant -------------------------------------------------------
  const getSchemaContext = useCallback(async (): Promise<string | null> => {
    const session = sessionsList.find((s) => s.id === activeSessionId);
    const database = session?.database;
    if (!session || !database) return null;
    try {
      const allTables = await getTables(session.id, database);
      const MAX_TABLES = 40;
      const tables = allTables
        .filter((t) => (t.table_type ?? "").toLowerCase() !== "view")
        .slice(0, MAX_TABLES);
      const withColumns = await Promise.all(
        tables.map(async (t) => {
          try {
            const cols = await getColumns(session.id, database, t.name, t.schema ?? undefined);
            return {
              name: t.name,
              columns: cols.map((c) => ({ name: c.name, type: c.data_type })),
            };
          } catch {
            return { name: t.name };
          }
        })
      );
      const summary = buildSchemaSummary(withColumns, MAX_TABLES);
      return summary.trim() ? summary : null;
    } catch {
      return null;
    }
  }, [sessionsList, activeSessionId, getTables, getColumns]);

  const handleAskAi = useCallback(
    (action: AskAiAction, sql: string, ctx: AskAiContext) => {
      const messages = buildAskAiMessages(action, sql, ctx);
      setAiSeed(messages);
      setAiSeedKey((k) => k + 1);
      setShowAi(true);
    },
    []
  );

  const handleInsertSqlFromAi = useCallback((sql: string) => {
    insertSqlRef.current?.(sql);
  }, []);

  const handleRegisterInsertSql = useCallback(
    (insert: ((sql: string) => void) | null) => {
      insertSqlRef.current = insert;
    },
    []
  );

  // --- Users / roles ------------------------------------------------------
  const handleOpenUsers = useCallback(
    (sessionId: string) => {
      const dialect = dialectOf(sessionId);
      if (!dialect || dialect === "sqlite") return;
      setUserManager({ sessionId, dialect });
    },
    [dialectOf]
  );

  // --- Backup / execute SQL ----------------------------------------------
  const handleOpenBackup = useCallback(
    async (sessionId: string, database: string, schema?: string) => {
      const dialect = dialectOf(sessionId);
      if (!dialect) return;
      try {
        const all = await getTables(sessionId, database);
        const baseTables = all
          .filter((t) => (t.table_type ?? "").toLowerCase() !== "view")
          .map((t) => t.name);
        setBackupState({
          sessionId,
          database,
          schema: schema ?? null,
          dialect,
          tables: baseTables,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setConnectError(t("shell.couldNotListTables", { database, message: msg }));
      }
    },
    [dialectOf, getTables, t]
  );

  const handleOpenExecuteSqlFile = useCallback(
    (sessionId: string, title = "Execute SQL File") => {
      setExecuteSqlFileState({ sessionId, title });
    },
    []
  );

  const commitChangesForModal = useCallback(
    (sessionId: string, statements: { sql: string; params: unknown[] }[]) =>
      commitChanges(
        sessionId,
        statements.map((s) => ({ sql: s.sql, params: [] }))
      ),
    [commitChanges]
  );

  const handleApplyDesigner = useCallback(
    async (statements: Statement[], sessionId: string) => {
      await commitChanges(sessionId, statements);
    },
    [commitChanges]
  );

  // --- Connection CRUD ---------------------------------------------------
  const handleSaveConnection = useCallback(
    async (
      connection: Omit<Connection, "id" | "created_at" | "updated_at">,
      secrets?: ConnectionSecrets
    ) => {
      if (editingConnection) {
        await updateConnection(editingConnection.id, connection, secrets);
      } else {
        await createConnection(connection, secrets);
      }
      setShowConnectionForm(false);
      setEditingConnection(undefined);
    },
    [editingConnection, updateConnection, createConnection]
  );

  const handleEditConnection = useCallback((connection: Connection) => {
    setEditingConnection(connection);
    setShowConnectionForm(true);
  }, []);

  const handleTest = useCallback(
    async (
      connection: Omit<Connection, "id" | "created_at" | "updated_at"> & ConnectionSecrets
    ): Promise<boolean> => {
      try {
        return await connectionCommands.testConnectionParams({
          driver: connection.driver,
          host: connection.host,
          port: connection.port,
          database: connection.database,
          username: connection.username,
          password: connection.password,
          options: connection.options ?? undefined,
          sshPassword: connection.sshPassword,
          sshPassphrase: connection.sshPassphrase,
        });
      } catch (err) {
        console.error("Connection test failed:", err);
        return false;
      }
    },
    []
  );

  const handleConnect = useCallback(
    async (connection: Connection) => {
      setConnectError(null);
      try {
        return await connect(connection);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setConnectError(t("shell.failedToConnect", { name: connection.name, message: msg }));
        throw err;
      }
    },
    [connect, t]
  );

  const handleOpenRedis = useCallback(
    async (connection: Connection) => {
      setConnectError(null);
      try {
        const { sessionId } = await redisCommands.connect(connection.id);
        ws.openTab({
          kind: "redis-browser",
          title: connection.name,
          payload: { connectionId: connection.id, sessionId },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setConnectError(t("shell.failedToConnect", { name: connection.name, message: msg }));
      }
    },
    [ws, t]
  );

  const handleOpenMongo = useCallback(
    async (connection: Connection) => {
      setConnectError(null);
      try {
        const { sessionId } = await mongoCommands.connect(connection.id);
        ws.openTab({
          kind: "mongo-browser",
          title: connection.name,
          payload: { connectionId: connection.id, sessionId },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setConnectError(t("shell.failedToConnect", { name: connection.name, message: msg }));
      }
    },
    [ws, t]
  );

  const handleExportConnections = useCallback(async () => {
    setConnectError(null);
    if (connections.length === 0) {
      setConnectError(t("shell.noConnectionsToExport"));
      return;
    }
    try {
      const filePath = await save({
        title: t("shell.exportConnectionsTitle"),
        defaultPath: "ansql-connections.json",
        filters: [{ name: t("shell.jsonFiles"), extensions: ["json"] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, exportConnections(connections));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setConnectError(t("shell.failedToExportConnections", { message: msg }));
    }
  }, [connections, t]);

  const handleImportConnections = useCallback(async () => {
    setConnectError(null);
    try {
      const selected = await open({
        title: t("shell.importConnectionsTitle"),
        multiple: false,
        directory: false,
        filters: [{ name: t("shell.jsonFiles"), extensions: ["json"] }],
      });
      const path = Array.isArray(selected) ? selected[0] ?? null : selected;
      if (!path) return;
      const text = await readTextFile(path);
      const imported = importConnections(text);
      if (imported.length === 0) {
        setConnectError(t("shell.fileHasNoConnections"));
        return;
      }
      const failures: string[] = [];
      for (const conn of imported) {
        try {
          await createConnection(conn);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`${conn.name}: ${msg}`);
        }
      }
      await loadConnections();
      if (failures.length > 0) {
        setConnectError(
          t("shell.importSummary", {
            ok: imported.length - failures.length,
            total: imported.length,
            failures: failures.join("\n"),
          })
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setConnectError(t("shell.failedToImportConnections", { message: msg }));
    }
  }, [createConnection, loadConnections, t]);

  // --- Toolbar capabilities / view ---------------------------------------
  const mainView: MainView =
    ws.activeTab?.kind === "query"
      ? "query"
      : ws.activeTab?.kind === "table-list"
        ? "tableList"
        : ws.activeTab?.kind === "table"
          ? "table"
          : "empty";
  const toolbar = resolveToolbarState({
    activeSession,
    view: mainView,
    hasQueryResult: activeResult !== null,
  });

  // When the active tab is not a query, no QueryDocument drives activeResult —
  // reset it so the header Export button disables.
  useEffect(() => {
    if (ws.activeTab?.kind !== "query") setActiveResult(null);
  }, [ws.activeTab?.id, ws.activeTab?.kind]);

  // --- Header export -----------------------------------------------------
  const { exportToJSON, exportXlsx, exportSql, exportHtml, exportXml, exportText } = useExport();

  const handleHeaderExport = useCallback(
    async (format: ExportFormat) => {
      if (!activeResult) return;
      try {
        switch (format) {
          case "csv":
          case "txt":
            setExportTextDialog(format);
            break;
          case "json":
            await exportToJSON(activeResult, "export");
            break;
          case "xlsx":
            await exportXlsx(activeResult, "export");
            break;
          case "html":
            await exportHtml(activeResult, "export");
            break;
          case "xml":
            await exportXml(activeResult, "export");
            break;
          case "sql": {
            const tableName =
              ws.activeTab?.kind === "table" ? ws.activeTab.payload.table : "export_table";
            const dialect =
              activeConnection && isSqlDriver(activeConnection.driver)
                ? toDialect(activeConnection.driver)
                : "mysql";
            await exportSql(activeResult, tableName, dialect, "export");
            break;
          }
        }
      } catch (err) {
        console.error("Export failed:", err);
      }
    },
    [activeResult, exportToJSON, exportXlsx, exportSql, exportHtml, exportXml, ws.activeTab, activeConnection]
  );

  const handleExportTextConfirm = useCallback(
    async (options: ExportTextOptions) => {
      const format = exportTextDialog;
      setExportTextDialog(null);
      if (!format || !activeResult) return;
      try {
        await exportText(activeResult, format, options, "export");
      } catch (err) {
        console.error("Export failed:", err);
      }
    },
    [exportTextDialog, activeResult, exportText]
  );

  // --- Selection (Info pane) --------------------------------------------
  const handleSelectObject = useCallback((target: InfoPaneTarget | null) => {
    setInfoTarget(target);
    if (target) setShowInfo(true);
  }, []);

  return {
    theme,
    toggleTheme,
    connections,
    loadConnections,
    createConnection,
    updateConnection,
    deleteConnection,
    sessions,
    sessionsList,
    activeSessionId,
    setActiveSessionId,
    connect,
    disconnect,
    getTables,
    getDatabases,
    getColumns,
    getIndexes,
    getForeignKeys,
    getSchemaGraph,
    getViewDefinition,
    getTriggers: getTriggersForTable,
    executeQuery,
    commitChanges,
    journal,
    ensureSession,
    handleConnectionChange,
    ws,
    vaultLocked,
    vaultGateChecked,
    unlockError,
    unlockBusy,
    handleVaultUnlock,
    handleVaultReset,
    showSettings,
    setShowSettings,
    showTimeline,
    setShowTimeline,
    showConnectionForm,
    setShowConnectionForm,
    editingConnection,
    setEditingConnection,
    connectError,
    setConnectError,
    transferState,
    setTransferState,
    exportTextDialog,
    setExportTextDialog,
    userManager,
    setUserManager,
    backupState,
    setBackupState,
    executeSqlFileState,
    setExecuteSqlFileState,
    tableRefresh,
    bumpTableRefresh,
    showAi,
    setShowAi,
    aiSeed,
    aiSeedKey,
    aiConfig,
    aiConfigured,
    showInfo,
    setShowInfo,
    infoTarget,
    handleSelectObject,
    focusMode,
    setFocusMode,
    activeResult,
    setActiveResult,
    insertSqlRef,
    canOpenRoutine,
    canManageUsers,
    toolbar,
    mainView,
    handleSelectTable,
    handleEditTable,
    handleSelectTableList,
    handleOpenErd,
    handleOpenStructureSync,
    handleOpenDataSync,
    handleOpenServerMonitor,
    handleOpenDashboards,
    handleNewQuery,
    handleCopyTables,
    handleTransferTables,
    handleDeleteTables,
    handleNewTable,
    handleEditStructure,
    handleNewView,
    handleEditView,
    handleNewRoutine,
    handleEditRoutine,
    handleNewTrigger,
    handleEditTrigger,
    handleNewEvent,
    handleEditEvent,
    handleNewSequence,
    handleEditSequence,
    handleNewMaterializedView,
    getSchemaContext,
    handleAskAi,
    handleInsertSqlFromAi,
    handleRegisterInsertSql,
    handleOpenUsers,
    handleOpenBackup,
    handleOpenExecuteSqlFile,
    commitChangesForModal,
    handleApplyDesigner,
    handleSaveConnection,
    handleEditConnection,
    handleTest,
    handleConnect,
    handleOpenRedis,
    handleOpenMongo,
    handleExportConnections,
    handleImportConnections,
    handleHeaderExport,
    handleExportTextConfirm,
    executeQueryWithRequestId,
    cancelQueryById,
    activeSession,
    activeConnection,
  };
}
