// WorkspaceArea — the main content row inside the app shell.
// Renders the explorer (left) + the active tab (center) + the right docks
// (Info + AI). Conditionally hidden in Focus Mode.

import { useEffect, useState } from "react";
import { FolderTree, FileCode } from "lucide-react";
import DatabaseExplorer from "../explorer/DatabaseExplorer";
import TableViewer from "../table/TableViewer";
import { TableDesigner } from "../table/TableDesigner";
import { ViewDesigner } from "../view/ViewDesigner";
import { RoutineEditor } from "../routine/RoutineEditor";
import { TriggerDesigner } from "../trigger/TriggerDesigner";
import { EventDesigner } from "../event/EventDesigner";
import { SequenceDesigner } from "../sequence/SequenceDesigner";
import { TableListView } from "../table/TableListView";
import { ErdView } from "../erd/ErdView";
import {
  StructureSyncView,
  type SyncSession,
} from "../sync/StructureSyncView";
import {
  DataSyncView,
  type DataSyncSession,
} from "../sync/DataSyncView";
import { DashboardView } from "../dashboard/DashboardView";
import type { DashboardSessionOption } from "../dashboard/WidgetEditor";
import { TransferWizard } from "../transfer/TransferWizard";
import { ServerMonitorView } from "../monitor/ServerMonitorView";
import { RedisKeyBrowser } from "../redis/RedisKeyBrowser";
import { MongoBrowser } from "../mongo/MongoBrowser";
import QueryDocument from "../query/QueryDocument";
import { InfoPane } from "../common/InfoPane";
import { AiAssistantPane } from "../ai/AiAssistantPane";
import { isFeatureEnabled } from "../../lib/edition";
import { EmptyState } from "../ui";
import { useGroups } from "../../hooks/useGroups";
import { useTranslation } from "../../i18n";
import { makeRedisApi, makeMongoApi } from "../../lib/tauri-commands";
import { isSqlDriver, toDialect } from "../../types";
import type {
  ColumnDefinition,
  ForeignKeyInfo,
  IndexInfo,
  TableGraph,
  TableInfo,
  QueryResult,
  Statement,
  SessionInfo,
  Connection,
} from "../../types";
import type { WorkspaceTab } from "../../lib/workspaceTabs";
import type { AppState } from "../../hooks/useAppState";

const noop = () => {};

export function WorkspaceArea({ app }: { app: AppState }) {
  const { t } = useTranslation();
  const { groups } = useGroups();

  return (
    <div className="flex-1 flex overflow-hidden">
      {!app.focusMode && (
        <div className="w-72 border-r border-border flex-shrink-0">
          <DatabaseExplorer
            connections={app.connections}
            groups={groups}
            sessions={app.sessionsList}
            activeSessionId={app.activeSessionId}
            onRefreshConnections={app.loadConnections}
            onConnect={app.handleConnect}
            onOpenRedis={app.handleOpenRedis}
            onOpenMongo={app.handleOpenMongo}
            onDisconnect={app.disconnect}
            onEditConnection={app.handleEditConnection}
            onDeleteConnection={app.deleteConnection}
            onSelectTable={app.handleSelectTable}
            onSelectTableList={app.handleSelectTableList}
            onSelectObject={app.handleSelectObject}
            onShowErd={app.handleOpenErd}
            onStructureSync={isFeatureEnabled("structureSync") ? app.handleOpenStructureSync : undefined}
            onDataSync={isFeatureEnabled("dataSync") ? app.handleOpenDataSync : undefined}
            onServerMonitor={isFeatureEnabled("serverMonitor") ? app.handleOpenServerMonitor : undefined}
            onNewQuery={app.handleNewQuery}
            onNewView={app.handleNewView}
            onEditView={app.handleEditView}
            onNewRoutine={app.handleNewRoutine}
            onEditRoutine={app.handleEditRoutine}
            onNewTrigger={app.handleNewTrigger}
            onEditTrigger={app.handleEditTrigger}
            onNewEvent={app.handleNewEvent}
            onEditEvent={app.handleEditEvent}
            onNewSequence={app.handleNewSequence}
            onEditSequence={app.handleEditSequence}
            onNewMaterializedView={app.handleNewMaterializedView}
            onDumpDatabase={app.handleOpenBackup}
            onExecuteSqlFile={app.handleOpenExecuteSqlFile}
            executeQuery={app.executeQuery}
            getTables={app.getTables}
            getDatabases={app.getDatabases}
          />
        </div>
      )}

      <div className="flex-1 overflow-hidden relative">
        {app.ws.tabs.length === 0 ? (
          app.sessionsList.length === 0 ? (
            <EmptyState
              icon={<FolderTree className="w-16 h-16" aria-hidden="true" />}
              title={t("shell.noActiveConnections")}
              description={t("shell.connectToExplore")}
              className="h-full"
            />
          ) : (
            <EmptyState
              icon={<FileCode className="w-16 h-16" aria-hidden="true" />}
              title={t("shell.readyToQuery")}
              description={t("shell.startWritingSql")}
              className="h-full"
            />
          )
        ) : (
          app.ws.tabs.map((tab) => (
            <div
              key={tab.id}
              className={tab.id === app.ws.activeId ? "h-full" : "hidden"}
            >
              <WorkspaceTabContent tab={tab} app={app} />
            </div>
          ))
        )}
      </div>

      {app.showInfo && !app.focusMode && (
        <InfoPane
          target={app.infoTarget}
          getColumns={app.getColumns}
          getIndexes={app.getIndexes}
          getForeignKeys={app.getForeignKeys}
          onClose={() => app.setShowInfo(false)}
        />
      )}

      {app.showAi && !app.focusMode && isFeatureEnabled("ai") && (
        <AiAssistantPane
          key={app.aiSeedKey}
          config={app.aiConfig}
          isConfigured={app.aiConfigured}
          onOpenSettings={() => app.setShowSettings(true)}
          onClose={() => app.setShowAi(false)}
          seedMessages={app.aiSeed ?? undefined}
          getSchemaContext={app.getSchemaContext}
          onInsertSql={app.handleInsertSqlFromAi}
        />
      )}

      {app.transferState && (
        <TransferWizard
          sourceSession={app.transferState.sourceSession}
          sourceDatabase={app.transferState.sourceDatabase}
          sourceTables={app.transferState.sourceTables}
          preselectedTables={app.transferState.preselected}
          sessions={app.sessionsList}
          connections={app.connections}
          onClose={() => app.setTransferState(null)}
        />
      )}
    </div>
  );
}

