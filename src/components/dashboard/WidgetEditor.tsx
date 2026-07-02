import { useMemo, useState } from "react";
import {
  X,
  Play,
  Loader2,
  BarChart3,
  LineChart as LineChartIcon,
  AreaChart as AreaChartIcon,
  PieChart as PieChartIcon,
} from "lucide-react";
import type { DashboardWidget as Widget } from "../../hooks/useDashboards";
import type { ChartType } from "../../lib/chartData";
import type { Dialect, QueryResult } from "../../types";
import { useTranslation } from "../../i18n";

export interface DashboardSessionOption {
  id: string;
  label: string;
  databases: string[];
  dialect: Dialect;
}

export interface WidgetEditorProps {
  initial?: Widget;
  sessions: DashboardSessionOption[];
  executeQuery: (sessionId: string, sql: string) => Promise<QueryResult>;
  onSave: (w: Omit<Widget, "id">) => void;
  onCancel: () => void;
}

const CHART_TYPES: { type: ChartType; labelKey: string; Icon: typeof BarChart3 }[] = [
  { type: "bar", labelKey: "io.chartBar", Icon: BarChart3 },
  { type: "line", labelKey: "io.chartLine", Icon: LineChartIcon },
  { type: "area", labelKey: "io.chartArea", Icon: AreaChartIcon },
  { type: "pie", labelKey: "io.chartPie", Icon: PieChartIcon },
];

const SIZES: { value: Widget["size"]; labelKey: string }[] = [
  { value: "sm", labelKey: "io.sizeSmall" },
  { value: "md", labelKey: "io.sizeMedium" },
  { value: "lg", labelKey: "io.sizeLarge" },
];

/**
 * Modal for creating/editing a dashboard widget. The user picks a session +
 * database, writes a query, runs it to capture the result columns, then maps
 * those columns onto a chart (type, X column, Y columns) and a size. Seeds from
 * {@link WidgetEditorProps.initial} when editing.
 */
export function WidgetEditor({
  initial,
  sessions,
  executeQuery,
  onSave,
  onCancel,
}: WidgetEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [sessionId, setSessionId] = useState(
    initial?.sessionId ?? sessions[0]?.id ?? ""
  );
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [query, setQuery] = useState(initial?.query ?? "");
  const [chartType, setChartType] = useState<ChartType>(
    initial?.chart.type ?? "bar"
  );
  const [xColumn, setXColumn] = useState(initial?.chart.xColumn ?? "");
  const [yColumns, setYColumns] = useState<string[]>(
    initial?.chart.yColumns ?? []
  );
  const [size, setSize] = useState<Widget["size"]>(initial?.size ?? "md");

  const [columns, setColumns] = useState<string[]>(() => {
    // When editing, seed the column list from the saved chart spec so the
    // pickers render even before the query is re-run.
    if (!initial) return [];
    const names = new Set<string>();
    if (initial.chart.xColumn) names.add(initial.chart.xColumn);
    for (const c of initial.chart.yColumns) names.add(c);
    return [...names];
  });
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === sessionId),
    [sessions, sessionId]
  );
  const databases = activeSession?.databases ?? [];

  const toggleYColumn = (col: string) => {
    setYColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleRun = async () => {
    if (!sessionId || !query.trim()) {
      setRunError(t("io.pickSessionAndQuery"));
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      const result = await executeQuery(sessionId, query);
      const names = result.columns.map((c) => c.name);
      setColumns(names);
      // Drop selections that no longer exist; default sensibly when empty.
      setXColumn((prev) => (names.includes(prev) ? prev : names[0] ?? ""));
      setYColumns((prev) => {
        const kept = prev.filter((c) => names.includes(c));
        if (kept.length > 0) return kept;
        return names.length > 1 ? [names[1]] : [];
      });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const canSave =
    title.trim() !== "" &&
    sessionId !== "" &&
    query.trim() !== "" &&
    xColumn !== "" &&
    yColumns.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      title: title.trim(),
      sessionId,
      database: database || undefined,
      query,
      chart: { type: chartType, xColumn, yColumns },
      size,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-[40rem] max-w-[92vw] max-h-[90vh] flex flex-col rounded-lg bg-background border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="text-sm font-medium">
            {initial ? t("io.editWidgetTitle") : t("io.newWidgetTitle")}
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-secondary rounded transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3 overflow-auto">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("io.title")} <span className="text-destructive">*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("io.titlePlaceholder")}
              className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Session + database */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t("io.session")}
              </label>
              <select
                value={sessionId}
                onChange={(e) => {
                  setSessionId(e.target.value);
                  setDatabase("");
                }}
                className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {sessions.length === 0 && <option value="">{t("io.noSessionsParen")}</option>}
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t("io.database")}
              </label>
              <select
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">{t("io.databaseDefaultOption")}</option>
                {databases.map((db) => (
                  <option key={db} value={db}>
                    {db}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Query */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-muted-foreground">
                {t("io.query")} <span className="text-destructive">*</span>
              </label>
              <button
                onClick={handleRun}
                disabled={running || !sessionId || !query.trim()}
                className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg bg-secondary hover:bg-secondary/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={t("io.runToLoadColumnsTitle")}
              >
                {running ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                {t("io.runToLoadColumns")}
              </button>
            </div>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("io.queryPlaceholder")}
              rows={4}
              className="w-full bg-secondary text-sm font-mono rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            {runError && <p className="mt-1 text-xs text-destructive">{runError}</p>}
          </div>

          {/* Chart type */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("io.chartType")}
            </label>
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
                    title={t("io.chartTypeTitle", { label })}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* X / Y columns */}
          {columns.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("io.runQueryToLoadColumns")}
            </p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  {t("io.xColumn")} <span className="text-destructive">*</span>
                </label>
                <select
                  value={xColumn}
                  onChange={(e) => setXColumn(e.target.value)}
                  className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{t("io.selectParen")}</option>
                  {columns.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  {t("io.yColumns")} <span className="text-destructive">*</span>
                </label>
                <div className="flex items-center gap-1 flex-wrap">
                  {columns
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
                        title={t("io.toggleSeries", { name })}
                      >
                        {name}
                      </button>
                    ))}
                </div>
              </div>
            </>
          )}

          {/* Size */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("io.size")}
            </label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value as Widget["size"])}
              className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-secondary transition-colors"
          >
            {t("io.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t("io.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
