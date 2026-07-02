import { useState, useCallback, useEffect } from "react";
import { AlertCircle, ChevronUp, ChevronDown, Copy } from "lucide-react";
import { format } from "sql-formatter";
import QueryTabs from "./QueryTabs";
import QueryToolbar from "./QueryToolbar";
import QueryEditor from "./QueryEditor";
import ResultTabs from "./ResultTabs";
import HistoryPanel from "./HistoryPanel";
import SavedQueriesPanel from "./SavedQueriesPanel";
import SaveFavoriteDialog from "./SaveFavoriteDialog";
import ResultsGrid from "../results/ResultsGrid";
import { useQueries, resultEntryToQueryResult } from "../../hooks/useQueries";
import { useExport } from "../../hooks/useExport";
import { clipboardStore } from "../../lib/clipboardStore";
import { saveFavoriteQuery } from "../../lib/queryPanelCommands";
import type { SessionInfo, QueryResult, Connection, SourceRef } from "../../types";

interface QueryPanelProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSessionChange: (sessionId: string) => void;
  onConnectionChange?: (connectionId: string, database?: string) => void;
  connections: Connection[];
  /** Called when the last query tab is closed, so the host can leave the query view. */
  onExitQuery?: () => void;
  onResultChange?: (result: QueryResult | null) => void;
}