interface TabContentProps {
  tab: WorkspaceTab;
  app: AppState;
}

function WorkspaceTabContent({ tab, app }: TabContentProps) {
  switch (tab.kind) {
    case "table": {
      const p = tab.payload;
      return (
        <TableViewer
          sessionId={p.sessionId}
          connectionId={p.connectionId}
          database={p.database}
          table={p.table}
          schema={p.schema}
          driver={p.driver}
          initialWhereSql={p.initialWhereSql}
          onClose={() => app.ws.closeTab(tab.id)}
          getColumns={app.getColumns}
          getIndexes={app.getIndexes}
          getForeignKeys={app.getForeignKeys}
          executeQuery={app.executeQuery}
          refreshKey={app.tableRefresh}
          onEditStructure={() =>
            app.handleEditStructure(p.sessionId, p.database, p.table, p.schema)
          }
        />
      );
    }
    case "table-list": {
      const p = tab.payload;
      return (
        <TableListView
          sessionId={p.sessionId}
          database={p.database}
          getTables={app.getTables}
          onOpenTable={(table, schema) =>
            app.handleSelectTable(p.sessionId, p.database, table, schema)
          }
          onCopyTables={(tabs) => app.handleCopyTables(p.sessionId, p.database, tabs)}
          onTransferTables={(tabs) => app.handleTransferTables(p.sessionId, p.database, tabs)}
          onDeleteTables={(tabs, force) =>
            app.handleDeleteTables(p.sessionId, p.database, tabs, force)
          }
          onNewTable={app.handleNewTable ? () => app.handleNewTable(p.sessionId, p.database) : undefined}
          refreshKey={app.tableRefresh}
        />
      );
    }
    case "query": {
      const p = tab.payload;
      return (
        <QueryDocument
          tabId={tab.id}
          payload={p}
          onPatch={(patch) => app.ws.updateTabPayload(tab.id, patch)}
          onDirty={(dirty) => app.ws.setDirty(tab.id, dirty)}
          sessions={app.sessionsList}
          connections={app.connections}
          onConnectionChange={app.ensureSession}
          executeQuery={app.executeQueryWithRequestId}
          cancelQuery={app.cancelQueryById}
          onResultChange={tab.id === app.ws.activeId ? app.setActiveResult : noop}
          onAskAi={app.handleAskAi}
          onEditTable={app.handleEditTable}
          onRegisterInsertSql={tab.id === app.ws.activeId ? app.handleRegisterInsertSql : undefined}
          getTables={app.getTables}
          getColumns={app.getColumns}
          getForeignKeys={app.getForeignKeys}
        />
      );
    }
    case "table-designer": {
      const p = tab.payload;
      return (
        <TableDesigner
          mode={p.mode}
          dialect={p.dialect}
          database={p.database}
          schema={p.schema}
          tableName={p.mode === "alter" ? p.tableName : undefined}
          originalColumns={p.mode === "alter" ? p.originalColumns : undefined}
          originalIndexes={p.mode === "alter" ? p.originalIndexes : undefined}
          originalForeignKeys={p.mode === "alter" ? p.originalForeignKeys : undefined}
          listTables={() => app.getTables(p.sessionId, p.database).then((ts) => ts.map((t) => t.name))}
          getTableColumns={(t) =>
            app.getColumns(p.sessionId, p.database, t).then((cs) => cs.map((c) => c.name))
          }
          listTriggers={
            p.mode === "alter"
              ? () => app.getTriggers(p.sessionId, p.database, p.tableName, p.schema)
              : undefined
          }
          onOpenTriggerDesigner={
            p.mode === "alter" && app.handleNewTrigger
              ? () => app.handleNewTrigger(p.sessionId, p.database, p.tableName, p.schema)
              : undefined
          }
          onEditTrigger={
            p.mode === "alter" && app.handleEditTrigger
              ? (trigger) => app.handleEditTrigger(p.sessionId, p.database, trigger, p.schema)
              : undefined
          }
          triggerRefreshKey={app.tableRefresh}
          onApply={(statements) => app.handleApplyDesigner(statements, p.sessionId)}
          onApplied={() => {
            app.bumpTableRefresh();
            app.ws.closeTab(tab.id);
          }}
          onClose={() => app.ws.closeTab(tab.id)}
        />
      );
    }
    case "view-designer": {
      const p = tab.payload;
      return (
        <ViewDesigner
          mode={p.mode}
          dialect={p.dialect}
          database={p.database}
          schema={p.schema}
          viewName={p.mode === "edit" ? p.viewName : undefined}
          initialBody={p.mode === "edit" ? p.initialBody : undefined}
          initialMaterialized={p.materialized}
          onApply={(statements) => app.handleApplyDesigner(statements, p.sessionId)}
          executeQuery={(sql) => app.executeQuery(p.sessionId, sql)}
          onApplied={() => {
            app.bumpTableRefresh();
            app.ws.closeTab(tab.id);
          }}
          onClose={() => app.ws.closeTab(tab.id)}
        />
      );
    }
    case "routine-editor": {
      const p = tab.payload;
      return (
        <RoutineEditor
          mode={p.mode}
          dialect={p.dialect}
          database={p.database}
          schema={p.schema}
          kind={p.kind}
          routineName={p.mode === "edit" ? p.routineName : undefined}
          initialBody={p.mode === "edit" ? p.initialBody : undefined}
          runQuery={(sql) => app.executeQuery(p.sessionId, sql)}
          onApplied={() => {
            app.bumpTableRefresh();
            app.ws.closeTab(tab.id);
          }}
          onClose={() => app.ws.closeTab(tab.id)}
        />
      );
    }
    case "trigger-designer": {
      const p = tab.payload;
      return (
        <TriggerDesigner
          mode={p.mode}
          dialect={p.dialect}
          database={p.database}
          schema={p.schema}
          table={p.table}
          existing={p.mode === "edit" ? p.existing : undefined}
          executeQuery={(sql) => app.executeQuery(p.sessionId, sql)}
          onApplied={() => {
            app.bumpTableRefresh();
            app.ws.closeTab(tab.id);
          }}
          onClose={() => app.ws.closeTab(tab.id)}
        />
      );
    }
    case "event-designer": {
      const p = tab.payload;
      return (
        <EventDesigner
          mode={p.mode}
          sessionId={p.sessionId}
          database={p.database}
          existing={p.mode === "edit" ? p.existing : undefined}
          executeQuery={(sql) => app.executeQuery(p.sessionId, sql)}
          onApplied={() => {
            app.bumpTableRefresh();
            app.ws.closeTab(tab.id);
          }}
          onClose={() => app.ws.closeTab(tab.id)}
        />
      );
    }
    case "sequence-designer": {
      const p = tab.payload;
      return (
        <SequenceDesigner
          mode={p.mode}
          sessionId={p.sessionId}
          database={p.database}
          schema={p.schema}
          existing={p.mode === "edit" ? p.existing : undefined}
          executeQuery={(sql) => app.executeQuery(p.sessionId, sql)}
          onApplied={() => {
            app.bumpTableRefresh();
            app.ws.closeTab(tab.id);
          }}
          onClose={() => app.ws.closeTab(tab.id)}
        />
      );
    }
    case "erd": {
      const p = tab.payload;
      const erdSession = app.sessionsList.find((s) => s.id === p.sessionId);
      const erdConn = erdSession
        ? app.connections.find((c) => c.id === erdSession.connection_id)
        : undefined;
      const erdDialect =
        erdConn && isSqlDriver(erdConn.driver) ? toDialect(erdConn.driver) : "mysql";
      return (
        <ErdView
          sessionId={p.sessionId}
          database={p.database}
          schema={p.schema}
          dialect={erdDialect}
          getTables={app.getTables}
          getColumns={app.getColumns}
          getIndexes={app.getIndexes}
          getForeignKeys={app.getForeignKeys}
          getSchemaGraph={app.getSchemaGraph}
          executeQuery={(sql) => app.executeQuery(p.sessionId, sql)}
          onOpenTable={(table, schema) =>
            app.handleSelectTable(p.sessionId, p.database, table, schema ?? undefined)
          }
        />
      );
    }
    case "structure-sync":
      return (
        <StructureSyncTabHost
          sessions={app.sessionsList}
          connections={app.connections}
          initialSourceSessionId={tab.payload.sourceSessionId}
          initialSourceDatabase={tab.payload.sourceDatabase}
          getTables={app.getTables}
          getDatabases={app.getDatabases}
          getColumns={app.getColumns}
          getIndexes={app.getIndexes}
          getForeignKeys={app.getForeignKeys}
          getSchemaGraph={app.getSchemaGraph}
          executeQuery={app.executeQuery}
        />
      );
    case "data-sync":
      return (
        <DataSyncTabHost
          sessions={app.sessionsList}
          connections={app.connections}
          initialSourceSessionId={tab.payload.sourceSessionId}
          initialSourceDatabase={tab.payload.sourceDatabase}
          getTables={app.getTables}
          getDatabases={app.getDatabases}
          getColumns={app.getColumns}
          executeQuery={app.executeQuery}
          commitChanges={app.commitChanges}
        />
      );
    case "server-monitor": {
      const p = tab.payload;
      const monSession = app.sessionsList.find((s) => s.id === p.sessionId);
      const monConn = monSession
        ? app.connections.find((c) => c.id === monSession.connection_id)
        : undefined;
      const monDialect =
        monConn && isSqlDriver(monConn.driver) ? toDialect(monConn.driver) : "mysql";
      return (
        <ServerMonitorView
          sessionId={p.sessionId}
          dialect={monDialect}
          executeQuery={app.executeQuery}
          onClose={() => app.ws.closeTab(tab.id)}
        />
      );
    }
    case "dashboard":
      return (
        <DashboardTabHost
          sessions={app.sessionsList}
          connections={app.connections}
          getDatabases={app.getDatabases}
          executeQuery={app.executeQuery}
          onClose={() => app.ws.closeTab(tab.id)}
        />
      );
    case "redis-browser": {
      const p = tab.payload;
      return (
        <RedisKeyBrowser
          api={makeRedisApi(p.sessionId)}
          onClose={() => app.ws.closeTab(tab.id)}
        />
      );
    }
    case "mongo-browser": {
      const p = tab.payload;
      return (
        <MongoBrowser
          api={makeMongoApi(p.sessionId)}
          onClose={() => app.ws.closeTab(tab.id)}
        />
      );
    }
  }
}

