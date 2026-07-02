import { useState } from "react";
import { Table, Database, PenLine } from "lucide-react";
import TableStructure from "./TableStructure";
import TableData from "./TableData";
import { useTranslation } from "../../i18n";
import type { ColumnDefinition, IndexInfo, ForeignKeyInfo, QueryResult } from "../../types";

interface TableViewerProps {
  sessionId: string;
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  driver?: string;
  onClose: () => void;
  getColumns: (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ) => Promise<ColumnDefinition[]>;
  getIndexes: (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ) => Promise<IndexInfo[]>;
  getForeignKeys: (
    sessionId: string,
    database: string,
    table: string,
    schema?: string
  ) => Promise<ForeignKeyInfo[]>;
  executeQuery: (
    sessionId: string,
    query: string
  ) => Promise<QueryResult>;
  /** Open the table designer in alter mode for this table. */
  onEditStructure?: () => void;
  /** Bumped by the parent to force the structure tab to re-fetch. */
  refreshKey?: number;
  /**
   * Raw WHERE clause text (sans leading `WHERE`) to seed the Data grid's initial
   * load with — set when this table tab was opened from "Edit results" on a
   * single-table SELECT. Forwarded to {@link TableData}; optional + back-compatible.
   */
  initialWhereSql?: string;
}

type ViewTab = "data" | "structure";

function TableViewer({
  sessionId,
  connectionId,
  database,
  table,
  schema,
  driver,
  onClose: _onClose,
  getColumns,
  getIndexes,
  getForeignKeys,
  executeQuery,
  onEditStructure,
  refreshKey,
  initialWhereSql,
}: TableViewerProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ViewTab>("data");

  const tabs = [
    { id: "data" as const, label: t("table.tabData"), icon: Table },
    { id: "structure" as const, label: t("table.tabStructure"), icon: Database },
  ];

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Tabs — the table name lives in the workspace tab bar above. */}
      <div className="flex border-b border-border px-4 items-center">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
        {onEditStructure && activeTab === "structure" && (
          <button
            onClick={onEditStructure}
            className="ml-auto flex items-center gap-1.5 rounded px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title={t("table.designStructureTooltip")}
          >
            <PenLine className="w-4 h-4" />
            {t("table.design")}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "data" && (
          <TableData
            sessionId={sessionId}
            connectionId={connectionId}
            database={database}
            table={table}
            schema={schema}
            driver={driver}
            executeQuery={executeQuery}
            initialWhereSql={initialWhereSql}
          />
        )}
        {activeTab === "structure" && (
          <TableStructure
            sessionId={sessionId}
            database={database}
            table={table}
            schema={schema}
            getColumns={getColumns}
            getIndexes={getIndexes}
            getForeignKeys={getForeignKeys}
            refreshKey={refreshKey}
          />
        )}
      </div>
    </div>
  );
}

export default TableViewer;
