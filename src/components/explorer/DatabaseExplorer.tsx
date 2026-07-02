import { useState, useEffect, useMemo } from "react";
import {
  Database,
  Table,
  Eye,
  FolderOpen,
  Folder,
  RefreshCw,
  PlugZap,
  Unplug,
  FileCode,
  Archive,
  Bookmark,
  Pencil,
  Trash2,
  FilePlus,
  ArrowRightLeft,
  FileUp,
  Zap,
  Network,
  GitCompareArrows,
  Search,
  X,
  DatabaseBackup,
  PlayCircle,
  CalendarClock,
  ListOrdered,
  Layers,
  Star,
  StarOff,
  FolderPlus,
  Gauge,
  KeyRound,
  Leaf,
  Plus,
} from "lucide-react";
import TreeView, { TreeNode } from "../common/TreeView";
import { quoteIdent } from "../../lib/mutationBuilder";
import type { Connection, SessionInfo, TableInfo, ConnectionGroup, SourceRef, QueryResult, Dialect, Statement } from "../../types";
import { listSchemasQuery } from "../../lib/connectionIO";
import { useGroups } from "../../hooks/useGroups";
import { useConnections } from "../../hooks/useConnections";
import { TransferWizard } from "../transfer/TransferWizard";
import { ImportModal } from "../import/ImportModal";
import { clipboardStore } from "../../lib/clipboardStore";
import { usePasteController } from "../../hooks/usePaste";
import { useDialogs, useToast } from "../ui";
import { listRoutinesQuery, type RoutineKind } from "../../lib/routineBuilder";
import { getTriggers, type TriggerInfo } from "../../lib/introspectionQueries";
import { buildDropTrigger } from "../../lib/triggerBuilder";
import { listEventsQuery, buildDropEvent } from "../../lib/eventBuilder";
import { listSequencesQuery, buildDropSequence } from "../../lib/sequenceBuilder";
import { listMaterializedViewsQuery, buildDropMaterializedView } from "../../lib/viewBuilder";
import type { InfoPaneTarget } from "../common/InfoPane";
import { useTranslation } from "../../i18n";

interface DatabaseExplorerProps {
  connections: Connection[];
  groups: ConnectionGroup[];
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onConnect: (connection: Connection) => void;
  /**
   * Open the Redis key browser for a Redis connection (driver === "redis").
   * Redis connections have no SQL database/table sub-tree — opening one connects
   * a redis session and opens the key browser instead of a SQL session.
   */
  onOpenRedis?: (connection: Connection) => void;
  /**
   * Open the MongoDB document browser for a Mongo connection (driver === "mongodb").
   * Mongo connections have no SQL database/table sub-tree — opening one connects
   * a mongo session and opens the document browser instead of a SQL session.
   */
  onOpenMongo?: (connection: Connection) => void;
  onDisconnect: (sessionId: string) => void;
  onRefreshConnections?: () => Promise<void> | void;
  onEditConnection: (connection: Connection) => void;
  onDeleteConnection: (id: string) => void;
  onSelectTable: (sessionId: string, database: string, table: string) => void;
  /** Show the full table list for a database in the right panel (click "Tables" node). */
  onSelectTableList?: (sessionId: string, database: string) => void;
  /**
   * Emitted when a leaf object (table / view / routine / trigger) is selected in
   * the tree. Feeds the right-dock Information pane. Null is emitted when the
   * selection moves to a non-object node so the pane can clear.
   */
  onSelectObject?: (target: InfoPaneTarget | null) => void;
  /** Open the ER Diagram for a database (database-node context menu). */
  onShowErd?: (sessionId: string, database: string, schema?: string) => void;
  /** Open Structure Synchronization seeded with this database as the source. */
  onStructureSync?: (sessionId: string, database: string, schema?: string) => void;
  /** Open Data Synchronization seeded with this database as the source. */
  onDataSync?: (sessionId: string, database: string, schema?: string) => void;
  /** Open the Server Monitor for a connected session (MySQL/Postgres only). */
  onServerMonitor?: (sessionId: string) => void;
  onNewQuery?: (initialQuery?: string, connectionId?: string, database?: string) => void;
  /** Open the View designer in create mode (from a database / Views node). */
  onNewView?: (sessionId: string, database: string, schema?: string) => void;
  /** Open the View designer in edit mode for an existing view. */
  onEditView?: (sessionId: string, database: string, view: string, schema?: string) => void;
  /** Open the Routine editor in create mode (Functions node / database menu). */
  onNewRoutine?: (sessionId: string, database: string, kind: RoutineKind, schema?: string) => void;
  /** Open the Routine editor in edit mode for an existing function/procedure. */
  onEditRoutine?: (
    sessionId: string,
    database: string,
    name: string,
    kind: RoutineKind,
    schema?: string
  ) => void;
  /** Open the Trigger designer in create mode for a given table. */
  onNewTrigger?: (sessionId: string, database: string, table: string, schema?: string) => void;
  /** Open the Trigger designer in edit mode for an existing trigger. */
  onEditTrigger?: (
    sessionId: string,
    database: string,
    trigger: TriggerInfo,
    schema?: string
  ) => void;
  /** Open the Event designer in create mode (MySQL only — Events node). */
  onNewEvent?: (sessionId: string, database: string) => void;
  /** Open the Event designer in edit mode for an existing MySQL event. */
  onEditEvent?: (sessionId: string, database: string, name: string, statement?: string) => void;
  /** Open the Sequence designer in create mode (Postgres only — Sequences node). */
  onNewSequence?: (sessionId: string, database: string, schema?: string) => void;
  /** Open the Sequence designer in edit mode for an existing Postgres sequence. */
  onEditSequence?: (sessionId: string, database: string, name: string, schema?: string) => void;
  /** Open the View designer in create mode for a materialized view (Postgres only). */
  onNewMaterializedView?: (sessionId: string, database: string, schema?: string) => void;
  /** Open the Backup / Dump SQL modal for a database (optionally pre-selecting one table). */
  onDumpDatabase?: (sessionId: string, database: string, schema?: string) => void;
  /** Open the Execute SQL File / Restore modal for a session. */
  onExecuteSqlFile?: (sessionId: string, database?: string) => void;
  /** Used to lazily list routines for the Functions node. */
  executeQuery?: (sessionId: string, query: string) => Promise<QueryResult>;
  getTables: (sessionId: string, database: string, schema?: string) => Promise<TableInfo[]>;
  getDatabases: (sessionId: string) => Promise<string[]>;
}

/** A routine listed under a database's Functions node. */
interface RoutineEntry {
  name: string;
  kind: RoutineKind;
}

interface SessionData {
  databases: string[];
  /** Lazily-loaded Postgres schemas, keyed by database. */
  schemas: Map<string, string[]>;
  /** Databases whose schema list is currently being fetched. */
  loadingSchemas: Set<string>;
  tables: Map<string, TableInfo[]>;
  /** Lazily-loaded routines (functions + procedures), keyed by database. */
  routines: Map<string, RoutineEntry[]>;
  /** Lazily-loaded triggers, keyed by database. */
  triggers: Map<string, TriggerInfo[]>;
  /** Lazily-loaded MySQL events, keyed by database. */
  events: Map<string, string[]>;
  /** Lazily-loaded Postgres sequences, keyed by database. */
  sequences: Map<string, string[]>;
  /** Lazily-loaded Postgres materialized views, keyed by database. */
  materializedViews: Map<string, string[]>;
  loadingDatabases: boolean;
  loadingTables: Set<string>;
  /** Databases whose routines are currently being fetched. */
  loadingRoutines: Set<string>;
  /** Databases whose triggers are currently being fetched. */
  loadingTriggers: Set<string>;
  /** Databases whose events are currently being fetched. */
  loadingEvents: Set<string>;
  /** Databases whose sequences are currently being fetched. */
  loadingSequences: Set<string>;
  /** Databases whose materialized views are currently being fetched. */
  loadingMaterializedViews: Set<string>;
}

