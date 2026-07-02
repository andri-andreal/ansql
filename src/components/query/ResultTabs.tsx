import { useEffect, useRef, useState } from "react";
import { X, AlertCircle, Table2, Pin, PinOff } from "lucide-react";
import type { ResultEntry } from "../../hooks/useQueries";
import { useTranslation } from "../../i18n";

interface ResultTabsProps {
  results: ResultEntry[];
  activeResultId: string | null;
  onSelect: (resultId: string) => void;
  onClose: (resultId: string) => void;
  /** Toggle the pinned flag on a result tab (pinned tabs survive the cap). */
  onTogglePin?: (resultId: string) => void;
  /** Set/clear a result tab's custom label (blank clears it back to the snippet). */
  onRename?: (resultId: string, name: string) => void;
}

/**
 * Tab bar shown above the results grid. One tab per executed query; the label is
 * the custom name (when set) else a short SQL snippet plus the exec time. Newest
 * is auto-selected by the hook. Each tab can be pinned (kept past the cap) and
 * renamed inline by double-clicking the label.
 */
function ResultTabs({
  results,
  activeResultId,
  onSelect,
  onClose,
  onTogglePin,
  onRename,
}: ResultTabsProps) {
  const { t } = useTranslation();
  // Which tab is being inline-renamed, plus the live draft value.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select the input when an edit starts.
  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  const startRename = (r: ResultEntry) => {
    setEditingId(r.id);
    setDraft(r.customName ?? r.snippet ?? "");
  };

  const commitRename = () => {
    if (editingId) onRename?.(editingId, draft);
    setEditingId(null);
    setDraft("");
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraft("");
  };

  if (results.length === 0) return null;

  return (
    <div className="flex items-center border-b border-border bg-secondary/30 overflow-x-auto">
      {results.map((r, i) => {
        const active = r.id === activeResultId;
        const editing = editingId === r.id;
        const label =
          r.customName || r.snippet || t("query.resultLabel", { index: i + 1 });
        return (
          <div
            key={r.id}
            className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-r border-border transition-colors whitespace-nowrap ${
              active
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background/50"
            }`}
            onClick={() => onSelect(r.id)}
            title={r.error ? r.error : r.customName || r.snippet}
          >
            {r.error ? (
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-destructive" />
            ) : (
              <Table2 className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
                className="text-xs bg-background border border-border rounded px-1 py-0 w-[140px] outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <span
                className="text-xs truncate max-w-[160px]"
                onDoubleClick={
                  onRename
                    ? (e) => {
                        e.stopPropagation();
                        startRename(r);
                      }
                    : undefined
                }
                title={onRename ? t("query.doubleClickToRename") : undefined}
              >
                {label}
              </span>
            )}
            {!r.error && !editing && (
              <span className="text-[10px] text-muted-foreground/60">
                {r.execTimeMs}ms
              </span>
            )}
            {onTogglePin && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(r.id);
                }}
                className={`p-0.5 rounded hover:bg-accent transition-opacity ${
                  r.pinned
                    ? "opacity-100 text-primary"
                    : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                }`}
                title={r.pinned ? t("query.unpinResult") : t("query.pinResult")}
              >
                {r.pinned ? (
                  <Pin className="w-3 h-3" />
                ) : (
                  <PinOff className="w-3 h-3" />
                )}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(r.id);
              }}
              className="p-0.5 rounded hover:bg-destructive/20 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              title={t("query.closeResult")}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default ResultTabs;
