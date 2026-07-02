import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "ansql.gridLayout";

/**
 * Per-table grid layout: which columns are hidden, their display order, how many
 * are frozen, the row height, and per-column widths. `columnOrder` empty means
 * natural (data-defined) order; `widths` is keyed by column name.
 */
export interface GridLayout {
  hiddenColumns: string[];
  columnOrder: string[];
  frozenCount: number;
  rowHeight: number;
  widths: Record<string, number>;
}

/** A named, reusable layout the user can save and apply to any table. */
export interface GridLayoutProfile {
  name: string;
  layout: GridLayout;
}

/**
 * Persisted shape: a layout per table key plus a flat list of named profiles
 * shared across tables.
 */
interface GridLayoutStore {
  byTable: Record<string, GridLayout>;
  profiles: GridLayoutProfile[];
}

const DEFAULT_LAYOUT: GridLayout = {
  hiddenColumns: [],
  columnOrder: [],
  frozenCount: 0,
  rowHeight: 34,
  widths: {},
};

const EMPTY_STORE: GridLayoutStore = { byTable: {}, profiles: [] };

/** Merge a partial layout over the defaults so missing keys degrade gracefully. */
function normalizeLayout(layout: Partial<GridLayout> | undefined): GridLayout {
  return {
    hiddenColumns: layout?.hiddenColumns ?? DEFAULT_LAYOUT.hiddenColumns,
    columnOrder: layout?.columnOrder ?? DEFAULT_LAYOUT.columnOrder,
    frozenCount: layout?.frozenCount ?? DEFAULT_LAYOUT.frozenCount,
    rowHeight: layout?.rowHeight ?? DEFAULT_LAYOUT.rowHeight,
    widths: layout?.widths ?? DEFAULT_LAYOUT.widths,
  };
}

/** Read the persisted store, tolerating a missing key or corrupt JSON. */
function loadStore(): GridLayoutStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw) as Partial<GridLayoutStore>;
    return {
      byTable: parsed.byTable ?? {},
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    };
  } catch {
    return EMPTY_STORE;
  }
}

/**
 * localStorage-backed grid layout for a single table (`tableKey`, the
 * connectionId/database/table triple joined by ":"). Layout edits are scoped to
 * the table; named profiles are shared and can be applied to any table. Mirrors
 * useSettings/useSnippets: state initialised from storage, persisted on change.
 */
export function useGridLayout(tableKey: string) {
  const [store, setStore] = useState<GridLayoutStore>(loadStore);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  const layout = normalizeLayout(store.byTable[tableKey]);

  /** Merge a partial patch over this table's current layout. */
  const setLayout = useCallback(
    (patch: Partial<GridLayout>) => {
      setStore((prev) => {
        const current = normalizeLayout(prev.byTable[tableKey]);
        return {
          ...prev,
          byTable: { ...prev.byTable, [tableKey]: { ...current, ...patch } },
        };
      });
    },
    [tableKey],
  );

  /** Save this table's current layout under a name (replacing a same-named one). */
  const saveProfile = useCallback(
    (name: string) => {
      setStore((prev) => {
        const snapshot = normalizeLayout(prev.byTable[tableKey]);
        const others = prev.profiles.filter((p) => p.name !== name);
        return { ...prev, profiles: [...others, { name, layout: snapshot }] };
      });
    },
    [tableKey],
  );

  /** Apply a named profile's layout to this table (no-op if name is unknown). */
  const applyProfile = useCallback(
    (name: string) => {
      setStore((prev) => {
        const profile = prev.profiles.find((p) => p.name === name);
        if (!profile) return prev;
        return {
          ...prev,
          byTable: {
            ...prev.byTable,
            [tableKey]: normalizeLayout(profile.layout),
          },
        };
      });
    },
    [tableKey],
  );

  /** Remove a named profile. */
  const deleteProfile = useCallback((name: string) => {
    setStore((prev) => ({
      ...prev,
      profiles: prev.profiles.filter((p) => p.name !== name),
    }));
  }, []);

  /** Reset this table's layout back to the defaults. */
  const reset = useCallback(() => {
    setStore((prev) => ({
      ...prev,
      byTable: { ...prev.byTable, [tableKey]: { ...DEFAULT_LAYOUT } },
    }));
  }, [tableKey]);

  return {
    layout,
    setLayout,
    profiles: store.profiles,
    saveProfile,
    applyProfile,
    deleteProfile,
    reset,
  };
}