function DatabaseExplorer({
  connections,
  groups,
  sessions,
  activeSessionId: _activeSessionId,
  onConnect,
  onOpenRedis,
  onOpenMongo,
  onDisconnect,
  onRefreshConnections,
  onEditConnection,
  onDeleteConnection,
  onSelectTable,
  onSelectTableList,
  onSelectObject,
  onShowErd,
  onStructureSync,
  onDataSync,
  onServerMonitor,
  onNewQuery,
  onNewView,
  onEditView,
  onNewRoutine,
  onEditRoutine,
  onNewTrigger,
  onEditTrigger,
  onNewEvent,
  onEditEvent,
  onNewSequence,
  onEditSequence,
  onNewMaterializedView,
  onDumpDatabase,
  onExecuteSqlFile,
  executeQuery,
  getTables,
  getDatabases,
}: DatabaseExplorerProps) {
  const { t } = useTranslation();
  const [sessionData, setSessionData] = useState<Map<string, SessionData>>(new Map());
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  // Client-side object search over the already-built tree (see filteredTree below).
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode;
  } | null>(null);

  const [transferState, setTransferState] = useState<{
    sourceSession: SessionInfo;
    sourceDatabase: string;
    sourceTables: TableInfo[];
    preselected: string[];
  } | null>(null);

  const [importState, setImportState] = useState<{
    sessionId: string;
    database: string;
    table?: string;
    mode: "existing" | "new";
  } | null>(null);

  // Starred connection ids, persisted client-side (the Connection model has no
  // "starred" field). Starred connections surface in a pinned section at the top.
  const STARRED_STORAGE_KEY = "ansql.starredConnections";
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STARRED_STORAGE_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });

  const toggleStar = (connectionId: string) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(connectionId)) {
        next.delete(connectionId);
      } else {
        next.add(connectionId);
      }
      try {
        localStorage.setItem(STARRED_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Ignore persistence failures (private mode / quota) — in-memory state still works.
      }
      return next;
    });
  };

  // In-tree group management. We use the group/connection hooks directly for the
  // create-group and move-to-group mutations; the prop-driven `connections`
  // list is refreshed via onRefreshConnections after a move so the tree updates.
  const { groups: liveGroups, createGroup } = useGroups();
  const { updateConnection } = useConnections();
  // Prefer the prop-supplied groups (the source of truth for rendering); fall
  // back to the hook's own list if the parent didn't pass any.
  const effectiveGroups = groups.length > 0 ? groups : liveGroups;

  const dialogs = useDialogs();
  const toast = useToast();

  const handleCreateGroup = async () => {
    const name = (await dialogs.prompt({ title: t("explorer.newGroupPrompt") }))?.trim();
    if (!name) return;
    try {
      await createGroup({ name });
      await onRefreshConnections?.();
    } catch (err) {
      console.error("Failed to create group:", err);
      toast.error(t("explorer.createGroupFailed", { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleMoveConnectionToGroup = async (
    connectionId: string,
    groupId: string | null,
  ) => {
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) return;
    if ((conn.group_id ?? null) === groupId) return;
    try {
      await updateConnection(connectionId, { group_id: groupId ?? undefined });
      await onRefreshConnections?.();
    } catch (err) {
      console.error("Failed to move connection:", err);
      toast.error(t("explorer.moveConnectionFailed", { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const { requestPaste } = usePasteController();

  // Load databases when a session is created
  useEffect(() => {
    sessions.forEach(async (session) => {
      if (!sessionData.has(session.id)) {
        setSessionData((prev) => {
          const next = new Map(prev);
          next.set(session.id, {
            databases: [],
            schemas: new Map(),
            loadingSchemas: new Set(),
            tables: new Map(),
            routines: new Map(),
            triggers: new Map(),
            events: new Map(),
            sequences: new Map(),
            materializedViews: new Map(),
            loadingDatabases: true,
            loadingTables: new Set(),
            loadingRoutines: new Set(),
            loadingTriggers: new Set(),
            loadingEvents: new Set(),
            loadingSequences: new Set(),
            loadingMaterializedViews: new Set(),
          });
          return next;
        });

        try {
          const databases = await getDatabases(session.id);
          setSessionData((prev) => {
            const next = new Map(prev);
            const data = next.get(session.id);
            if (data) {
              next.set(session.id, {
                ...data,
                databases,
                loadingDatabases: false,
              });
            }
            return next;
          });
        } catch (err) {
          console.error("Failed to load databases:", err);
          setSessionData((prev) => {
            const next = new Map(prev);
            const data = next.get(session.id);
            if (data) {
              next.set(session.id, { ...data, loadingDatabases: false });
            }
            return next;
          });
        }
      }
    });
  }, [sessions, getDatabases, sessionData]);

  // Clean up session data when sessions are removed
  useEffect(() => {
    const sessionIds = new Set(sessions.map((s) => s.id));
    setSessionData((prev) => {
      const next = new Map(prev);
      for (const id of next.keys()) {
        if (!sessionIds.has(id)) {
          next.delete(id);
        }
      }
      return next;
    });
  }, [sessions]);

  // Composite map key for the per-database object caches. Postgres adds a schema
  // tier between the database and its category folders, so its objects are keyed
  // by database + schema; MySQL/SQLite keep the plain database key.
  const dbKey = (database: string, schema?: string): string =>
    schema ? `${database}::${schema}` : database;

  const loadTables = async (sessionId: string, database: string, schema?: string) => {
    const data = sessionData.get(sessionId);

    if (!data) {
      return;
    }

    const key = dbKey(database, schema);
    if (data.loadingTables.has(key)) {
      return;
    }

    setSessionData((prev) => {
      const next = new Map(prev);
      const d = next.get(sessionId);
      if (d) {
        const loadingTables = new Set(d.loadingTables);
        loadingTables.add(key);
        next.set(sessionId, { ...d, loadingTables });
      }
      return next;
    });

    try {
      const tables = await getTables(sessionId, database, schema);
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const newTables = new Map(d.tables);
          newTables.set(key, tables);
          const loadingTables = new Set(d.loadingTables);
          loadingTables.delete(key);
          next.set(sessionId, { ...d, tables: newTables, loadingTables });
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to load tables:", err);
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const loadingTables = new Set(d.loadingTables);
          loadingTables.delete(key);
          next.set(sessionId, { ...d, loadingTables });
        }
        return next;
      });
    }
  };

  // Lazily list Postgres schemas for a database via executeQuery. No-op on
  // MySQL/SQLite (listSchemasQuery returns "" for them) — those engines have no
  // schema tier so the database node holds the category folders directly.
  const loadSchemas = async (sessionId: string, database: string) => {
    const data = sessionData.get(sessionId);
    if (!data || data.loadingSchemas.has(database)) return;

    const dialect = dialectFor(sessionId);
    if (!dialect || !executeQuery) return;
    const sql = listSchemasQuery(dialect);
    if (!sql) return;

    setSessionData((prev) => {
      const next = new Map(prev);
      const d = next.get(sessionId);
      if (d) {
        const loadingSchemas = new Set(d.loadingSchemas);
        loadingSchemas.add(database);
        next.set(sessionId, { ...d, loadingSchemas });
      }
      return next;
    });

    try {
      const result = await executeQuery(sessionId, sql);
      const names = result.rows
        .map((row) => String(row.schema_name ?? row.SCHEMA_NAME ?? row.name ?? ""))
        .filter((n) => n !== "");
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const newSchemas = new Map(d.schemas);
          newSchemas.set(database, names);
          const loadingSchemas = new Set(d.loadingSchemas);
          loadingSchemas.delete(database);
          next.set(sessionId, { ...d, schemas: newSchemas, loadingSchemas });
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to load schemas:", err);
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const loadingSchemas = new Set(d.loadingSchemas);
          loadingSchemas.delete(database);
          next.set(sessionId, { ...d, loadingSchemas });
        }
        return next;
      });
    }
  };

  // Resolve a session's SQL dialect from its connection's driver. SQLite has no
  // stored routines, so the Functions node is suppressed for it.
  const dialectFor = (sessionId: string): Dialect | null => {
    const session = sessions.find((s) => s.id === sessionId);
    const conn = session ? connections.find((c) => c.id === session.connection_id) : undefined;
    return (conn?.driver as Dialect | undefined) ?? null;
  };

  // Lazily list the functions/procedures in a database via executeQuery, parsing
  // (name, type) rows into RoutineEntry. No-op on SQLite (empty list query).
  const loadRoutines = async (sessionId: string, database: string, schema?: string) => {
    const data = sessionData.get(sessionId);
    const key = dbKey(database, schema);
    if (!data || data.loadingRoutines.has(key)) return;

    const dialect = dialectFor(sessionId);
    if (!dialect || dialect === "sqlite" || !executeQuery) return;
    const sql = listRoutinesQuery(dialect, database);
    if (!sql) return;

    setSessionData((prev) => {
      const next = new Map(prev);
      const d = next.get(sessionId);
      if (d) {
        const loadingRoutines = new Set(d.loadingRoutines);
        loadingRoutines.add(key);
        next.set(sessionId, { ...d, loadingRoutines });
      }
      return next;
    });

    try {
      const result = await executeQuery(sessionId, sql);
      const routines: RoutineEntry[] = result.rows.map((row) => {
        const name = String(row.name ?? row.NAME ?? "");
        const typeRaw = String(row.type ?? row.TYPE ?? "FUNCTION").toUpperCase();
        const kind: RoutineKind = typeRaw.includes("PROC") ? "procedure" : "function";
        return { name, kind };
      });
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const newRoutines = new Map(d.routines);
          newRoutines.set(key, routines);
          const loadingRoutines = new Set(d.loadingRoutines);
          loadingRoutines.delete(key);
          next.set(sessionId, { ...d, routines: newRoutines, loadingRoutines });
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to load routines:", err);
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const loadingRoutines = new Set(d.loadingRoutines);
          loadingRoutines.delete(key);
          next.set(sessionId, { ...d, loadingRoutines });
        }
        return next;
      });
    }
  };

  // Lazily list triggers for a database via the get_triggers command. Works on
  // all engines (MySQL/Postgres/SQLite all expose triggers).
  const loadTriggers = async (sessionId: string, database: string, schema?: string) => {
    const data = sessionData.get(sessionId);
    const key = dbKey(database, schema);
    if (!data || data.loadingTriggers.has(key)) return;

    setSessionData((prev) => {
      const next = new Map(prev);
      const d = next.get(sessionId);
      if (d) {
        const loadingTriggers = new Set(d.loadingTriggers);
        loadingTriggers.add(key);
        next.set(sessionId, { ...d, loadingTriggers });
      }
      return next;
    });

    try {
      const triggers = await getTriggers(sessionId, database);
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const newTriggers = new Map(d.triggers);
          newTriggers.set(key, triggers);
          const loadingTriggers = new Set(d.loadingTriggers);
          loadingTriggers.delete(key);
          next.set(sessionId, { ...d, triggers: newTriggers, loadingTriggers });
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to load triggers:", err);
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const loadingTriggers = new Set(d.loadingTriggers);
          loadingTriggers.delete(key);
          next.set(sessionId, { ...d, loadingTriggers });
        }
        return next;
      });
    }
  };

  // Drop a trigger via executeQuery, then reload that database's trigger list.
  // Postgres emits two statements (DROP TRIGGER + DROP FUNCTION) — run each.
  const handleDropTrigger = async (
    sessionId: string,
    database: string,
    trigger: TriggerInfo,
    schema?: string,
  ) => {
    const dialect = dialectFor(sessionId);
    if (!dialect || !executeQuery) return;
    if (!(await dialogs.confirm({ title: t("explorer.dropTriggerConfirm", { name: trigger.name }), danger: true }))) return;
    // MySQL qualifies the DROP by database; Postgres/SQLite by the trigger's schema.
    const qualifier = dialect === "mysql" ? database : (trigger.schema ?? null);
    const stmts = buildDropTrigger(dialect, trigger.name, trigger.table, qualifier);
    const key = dbKey(database, schema);
    try {
      for (const s of stmts) {
        await executeQuery(sessionId, s.sql);
      }
      // Re-fetch triggers so the dropped one disappears from the tree.
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const newTriggers = new Map(d.triggers);
          newTriggers.delete(key);
          next.set(sessionId, { ...d, triggers: newTriggers });
        }
        return next;
      });
      await loadTriggers(sessionId, database, schema);
    } catch (err) {
      console.error("Failed to drop trigger:", err);
      toast.error(t("explorer.dropTriggerFailed", { name: trigger.name, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  // Generic lazy loader for a name-only object list (events / sequences /
  // materialized views). Reads the loading set + result map off SessionData via
  // the supplied selectors, runs the list query, and stashes the `name` column
  // of each row. Returns early on SQLite or when the list query is empty.
  const loadNamedObjects = async (
    sessionId: string,
    database: string,
    sql: string,
    loadingKey: "loadingEvents" | "loadingSequences" | "loadingMaterializedViews",
    mapKey: "events" | "sequences" | "materializedViews",
    schema?: string,
  ) => {
    const data = sessionData.get(sessionId);
    const key = dbKey(database, schema);
    if (!data || data[loadingKey].has(key) || !executeQuery || !sql) return;

    setSessionData((prev) => {
      const next = new Map(prev);
      const d = next.get(sessionId);
      if (d) {
        const loading = new Set(d[loadingKey]);
        loading.add(key);
        next.set(sessionId, { ...d, [loadingKey]: loading });
      }
      return next;
    });

    try {
      const result = await executeQuery(sessionId, sql);
      const names = result.rows
        .map((row) => String(row.name ?? row.NAME ?? ""))
        .filter((n) => n !== "");
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const newMap = new Map(d[mapKey]);
          newMap.set(key, names);
          const loading = new Set(d[loadingKey]);
          loading.delete(key);
          next.set(sessionId, { ...d, [mapKey]: newMap });
          // Clear the loading flag in a separate, single-key patch so the
          // computed-key value type is unambiguous to the checker.
          const d2 = next.get(sessionId)!;
          next.set(sessionId, { ...d2, [loadingKey]: loading });
        }
        return next;
      });
    } catch (err) {
      console.error(`Failed to load ${mapKey}:`, err);
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const loading = new Set(d[loadingKey]);
          loading.delete(key);
          next.set(sessionId, { ...d, [loadingKey]: loading });
        }
        return next;
      });
    }
  };

  // Lazily list MySQL events for a database (MySQL only; no schema tier).
  const loadEvents = (sessionId: string, database: string) => {
    if (dialectFor(sessionId) !== "mysql") return;
    void loadNamedObjects(
      sessionId,
      database,
      listEventsQuery(database),
      "loadingEvents",
      "events",
    );
  };

  // Lazily list Postgres sequences for a database (Postgres only).
  const loadSequences = (sessionId: string, database: string, schema?: string) => {
    if (dialectFor(sessionId) !== "postgres") return;
    void loadNamedObjects(
      sessionId,
      database,
      listSequencesQuery(),
      "loadingSequences",
      "sequences",
      schema,
    );
  };

  // Lazily list Postgres materialized views for a database (Postgres only).
  const loadMaterializedViews = (sessionId: string, database: string, schema?: string) => {
    const dialect = dialectFor(sessionId);
    if (dialect !== "postgres") return;
    void loadNamedObjects(
      sessionId,
      database,
      listMaterializedViewsQuery(dialect),
      "loadingMaterializedViews",
      "materializedViews",
      schema,
    );
  };

  // Drop a named object (event / sequence / matview), then reload that
  // database's list so the dropped object disappears from the tree.
  const handleDropNamedObject = async (
    sessionId: string,
    database: string,
    name: string,
    label: string,
    buildDrop: () => Statement[],
    reload: (sessionId: string, database: string, schema?: string) => void,
    mapKey: "events" | "sequences" | "materializedViews",
    schema?: string,
  ) => {
    if (!executeQuery) return;
    if (!(await dialogs.confirm({ title: t("explorer.dropObjectConfirm", { label, name }), danger: true }))) return;
    const key = dbKey(database, schema);
    try {
      for (const s of buildDrop()) {
        await executeQuery(sessionId, s.sql);
      }
      setSessionData((prev) => {
        const next = new Map(prev);
        const d = next.get(sessionId);
        if (d) {
          const newMap = new Map(d[mapKey]);
          newMap.delete(key);
          next.set(sessionId, { ...d, [mapKey]: newMap });
        }
        return next;
      });
      reload(sessionId, database, schema);
    } catch (err) {
      console.error(`Failed to drop ${label}:`, err);
      toast.error(t("explorer.dropObjectFailed", { label, name, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  // Eagerly load the schema list for each Postgres database once its database
  // list is known. This makes the schema tier appear (so each database node is
  // expandable) without requiring the user to first expand the database — the
  // category folders below each schema still lazy-load on their own expand.
  useEffect(() => {
    sessions.forEach((session) => {
      if (dialectFor(session.id) !== "postgres") return;
      const data = sessionData.get(session.id);
      if (!data || data.loadingDatabases) return;
      data.databases.forEach((dbName) => {
        if (!data.schemas.has(dbName) && !data.loadingSchemas.has(dbName)) {
          void loadSchemas(session.id, dbName);
        }
      });
    });
    // loadSchemas/dialectFor are stable enough for this lazy trigger; rerun when
    // the session set or loaded data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, sessionData]);

  // Build tree nodes with Navicat-style structure
  const treeNodes = useMemo<TreeNode[]>(() => {
    // Group connections by group_id
    const groupedConnections = new Map<string | null, Connection[]>();
    connections.forEach((conn) => {
      const groupId = conn.group_id || null;
      if (!groupedConnections.has(groupId)) {
        groupedConnections.set(groupId, []);
      }
      groupedConnections.get(groupId)!.push(conn);
    });

    const groupNodes: TreeNode[] = [];

    // Build the category folders (Tables/Views/Functions/...) for one database,
    // optionally scoped to a Postgres schema. `schema` is threaded into every
    // node's data + into the composite cache key (dbKey) and id suffix so
    // schema-scoped branches don't collide with the plain-database ones.
    const buildCategoryNodes = (
      session: SessionInfo,
      connection: Connection,
      data: SessionData,
      dbName: string,
      schema?: string,
    ): TreeNode[] => {
      // id segment: empty for the plain (non-schema) database so existing
      // MySQL/SQLite/Postgres-without-schema ids stay byte-for-byte identical.
      const seg = schema ? `${schema}:` : "";
      const key = dbKey(dbName, schema);
      const base = { sessionId: session.id, database: dbName, schema };

      const tables = data.tables.get(key) || [];
      const isLoadingTables = data.loadingTables.has(key);

      // Separate tables and views
      const actualTables = tables.filter(
        (t) => t.table_type?.toLowerCase() !== "view"
      );
      const views = tables.filter((t) => t.table_type?.toLowerCase() === "view");

      const tableItemNodes: TreeNode[] = actualTables.length > 0
        ? actualTables.map((table) => ({
            id: `${session.id}:${dbName}:${seg}table:${table.name}`,
            label: table.name,
            icon: <Table className="w-4 h-4 text-blue-500" />,
            // Show the row count subtly when the driver populated it.
            secondaryLabel:
              table.row_count != null
                ? table.row_count.toLocaleString()
                : undefined,
            data: { ...base, table: table.name, type: "table" },
          }))
        : tables.length === 0 && !isLoadingTables
          ? [{
              id: `${session.id}:${dbName}:${seg}tables:placeholder`,
              label: t("explorer.noTablesFound"),
              icon: <Table className="w-4 h-4 text-muted-foreground" />,
              data: { type: "placeholder" },
            }]
          : [];

      const viewItemNodes: TreeNode[] = views.length > 0
        ? views.map((view) => ({
            id: `${session.id}:${dbName}:${seg}view:${view.name}`,
            label: view.name,
            icon: <Eye className="w-4 h-4 text-purple-500" />,
            data: { ...base, table: view.name, type: "view" },
          }))
        : [];

      // Routines (functions + procedures). SQLite has none, so the
      // Functions category is suppressed entirely for it.
      const isSqlite = connection.driver === "sqlite";
      const routines = data.routines.get(key) || [];
      const isLoadingRoutines = data.loadingRoutines.has(key);
      const routineItemNodes: TreeNode[] = routines.length > 0
        ? routines.map((r) => ({
            id: `${session.id}:${dbName}:${seg}routine:${r.kind}:${r.name}`,
            label: r.name,
            icon: <FileCode className={`w-4 h-4 ${r.kind === "procedure" ? "text-pink-500" : "text-orange-500"}`} />,
            data: {
              ...base,
              routine: r.name,
              routineKind: r.kind,
              type: "routine",
            },
          }))
        : [];

      // Triggers (all engines). Lazily loaded on expand.
      const triggers = data.triggers.get(key) || [];
      const isLoadingTriggers = data.loadingTriggers.has(key);
      const triggerItemNodes: TreeNode[] = triggers.length > 0
        ? triggers.map((t) => ({
            id: `${session.id}:${dbName}:${seg}trigger:${t.table}:${t.name}`,
            label: t.name,
            icon: <Zap className="w-4 h-4 text-yellow-500" />,
            secondaryLabel: t.table || undefined,
            data: {
              ...base,
              trigger: t.name,
              table: t.table,
              // Full introspected trigger so the context menu can edit/drop.
              triggerInfo: t,
              type: "trigger",
            },
          }))
        : [];

      // Events (MySQL only). Lazily loaded on expand.
      const isMysql = connection.driver === "mysql";
      const isPostgres = connection.driver === "postgres";
      const events = data.events.get(key) || [];
      const isLoadingEvents = data.loadingEvents.has(key);
      const eventItemNodes: TreeNode[] = events.length > 0
        ? events.map((name) => ({
            id: `${session.id}:${dbName}:${seg}event:${name}`,
            label: name,
            icon: <CalendarClock className="w-4 h-4 text-rose-500" />,
            data: {
              ...base,
              event: name,
              type: "event",
            },
          }))
        : [];

      // Sequences (Postgres only). Lazily loaded on expand.
      const sequences = data.sequences.get(key) || [];
      const isLoadingSequences = data.loadingSequences.has(key);
      const sequenceItemNodes: TreeNode[] = sequences.length > 0
        ? sequences.map((name) => ({
            id: `${session.id}:${dbName}:${seg}sequence:${name}`,
            label: name,
            icon: <ListOrdered className="w-4 h-4 text-indigo-500" />,
            data: {
              ...base,
              sequence: name,
              type: "sequence",
            },
          }))
        : [];

      // Materialized views (Postgres only). Lazily loaded on expand.
      const matviews = data.materializedViews.get(key) || [];
      const isLoadingMatviews = data.loadingMaterializedViews.has(key);
      const matviewItemNodes: TreeNode[] = matviews.length > 0
        ? matviews.map((name) => ({
            id: `${session.id}:${dbName}:${seg}matview:${name}`,
            label: name,
            icon: <Layers className="w-4 h-4 text-fuchsia-500" />,
            data: {
              ...base,
              matview: name,
              type: "matview",
            },
          }))
        : [];

      // Category folders
      const categoryNodes: TreeNode[] = [
        {
          id: `${session.id}:${dbName}:${seg}tables`,
          label: t("explorer.categoryTables"),
          icon: <Table className="w-4 h-4 text-blue-400" />,
          children: tableItemNodes.length > 0 ? tableItemNodes : undefined,
          isLoading: isLoadingTables,
          data: { ...base, type: "category", category: "tables" },
        },
        {
          id: `${session.id}:${dbName}:${seg}views`,
          label: t("explorer.categoryViews"),
          icon: <Eye className="w-4 h-4 text-purple-400" />,
          children: viewItemNodes.length > 0 ? viewItemNodes : undefined,
          data: { ...base, type: "category", category: "views" },
        },
        {
          id: `${session.id}:${dbName}:${seg}triggers`,
          label: t("explorer.categoryTriggers"),
          icon: <Zap className="w-4 h-4 text-yellow-400" />,
          children: triggerItemNodes.length > 0 ? triggerItemNodes : undefined,
          isLoading: isLoadingTriggers,
          data: { ...base, type: "category", category: "triggers" },
        },
        {
          id: `${session.id}:${dbName}:${seg}queries`,
          label: t("explorer.categoryQueries"),
          icon: <Bookmark className="w-4 h-4 text-cyan-400" />,
          children: undefined,
          data: { ...base, type: "category", category: "queries" },
        },
        {
          id: `${session.id}:${dbName}:${seg}backups`,
          label: t("explorer.categoryBackups"),
          icon: <Archive className="w-4 h-4 text-slate-400" />,
          children: undefined,
          data: { ...base, type: "category", category: "backups" },
        },
      ];

      // Functions node: only for engines with stored routines (not SQLite),
      // inserted after Views.
      if (!isSqlite) {
        categoryNodes.splice(2, 0, {
          id: `${session.id}:${dbName}:${seg}functions`,
          label: t("explorer.categoryFunctions"),
          icon: <FileCode className="w-4 h-4 text-orange-400" />,
          children: routineItemNodes.length > 0 ? routineItemNodes : undefined,
          isLoading: isLoadingRoutines,
          data: { ...base, type: "category", category: "functions" },
        });
      }

      // Dialect-specific categories, inserted before Queries/Backups:
      // Materialized Views + Sequences (Postgres only), Events (MySQL only).
      const extraCategories: TreeNode[] = [];
      if (isPostgres) {
        extraCategories.push({
          id: `${session.id}:${dbName}:${seg}matviews`,
          label: t("explorer.categoryMaterializedViews"),
          icon: <Layers className="w-4 h-4 text-fuchsia-400" />,
          children: matviewItemNodes.length > 0 ? matviewItemNodes : undefined,
          isLoading: isLoadingMatviews,
          data: { ...base, type: "category", category: "matviews" },
        });
        extraCategories.push({
          id: `${session.id}:${dbName}:${seg}sequences`,
          label: t("explorer.categorySequences"),
          icon: <ListOrdered className="w-4 h-4 text-indigo-400" />,
          children: sequenceItemNodes.length > 0 ? sequenceItemNodes : undefined,
          isLoading: isLoadingSequences,
          data: { ...base, type: "category", category: "sequences" },
        });
      }
      if (isMysql) {
        extraCategories.push({
          id: `${session.id}:${dbName}:${seg}events`,
          label: t("explorer.categoryEvents"),
          icon: <CalendarClock className="w-4 h-4 text-rose-400" />,
          children: eventItemNodes.length > 0 ? eventItemNodes : undefined,
          isLoading: isLoadingEvents,
          data: { ...base, type: "category", category: "events" },
        });
      }
      if (extraCategories.length > 0) {
        // Insert before the trailing Queries + Backups categories.
        categoryNodes.splice(categoryNodes.length - 2, 0, ...extraCategories);
      }

      return categoryNodes;
    };

    // Build the database-level nodes for one connected session. Postgres inserts
    // a schema tier between the database node and its category folders; MySQL and
    // SQLite have no schema tier so the categories hang directly off the database.
    const buildDatabaseNodes = (
      session: SessionInfo,
      connection: Connection,
      data: SessionData,
    ): TreeNode[] => {
      const isPostgres = connection.driver === "postgres";
      const nodes: TreeNode[] = [];

      data.databases.forEach((dbName) => {
        if (isPostgres) {
          const schemaList = data.schemas.get(dbName);
          const isLoadingSchemas = data.loadingSchemas.has(dbName);
          const schemaNodes: TreeNode[] = (schemaList ?? []).map((schemaName) => ({
            id: `${session.id}:${dbName}:schema:${schemaName}`,
            label: schemaName,
            icon: <Folder className="w-4 h-4 text-emerald-500" />,
            children: buildCategoryNodes(session, connection, data, dbName, schemaName),
            data: { sessionId: session.id, database: dbName, schema: schemaName, type: "schema" },
          }));

          nodes.push({
            id: `${session.id}:${dbName}`,
            label: dbName,
            icon: <Database className="w-4 h-4 text-teal-500" />,
            // Schemas are lazily loaded on expand; show the spinner until then.
            children: schemaNodes.length > 0 ? schemaNodes : undefined,
            isLoading: isLoadingSchemas,
            data: { sessionId: session.id, database: dbName, type: "database" },
          });
        } else {
          nodes.push({
            id: `${session.id}:${dbName}`,
            label: dbName,
            icon: <Database className="w-4 h-4 text-teal-500" />,
            children: buildCategoryNodes(session, connection, data, dbName),
            data: { sessionId: session.id, database: dbName, type: "database" },
          });
        }
      });

      return nodes;
    };

    // Build a connection's node (connected → session w/ databases, else a plain
    // connection node). Shared by the grouped tree and the pinned Starred section.
    const buildConnectionNode = (connection: Connection): TreeNode => {
      const session = sessions.find((s) => s.connection_id === connection.id);
      const isStarred = starredIds.has(connection.id);
      // Redis is not a SQL engine: it never holds a SQL session and has no
      // database/table sub-tree. Render it as a leaf whose double-click opens the
      // key browser (handled in handleDoubleClick via type "redis-connection").
      if (connection.driver === "redis") {
        return {
          id: `connection:${connection.id}`,
          label: connection.name,
          icon: connection.color ? (
            <KeyRound className="w-4 h-4" style={{ color: connection.color }} />
          ) : (
            <KeyRound className="w-4 h-4 text-rose-600" />
          ),
          secondaryLabel: isStarred ? <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> : undefined,
          data: { connectionId: connection.id, type: "redis-connection" },
        };
      }
      // MongoDB, like Redis, is not a SQL engine: no SQL session, no
      // database/table sub-tree. Render it as a leaf whose double-click opens the
      // document browser (handled in handleDoubleClick via type "mongo-connection").
      if (connection.driver === "mongodb") {
        return {
          id: `connection:${connection.id}`,
          label: connection.name,
          icon: connection.color ? (
            <Leaf className="w-4 h-4" style={{ color: connection.color }} />
          ) : (
            <Leaf className="w-4 h-4 text-green-600" />
          ),
          secondaryLabel: isStarred ? <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> : undefined,
          data: { connectionId: connection.id, type: "mongo-connection" },
        };
      }
      if (session) {
        const data = sessionData.get(session.id);
        const databaseNodes = data ? buildDatabaseNodes(session, connection, data) : [];
        return {
          id: `session:${session.id}`,
          label: connection.name,
          // When the connection has a custom color, tint the icon with it
          // (dropping the default green); otherwise keep the connected green.
          icon: connection.color ? (
            <Database className="w-4 h-4" style={{ color: connection.color }} />
          ) : (
            <Database className="w-4 h-4 text-green-500" />
          ),
          secondaryLabel: isStarred ? <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> : undefined,
          children: databaseNodes,
          isLoading: data?.loadingDatabases,
          data: { sessionId: session.id, connectionId: connection.id, type: "session" },
        };
      }
      return {
        id: `connection:${connection.id}`,
        label: connection.name,
        // Tint by the connection's custom color when set; otherwise muted.
        icon: connection.color ? (
          <Database className="w-4 h-4" style={{ color: connection.color }} />
        ) : (
          <Database className="w-4 h-4 text-muted-foreground" />
        ),
        secondaryLabel: isStarred ? <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> : undefined,
        data: { connectionId: connection.id, type: "connection" },
      };
    };

    // Deep-prefix every id in a subtree so a duplicated branch (e.g. the pinned
    // Starred copy of a connection that also lives in a group) keeps independent
    // expansion state in TreeView. `data` is left untouched so the toggle/select
    // handlers still resolve the real session/database/schema off the node.
    const prefixIds = (node: TreeNode, prefix: string): TreeNode => ({
      ...node,
      id: `${prefix}${node.id}`,
      children: node.children?.map((c) => prefixIds(c, prefix)),
    });

    // Pinned "Starred" section: render starred connections at the top so they're
    // always one click away regardless of their group. Ids are prefixed so
    // expansion state never collides with the in-group copy.
    const starredConnections = connections.filter((c) => starredIds.has(c.id));
    if (starredConnections.length > 0) {
      groupNodes.push({
        id: "starred",
        label: t("explorer.starred"),
        icon: <Star className="w-4 h-4 text-amber-400 fill-amber-400" />,
        children: starredConnections.map((c) => prefixIds(buildConnectionNode(c), "starred:")),
        data: { type: "starred-section" },
      });
    }

    // Always render existing groups (even empty ones) so they can be drop/move
    // targets; merge in any group ids referenced only by connections.
    const groupIds = new Set<string | null>();
    effectiveGroups.forEach((g) => groupIds.add(g.id));
    groupedConnections.forEach((_conns, gid) => {
      if (gid) groupIds.add(gid);
    });

    // Render grouped connections first, then the ungrouped ones at the root.
    groupIds.forEach((groupId) => {
      if (!groupId) return;
      const groupConnections = groupedConnections.get(groupId) ?? [];
      const connectionNodes = groupConnections.map(buildConnectionNode);
      const group = effectiveGroups.find((g) => g.id === groupId);
      const groupName = group?.name || `Group ${groupId.substring(0, 8)}`;
      groupNodes.push({
        id: `group:${groupId}`,
        label: groupName,
        icon: <Folder className="w-4 h-4 text-amber-500" />,
        children: connectionNodes.length > 0 ? connectionNodes : undefined,
        data: { groupId, groupName, type: "group" },
      });
    });

    // Ungrouped connections render directly under the root.
    const ungrouped = groupedConnections.get(null) ?? [];
    ungrouped.forEach((connection) => {
      groupNodes.push(buildConnectionNode(connection));
    });

    // Root node: "My Connections"
    return [
      {
        id: "root",
        label: t("explorer.myConnections"),
        icon: <FolderOpen className="w-4 h-4 text-yellow-500" />,
        children: groupNodes,
        data: { type: "root" },
      },
    ];
  }, [sessions, connections, sessionData, effectiveGroups, starredIds, t]);

  // Client-side recursive filter over the ALREADY-BUILT treeNodes. A node is
  // kept when its label matches the query (case-insensitive substring) OR any
  // descendant matches; the ancestor ids of every match are collected so their
  // branches can be force-expanded (via TreeView's forceExpandedIds) and the
  // matches stay visible.
  //
  // NOTE: this only filters nodes that are already loaded into the tree. Lazily
  // loaded children that have never been expanded (and thus aren't in the tree
  // yet) won't match — that's the accepted quick-win behavior.
  const { displayNodes, forceExpandedIds } = useMemo<{
    displayNodes: TreeNode[];
    forceExpandedIds: Set<string> | undefined;
  }>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      // No active query: render the normal unfiltered tree and let TreeView keep
      // the user's existing expansion (no forced expansion).
      return { displayNodes: treeNodes, forceExpandedIds: undefined };
    }

    const expand = new Set<string>();

    // Returns the filtered copy of `node` if it (or a descendant) matches, else
    // null. Ancestors of any match are recorded in `expand`.
    const filterNode = (node: TreeNode): TreeNode | null => {
      const selfMatches = node.label.toLowerCase().includes(query);

      const filteredChildren = node.children
        ? node.children
            .map(filterNode)
            .filter((c): c is TreeNode => c !== null)
        : [];

      if (filteredChildren.length > 0) {
        // A descendant matched — keep this node expanded so the match shows.
        expand.add(node.id);
      }

      if (selfMatches) {
        // The node itself matches: keep it with its full (unfiltered) subtree so
        // the user can still explore everything under the match.
        return { ...node };
      }
      if (filteredChildren.length > 0) {
        // Only a descendant matched: prune to the matching children.
        return { ...node, children: filteredChildren };
      }
      return null;
    };

    const filtered = treeNodes
      .map(filterNode)
      .filter((n): n is TreeNode => n !== null);

    return { displayNodes: filtered, forceExpandedIds: expand };
  }, [treeNodes, searchQuery]);

  // Auto-expand a connection's node the moment it connects (a session appears),
  // so its databases show without a manual click. TreeView expands each id once.
  const autoExpandIds = useMemo(
    () => sessions.map((s) => `session:${s.id}`),
    [sessions]
  );

  const isSearching = searchQuery.trim().length > 0;

  const handleSelect = (node: TreeNode) => {
    setSelectedNodeId(node.id);
    // Clicking the "Tables" category node shows the full table list on the right.
    const data = node.data as {
      type?: string;
      category?: string;
      sessionId?: string;
      database?: string;
      schema?: string;
      table?: string;
      routine?: string;
      trigger?: string;
      matview?: string;
    };
    if (
      data?.type === "category" &&
      data.category === "tables" &&
      data.sessionId &&
      data.database
    ) {
      loadTables(data.sessionId, data.database, data.schema);
      onSelectTableList?.(data.sessionId, data.database);
    }

    // Feed the Information pane: emit the selected leaf object (table / view /
    // routine / trigger) as an InfoPaneTarget; clear it (null) for any other
    // node so the pane resets to its placeholder. The leaf node's `data` keys
    // the object name differently per kind (table/view → `table`, routine →
    // `routine`, trigger → `trigger`, matview → `matview`).
    if (onSelectObject) {
      let target: InfoPaneTarget | null = null;
      if (data?.sessionId && data.database) {
        const base = {
          sessionId: data.sessionId,
          database: data.database,
          schema: data.schema ?? null,
        };
        if (data.type === "table" && data.table) {
          target = { ...base, kind: "table", name: data.table };
        } else if (data.type === "view" && data.table) {
          target = { ...base, kind: "view", name: data.table };
        } else if (data.type === "matview" && data.matview) {
          target = { ...base, kind: "view", name: data.matview };
        } else if (data.type === "routine" && data.routine) {
          target = { ...base, kind: "routine", name: data.routine };
        } else if (data.type === "trigger" && data.trigger) {
          target = { ...base, kind: "trigger", name: data.trigger };
        }
      }
      onSelectObject(target);
    }
  };

  const findNodeById = (nodes: TreeNode[], id: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const handleToggle = (nodeId: string, isExpanded: boolean) => {
    if (!isExpanded) return;


    // Find the node to get its data
    const node = findNodeById(treeNodes, nodeId);

    if (!node) return;

    const data = node.data as {
      type?: string;
      sessionId?: string;
      database?: string;
      schema?: string;
      category?: string;
    };

    // Expanding a Postgres database node lazily loads its schema list; for
    // MySQL/SQLite it loads tables directly (no schema tier).
    if (data?.type === "database" && data.sessionId && data.database) {
      if (dialectFor(data.sessionId) === "postgres") {
        loadSchemas(data.sessionId, data.database);
      } else {
        loadTables(data.sessionId, data.database);
      }
    } else if (data?.type === "schema" && data.sessionId && data.database) {
      // Expanding a Postgres schema node loads that schema's tables eagerly so
      // the Tables folder isn't empty on first open.
      loadTables(data.sessionId, data.database, data.schema);
    } else if (data?.type === "category" && data.category === "tables" && data.sessionId && data.database) {
      loadTables(data.sessionId, data.database, data.schema);
    } else if (
      data?.type === "category" &&
      data.category === "functions" &&
      data.sessionId &&
      data.database
    ) {
      loadRoutines(data.sessionId, data.database, data.schema);
    } else if (
      data?.type === "category" &&
      data.category === "triggers" &&
      data.sessionId &&
      data.database
    ) {
      loadTriggers(data.sessionId, data.database, data.schema);
    } else if (
      data?.type === "category" &&
      data.category === "events" &&
      data.sessionId &&
      data.database
    ) {
      loadEvents(data.sessionId, data.database);
    } else if (
      data?.type === "category" &&
      data.category === "sequences" &&
      data.sessionId &&
      data.database
    ) {
      loadSequences(data.sessionId, data.database, data.schema);
    } else if (
      data?.type === "category" &&
      data.category === "matviews" &&
      data.sessionId &&
      data.database
    ) {
      loadMaterializedViews(data.sessionId, data.database, data.schema);
    }
  };

  const handleDoubleClick = (node: TreeNode) => {
    const data = node.data as {
      type: string;
      connectionId?: string;
      sessionId?: string;
      database?: string;
      schema?: string;
      table?: string;
      routine?: string;
      routineKind?: RoutineKind;
      triggerInfo?: TriggerInfo;
      event?: string;
      sequence?: string;
      matview?: string;
    };

    if (data.type === "redis-connection" && data.connectionId) {
      // Redis: open the key browser instead of a SQL session.
      const connection = connections.find((c) => c.id === data.connectionId);
      if (connection) {
        onOpenRedis?.(connection);
      }
    } else if (data.type === "mongo-connection" && data.connectionId) {
      // MongoDB: open the document browser instead of a SQL session.
      const connection = connections.find((c) => c.id === data.connectionId);
      if (connection) {
        onOpenMongo?.(connection);
      }
    } else if (data.type === "connection" && data.connectionId) {
      const connection = connections.find((c) => c.id === data.connectionId);
      if (connection) {
        onConnect(connection);
      }
    } else if (data.type === "table" && data.sessionId && data.database && data.table) {
      onSelectTable(data.sessionId, data.database, data.table);
    } else if (data.type === "view" && data.sessionId && data.database && data.table) {
      // Double-clicking a view opens it in the View designer (edit mode).
      onEditView?.(data.sessionId, data.database, data.table, data.schema);
    } else if (
      data.type === "routine" &&
      data.sessionId &&
      data.database &&
      data.routine &&
      data.routineKind
    ) {
      // Double-clicking a routine opens it in the Routine editor (edit mode).
      onEditRoutine?.(data.sessionId, data.database, data.routine, data.routineKind, data.schema);
    } else if (
      data.type === "trigger" &&
      data.sessionId &&
      data.database &&
      data.triggerInfo
    ) {
      // Double-clicking a trigger opens it in the Trigger designer (edit mode).
      onEditTrigger?.(data.sessionId, data.database, data.triggerInfo, data.schema);
    } else if (data.type === "event" && data.sessionId && data.database && data.event) {
      // Double-clicking an event opens it in the Event designer (edit mode).
      onEditEvent?.(data.sessionId, data.database, data.event);
    } else if (data.type === "sequence" && data.sessionId && data.database && data.sequence) {
      // Double-clicking a sequence opens it in the Sequence designer (edit mode).
      onEditSequence?.(data.sessionId, data.database, data.sequence, data.schema);
    } else if (data.type === "matview" && data.sessionId && data.database && data.matview) {
      // Materialized views reuse the View designer; there is no body round-trip
      // here, so open it in create mode pre-set to Materialized as a pragmatic
      // entry point (the user re-enters the SELECT). Edit-from-definition is a
      // follow-up.
      onNewMaterializedView?.(data.sessionId, data.database, data.schema);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  /** Re-fetch a session's database list and update the tree. */
  const reloadDatabases = async (sessionId: string) => {
    try {
      const databases = await getDatabases(sessionId);
      setSessionData((prev) => {
        const next = new Map(prev);
        const data = next.get(sessionId);
        if (data) next.set(sessionId, { ...data, databases });
        return next;
      });
    } catch (err) {
      console.error("Failed to reload databases:", err);
    }
  };

  /** Prompt for a name and CREATE DATABASE on the session, then refresh. */
  const handleCreateDatabase = async (sessionId: string) => {
    const dialect = dialectFor(sessionId);
    if (!dialect || dialect === "sqlite" || !executeQuery) return;
    const name = (await dialogs.prompt({ title: t("explorer.newDatabasePrompt") }))?.trim();
    if (!name) return;
    try {
      await executeQuery(sessionId, `CREATE DATABASE ${quoteIdent(dialect, name)}`);
      await reloadDatabases(sessionId);
    } catch (err) {
      toast.error(
        t("explorer.createDatabaseFailed", {
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  };

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    // Reload the saved connections list as well, not just active-session tables.
    try {
      await onRefreshConnections?.();
    } catch (e) {
      console.error("Failed to refresh connections:", e);
    }
    for (const session of sessions) {
      try {
        // Remember which databases were previously expanded (had tables loaded)
        const prevData = sessionData.get(session.id);
        const prevLoadedDatabases = prevData ? Array.from(prevData.tables.keys()) : [];

        const databases = await getDatabases(session.id);
        setSessionData((prev) => {
          const next = new Map(prev);
          next.set(session.id, {
            databases,
            schemas: new Map(),
            loadingSchemas: new Set(),
            tables: new Map(),
            routines: new Map(),
            triggers: new Map(),
            events: new Map(),
            sequences: new Map(),
            materializedViews: new Map(),
            loadingDatabases: false,
            loadingTables: new Set(),
            loadingRoutines: new Set(),
            loadingTriggers: new Set(),
            loadingEvents: new Set(),
            loadingSequences: new Set(),
            loadingMaterializedViews: new Set(),
          });
          return next;
        });

        // Re-fetch tables for databases that were previously loaded
        for (const dbName of prevLoadedDatabases) {
          if (databases.includes(dbName)) {
            try {
              const tables = await getTables(session.id, dbName);
              setSessionData((prev) => {
                const next = new Map(prev);
                const d = next.get(session.id);
                if (d) {
                  const newTables = new Map(d.tables);
                  newTables.set(dbName, tables);
                  next.set(session.id, { ...d, tables: newTables });
                }
                return next;
              });
            } catch (err) {
              console.error(`Failed to refresh tables for ${dbName}:`, err);
            }
          }
        }
      } catch (err) {
        console.error("Failed to refresh databases:", err);
      }
    }
    setRefreshing(false);
  };

  // Shared connection context-menu actions (star toggle + move-to-group). Used
  // by both the connected (session) and disconnected (connection) node menus.
  const renderConnectionExtras = (connectionId: string | undefined) => {
    if (!connectionId) return null;
    const conn = connections.find((c) => c.id === connectionId);
    const isStarred = starredIds.has(connectionId);
    return (
      <>
        <div className="my-1 border-t border-border" />
        <button
          onClick={() => {
            toggleStar(connectionId);
            closeContextMenu();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
        >
          {isStarred ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
          {isStarred ? t("explorer.unstar") : t("explorer.star")}
        </button>
        <div className="my-1 border-t border-border" />
        <div className="px-3 py-1 text-xs text-muted-foreground">{t("explorer.moveToGroup")}</div>
        {effectiveGroups.map((g) => (
          <button
            key={g.id}
            disabled={(conn?.group_id ?? null) === g.id}
            onClick={() => {
              void handleMoveConnectionToGroup(connectionId, g.id);
              closeContextMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-default"
          >
            <Folder className="w-4 h-4 text-amber-500" />
            {g.name}
          </button>
        ))}
        {conn?.group_id && (
          <button
            onClick={() => {
              void handleMoveConnectionToGroup(connectionId, null);
              closeContextMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
          >
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
            {t("explorer.noGroup")}
          </button>
        )}
        <button
          onClick={() => {
            void (async () => {
              const name = (await dialogs.prompt({ title: t("explorer.newGroupPrompt") }))?.trim();
              if (!name) return;
              try {
                const created = await createGroup({ name });
                await handleMoveConnectionToGroup(connectionId, created.id);
              } catch (err) {
                console.error("Failed to create group:", err);
                toast.error(t("explorer.createGroupFailed", { error: err instanceof Error ? err.message : String(err) }));
              }
            })();
            closeContextMenu();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
        >
          <FolderPlus className="w-4 h-4" />
          {t("explorer.newGroup")}
        </button>
      </>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">{t("explorer.title")}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void handleCreateGroup()}
            className="p-1 hover:bg-secondary rounded transition-colors"
            title={t("explorer.newGroup")}
          >
            <FolderPlus className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1 hover:bg-secondary rounded transition-colors disabled:opacity-50"
            title={t("explorer.refresh")}
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Object search/filter */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("explorer.searchPlaceholder")}
            className="w-full pl-8 pr-8 py-1.5 text-sm bg-secondary rounded-lg border border-input focus:outline-none focus:ring-2 focus:ring-primary transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-secondary rounded transition-colors"
              title={t("explorer.clearSearch")}
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-auto p-2">
        {treeNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Database className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {t("explorer.noConnections")}
            </p>
          </div>
        ) : isSearching && displayNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Search className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">{t("explorer.noMatches")}</p>
          </div>
        ) : (
          <TreeView
            nodes={displayNodes}
            selectedId={selectedNodeId}
            forceExpandedIds={forceExpandedIds}
            autoExpandIds={autoExpandIds}
            onSelect={handleSelect}
            onToggle={handleToggle}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
          />
        )}
      </div>

      {/* Transfer Wizard */}
      {transferState && (
        <TransferWizard
          sourceSession={transferState.sourceSession}
          sourceDatabase={transferState.sourceDatabase}
          sourceTables={transferState.sourceTables}
          preselectedTables={transferState.preselected}
          sessions={sessions}
          connections={connections}
          onClose={() => setTransferState(null)}
        />
      )}

      {/* Import from file */}
      {importState && (
        <ImportModal
          targetSession={importState.sessionId}
          targetDatabase={importState.database}
          targetTable={importState.table}
          mode={importState.mode}
          sessions={sessions}
          connections={connections}
          onClose={() => setImportState(null)}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
          <div
            className="fixed bg-popover border border-border rounded-lg shadow-lg z-50 py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {(() => {
              const data = contextMenu.node.data as { type: string; connectionId?: string; sessionId?: string };

              if (data.type === "redis-connection") {
                // Redis connections open the key browser (no SQL connect).
                const connection = connections.find((c) => c.id === data.connectionId);
                return (
                  <>
                    <button
                      onClick={() => {
                        if (connection) onOpenRedis?.(connection);
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <KeyRound className="w-4 h-4" />
                      {t("explorer.connect")}
                    </button>
                    <button
                      onClick={() => {
                        if (connection) onEditConnection(connection);
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                      {t("explorer.edit")}
                    </button>
                    <button
                      onClick={async () => {
                        if (data.connectionId) {
                          if (await dialogs.confirm({ title: t("explorer.deleteConnectionConfirm", { name: connection?.name ?? "" }), danger: true })) {
                            onDeleteConnection(data.connectionId);
                          }
                        }
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("explorer.delete")}
                    </button>
                    {renderConnectionExtras(data.connectionId)}
                  </>
                );
              }

              if (data.type === "mongo-connection") {
                // Mongo connections open the document browser (no SQL connect).
                const connection = connections.find((c) => c.id === data.connectionId);
                return (
                  <>
                    <button
                      onClick={() => {
                        if (connection) onOpenMongo?.(connection);
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <Leaf className="w-4 h-4" />
                      {t("explorer.connect")}
                    </button>
                    <button
                      onClick={() => {
                        if (connection) onEditConnection(connection);
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                      {t("explorer.edit")}
                    </button>
                    <button
                      onClick={async () => {
                        if (data.connectionId) {
                          if (await dialogs.confirm({ title: t("explorer.deleteConnectionConfirm", { name: connection?.name ?? "" }), danger: true })) {
                            onDeleteConnection(data.connectionId);
                          }
                        }
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("explorer.delete")}
                    </button>
                    {renderConnectionExtras(data.connectionId)}
                  </>
                );
              }

              if (data.type === "connection") {
                const connection = connections.find((c) => c.id === data.connectionId);
                return (
                  <>
                    <button
                      onClick={() => {
                        if (connection) onConnect(connection);
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <PlugZap className="w-4 h-4" />
                      {t("explorer.connect")}
                    </button>
                    <button
                      onClick={() => {
                        if (connection) onEditConnection(connection);
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                      {t("explorer.edit")}
                    </button>
                    <button
                      onClick={async () => {
                        if (data.connectionId) {
                          if (await dialogs.confirm({ title: t("explorer.deleteConnectionConfirm", { name: connection?.name ?? "" }), danger: true })) {
                            onDeleteConnection(data.connectionId);
                          }
                        }
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("explorer.delete")}
                    </button>
                    {renderConnectionExtras(data.connectionId)}
                  </>
                );
              }

              if (data.type === "session") {
                // Server Monitor is only meaningful for server engines; SQLite is
                // an embedded engine with no server process, so gate it out.
                const showMonitor =
                  !!onServerMonitor &&
                  !!data.sessionId &&
                  dialectFor(data.sessionId) !== "sqlite";
                const canCreateDatabase =
                  !!executeQuery &&
                  !!data.sessionId &&
                  dialectFor(data.sessionId) !== "sqlite";
                return (
                  <>
                    {canCreateDatabase && (
                      <button
                        onClick={() => {
                          if (data.sessionId) void handleCreateDatabase(data.sessionId);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        {t("explorer.newDatabase")}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (data.sessionId) onDisconnect(data.sessionId);
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Unplug className="w-4 h-4" />
                      {t("explorer.disconnect")}
                    </button>
                    {showMonitor && (
                      <button
                        onClick={() => {
                          if (data.sessionId) onServerMonitor!(data.sessionId);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Gauge className="w-4 h-4" />
                        {t("explorer.serverMonitor")}
                      </button>
                    )}
                    {renderConnectionExtras(data.connectionId)}
                  </>
                );
              }

              // Group node + the root "My Connections" node both offer "New Group…".
              if (data.type === "group" || data.type === "root") {
                return (
                  <button
                    onClick={() => {
                      void handleCreateGroup();
                      closeContextMenu();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    <FolderPlus className="w-4 h-4" />
                    {t("explorer.newGroup")}
                  </button>
                );
              }

              // Database node - show "New Query", "Transfer to…", and "Paste here"
              if (data.type === "database") {
                const dbData = data as { sessionId?: string; database?: string };
                return (
                  <>
                    {onNewQuery && (
                      <button
                        onClick={() => {
                          const initialQuery = dbData.database ? `-- Database: ${dbData.database}\n\n` : '';

                          // Get connection ID from session
                          const session = sessions.find(s => s.id === dbData.sessionId);
                          const connectionId = session?.connection_id;

                          onNewQuery(initialQuery, connectionId, dbData.database);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <FilePlus className="w-4 h-4" />
                        {t("explorer.newQuery")}
                      </button>
                    )}
                    {onNewView && dbData.sessionId && dbData.database && (
                      <button
                        onClick={() => {
                          onNewView(dbData.sessionId!, dbData.database!);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                        {t("explorer.newView")}
                      </button>
                    )}
                    {onNewRoutine &&
                      dbData.sessionId &&
                      dbData.database &&
                      dialectFor(dbData.sessionId) !== "sqlite" && (
                        <button
                          onClick={() => {
                            onNewRoutine(dbData.sessionId!, dbData.database!, "function");
                            closeContextMenu();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                          <FileCode className="w-4 h-4" />
                          {t("explorer.newFunction")}
                        </button>
                      )}
                    {onNewMaterializedView &&
                      dbData.sessionId &&
                      dbData.database &&
                      dialectFor(dbData.sessionId) === "postgres" && (
                        <button
                          onClick={() => {
                            onNewMaterializedView(dbData.sessionId!, dbData.database!);
                            closeContextMenu();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                          <Layers className="w-4 h-4" />
                          {t("explorer.newMaterializedView")}
                        </button>
                      )}
                    {onNewSequence &&
                      dbData.sessionId &&
                      dbData.database &&
                      dialectFor(dbData.sessionId) === "postgres" && (
                        <button
                          onClick={() => {
                            onNewSequence(dbData.sessionId!, dbData.database!);
                            closeContextMenu();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                          <ListOrdered className="w-4 h-4" />
                          {t("explorer.newSequence")}
                        </button>
                      )}
                    {onNewEvent &&
                      dbData.sessionId &&
                      dbData.database &&
                      dialectFor(dbData.sessionId) === "mysql" && (
                        <button
                          onClick={() => {
                            onNewEvent(dbData.sessionId!, dbData.database!);
                            closeContextMenu();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                          <CalendarClock className="w-4 h-4" />
                          {t("explorer.newEvent")}
                        </button>
                      )}
                    {onShowErd && dbData.sessionId && dbData.database && (
                      <button
                        onClick={() => {
                          onShowErd(dbData.sessionId!, dbData.database!);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Network className="w-4 h-4" />
                        {t("explorer.showErd")}
                      </button>
                    )}
                    {onStructureSync && dbData.sessionId && dbData.database && (
                      <button
                        onClick={() => {
                          onStructureSync(dbData.sessionId!, dbData.database!);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <GitCompareArrows className="w-4 h-4" />
                        {t("explorer.structureSync")}
                      </button>
                    )}
                    {onDataSync && dbData.sessionId && dbData.database && (
                      <button
                        onClick={() => {
                          onDataSync(dbData.sessionId!, dbData.database!);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <GitCompareArrows className="w-4 h-4" />
                        {t("explorer.dataSync")}
                      </button>
                    )}
                    {dbData.sessionId && dbData.database && (() => {
                      const session = sessions.find(s => s.id === dbData.sessionId);
                      if (!session) return null;
                      const tables = sessionData.get(dbData.sessionId!)?.tables.get(dbData.database!) ?? [];
                      return (
                        <>
                          <button
                            onClick={() => {
                              setTransferState({
                                sourceSession: session,
                                sourceDatabase: dbData.database!,
                                sourceTables: tables,
                                preselected: tables.map(t => t.name),
                              });
                              closeContextMenu();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                          >
                            <ArrowRightLeft className="w-4 h-4" />
                            {t("explorer.transferTo")}
                          </button>
                          <button
                            onClick={() => {
                              requestPaste({ kind: "node", sessionId: session.id, database: dbData.database! });
                              closeContextMenu();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                          >
                            {t("explorer.pasteHere")}
                          </button>
                          <button
                            onClick={() => {
                              setImportState({
                                sessionId: session.id,
                                database: dbData.database!,
                                mode: "new",
                              });
                              closeContextMenu();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                          >
                            <FileUp className="w-4 h-4" />
                            {t("explorer.importFromFile")}
                          </button>
                          {onDumpDatabase && (
                            <button
                              onClick={() => {
                                onDumpDatabase(session.id, dbData.database!);
                                closeContextMenu();
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                            >
                              <DatabaseBackup className="w-4 h-4" />
                              {t("explorer.dumpSqlBackup")}
                            </button>
                          )}
                          {onExecuteSqlFile && (
                            <button
                              onClick={() => {
                                onExecuteSqlFile(session.id, dbData.database!);
                                closeContextMenu();
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                            >
                              <PlayCircle className="w-4 h-4" />
                              {t("explorer.executeSqlFile")}
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </>
                );
              }

              // Schema node (Postgres) - schema-scoped create actions + ERD/sync.
              if (data.type === "schema") {
                const schemaData = data as { sessionId?: string; database?: string; schema?: string };
                const sid = schemaData.sessionId;
                const db = schemaData.database;
                const sch = schemaData.schema;
                if (!sid || !db) return null;
                return (
                  <>
                    {onNewQuery && (
                      <button
                        onClick={() => {
                          const session = sessions.find((s) => s.id === sid);
                          onNewQuery(`-- Database: ${db}${sch ? ` / Schema: ${sch}` : ""}\n\n`, session?.connection_id, db);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <FilePlus className="w-4 h-4" />
                        {t("explorer.newQuery")}
                      </button>
                    )}
                    {onNewView && (
                      <button
                        onClick={() => {
                          onNewView(sid, db, sch);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                        {t("explorer.newView")}
                      </button>
                    )}
                    {onNewRoutine && (
                      <button
                        onClick={() => {
                          onNewRoutine(sid, db, "function", sch);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <FileCode className="w-4 h-4" />
                        {t("explorer.newFunction")}
                      </button>
                    )}
                    {onNewSequence && (
                      <button
                        onClick={() => {
                          onNewSequence(sid, db, sch);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <ListOrdered className="w-4 h-4" />
                        {t("explorer.newSequence")}
                      </button>
                    )}
                    {onNewMaterializedView && (
                      <button
                        onClick={() => {
                          onNewMaterializedView(sid, db, sch);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Layers className="w-4 h-4" />
                        {t("explorer.newMaterializedView")}
                      </button>
                    )}
                    {onShowErd && (
                      <button
                        onClick={() => {
                          onShowErd(sid, db, sch);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Network className="w-4 h-4" />
                        {t("explorer.showErd")}
                      </button>
                    )}
                    {onStructureSync && (
                      <button
                        onClick={() => {
                          onStructureSync(sid, db, sch);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <GitCompareArrows className="w-4 h-4" />
                        {t("explorer.structureSync")}
                      </button>
                    )}
                  </>
                );
              }

              // Table or View node - show "New Query" with SELECT, "Copy", and "Transfer to…"
              if (data.type === "table" || data.type === "view") {
                const tableData = data as { sessionId?: string; database?: string; schema?: string; table?: string };
                return (
                  <>
                    {onNewQuery && (
                      <button
                        onClick={() => {
                          const tableName = tableData.table || '';
                          const database = tableData.database || '';
                          // Use fully qualified table name (database.table) if database is available
                          const qualifiedTableName = database ? `\`${database}\`.\`${tableName}\`` : `\`${tableName}\``;
                          const initialQuery = `SELECT * FROM ${qualifiedTableName} LIMIT 100;`;

                          // Get connection ID from session
                          const session = sessions.find(s => s.id === tableData.sessionId);
                          const connectionId = session?.connection_id;

                          onNewQuery(initialQuery, connectionId, database);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <FilePlus className="w-4 h-4" />
                        {t("explorer.newQuery")}
                      </button>
                    )}
                    {data.type === "view" && onEditView && tableData.sessionId && tableData.database && tableData.table && (
                      <button
                        onClick={() => {
                          onEditView(tableData.sessionId!, tableData.database!, tableData.table!, tableData.schema);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                        {t("explorer.editView")}
                      </button>
                    )}
                    {data.type === "table" && onNewTrigger && tableData.sessionId && tableData.database && tableData.table && (
                      <button
                        onClick={() => {
                          onNewTrigger(tableData.sessionId!, tableData.database!, tableData.table!, tableData.schema);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Zap className="w-4 h-4" />
                        {t("explorer.newTrigger")}
                      </button>
                    )}
                    {tableData.sessionId && tableData.database && tableData.table && (() => {
                      const session = sessions.find(s => s.id === tableData.sessionId);
                      if (!session) return null;
                      const conn = connections.find(c => c.id === session.connection_id);
                      // Use already-loaded table list if available; fall back to a synthetic entry.
                      // Postgres caches tables under a database+schema composite key.
                      const allTables = sessionData.get(tableData.sessionId!)?.tables.get(dbKey(tableData.database!, tableData.schema)) ?? [];
                      const sourceTables: TableInfo[] = allTables.length > 0
                        ? allTables
                        : [{ name: tableData.table! } as TableInfo];
                      return (
                        <>
                          {conn && (
                            <button
                              onClick={() => {
                                const source: SourceRef = {
                                  sessionId: session.id,
                                  connectionId: conn.id,
                                  dbType: conn.driver,
                                  // Use the database the clicked table node belongs to (a session
                                  // can browse databases other than the one it opened with).
                                  database: tableData.database ?? session.database ?? conn.database ?? "",
                                  schema: tableData.schema ?? null,
                                };
                                clipboardStore.set({
                                  kind: "table-ref",
                                  source,
                                  tables: [{ name: tableData.table!, schema: tableData.schema ?? null }],
                                });
                                closeContextMenu();
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                            >
                              {t("explorer.copy")}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setTransferState({
                                sourceSession: session,
                                sourceDatabase: tableData.database!,
                                sourceTables,
                                preselected: [tableData.table!],
                              });
                              closeContextMenu();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                          >
                            <ArrowRightLeft className="w-4 h-4" />
                            {t("explorer.transferTo")}
                          </button>
                          {data.type === "table" && (
                            <button
                              onClick={() => {
                                setImportState({
                                  sessionId: session.id,
                                  database: tableData.database!,
                                  table: tableData.table!,
                                  mode: "existing",
                                });
                                closeContextMenu();
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                            >
                              <FileUp className="w-4 h-4" />
                              {t("explorer.importFromFile")}
                            </button>
                          )}
                          {data.type === "table" && onDumpDatabase && (
                            <button
                              onClick={() => {
                                // The dump modal seeds its checklist from the
                                // database's full table list; open it scoped to
                                // this table's database so the user can confirm.
                                onDumpDatabase(session.id, tableData.database!);
                                closeContextMenu();
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                            >
                              <DatabaseBackup className="w-4 h-4" />
                              {t("explorer.dumpSql")}
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </>
                );
              }

              // Category nodes (Tables, Views, etc.) - show "New Query" and,
              // on the Views category, a "New View" action.
              if (data.type === "category") {
                const categoryData = data as {
                  database?: string;
                  sessionId?: string;
                  schema?: string;
                  category?: string;
                };
                return (
                  <>
                    {onNewQuery && (
                      <button
                        onClick={() => {
                          const initialQuery = categoryData.database ? `-- Database: ${categoryData.database}\n\n` : '';
                          onNewQuery(initialQuery);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <FilePlus className="w-4 h-4" />
                        {t("explorer.newQuery")}
                      </button>
                    )}
                    {categoryData.category === "views" &&
                      onNewView &&
                      categoryData.sessionId &&
                      categoryData.database && (
                        <button
                          onClick={() => {
                            onNewView(categoryData.sessionId!, categoryData.database!, categoryData.schema);
                            closeContextMenu();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                          {t("explorer.newView")}
                        </button>
                      )}
                    {categoryData.category === "functions" &&
                      onNewRoutine &&
                      categoryData.sessionId &&
                      categoryData.database && (
                        <>
                          <button
                            onClick={() => {
                              onNewRoutine(categoryData.sessionId!, categoryData.database!, "function", categoryData.schema);
                              closeContextMenu();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                          >
                            <FileCode className="w-4 h-4" />
                            {t("explorer.newFunction")}
                          </button>
                          <button
                            onClick={() => {
                              onNewRoutine(categoryData.sessionId!, categoryData.database!, "procedure", categoryData.schema);
                              closeContextMenu();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                          >
                            <FileCode className="w-4 h-4" />
                            {t("explorer.newProcedure")}
                          </button>
                        </>
                      )}
                    {categoryData.category === "events" &&
                      onNewEvent &&
                      categoryData.sessionId &&
                      categoryData.database && (
                        <button
                          onClick={() => {
                            onNewEvent(categoryData.sessionId!, categoryData.database!);
                            closeContextMenu();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                          <CalendarClock className="w-4 h-4" />
                          {t("explorer.newEvent")}
                        </button>
                      )}
                    {categoryData.category === "sequences" &&
                      onNewSequence &&
                      categoryData.sessionId &&
                      categoryData.database && (
                        <button
                          onClick={() => {
                            onNewSequence(categoryData.sessionId!, categoryData.database!, categoryData.schema);
                            closeContextMenu();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                          <ListOrdered className="w-4 h-4" />
                          {t("explorer.newSequence")}
                        </button>
                      )}
                    {categoryData.category === "matviews" &&
                      onNewMaterializedView &&
                      categoryData.sessionId &&
                      categoryData.database && (
                        <button
                          onClick={() => {
                            onNewMaterializedView(categoryData.sessionId!, categoryData.database!, categoryData.schema);
                            closeContextMenu();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                          <Layers className="w-4 h-4" />
                          {t("explorer.newMaterializedView")}
                        </button>
                      )}
                  </>
                );
              }

              // Routine node (function / procedure) - edit action.
              if (data.type === "routine") {
                const routineData = data as {
                  sessionId?: string;
                  database?: string;
                  routine?: string;
                  routineKind?: RoutineKind;
                };
                if (
                  !onEditRoutine ||
                  !routineData.sessionId ||
                  !routineData.database ||
                  !routineData.routine ||
                  !routineData.routineKind
                ) {
                  return null;
                }
                return (
                  <button
                    onClick={() => {
                      onEditRoutine(
                        routineData.sessionId!,
                        routineData.database!,
                        routineData.routine!,
                        routineData.routineKind!
                      );
                      closeContextMenu();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    {routineData.routineKind === "procedure" ? t("explorer.editProcedure") : t("explorer.editFunction")}
                  </button>
                );
              }

              // Trigger node - edit + drop actions.
              if (data.type === "trigger") {
                const triggerData = data as {
                  sessionId?: string;
                  database?: string;
                  schema?: string;
                  triggerInfo?: TriggerInfo;
                };
                if (!triggerData.sessionId || !triggerData.database || !triggerData.triggerInfo) {
                  return null;
                }
                const info = triggerData.triggerInfo;
                return (
                  <>
                    {onEditTrigger && (
                      <button
                        onClick={() => {
                          onEditTrigger(triggerData.sessionId!, triggerData.database!, info, triggerData.schema);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                        {t("explorer.editTrigger")}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        void handleDropTrigger(triggerData.sessionId!, triggerData.database!, info, triggerData.schema);
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("explorer.dropTrigger")}
                    </button>
                  </>
                );
              }

              // Event node (MySQL) - edit + drop actions.
              if (data.type === "event") {
                const eventData = data as {
                  sessionId?: string;
                  database?: string;
                  event?: string;
                };
                if (!eventData.sessionId || !eventData.database || !eventData.event) {
                  return null;
                }
                const evName = eventData.event;
                return (
                  <>
                    {onEditEvent && (
                      <button
                        onClick={() => {
                          onEditEvent(eventData.sessionId!, eventData.database!, evName);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                        {t("explorer.editEvent")}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        void handleDropNamedObject(
                          eventData.sessionId!,
                          eventData.database!,
                          evName,
                          t("explorer.objectEvent"),
                          () => buildDropEvent(evName),
                          loadEvents,
                          "events",
                        );
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("explorer.dropEvent")}
                    </button>
                  </>
                );
              }

              // Sequence node (Postgres) - edit + drop actions.
              if (data.type === "sequence") {
                const seqData = data as {
                  sessionId?: string;
                  database?: string;
                  schema?: string;
                  sequence?: string;
                };
                if (!seqData.sessionId || !seqData.database || !seqData.sequence) {
                  return null;
                }
                const seqName = seqData.sequence;
                return (
                  <>
                    {onEditSequence && (
                      <button
                        onClick={() => {
                          onEditSequence(seqData.sessionId!, seqData.database!, seqName, seqData.schema);
                          closeContextMenu();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                        {t("explorer.editSequence")}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        void handleDropNamedObject(
                          seqData.sessionId!,
                          seqData.database!,
                          seqName,
                          t("explorer.objectSequence"),
                          () => buildDropSequence(seqData.schema ?? null, seqName),
                          loadSequences,
                          "sequences",
                          seqData.schema,
                        );
                        closeContextMenu();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("explorer.dropSequence")}
                    </button>
                  </>
                );
              }

              // Materialized view node (Postgres) - drop action. Editing a
              // matview definition is a follow-up (no body round-trip yet).
              if (data.type === "matview") {
                const mvData = data as {
                  sessionId?: string;
                  database?: string;
                  schema?: string;
                  matview?: string;
                };
                if (!mvData.sessionId || !mvData.database || !mvData.matview) {
                  return null;
                }
                const mvName = mvData.matview;
                return (
                  <button
                    onClick={() => {
                      void handleDropNamedObject(
                        mvData.sessionId!,
                        mvData.database!,
                        mvName,
                        t("explorer.objectMaterializedView"),
                        () => [buildDropMaterializedView("postgres", mvData.schema ?? null, mvName)],
                        loadMaterializedViews,
                        "materializedViews",
                        mvData.schema,
                      );
                      closeContextMenu();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t("explorer.dropMaterializedView")}
                  </button>
                );
              }

              return null;
            })()}
          </div>
        </>
      )}
    </div>
  );
}

export default DatabaseExplorer;
