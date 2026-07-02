import { useState, useEffect } from "react";
import { Play, Square, Save, Database, Clock, AlignLeft, Server, History, Star, ListChecks, TextSelect, Network, Code2, Sparkles, ChevronDown, Search, Wand2 } from "lucide-react";
import type { SessionInfo } from "../../types";
import type { AskAiAction } from "../../lib/aiPrompts";
import { useConnections } from "../../hooks/useConnections";
import { databaseCommands } from "../../lib/tauri-commands";
import { useTranslation } from "../../i18n";

const ASK_AI_ACTIONS: { id: AskAiAction; labelKey: string }[] = [
  { id: "explain", labelKey: "query.askAiExplain" },
  { id: "optimize", labelKey: "query.askAiOptimize" },
  { id: "convert", labelKey: "query.askAiConvert" },
  { id: "fix", labelKey: "query.askAiFix" },
];

interface QueryToolbarProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  isExecuting: boolean;
  executionTime?: number;
  onExecute: () => void;
  onCancel: () => void;
  onSave: () => void;
  onFormat: () => void;
  /** Run the entire buffer (all statements). */
  onRunAll?: () => void;
  /** Run the current editor selection (disabled when nothing is selected). */
  onRunSelected?: () => void;
  /** Whether the editor currently has a non-empty selection. */
  hasSelection?: boolean;
  /** EXPLAIN the current statement / selection. */
  onExplain?: () => void;
  /** Open the editor's native Find / Replace widget. */
  onFindReplace?: () => void;
  /** Open the visual SELECT builder modal. */
  onOpenBuilder?: () => void;
  /** Ask the AI assistant about the current SQL (explain/optimize/convert/fix). */
  onAskAi?: (action: AskAiAction) => void;
  onSessionChange: (sessionId: string) => void;
  onConnectionChange?: (connectionId: string, database?: string) => void;
  /** Toggle the query-history side panel. */
  onToggleHistory?: () => void;
  /** Whether the history panel is currently open (for active styling). */
  historyOpen?: boolean;
  /** Toggle the saved-queries side panel. */
  onToggleFavorites?: () => void;
  /** Whether the saved-queries panel is currently open (for active styling). */
  favoritesOpen?: boolean;
  /** Toggle the snippet-library side panel. */
  onToggleSnippets?: () => void;
  /** Whether the snippet panel is currently open (for active styling). */
  snippetsOpen?: boolean;
}

