import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  emptyWorkspace,
  openTab as openTabReducer,
  closeTab as closeTabReducer,
  activateTab as activateTabReducer,
  updateTabPayload as updateTabPayloadReducer,
  setDirty as setDirtyReducer,
  setTitle as setTitleReducer,
  nextTabId,
  type WorkspaceState,
  type WorkspaceTab,
  type WorkspaceTabIntent,
  type WorkspaceTabKind,
  type PayloadForKind,
} from "../lib/workspaceTabs";

// localStorage key for the persisted open-tabs + active-id snapshot.
const STORAGE_KEY = "ansql.workspace";

// Read the persisted workspace, if any. Tabs are plain serializable payloads
// (the union's payloads are all JSON-safe by design), so we just JSON-parse and
// shape-validate the minimum so a corrupt/old blob can't crash the app. Stale
// session ids inside payloads are intentionally NOT scrubbed here: tabs still
// render (a disconnected session shows a reconnect hint in the relevant view).
function loadPersistedWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyWorkspace;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyWorkspace;
    const { tabs, activeId } = parsed as Partial<WorkspaceState>;
    if (!Array.isArray(tabs)) return emptyWorkspace;
    const candidates = tabs.filter(
      (t): t is WorkspaceTab =>
        !!t &&
        typeof t === "object" &&
        typeof (t as WorkspaceTab).id === "string" &&
        typeof (t as WorkspaceTab).kind === "string" &&
        typeof (t as WorkspaceTab).payload === "object" &&
        (t as WorkspaceTab).payload !== null
    );
    // Re-mint ids from the module sequence so freshly-opened tabs (which also
    // pull from nextTabId, starting at wt-1 each launch) can never collide with
    // a restored tab's persisted id. Remap activeId through the same mapping.
    const idMap = new Map<string, string>();
    const valid = candidates.map((t) => {
      const fresh = nextTabId();
      idMap.set(t.id, fresh);
      return { ...t, id: fresh } as WorkspaceTab;
    });
    const remappedActive =
      typeof activeId === "string" ? idMap.get(activeId) ?? null : null;
    return {
      tabs: valid,
      activeId: remappedActive ?? valid[valid.length - 1]?.id ?? null,
    };
  } catch {
    return emptyWorkspace;
  }
}

function persistWorkspace(state: WorkspaceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore persistence failures (quota / private mode) — in-memory state still works.
  }
}

export interface UseWorkspaceTabs {
  tabs: WorkspaceTab[];
  activeId: string | null;
  activeTab: WorkspaceTab | null;
  /** Open (dedupe-or-append) and activate. */
  openTab: (intent: WorkspaceTabIntent) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  /** Patch any tab's payload (type-narrowed by its kind). */
  updateTabPayload: <K extends WorkspaceTabKind>(
    id: string,
    patch: Partial<PayloadForKind<K>>
  ) => void;
  /** Patch the ACTIVE tab's payload. No-op when no active tab. */
  updateActivePayload: (patch: Partial<WorkspaceTab["payload"]>) => void;
  setDirty: (id: string, dirty: boolean) => void;
  setTitle: (id: string, title: string) => void;
}

export function useWorkspaceTabs(): UseWorkspaceTabs {
  // Restore the open tabs + active id from localStorage on first mount. The
  // initializer runs once (lazy useState), so a fresh launch picks up the last
  // session's workspace.
  const [state, setState] = useState<WorkspaceState>(loadPersistedWorkspace);

  // Mirror every state change back to localStorage. Skip the very first run so
  // restoring an empty workspace doesn't immediately clobber a stale-but-valid
  // blob mid-hydration (there's nothing to write on mount anyway).
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    persistWorkspace(state);
  }, [state]);

  const openTab = useCallback((intent: WorkspaceTabIntent) => {
    setState((s) => openTabReducer(s, intent));
  }, []);
  const closeTab = useCallback((id: string) => {
    setState((s) => closeTabReducer(s, id));
  }, []);
  const activateTab = useCallback((id: string) => {
    setState((s) => activateTabReducer(s, id));
  }, []);
  const updateTabPayload = useCallback(
    <K extends WorkspaceTabKind>(id: string, patch: Partial<PayloadForKind<K>>) => {
      setState((s) => updateTabPayloadReducer(s, id, patch as Partial<WorkspaceTab["payload"]>));
    },
    []
  );
  const updateActivePayload = useCallback((patch: Partial<WorkspaceTab["payload"]>) => {
    setState((s) => (s.activeId ? updateTabPayloadReducer(s, s.activeId, patch) : s));
  }, []);
  const setDirty = useCallback((id: string, dirty: boolean) => {
    setState((s) => setDirtyReducer(s, id, dirty));
  }, []);
  const setTitle = useCallback((id: string, title: string) => {
    setState((s) => setTitleReducer(s, id, title));
  }, []);

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeId) ?? null,
    [state.tabs, state.activeId]
  );

  return {
    tabs: state.tabs,
    activeId: state.activeId,
    activeTab,
    openTab,
    closeTab,
    activateTab,
    updateTabPayload,
    updateActivePayload,
    setDirty,
    setTitle,
  };
}
