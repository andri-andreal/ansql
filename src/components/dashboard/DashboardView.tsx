import { useState } from "react";
import {
  LayoutDashboard,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { QueryResult } from "../../types";
import {
  useDashboards,
  type DashboardWidget as DashboardWidgetModel,
} from "../../hooks/useDashboards";
import { DashboardWidget } from "./DashboardWidget";
import { WidgetEditor, type DashboardSessionOption } from "./WidgetEditor";
import { useDialogs } from "../ui";
import { useTranslation } from "../../i18n";

export interface DashboardViewProps {
  sessions: DashboardSessionOption[];
  executeQuery: (sessionId: string, sql: string) => Promise<QueryResult>;
  onClose: () => void;
}

/** Map a widget size to its column span in the 12-column responsive grid. */
const SIZE_SPAN: Record<DashboardWidgetModel["size"], string> = {
  sm: "lg:col-span-4",
  md: "lg:col-span-6",
  lg: "lg:col-span-12",
};

/**
 * BI dashboards workspace: a switchable set of named dashboards, each a
 * responsive grid of chart widgets driven by their own query. Dashboards and
 * widgets are persisted via {@link useDashboards}; widgets re-run their query
 * on mount and on "Refresh all" (a key bump forces a remount).
 */
export function DashboardView({
  sessions,
  executeQuery,
  onClose,
}: DashboardViewProps) {
  const { t } = useTranslation();
  const dialogs = useDialogs();
  const {
    dashboards,
    activeId,
    setActiveId,
    createDashboard,
    renameDashboard,
    deleteDashboard,
    addWidget,
    updateWidget,
    removeWidget,
    moveWidget,
  } = useDashboards();

  const activeDashboard =
    dashboards.find((d) => d.id === activeId) ?? null;

  // The widget editor: null = closed; { } = adding; { widget } = editing.
  const [editing, setEditing] = useState<
    { widget?: DashboardWidgetModel } | null
  >(null);

  // Bumped by "Refresh all" to remount every widget (re-running their queries).
  const [refreshKey, setRefreshKey] = useState(0);

  async function handleNewDashboard() {
    const name = await dialogs.prompt({
      title: t("io.dashboardNamePrompt"),
      defaultValue: t("io.newDashboard"),
    });
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    createDashboard(trimmed);
  }

  async function handleRenameDashboard() {
    if (!activeDashboard) return;
    const name = await dialogs.prompt({
      title: t("io.renameDashboardPrompt"),
      defaultValue: activeDashboard.name,
    });
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    renameDashboard(activeDashboard.id, trimmed);
  }

  async function handleDeleteDashboard() {
    if (!activeDashboard) return;
    const ok = await dialogs.confirm({
      title: t("io.deleteDashboardConfirm", { name: activeDashboard.name }),
      danger: true,
    });
    if (!ok) return;
    deleteDashboard(activeDashboard.id);
  }

  function handleSaveWidget(widget: Omit<DashboardWidgetModel, "id">) {
    if (!activeDashboard) return;
    if (editing?.widget) {
      updateWidget(activeDashboard.id, editing.widget.id, widget);
    } else {
      addWidget(activeDashboard.id, widget);
    }
    setEditing(null);
  }

  const widgets = activeDashboard?.widgets ?? [];

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* ── Top bar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
          {t("io.dashboards")}
        </div>

        {dashboards.length > 0 && (
          <select
            value={activeDashboard?.id ?? ""}
            onChange={(e) => setActiveId(e.target.value)}
            className="h-8 min-w-[160px] rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            title={t("io.switchDashboard")}
          >
            {dashboards.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={handleNewDashboard}
          className="flex items-center gap-1.5 rounded border border-border px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
          title={t("io.newDashboard")}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("io.new")}
        </button>

        {activeDashboard && (
          <>
            <button
              onClick={handleRenameDashboard}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
              title={t("io.renameDashboard")}
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("io.rename")}
            </button>
            <button
              onClick={handleDeleteDashboard}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
              title={t("io.deleteDashboard")}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("io.delete")}
            </button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {activeDashboard && (
            <>
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                disabled={widgets.length === 0}
                className="flex items-center gap-1.5 rounded border border-border px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                title={t("io.rerunEveryWidget")}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("io.refreshAll")}
              </button>
              <button
                onClick={() => setEditing({})}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
                title={t("io.addWidgetTitle")}
              >
                <Plus className="h-4 w-4" />
                {t("io.addWidget")}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title={t("io.closeDashboards")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!activeDashboard ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <LayoutDashboard className="h-10 w-10 opacity-40" />
            <div>
              <p className="font-medium text-foreground">{t("io.noDashboardsYet")}</p>
              <p>{t("io.createDashboardHint")}</p>
            </div>
            <button
              onClick={handleNewDashboard}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              {t("io.newDashboard")}
            </button>
          </div>
        ) : widgets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <LayoutDashboard className="h-10 w-10 opacity-40" />
            <div>
              <p className="font-medium text-foreground">
                {t("io.dashboardNoWidgets", { name: activeDashboard.name })}
              </p>
              <p>{t("io.addWidgetHint")}</p>
            </div>
            <button
              onClick={() => setEditing({})}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              {t("io.addWidget")}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {widgets.map((widget) => (
              <div
                key={widget.id}
                className={`col-span-1 ${SIZE_SPAN[widget.size]}`}
              >
                <DashboardWidget
                  key={`${widget.id}:${refreshKey}`}
                  widget={widget}
                  executeQuery={executeQuery}
                  onEdit={() => setEditing({ widget })}
                  onRemove={() => removeWidget(activeDashboard.id, widget.id)}
                  onMove={(dir) => moveWidget(activeDashboard.id, widget.id, dir)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Widget editor (add / edit) ── */}
      {editing && activeDashboard && (
        <WidgetEditor
          sessions={sessions}
          executeQuery={executeQuery}
          initial={editing.widget}
          onSave={handleSaveWidget}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