function QueryToolbar({
  sessions,
  activeSessionId,
  isExecuting,
  executionTime,
  onExecute,
  onCancel,
  onSave,
  onFormat,
  onRunAll,
  onRunSelected,
  hasSelection,
  onExplain,
  onFindReplace,
  onOpenBuilder,
  onAskAi,
  onSessionChange,
  onConnectionChange,
  onToggleHistory,
  historyOpen,
  onToggleFavorites,
  favoritesOpen,
  onToggleSnippets,
  snippetsOpen,
}: QueryToolbarProps) {
  const { t } = useTranslation();
  const { connections } = useConnections();
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [selectedDatabase, setSelectedDatabase] = useState<string>("");
  const [databases, setDatabases] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  // "Ask AI" action menu (Explain / Optimize / Convert / Fix).
  const [askAiMenuOpen, setAskAiMenuOpen] = useState(false);

  // Get current session info
  const currentSession = sessions.find(s => s.id === activeSessionId);

  // Update selected connection and database when active session changes
  useEffect(() => {
    if (currentSession) {
      setSelectedConnectionId(currentSession.connection_id);
      setSelectedDatabase(currentSession.database || "");
    }
  }, [currentSession]);

  // Load databases when connection changes
  useEffect(() => {
    const loadDatabases = async () => {
      if (!selectedConnectionId) {
        setDatabases([]);
        return;
      }

      // Find session for this connection to get databases
      const session = sessions.find(s => s.connection_id === selectedConnectionId);
      if (!session) {
        setDatabases([]);
        return;
      }

      setLoadingDatabases(true);
      try {
        const dbs = await databaseCommands.getDatabases(session.id);
        setDatabases(dbs);
      } catch (err) {
        console.error("Failed to load databases:", err);
        setDatabases([]);
      } finally {
        setLoadingDatabases(false);
      }
    };

    loadDatabases();
  }, [selectedConnectionId, sessions]);

  const handleConnectionChange = (connectionId: string) => {
    setSelectedConnectionId(connectionId);
    setSelectedDatabase("");

    // Find or create session for this connection
    const session = sessions.find(s => s.connection_id === connectionId);
    if (session) {
      onSessionChange(session.id);
    } else if (onConnectionChange) {
      onConnectionChange(connectionId);
    }
  };

  const handleDatabaseChange = (database: string) => {
    setSelectedDatabase(database);

    if (onConnectionChange && selectedConnectionId) {
      onConnectionChange(selectedConnectionId, database);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background">
      {/* Execute Button */}
      <button
        onClick={isExecuting ? onCancel : onExecute}
        disabled={!activeSessionId}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
          isExecuting
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        }`}
        title={isExecuting ? t("query.cancelTooltip") : t("query.executeTooltip")}
      >
        {isExecuting ? (
          <>
            <Square className="w-4 h-4" />
            {t("query.cancel")}
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            {t("query.execute")}
          </>
        )}
      </button>

      {/* Run All (whole buffer, multi-statement) */}
      {onRunAll && (
        <button
          onClick={onRunAll}
          disabled={!activeSessionId || isExecuting}
          className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("query.runAllTooltip")}
        >
          <ListChecks className="w-4 h-4 text-muted-foreground" />
          {t("query.runAll")}
        </button>
      )}

      {/* Run Selected (current selection only) */}
      {onRunSelected && (
        <button
          onClick={onRunSelected}
          disabled={!activeSessionId || isExecuting || !hasSelection}
          className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("query.runSelectedTooltip")}
        >
          <TextSelect className="w-4 h-4 text-muted-foreground" />
          {t("query.runSelected")}
        </button>
      )}

      {/* Explain */}
      {onExplain && (
        <button
          onClick={onExplain}
          disabled={!activeSessionId || isExecuting}
          className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("query.explainTooltip")}
        >
          <Network className="w-4 h-4 text-muted-foreground" />
          {t("query.explain")}
        </button>
      )}

      {/* SQL Builder (visual SELECT builder modal) */}
      {onOpenBuilder && (
        <button
          onClick={onOpenBuilder}
          disabled={!activeSessionId}
          className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("query.sqlBuilderTooltip")}
        >
          <Wand2 className="w-4 h-4 text-muted-foreground" />
          {t("query.sqlBuilder")}
        </button>
      )}

      {/* Ask AI (Explain / Optimize / Convert / Fix) */}
      {onAskAi && (
        <div className="relative">
          <button
            onClick={() => setAskAiMenuOpen((o) => !o)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg hover:bg-secondary transition-colors"
            title={t("query.askAiTooltip")}
          >
            <Sparkles className="w-4 h-4 text-primary" />
            {t("query.askAi")}
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
          {askAiMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setAskAiMenuOpen(false)}
              />
              <div className="absolute top-full left-0 z-50 mt-1 min-w-[150px] rounded-md border border-border bg-popover py-1 shadow-lg">
                {ASK_AI_ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setAskAiMenuOpen(false);
                      onAskAi(a.id);
                    }}
                    className="flex w-full items-center px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    {t(a.labelKey)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Save Button */}
      <button
        onClick={onSave}
        className="p-2 hover:bg-secondary rounded-lg transition-colors"
        title={t("query.saveTooltip")}
      >
        <Save className="w-4 h-4 text-muted-foreground" />
      </button>

      {/* Format Button */}
      <button
        onClick={onFormat}
        className="p-2 hover:bg-secondary rounded-lg transition-colors"
        title={t("query.formatTooltip")}
      >
        <AlignLeft className="w-4 h-4 text-muted-foreground" />
      </button>

      {/* Find / Replace Button */}
      {onFindReplace && (
        <button
          onClick={onFindReplace}
          className="p-2 hover:bg-secondary rounded-lg transition-colors"
          title={t("query.findReplaceTooltip")}
        >
          <Search className="w-4 h-4 text-muted-foreground" />
        </button>
      )}

      {/* History Toggle */}
      {onToggleHistory && (
        <button
          onClick={onToggleHistory}
          className={`p-2 rounded-lg transition-colors ${
            historyOpen ? "bg-secondary text-foreground" : "hover:bg-secondary"
          }`}
          title={t("query.history")}
        >
          <History className={`w-4 h-4 ${historyOpen ? "text-foreground" : "text-muted-foreground"}`} />
        </button>
      )}

      {/* Favorites Toggle */}
      {onToggleFavorites && (
        <button
          onClick={onToggleFavorites}
          className={`p-2 rounded-lg transition-colors ${
            favoritesOpen ? "bg-secondary text-foreground" : "hover:bg-secondary"
          }`}
          title={t("query.savedQueries")}
        >
          <Star className={`w-4 h-4 ${favoritesOpen ? "text-foreground" : "text-muted-foreground"}`} />
        </button>
      )}

      {/* Snippets Toggle */}
      {onToggleSnippets && (
        <button
          onClick={onToggleSnippets}
          className={`p-2 rounded-lg transition-colors ${
            snippetsOpen ? "bg-secondary text-foreground" : "hover:bg-secondary"
          }`}
          title={t("query.snippets")}
        >
          <Code2 className={`w-4 h-4 ${snippetsOpen ? "text-foreground" : "text-muted-foreground"}`} />
        </button>
      )}

      <div className="w-px h-6 bg-border mx-1" />

      {/* Connection Selector */}
      <div className="flex items-center gap-2">
        <Server className="w-4 h-4 text-muted-foreground" />
        <select
          value={selectedConnectionId}
          onChange={(e) => handleConnectionChange(e.target.value)}
          className="bg-secondary text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary min-w-[150px]"
        >
          <option value="" disabled>
            {t("query.selectConnection")}
          </option>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </select>
      </div>

      {/* Database Selector */}
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-muted-foreground" />
        <select
          value={selectedDatabase}
          onChange={(e) => handleDatabaseChange(e.target.value)}
          disabled={!selectedConnectionId || loadingDatabases}
          className="bg-secondary text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary min-w-[150px] disabled:opacity-50"
        >
          <option value="">
            {loadingDatabases ? t("query.loading") : t("query.selectDatabase")}
          </option>
          {databases.map((db) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))}
        </select>
      </div>

      {/* Execution Time */}
      {executionTime !== undefined && (
        <div className="ml-auto flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span>{executionTime}ms</span>
        </div>
      )}
    </div>
  );
}

export default QueryToolbar;
