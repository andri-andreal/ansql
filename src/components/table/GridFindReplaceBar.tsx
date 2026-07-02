import { useEffect, useRef, useState } from "react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Replace,
  Search,
  X,
} from "lucide-react";
import { useTranslation } from "../../i18n";

/**
 * A compact find / replace bar docked at the top of the data grid. The host owns
 * the actual match cursor and the grid mutation; this bar only collects the
 * query / replacement text and options and reports intent through callbacks.
 *
 * - Find input shows a live "current / matchCount" counter.
 * - Prev / next step through matches; match-case toggles case sensitivity.
 * - When `replaceEnabled`, an expandable row adds a replacement input plus
 *   Replace (one) and Replace All. Replace is hidden when editing isn't allowed.
 */
export interface GridFindReplaceBarProps {
  onFind: (query: string, opts: { matchCase: boolean }) => void;
  matchCount: number;
  current: number;
  onNext: () => void;
  onPrev: () => void;
  replaceEnabled: boolean;
  onReplace: (find: string, replace: string, opts: { matchCase: boolean }) => void;
  onReplaceAll: (find: string, replace: string, opts: { matchCase: boolean }) => void;
  onClose: () => void;
}

export function GridFindReplaceBar({
  onFind,
  matchCount,
  current,
  onNext,
  onPrev,
  replaceEnabled,
  onReplace,
  onReplaceAll,
  onClose,
}: GridFindReplaceBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, []);

  // Re-run the search whenever the query or case option changes.
  useEffect(() => {
    onFind(query, { matchCase });
    // onFind is owned by the host and assumed stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase]);

  const hasMatches = matchCount > 0;
  const counter = query ? `${hasMatches ? current + 1 : 0}/${matchCount}` : "";

  const onFindKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5 bg-card border-b border-border shadow-sm">
      {/* Find row */}
      <div className="flex items-center gap-1.5">
        {replaceEnabled && (
          <button
            type="button"
            onClick={() => setShowReplace((s) => !s)}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
            title={showReplace ? t("table.hideReplace") : t("table.showReplace")}
          >
            {showReplace ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        )}

        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
          <input
            ref={findRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onFindKeyDown}
            placeholder={t("table.findInGrid")}
            className="w-full pl-7 pr-16 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground select-none">
            {counter}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setMatchCase((c) => !c)}
          className={`p-1 rounded transition-colors shrink-0 ${
            matchCase
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
          title={t("table.matchCase")}
          aria-pressed={matchCase}
        >
          <CaseSensitive className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onPrev}
          disabled={!hasMatches}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0 disabled:opacity-40 disabled:hover:bg-transparent"
          title={t("table.previousMatch")}
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMatches}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0 disabled:opacity-40 disabled:hover:bg-transparent"
          title={t("table.nextMatch")}
        >
          <ChevronDown className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
          title={t("table.closeEsc")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Replace row */}
      {replaceEnabled && showReplace && (
        <div className="flex items-center gap-1.5 pl-6">
          <div className="relative flex-1 min-w-0">
            <Replace className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
              placeholder={t("table.replaceWith")}
              className="w-full pl-7 pr-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => onReplace(query, replacement, { matchCase })}
            disabled={!query || !hasMatches}
            className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 rounded transition-colors font-medium shrink-0 disabled:opacity-40"
            title={t("table.replaceCurrentMatch")}
          >
            {t("table.replace")}
          </button>
          <button
            type="button"
            onClick={() => onReplaceAll(query, replacement, { matchCase })}
            disabled={!query || !hasMatches}
            className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors font-medium shrink-0 disabled:opacity-40"
            title={t("table.replaceAllMatches")}
          >
            {t("table.all")}
          </button>
        </div>
      )}
    </div>
  );
}

export default GridFindReplaceBar;
