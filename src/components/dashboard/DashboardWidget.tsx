import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Pencil,
  Trash,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  LineChart,
  AreaChart,
  PieChart,
  Bar,
  Line,
  Area,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { QueryResult } from "../../types";
import { buildChartData } from "../../lib/chartData";
import type { DashboardWidget as Widget } from "../../hooks/useDashboards";
import { useTranslation } from "../../i18n";

export interface DashboardWidgetProps {
  widget: Widget;
  executeQuery: (sessionId: string, sql: string) => Promise<QueryResult>;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}

// Stable palette for series / pie slices (mirrors ChartView).
const COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

// Widget size -> grid column span + body height.
const SIZE_STYLES: Record<Widget["size"], { span: string; height: string }> = {
  sm: { span: "md:col-span-1", height: "h-48" },
  md: { span: "md:col-span-2", height: "h-64" },
  lg: { span: "md:col-span-3", height: "h-80" },
};

export function DashboardWidget({
  widget,
  executeQuery,
  onEdit,
  onRemove,
  onMove,
}: DashboardWidgetProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { sessionId, query, chart } = widget;

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await executeQuery(sessionId, query);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [executeQuery, sessionId, query]);

  // Load on mount and whenever the source query/session changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const size = SIZE_STYLES[widget.size] ?? SIZE_STYLES.md;

  const renderBody = () => {
    if (!sessionId) {
      return (
        <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">
          {t("io.widgetNotConfigured")}
        </div>
      );
    }

    if (loading && !result) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("io.loadingDots")}
        </div>
      );
    }

    if (error) {
      return (
        <div className="m-3 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      );
    }

    if (!result) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t("io.noData")}
        </div>
      );
    }

    const { rows, numericYColumns } = buildChartData(result, chart);

    if (rows.length === 0 || numericYColumns.length === 0) {
      return (
        <div className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">
          {t("io.noDataToPlot")}
        </div>
      );
    }

    if (chart.type === "pie") {
      const pieKey = numericYColumns[0];
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip />
            <Legend />
            <Pie
              data={rows}
              dataKey={pieKey}
              nameKey="x"
              cx="50%"
              cy="50%"
              outerRadius="70%"
              label
            >
              {rows.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      );
    }

    if (chart.type === "line") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="x" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {numericYColumns.map((col, i) => (
              <Line
                key={col}
                type="monotone"
                dataKey={col}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (chart.type === "area") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="x" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {numericYColumns.map((col, i) => (
              <Area
                key={col}
                type="monotone"
                dataKey={col}
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.3}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    // bar
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="x" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          {numericYColumns.map((col, i) => (
            <Bar key={col} dataKey={col} fill={COLORS[i % COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div
      className={`${size.span} flex flex-col rounded-lg border border-border bg-background shadow-sm`}
    >
      {/* Header: title + actions */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/30 px-3 py-2">
        <span className="truncate text-sm font-medium" title={widget.title}>
          {widget.title}
        </span>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button
            onClick={() => onMove(-1)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title={t("io.moveUp")}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={() => onMove(1)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title={t("io.moveDown")}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            onClick={() => void refresh()}
            disabled={loading || !sessionId}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title={t("io.refresh")}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={onEdit}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title={t("io.editWidget")}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onRemove}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
            title={t("io.removeWidget")}
          >
            <Trash className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Chart body */}
      <div className={`${size.height} overflow-hidden p-2`}>{renderBody()}</div>
    </div>
  );
}