// --- Per-tab host helpers (build session/db lists for the compare views) ---

interface StructureSyncTabHostProps {
  sessions: SessionInfo[];
  connections: Connection[];
  initialSourceSessionId?: string;
  initialSourceDatabase?: string;
  getTables: (sessionId: string, database: string, schema?: string) => Promise<TableInfo[]>;
  getDatabases: (sessionId: string) => Promise<string[]>;
  getColumns: (sessionId: string, database: string, table: string, schema?: string) => Promise<ColumnDefinition[]>;
  getIndexes: (sessionId: string, database: string, table: string, schema?: string) => Promise<IndexInfo[]>;
  getForeignKeys: (sessionId: string, database: string, table: string, schema?: string) => Promise<ForeignKeyInfo[]>;
  getSchemaGraph: (sessionId: string, database: string, tables: string[], schema?: string) => Promise<TableGraph[]>;
  executeQuery: (sessionId: string, sql: string) => Promise<QueryResult>;
}

function StructureSyncTabHost({ sessions, connections, initialSourceSessionId, initialSourceDatabase, getTables, getDatabases, getColumns, getIndexes, getForeignKeys, getSchemaGraph, executeQuery }: StructureSyncTabHostProps) {
  const [dbsBySession, setDbsBySession] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      sessions.map(async (s) => {
        try {
          return [s.id, await getDatabases(s.id)] as const;
        } catch {
          return [s.id, s.database ? [s.database] : []] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setDbsBySession(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [sessions, getDatabases]);

  const syncSessions: SyncSession[] = sessions.map((s) => {
    const conn = connections.find((c) => c.id === s.connection_id);
    const name = conn?.name ?? "Connection";
    const label = s.database ? `${name} · ${s.database}` : name;
    return {
      id: s.id,
      label,
      databases: dbsBySession.get(s.id) ?? (s.database ? [s.database] : []),
      dialect: conn && isSqlDriver(conn.driver) ? toDialect(conn.driver) : "mysql",
    };
  });

  return (
    <StructureSyncView
      sessions={syncSessions}
      initialSourceSessionId={initialSourceSessionId}
      initialSourceDatabase={initialSourceDatabase}
      getTables={getTables}
      getColumns={getColumns}
      getIndexes={getIndexes}
      getForeignKeys={getForeignKeys}
      getSchemaGraph={getSchemaGraph}
      executeQuery={executeQuery}
    />
  );
}

interface DataSyncTabHostProps {
  sessions: SessionInfo[];
  connections: Connection[];
  initialSourceSessionId?: string;
  initialSourceDatabase?: string;
  getTables: (sessionId: string, database: string, schema?: string) => Promise<TableInfo[]>;
  getDatabases: (sessionId: string) => Promise<string[]>;
  getColumns: (sessionId: string, database: string, table: string, schema?: string) => Promise<ColumnDefinition[]>;
  executeQuery: (sessionId: string, sql: string) => Promise<QueryResult>;
  commitChanges: (sessionId: string, statements: Statement[]) => Promise<unknown>;
}

function DataSyncTabHost({ sessions, connections, initialSourceSessionId, initialSourceDatabase, getTables, getDatabases, getColumns, executeQuery, commitChanges }: DataSyncTabHostProps) {
  const [dbsBySession, setDbsBySession] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      sessions.map(async (s) => {
        try {
          return [s.id, await getDatabases(s.id)] as const;
        } catch {
          return [s.id, s.database ? [s.database] : []] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setDbsBySession(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [sessions, getDatabases]);

  const dataSyncSessions: DataSyncSession[] = sessions.map((s) => {
    const conn = connections.find((c) => c.id === s.connection_id);
    const name = conn?.name ?? "Connection";
    const label = s.database ? `${name} · ${s.database}` : name;
    return {
      id: s.id,
      label,
      databases: dbsBySession.get(s.id) ?? (s.database ? [s.database] : []),
      dialect: conn && isSqlDriver(conn.driver) ? toDialect(conn.driver) : "mysql",
    };
  });

  return (
    <DataSyncView
      sessions={dataSyncSessions}
      initialSourceSessionId={initialSourceSessionId}
      initialSourceDatabase={initialSourceDatabase}
      getTables={getTables}
      getColumns={getColumns}
      executeQuery={executeQuery}
      runOnTarget={(sessionId, statements) =>
        commitChanges(sessionId, statements as Statement[])
      }
      onClose={noop}
    />
  );
}

interface DashboardTabHostProps {
  sessions: SessionInfo[];
  connections: Connection[];
  getDatabases: (sessionId: string) => Promise<string[]>;
  executeQuery: (sessionId: string, sql: string) => Promise<QueryResult>;
  onClose: () => void;
}

function DashboardTabHost({ sessions, connections, getDatabases, executeQuery, onClose }: DashboardTabHostProps) {
  const [dbsBySession, setDbsBySession] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      sessions.map(async (s) => {
        try {
          return [s.id, await getDatabases(s.id)] as const;
        } catch {
          return [s.id, s.database ? [s.database] : []] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setDbsBySession(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [sessions, getDatabases]);

  const dashboardSessions: DashboardSessionOption[] = sessions.map((s) => {
    const conn = connections.find((c) => c.id === s.connection_id);
    const name = conn?.name ?? "Connection";
    const label = s.database ? `${name} · ${s.database}` : name;
    return {
      id: s.id,
      label,
      databases: dbsBySession.get(s.id) ?? (s.database ? [s.database] : []),
      dialect: conn && isSqlDriver(conn.driver) ? toDialect(conn.driver) : "mysql",
    };
  });

  return (
    <DashboardView
      sessions={dashboardSessions}
      executeQuery={(sid, sql) => executeQuery(sid, sql)}
      onClose={onClose}
    />
  );
}
