import { Loader2, Sigma, X } from "lucide-react";
import { useTranslation } from "../../i18n";
import type { ColumnStats } from "../../lib/gridStats";

/**
 * A small dockable panel summarising one column: total / non-null / null% /
 * distinct / min / max. The host computes `stats` (via gridStats over the data
 * already on screen or a backstage aggregate query) and passes it in; this is a
 * pure presentational view with loading + empty states. Styled to match the
 * existing cell-viewer / review-changes sidebars in TableData.
 */
export interface ColumnStatsPanelProps {
  column: string;
  stats: ColumnStats | null;
  loading: boolean;
  onClose: () => void;
}

/** Format a numeric count with thousands separators ("—" for missing). */
function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString();
}

/** Render a min/max sentinel value as a string ("—" when unknown). */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** Null percentage of the column, rounded to one decimal ("—" when unknown). */
function nullPct(stats: ColumnStats): string {
  if (!stats.total) return "—";
  const nulls = stats.total - stats.nonNull;
  const pct = (nulls / stats.total) * 100;
  // Keep a single decimal but drop a trailing ".0".
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded}%`;
}

export function ColumnStatsPanel({ column, stats, loading, onClose }: ColumnStatsPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="fixed right-0 top-0 bottom-0 w-[300px] bg-card border-l border-border shadow-2xl z-50 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-secondary/30">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2">
            <Sigma className="w-4 h-4 text-primary shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate">{column}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{t("table.columnStatistics")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-lg transition-colors shrink-0"
            title={t("table.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 min-h-0">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("table.computing")}
          </div>
        ) : !stats ? (
          <div className="text-xs text-muted-foreground italic py-8 text-center">
            {t("table.noStatisticsAvailable")}
          </div>
        ) : (
          <dl className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            <StatRow label={t("table.statTotal")} value={fmtCount(stats.total)} />
            <StatRow label={t("table.statNonNull")} value={fmtCount(stats.nonNull)} />
            <StatRow label={t("table.statNullPct")} value={nullPct(stats)} />
            <StatRow label={t("table.statDistinct")} value={fmtCount(stats.distinct)} />
            <StatRow label={t("table.statMin")} value={fmtValue(stats.min)} mono />
            <StatRow label={t("table.statMax")} value={fmtValue(stats.max)} mono />
          </dl>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2 bg-background/50">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd
        className={`text-xs text-foreground text-right break-all tabular-nums ${
          mono ? "font-mono" : "font-medium"
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

export default ColumnStatsPanel;
