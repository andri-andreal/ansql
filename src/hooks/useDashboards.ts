import { useState, useEffect, useCallback } from "react";
import type { ChartSpec } from "../lib/chartData";

const STORAGE_KEY = "ansql.dashboards";

/**
 * A single chart widget on a dashboard. It pins the query (and the session /
 * database it runs against) plus the {@link ChartSpec} used to render the
 * result, so the dashboard can refresh itself by re-running each widget.
 */
export interface DashboardWidget {
  id: string;
  title: string;
  sessionId?: string;
  database?: string;
  query: string;
  chart: ChartSpec;
  size: "sm" | "md" | "lg";
}

/** A named collection of widgets, persisted in localStorage. */
export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
}

/** Generate a reasonably-unique id without pulling in a dependency. */
function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Read the persisted dashboards, tolerating a missing key or corrupt JSON. */
function loadDashboards(): Dashboard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed entries so a partially-corrupt store stays usable.
    return parsed.filter(
      (d): d is Dashboard =>
        d &&
        typeof d.id === "string" &&
        typeof d.name === "string" &&
        Array.isArray(d.widgets)
    );
  } catch {
    return [];
  }
}

/**
 * localStorage-backed dashboard store. Mirrors useSnippets/useGridLayout: state
 * initialised from storage, persisted on change. `activeId` is local UI state
 * (which dashboard is shown) and is not persisted; it self-corrects to a valid
 * dashboard (or null) as dashboards are created and deleted.
 */
export function useDashboards() {
  const [dashboards, setDashboards] = useState<Dashboard[]>(loadDashboards);
  const [activeId, setActiveId] = useState<string | null>(
    () => loadDashboards()[0]?.id ?? null
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
  }, [dashboards]);

  /** Create an empty dashboard, make it active, and return its new id. */
  const createDashboard = useCallback((name: string): string => {
    const id = makeId();
    setDashboards((prev) => [...prev, { id, name, widgets: [] }]);
    setActiveId(id);
    return id;
  }, []);

  /** Rename the dashboard with the given id. */
  const renameDashboard = useCallback((id: string, name: string) => {
    setDashboards((prev) =>
      prev.map((d) => (d.id === id ? { ...d, name } : d))
    );
  }, []);

  /** Remove a dashboard; if it was active, fall back to the first remaining. */
  const deleteDashboard = useCallback((id: string) => {
    setDashboards((prev) => {
      const next = prev.filter((d) => d.id !== id);
      setActiveId((curr) => (curr === id ? next[0]?.id ?? null : curr));
      return next;
    });
  }, []);

  /** Append a widget to a dashboard, assigning it a fresh id. */
  const addWidget = useCallback(
    (dashId: string, w: Omit<DashboardWidget, "id">) => {
      setDashboards((prev) =>
        prev.map((d) =>
          d.id === dashId
            ? { ...d, widgets: [...d.widgets, { ...w, id: makeId() }] }
            : d
        )
      );
    },
    []
  );

  /** Merge a partial patch over a widget within a dashboard. */
  const updateWidget = useCallback(
    (dashId: string, widgetId: string, patch: Partial<DashboardWidget>) => {
      setDashboards((prev) =>
        prev.map((d) =>
          d.id === dashId
            ? {
                ...d,
                widgets: d.widgets.map((w) =>
                  w.id === widgetId ? { ...w, ...patch, id: w.id } : w
                ),
              }
            : d
        )
      );
    },
    []
  );

  /** Remove a widget from a dashboard. */
  const removeWidget = useCallback((dashId: string, widgetId: string) => {
    setDashboards((prev) =>
      prev.map((d) =>
        d.id === dashId
          ? { ...d, widgets: d.widgets.filter((w) => w.id !== widgetId) }
          : d
      )
    );
  }, []);

  /** Move a widget one slot earlier (-1) or later (1) within its dashboard. */
  const moveWidget = useCallback(
    (dashId: string, widgetId: string, dir: -1 | 1) => {
      setDashboards((prev) =>
        prev.map((d) => {
          if (d.id !== dashId) return d;
          const idx = d.widgets.findIndex((w) => w.id === widgetId);
          if (idx === -1) return d;
          const target = idx + dir;
          if (target < 0 || target >= d.widgets.length) return d;
          const widgets = [...d.widgets];
          [widgets[idx], widgets[target]] = [widgets[target], widgets[idx]];
          return { ...d, widgets };
        })
      );
    },
    []
  );

  return {
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
  };
}
