import { useMemo } from "react";
import { Star, Trash2, RefreshCw, X } from "lucide-react";
import { useFavorites } from "../../hooks/useFavorites";
import { useTranslation } from "../../i18n";

interface SavedQueriesPanelProps {
  /** Connection used to scope/highlight favorites. */
  connectionId: string | null;
  /** Load a favorite's SQL into the active editor tab. */
  onLoadQuery: (sql: string) => void;
  /** Close the panel. */
  onClose: () => void;
  /**
   * Bumping this number triggers a refresh (e.g. after the toolbar saves a new
   * favorite). Optional.
   */
  refreshSignal?: number;
}

function snippet(sql: string, max = 90): string {
  const collapsed = sql.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/**
 * Side panel listing saved/favorite queries, filtered to the current connection.
 * Click loads into the editor; the trash button deletes.
 */
function SavedQueriesPanel({
  connectionId,
  onLoadQuery,
  onClose,
  refreshSignal,
}: SavedQueriesPanelProps) {
  const { t } = useTranslation();
  const { favorites, loading, error, refresh, remove } = useFavorites(connectionId);

  // Re-fetch when the parent signals a save happened.
  useMemo(() => {
    if (refreshSignal !== undefined) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  // Defensive client-side filter: show favorites for this connection plus those
  // not bound to any connection. If no connection is active, show everything.
  const items = useMemo(() => {
    if (!connectionId) return favorites;
    return favorites.filter(
      (f) => !f.connection_id || f.connection_id === connectionId
    );
  }, [favorites, connectionId]);

  return (
    <div className="h-full flex flex-col bg-background border-l border-border w-80">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Star className="w-4 h-4 text-muted-foreground" />
          {t("query.savedQueries")}
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
        {error ? (
          <div className="p-4 text-xs text-destructive">{error}</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            {loading ? t("query.loadingEllipsis") : t("query.noSavedQueries")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li
                key={item.id}
                className="group px-3 py-2 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <div
                    onClick={() => onLoadQuery(item.query)}
                    className="min-w-0 flex-1 cursor-pointer"
                    title={t("query.clickToLoad")}
                  >
                    <p className="text-xs font-medium text-foreground truncate">
                      {item.name}
                    </p>
                    {item.description && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {item.description}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] font-mono text-muted-foreground break-words">
                      {snippet(item.query)}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(item.id)}
                    className="p-1 rounded hover:bg-destructive/20 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    title={t("query.delete")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SavedQueriesPanel;
