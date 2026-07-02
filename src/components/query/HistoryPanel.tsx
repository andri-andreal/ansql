import { useMemo } from "react";
import { CheckCircle2, XCircle, Trash2, History, RefreshCw, X, Download } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useHistory } from "../../hooks/useHistory";
import { buildDelimitedText } from "../../lib/exportFormats";
import { useTranslation } from "../../i18n";

interface HistoryPanelProps {
  /** Connection whose history to show. */
  connectionId: string | null;
  /** Load a history item's SQL into the active editor tab. */
  onLoadQuery: (sql: string) => void;
  /** Close the panel. */
  onClose: () => void;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function snippet(sql: string, max = 90): string {
  const collapsed = sql.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/**
 * Side/bottom panel listing recent query executions for the current connection.
 * Click an item to load its SQL into the active editor; "Clear" wipes history.
 */
function HistoryPanel({ connectionId, onLoadQuery, onClose }: HistoryPanelProps) {
  const { t } = useTranslation();
  const { history, loading, error, refresh, clear } = useHistory(connectionId);

  const items = useMemo(() => history, [history]);

  // Export the visible history entries to a CSV file. Columns mirror the
  // panel's own fields; rows project each entry onto those columns. Built via
  // the shared buildDelimitedText builder and written through plugin-fs.
  const handleExportCsv = async () => {
    if (items.length === 0) return;
    const columns = [
      { name: "timestamp" },
      { name: "success" },
      { name: "execution_time_ms" },
      { name: "row_count" },
      { name: "query" },
      { name: "error" },
    ];
    const rows = items.map((item) => ({
      timestamp: item.created_at,
      success: item.success,
      execution_time_ms: item.execution_time_ms,
      row_count: item.row_count ?? null,
      query: item.query,
      error: item.error_message ?? null,
    }));
    try {
      const filePath = await save({
        title: t("query.exportHistoryTitle"),
        defaultPath: "query-history.csv",
        filters: [{ name: t("query.csvFiles"), extensions: ["csv"] }],
      });
      if (!filePath) return;
      const csv = buildDelimitedText(columns, rows);
      await writeTextFile(filePath, csv);
    } catch (err) {
      console.error("Failed to export history:", err);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background border-l border-border w-80">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium">
          <History className="w-4 h-4 text-muted-foreground" />
          {t("query.history")}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            className="p-1.5 hover:bg-secondary rounded transition-colors"
            title={t("query.refresh")}
          >
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => void handleExportCsv()}
            disabled={items.length === 0}
            className="p-1.5 hover:bg-secondary rounded transition-colors disabled:opacity-40"
            title={t("query.exportHistoryTooltip")}
          >
            <Download className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={clear}
            disabled={items.length === 0}
            className="p-1.5 hover:bg-secondary rounded transition-colors disabled:opacity-40"
            title={t("query.clearHistory")}
          >
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-secondary rounded transition-colors"
            title={t("query.close")}
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {!connectionId ? (
          <div className="p-4 text-xs text-muted-foreground">
            {t("query.selectConnectionForHistory")}
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-destructive">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            {loading ? t("query.loadingEllipsis") : t("query.noHistory")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li
                key={item.id}
                onClick={() => onLoadQuery(item.query)}
                className="px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
                title={t("query.clickToLoad")}
              >
                <div className="flex items-start gap-2">
                  {item.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-green-500" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-foreground break-words">
                      {snippet(item.query)}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{formatTimestamp(item.created_at)}</span>
                      <span>·</span>
                      <span>{item.execution_time_ms}ms</span>
                      {item.row_count !== undefined && item.row_count !== null && (
                        <>
                          <span>·</span>
                          <span>{t("query.rowsCount", { count: item.row_count })}</span>
                        </>
                      )}
                    </div>
                    {!item.success && item.error_message && (
                      <p className="mt-1 text-[10px] text-destructive break-words">
                        {item.error_message}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default HistoryPanel;
