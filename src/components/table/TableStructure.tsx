import { useState, useEffect } from "react";
import { Columns, Key, Link2, Loader2 } from "lucide-react";
import { useTranslation } from "../../i18n";
import type { ColumnDefinition, IndexInfo, ForeignKeyInfo } from "../../types";

interface TableStructureProps {
  sessionId: string;
  database: string;
  table: string;
  schema?: string;
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
  /** Bumped by the parent to force a re-fetch (e.g. after a designer apply). */
  refreshKey?: number;
}

type Tab = "columns" | "indexes" | "foreign_keys";

function TableStructure({
  sessionId,
  database,
  table,
  schema,
  getColumns,
  getIndexes,
  getForeignKeys,
  refreshKey,
}: TableStructureProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("columns");
  const [columns, setColumns] = useState<ColumnDefinition[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [cols, idxs, fks] = await Promise.all([
          getColumns(sessionId, database, table, schema),
          getIndexes(sessionId, database, table, schema),
          getForeignKeys(sessionId, database, table, schema),
        ]);
        setColumns(cols);
        setIndexes(idxs);
        setForeignKeys(fks);
      } catch (err) {
        console.error("Failed to load table structure:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [sessionId, database, table, schema, getColumns, getIndexes, getForeignKeys, refreshKey]);

  const tabs = [
    { id: "columns" as const, label: t("table.columns"), icon: Columns, count: columns.length },
    { id: "indexes" as const, label: t("table.indexes"), icon: Key, count: indexes.length },
    { id: "foreign_keys" as const, label: t("table.foreignKeys"), icon: Link2, count: foreignKeys.length },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold">{table}</h2>
        <p className="text-sm text-muted-foreground">
          {database}
          {schema && ` / ${schema}`}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            <span className="text-xs bg-secondary px-1.5 py-0.5 rounded">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "columns" && <ColumnsTab columns={columns} />}
        {activeTab === "indexes" && <IndexesTab indexes={indexes} />}
        {activeTab === "foreign_keys" && <ForeignKeysTab foreignKeys={foreignKeys} />}
      </div>
    </div>
  );
}

function ColumnsTab({ columns }: { columns: ColumnDefinition[] }) {
  const { t } = useTranslation();
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-secondary">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.colName")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.colType")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.colNullable")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.colDefault")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.colAttributes")}</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((col) => (
          <tr key={col.name} className="hover:bg-accent/50 transition-colors">
            <td className="px-4 py-2 font-medium">
              {col.name}
              {col.is_primary_key && (
                <span title={t("table.primaryKey")}>
                  <Key className="w-3 h-3 inline ml-1 text-yellow-500" />
                </span>
              )}
            </td>
            <td className="px-4 py-2 text-muted-foreground">{col.data_type}</td>
            <td className="px-4 py-2">
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  col.nullable
                    ? "bg-yellow-500/10 text-yellow-600"
                    : "bg-green-500/10 text-green-600"
                }`}
              >
                {col.nullable ? "NULL" : "NOT NULL"}
              </span>
            </td>
            <td className="px-4 py-2 text-muted-foreground">
              {col.default_value || <span className="text-muted-foreground/50">-</span>}
            </td>
            <td className="px-4 py-2">
              <div className="flex gap-1">
                {col.is_unique && (
                  <span className="text-xs bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded">
                    UNIQUE
                  </span>
                )}
                {col.is_auto_increment && (
                  <span className="text-xs bg-purple-500/10 text-purple-600 px-1.5 py-0.5 rounded">
                    AUTO
                  </span>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IndexesTab({ indexes }: { indexes: IndexInfo[] }) {
  const { t } = useTranslation();
  if (indexes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        {t("table.noIndexesFound")}
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-secondary">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.colName")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.columns")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.colType")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.colAttributes")}</th>
        </tr>
      </thead>
      <tbody>
        {indexes.map((idx) => (
          <tr key={idx.name} className="hover:bg-accent/50 transition-colors">
            <td className="px-4 py-2 font-medium">{idx.name}</td>
            <td className="px-4 py-2 text-muted-foreground">{idx.columns.join(", ")}</td>
            <td className="px-4 py-2 text-muted-foreground">{idx.type || "BTREE"}</td>
            <td className="px-4 py-2">
              <div className="flex gap-1">
                {idx.is_primary && (
                  <span className="text-xs bg-yellow-500/10 text-yellow-600 px-1.5 py-0.5 rounded">
                    PRIMARY
                  </span>
                )}
                {idx.is_unique && !idx.is_primary && (
                  <span className="text-xs bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded">
                    UNIQUE
                  </span>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ForeignKeysTab({ foreignKeys }: { foreignKeys: ForeignKeyInfo[] }) {
  const { t } = useTranslation();
  if (foreignKeys.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        {t("table.noForeignKeysFound")}
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-secondary">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.colName")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.columns")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.references")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.onDelete")}</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">{t("table.onUpdate")}</th>
        </tr>
      </thead>
      <tbody>
        {foreignKeys.map((fk) => (
          <tr key={fk.name} className="hover:bg-accent/50 transition-colors">
            <td className="px-4 py-2 font-medium">{fk.name}</td>
            <td className="px-4 py-2 text-muted-foreground">{fk.columns.join(", ")}</td>
            <td className="px-4 py-2 text-muted-foreground">
              {fk.referenced_table}({fk.referenced_columns.join(", ")})
            </td>
            <td className="px-4 py-2">
              <span className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                {fk.on_delete || "NO ACTION"}
              </span>
            </td>
            <td className="px-4 py-2">
              <span className="text-xs bg-secondary px-1.5 py-0.5 rounded">
                {fk.on_update || "NO ACTION"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default TableStructure;
