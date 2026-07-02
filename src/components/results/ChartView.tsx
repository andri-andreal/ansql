import { useMemo, useState } from "react";
import { X, BarChart3, LineChart as LineChartIcon, AreaChart as AreaChartIcon, PieChart as PieChartIcon } from "lucide-react";
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
import { buildChartData, type ChartType } from "../../lib/chartData";
import { useTranslation } from "../../i18n";

export interface ChartViewProps {
  result: QueryResult;
  onClose: () => void;
}

const CHART_TYPES: { type: ChartType; labelKey: string; Icon: typeof BarChart3 }[] = [
  { type: "bar", labelKey: "query.chartBar", Icon: BarChart3 },
  { type: "line", labelKey: "query.chartLine", Icon: LineChartIcon },
  { type: "area", labelKey: "query.chartArea", Icon: AreaChartIcon },
  { type: "pie", labelKey: "query.chartPie", Icon: PieChartIcon },
];

// Stable palette for series / pie slices.
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

export function ChartView({ result, onClose }: ChartViewProps) {
  const { t } = useTranslation();
  const columnNames = useMemo(() => result.columns.map((c) => c.name), [result.columns]);

  const [chartType, setChartType] = useState<ChartType>("bar");
  // Default X to the first column, Y to the second (when present).
  const [xColumn, setXColumn] = useState<string>(() => columnNames[0] ?? "");
  const [yColumns, setYColumns] = useState<string[]>(() =>
    columnNames.length > 1 ? [columnNames[1]] : []
  );

  const toggleYColumn = (col: string) => {
    setYColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const { rows, numericYColumns } = useMemo(
    () => buildChartData(result, { type: chartType, xColumn, yColumns }),
    [result, chartType, xColumn, yColumns]
  );

  // Pie charts plot a single series — use the first selected numeric column.
  const pieKey = numericYColumns[0];

  const renderChart = () => {
    if (rows.length === 0 || numericYColumns.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          {t("query.pickAxes")}
        </div>
      );
    }

    if (chartType === "pie") {
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

    if (chartType === "line") {
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

    if (chartType === "area") {
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
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar: chart type + axis pickers */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Chart type */}
          <div className="flex items-center gap-1">
            {CHART_TYPES.map(({ type, labelKey, Icon }) => {
              const label = t(labelKey);
              return (
                <button
                  key={type}
                  onClick={() => setChartType(type)}
                  className={`flex items-center gap-1.5 px-2 py-1 text-sm rounded transition-colors ${
                    chartType === type
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-secondary text-muted-foreground"
                  }`}
                  title={t("query.chartTypeTooltip", { type: label })}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              );
            })}
          </div>

          {/* X column */}
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            X
            <select
              value={xColumn}
              onChange={(e) => setXColumn(e.target.value)}
              className="px-2 py-1 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {columnNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          {/* Y columns (multi-select via toggles) */}
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Y
            <div className="flex items-center gap-1 flex-wrap">
              {columnNames
                .filter((name) => name !== xColumn)
                .map((name) => (
                  <button
                    key={name}
                    onClick={() => toggleYColumn(name)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      yColumns.includes(name)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-secondary"
                    }`}
                    title={t("query.toggleSeries", { name })}
                  >
                    {name}
                  </button>
                ))}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          title={t("query.closeChart")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Chart area */}
      <div className="flex-1 p-3 overflow-hidden">{renderChart()}</div>
    </div>
  );
}
