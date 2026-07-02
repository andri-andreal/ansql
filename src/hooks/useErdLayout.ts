import { useState, useEffect, useCallback, useMemo } from "react";

const STORAGE_KEY = "ansql.erdLayout";

/** Top-left position of an ERD table node. */
export interface ErdNodePos {
  x: number;
  y: number;
}

/**
 * Persisted layout for a single diagram: node positions and accent colors,
 * both keyed by node id (the schema-qualified table name).
 */
export interface ErdLayoutState {
  positions: Record<string, ErdNodePos>;
  colors: Record<string, string>;
}

/** Persisted shape: one ErdLayoutState per diagram key. */
type ErdLayoutStore = Record<string, ErdLayoutState>;

const EMPTY_STATE: ErdLayoutState = { positions: {}, colors: {} };

/** Merge a partial state over the empty defaults so missing keys degrade gracefully. */
function normalizeState(state: Partial<ErdLayoutState> | undefined): ErdLayoutState {
  return {
    positions: state?.positions ?? {},
    colors: state?.colors ?? {},
  };
}

/** Read the persisted store, tolerating a missing key or corrupt JSON. */
function loadStore(): ErdLayoutStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<ErdLayoutStore>;
    return parsed && typeof parsed === "object" ? (parsed as ErdLayoutStore) : {};
  } catch {
    return {};
  }
}

/**
 * localStorage-backed ERD layout for a single diagram (`diagramKey`, the
 * sessionId/database pair joined by ":"). Persists node positions and accent
 * colors so a hand-arranged diagram survives reloads. Mirrors useGridLayout:
 * state initialised from storage, persisted on change.
 */
export function useErdLayout(diagramKey: string): {
  state: ErdLayoutState;
  setPosition: (id: string, pos: ErdNodePos) => void;
  setColor: (id: string, color: string) => void;
  clear: () => void;
} {
  const [store, setStore] = useState<ErdLayoutStore>(loadStore);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  const setPosition = useCallback(
    (id: string, pos: ErdNodePos) => {
      setStore((prev) => {
        const current = normalizeState(prev[diagramKey]);
        return {
          ...prev,
          [diagramKey]: {
            ...current,
            positions: { ...current.positions, [id]: pos },
          },
        };
      });
    },
    [diagramKey],
  );

  const setColor = useCallback(
    (id: string, color: string) => {
      setStore((prev) => {
        const current = normalizeState(prev[diagramKey]);
        return {
          ...prev,
          [diagramKey]: {
            ...current,
            colors: { ...current.colors, [id]: color },
          },
        };
      });
    },
    [diagramKey],
  );

  const clear = useCallback(() => {
    setStore((prev) => ({ ...prev, [diagramKey]: { ...EMPTY_STATE } }));
  }, [diagramKey]);

  // `state` is a NEW object every call to normalizeState(). Without useMemo,
  // any consumer that lists `state.colors` (or `state.positions`) in a
  // useEffect dep array would re-fire on every parent render — which is
  // exactly what ErdView's `setNodes((prev) => …)` does, producing a
  // "Maximum update depth exceeded" loop. The normalized shape is stable
  // whenever the underlying `store[diagramKey]` doesn't change.
  const state = useMemo(
    () => normalizeState(store[diagramKey]),
    [store, diagramKey]
  );

  return { state, setPosition, setColor, clear };
}