function QueryPanel({
  sessions,
  activeSessionId,
  onSessionChange,
  onConnectionChange,
  connections,
  onExitQuery,
  onResultChange,
}: QueryPanelProps) {
  const {
    tabs,
    activeTabId,
    activeTab,
    executing,
    error,
    createTab,
    closeTab,
    setActiveTabId,
    updateTabContent,
    executeQuery,
    cancelQuery,
    getResults,
    getActiveResult,
    getActiveResultId,
    selectResult,
    closeResult,
  } = useQueries();

  const { exportToCSV, exportToJSON } = useExport();

  const [resultsPanelHeight, setResultsPanelHeight] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const [showResults, setShowResults] = useState(true);

  // Side panels (history / saved queries) and the save dialog.
  const [showHistory, setShowHistory] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  // Bumped after a save so the SavedQueriesPanel reloads.
  const [favoritesSignal, setFavoritesSignal] = useState(0);

  // Resolve the active session + its connection/database for schema-aware
  // autocomplete and history/favorites scoping.
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeConnection = connections.find(
    (c) => c.id === activeSession?.connection_id
  );
  const activeConnectionId = activeSession?.connection_id ?? null;
  const activeDatabase = activeSession?.database ?? activeConnection?.database ?? null;

  const resultEntries = activeTabId ? getResults(activeTabId) : [];
  const activeResultEntry = activeTabId ? getActiveResult(activeTabId) : null;
  const activeResultId = activeTabId ? getActiveResultId(activeTabId) : null;
  const currentResult: QueryResult | null =
    activeResultEntry && !activeResultEntry.error
      ? resultEntryToQueryResult(activeResultEntry)
      : null;
  // The active result's error (per-result), falling back to the hook-level error.
  const activeError = activeResultEntry?.error ?? null;

  // Guard against `null === null`: with no active tab there is nothing executing.
  const isExecuting = activeTabId !== null && executing === activeTabId;

  // When every tab is closed, ask the host to leave the query view instead of
  // stranding the user on an empty query page.
  useEffect(() => {
    if (tabs.length === 0) onExitQuery?.();
  }, [tabs.length, onExitQuery]);

  // Surface the current result to the host so a global Export button can use it.
  useEffect(() => {
    onResultChange?.(currentResult);
    return () => onResultChange?.(null);
  }, [currentResult, onResultChange]);
  // Only offer "Copy as source" when the active session + its connection are
  // still resolvable — a displayed result can outlive its session after disconnect.
  const copySourceReady = !!currentResult && !!activeConnection;

  const handleExecute = useCallback(async () => {
    if (!activeSessionId || !activeTabId) return;
    try {
      await executeQuery(activeSessionId, activeTabId);
      setShowResults(true);
    } catch (err) {
      console.error("Query execution failed:", err);
    }
  }, [activeSessionId, activeTabId, executeQuery]);

  const handleCancel = useCallback(async () => {
    await cancelQuery();
  }, [cancelQuery]);

  // Open the "Save to Favorites" dialog for the active editor's SQL.
  const handleSave = useCallback(() => {
    if (!activeTab?.content.trim()) return;
    setShowSaveDialog(true);
  }, [activeTab]);

  const handleConfirmSave = useCallback(
    async (name: string, description?: string) => {
      if (!activeTab) return;
      await saveFavoriteQuery({
        name,
        description,
        connection_id: activeConnectionId ?? undefined,
        database: activeDatabase ?? undefined,
        query: activeTab.content,
      });
      setShowSaveDialog(false);
      setFavoritesSignal((n) => n + 1);
    },
    [activeTab, activeConnectionId, activeDatabase]
  );

  // Load a query (from history/favorites) into the active editor tab, creating
  // one if none exists.
  const handleLoadQuery = useCallback(
    (sql: string) => {
      if (activeTabId) {
        updateTabContent(activeTabId, sql);
      } else {
        const tab = createTab();
        updateTabContent(tab.id, sql);
      }
    },
    [activeTabId, updateTabContent, createTab]
  );

  const handleExport = useCallback(async (format: "csv" | "json") => {
    if (!currentResult) return;
    try {
      if (format === "csv") {
        await exportToCSV(currentResult, activeTab?.title);
      } else {
        await exportToJSON(currentResult, activeTab?.title);
      }
    } catch (err) {
      console.error("Export failed:", err);
    }
  }, [currentResult, activeTab, exportToCSV, exportToJSON]);

  const handleFormat = useCallback(() => {
    if (!activeTabId || !activeTab) return;
    try {
      // Format the SQL query
      const formatted = format(activeTab.content, {
        language: "mysql",
        tabWidth: 2,
        keywordCase: "upper",
        indentStyle: "standard",
      });
      updateTabContent(activeTabId, formatted);
    } catch (err) {
      console.error("Format failed:", err);
    }
  }, [activeTabId, activeTab, updateTabContent]);

  const handleCopyAsSource = useCallback(() => {
    const session = activeSession;
    const conn = activeConnection;
    if (session && conn && currentResult && activeTab?.content) {
      const source: SourceRef = {
        sessionId: session.id,
        connectionId: conn.id,
        dbType: conn.driver,
        database: session.database ?? conn.database ?? "",
        schema: null,
      };
      clipboardStore.set({
        kind: "query-ref",
        source,
        sql: activeTab.content,
        columns: currentResult.columns.map((c) => ({ name: c.name, data_type: c.data_type, nullable: c.nullable })),
      });
    }
  }, [activeSession, activeConnection, currentResult, activeTab]);

  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isResizing) return;
      const container = e.currentTarget as HTMLElement;
      const rect = container.getBoundingClientRect();
      const newHeight = rect.bottom - e.clientY;
      setResultsPanelHeight(Math.max(100, Math.min(newHeight, rect.height - 100)));
    },
    [isResizing]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Opening one side panel closes the other (they share the same dock).
  const toggleHistory = useCallback(() => {
    setShowHistory((v) => {
      const next = !v;
      if (next) setShowFavorites(false);
      return next;
    });
  }, []);
  const toggleFavorites = useCallback(() => {
    setShowFavorites((v) => {
      const next = !v;
      if (next) setShowHistory(false);
      return next;
    });
  }, []);

  return (
    <div
      className="h-full flex flex-col"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Query Tabs */}
      <QueryTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onNewTab={createTab}
      />

      {/* Query Toolbar */}
      <QueryToolbar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isExecuting={isExecuting}
        executionTime={currentResult?.execution_time_ms}
        onExecute={handleExecute}
        onCancel={handleCancel}
        onSave={handleSave}
        onFormat={handleFormat}
        onSessionChange={onSessionChange}
        onConnectionChange={onConnectionChange}
        onToggleHistory={toggleHistory}
        historyOpen={showHistory}
        onToggleFavorites={toggleFavorites}
        favoritesOpen={showFavorites}
      />

      {/* Body: editor + results on the left, optional side panel on the right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor and Results */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Editor */}
          <div
            className="flex-1 min-h-[100px]"
            style={{ height: showResults ? `calc(100% - ${resultsPanelHeight}px)` : "100%" }}
          >
            {activeTab ? (
              <QueryEditor
                value={activeTab.content}
                onChange={(value) => updateTabContent(activeTab.id, value)}
                onExecute={handleExecute}
                onFormat={handleFormat}
                sessionId={activeSessionId}
                database={activeDatabase}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No active query tab
              </div>
            )}
          </div>

          {/* Results Panel Toggle */}
          <div
            className="flex items-center justify-between px-3 py-1 bg-secondary border-t border-border cursor-pointer"
            onClick={() => setShowResults(!showResults)}
          >
            <span className="text-xs font-medium text-muted-foreground">
              Results
              {currentResult && ` (${currentResult.rows.length} rows)`}
            </span>
            <div className="flex items-center gap-1">
              {copySourceReady && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopyAsSource(); }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Copy this result as a cross-DB transfer source"
                >
                  <Copy className="w-3 h-3" />
                  Copy as source
                </button>
              )}
              {showResults ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Results Panel */}
          {showResults && (
            <>
              {/* Resize Handle */}
              <div
                className="h-1 bg-border hover:bg-primary cursor-row-resize"
                onMouseDown={handleMouseDown}
              />

              {/* Result tab bar (one tab per execution) */}
              {activeTabId && resultEntries.length > 0 && (
                <ResultTabs
                  results={resultEntries}
                  activeResultId={activeResultId}
                  onSelect={(rid) => selectResult(activeTabId, rid)}
                  onClose={(rid) => closeResult(activeTabId, rid)}
                />
              )}

              {/* Results Content */}
              <div style={{ height: resultsPanelHeight }} className="overflow-hidden">
                {activeError || error ? (
                  <div className="flex items-start gap-3 p-4 bg-destructive/10 text-destructive">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Query Error</p>
                      <p className="text-sm mt-1">{activeError ?? error}</p>
                    </div>
                  </div>
                ) : currentResult ? (
                  <ResultsGrid result={currentResult} onExport={handleExport} />
                ) : isExecuting ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      Executing query...
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    Execute a query to see results
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right dock: history / saved queries */}
        {showHistory && (
          <HistoryPanel
            connectionId={activeConnectionId}
            onLoadQuery={handleLoadQuery}
            onClose={() => setShowHistory(false)}
          />
        )}
        {showFavorites && (
          <SavedQueriesPanel
            connectionId={activeConnectionId}
            onLoadQuery={handleLoadQuery}
            onClose={() => setShowFavorites(false)}
            refreshSignal={favoritesSignal}
          />
        )}
      </div>

      {/* Save to Favorites dialog */}
      <SaveFavoriteDialog
        open={showSaveDialog}
        sql={activeTab?.content ?? ""}
        onCancel={() => setShowSaveDialog(false)}
        onSave={handleConfirmSave}
      />
    </div>
  );
}

export default QueryPanel;
