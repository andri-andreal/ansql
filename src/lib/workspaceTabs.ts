/**
 * Workspace tab model + pure reducer helpers for the global tabbed workspace.
 *
 * Design rules (mirroring the rest of `src/lib`):
 * - Pure functions only — no React, no Tauri calls. The React wrapper lives in
 *   `src/hooks/useWorkspaceTabs.ts`.
 * - Every tab carries a fully self-contained `payload`, so a tab renders without
 *   reaching back into App state.
 * - A discriminated union keyed on `kind` drives both rendering and dedupe.
 */

import type {
  ColumnDefinition,
  IndexInfo,
  ForeignKeyInfo,
  Dialect,
} from "../types";
import type { RoutineKind } from "./routineBuilder";
import type { TriggerInfo } from "./introspectionQueries";
import type { ResultEntry } from "../hooks/useQueries";

/** Discriminator for every app-level tab kind. */
export type WorkspaceTabKind =
  | "table"
  | "table-list"
  | "query"
  | "table-designer"
  | "view-designer"
  | "routine-editor"
  | "trigger-designer"
  | "event-designer"
  | "sequence-designer"
  | "erd"
  | "structure-sync"
  | "data-sync"
  | "server-monitor"
  | "dashboard"
  | "redis-browser"
  | "mongo-browser";

// ---- per-kind payloads -----------------------------------------------------

/** 'table' — TableViewer (keeps its own Data/Structure sub-tabs). */
export interface TableTabPayload {
  sessionId: string;
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  driver: string;
  /** Which sub-tab the viewer should focus when (re)activated by dedupe. */
  focus?: "data" | "structure";
  /**
   * Raw WHERE clause text (sans leading WHERE) to seed the initial data load
   * with, when this table tab was opened from "Edit results" on a single-table
   * SELECT. Optional + back-compatible: absent for normal table opens.
   */
  initialWhereSql?: string;
}

/** 'table-list' — TableListView. */
export interface TableListTabPayload {
  sessionId: string;
  database: string;
}

/** 'erd' — entity-relationship diagram for a whole database (read-only canvas). */
export interface ErdTabPayload {
  sessionId: string;
  database: string;
  schema?: string | null;
}

/**
 * 'structure-sync' — Structure Synchronization compare view. The payload only
 * seeds the SOURCE side (both fields optional); the view lets the user pick
 * source/target sessions + databases interactively. A single sync tab opens at
 * a time (dedupe key is a constant).
 */
export interface StructureSyncTabPayload {
  sourceSessionId?: string;
  sourceDatabase?: string;
}

/**
 * 'data-sync' — Data Synchronization compare view. Like 'structure-sync', the
 * payload only seeds the SOURCE side (both fields optional); the view lets the
 * user pick source/target sessions + databases + tables interactively. A single
 * data-sync tab opens at a time (dedupe key is a constant).
 */
export interface DataSyncTabPayload {
  sourceSessionId?: string;
  sourceDatabase?: string;
}

/**
 * 'server-monitor' — read-only window onto a connected server's live process
 * list / status counters / configuration variables. Scoped to a single session
 * (one monitor tab per session — dedupe key is the session id). SQLite has no
 * server surface, so the explorer gates the affordance to MySQL/Postgres.
 */
export interface ServerMonitorTabPayload {
  sessionId: string;
}

/**
 * 'dashboard' — BI Dashboards workspace (a switchable set of named dashboards,
 * each a grid of chart widgets). The dashboards/widgets are persisted in
 * localStorage (via useDashboards), so the payload is essentially empty; the
 * optional `dashboardId` only hints which dashboard to focus. A single dashboard
 * tab opens app-wide (dedupe key is a constant).
 */
export interface DashboardTabPayload {
  dashboardId?: string;
}

/**
 * 'redis-browser' — the Redis key browser for a connected Redis session. Unlike
 * the SQL tabs, Redis has no database/table sub-tree: the browser owns its own
 * numeric DB index + key selection state internally. The payload only carries
 * the originating connection id and the redis session id (from redis_connect),
 * which the host binds into a RedisApi adapter. One browser per session — dedupe
 * key is the session id.
 */
export interface RedisBrowserTabPayload {
  connectionId: string;
  sessionId: string;
}

/**
 * 'mongo-browser' — the MongoDB document browser for a connected Mongo session.
 * Like Redis, Mongo has no SQL database/table sub-tree: the browser owns its own
 * database/collection selection + query state internally. The payload only
 * carries the originating connection id and the mongo session id (from
 * mongo_connect), which the host binds into a MongoApi adapter. One browser per
 * session — dedupe key is the session id.
 */
export interface MongoBrowserTabPayload {
  connectionId: string;
  sessionId: string;
}

/**
 * 'query' — one standalone query document.
 * content + the result list + selected-result id + UI flags live HERE so
 * switching tabs preserves an in-progress edit and the grid.
 */
export interface QueryTabPayload {
  /** Session the query runs against (null until chosen in the toolbar). */
  sessionId: string | null;
  /** Convenience copy of the session's database for autocomplete scoping. */
  database: string | null;
  content: string;
  /** Executed results (oldest -> newest), reusing useQueries' ResultEntry. */
  results: ResultEntry[];
  /** Currently selected result tab id (null = newest/none). */
  activeResultId: string | null;
  /** Hook-level last error (per-document). */
  error: string | null;
  /** Persisted UI prefs so they survive tab switches. */
  showResults?: boolean;
  resultsPanelHeight?: number;
}

/** 'table-designer' — mirrors the old DesignerState union, flattened. */
export type TableDesignerTabPayload =
  | { mode: "create"; sessionId: string; database: string; schema?: string; dialect: Dialect }
  | {
      mode: "alter";
      sessionId: string;
      database: string;
      schema?: string;
      dialect: Dialect;
      tableName: string;
      originalColumns: ColumnDefinition[];
      originalIndexes: IndexInfo[];
      originalForeignKeys: ForeignKeyInfo[];
    };

/**
 * 'view-designer' — mirrors the old ViewDesignerState union. Materialized views
 * (Postgres only) reuse this same kind: the optional `materialized` flag seeds
 * the designer's Materialized toggle (and threads through as `initialMaterialized`
 * in edit mode).
 */
export type ViewDesignerTabPayload =
  | {
      mode: "create";
      sessionId: string;
      database: string;
      schema?: string;
      dialect: Dialect;
      materialized?: boolean;
    }
  | {
      mode: "edit";
      sessionId: string;
      database: string;
      schema?: string;
      dialect: Dialect;
      viewName: string;
      initialBody: string;
      materialized?: boolean;
    };

/** 'routine-editor' — mirrors the old RoutineEditorState union. */
export type RoutineEditorTabPayload =
  | { mode: "create"; sessionId: string; database: string; schema?: string; dialect: Dialect; kind: RoutineKind }
  | {
      mode: "edit";
      sessionId: string;
      database: string;
      schema?: string;
      dialect: Dialect;
      kind: RoutineKind;
      routineName: string;
      initialBody: string;
    };

/**
 * 'trigger-designer' — standalone trigger editor. Mirrors RoutineEditorTabPayload
 * in shape: a create variant scoped to a table, and an edit variant that carries
 * the existing introspected {@link TriggerInfo} so the designer can pre-fill.
 */
export type TriggerDesignerTabPayload =
  | { mode: "create"; sessionId: string; database: string; schema?: string; dialect: Dialect; table: string }
  | {
      mode: "edit";
      sessionId: string;
      database: string;
      schema?: string;
      dialect: Dialect;
      table: string;
      existing: TriggerInfo;
    };

/**
 * 'event-designer' — standalone MySQL EVENT (scheduler) designer. MySQL-only;
 * the explorer gates the affordance to MySQL sessions. The edit variant carries
 * the existing event's name (and, when known, its verbatim definition) so the
 * designer can pre-fill — matching {@link EventDesignerProps.existing}.
 */
export type EventDesignerTabPayload =
  | { mode: "create"; sessionId: string; database: string; dialect: Dialect }
  | {
      mode: "edit";
      sessionId: string;
      database: string;
      dialect: Dialect;
      existing: { name: string; statement?: string };
    };

/**
 * 'sequence-designer' — standalone Postgres SEQUENCE designer. Postgres-only;
 * the explorer gates the affordance to Postgres sessions. The edit variant
 * carries the existing sequence's name — matching {@link SequenceDesignerProps.existing}.
 */
export type SequenceDesignerTabPayload =
  | { mode: "create"; sessionId: string; database: string; schema?: string; dialect: Dialect }
  | {
      mode: "edit";
      sessionId: string;
      database: string;
      schema?: string;
      dialect: Dialect;
      existing: { name: string };
    };

// ---- the tab union ---------------------------------------------------------

interface BaseTab {
  id: string;
  title: string;
  dirty?: boolean;
}

export type WorkspaceTab =
  | (BaseTab & { kind: "table"; payload: TableTabPayload })
  | (BaseTab & { kind: "table-list"; payload: TableListTabPayload })
  | (BaseTab & { kind: "query"; payload: QueryTabPayload })
  | (BaseTab & { kind: "table-designer"; payload: TableDesignerTabPayload })
  | (BaseTab & { kind: "view-designer"; payload: ViewDesignerTabPayload })
  | (BaseTab & { kind: "routine-editor"; payload: RoutineEditorTabPayload })
  | (BaseTab & { kind: "trigger-designer"; payload: TriggerDesignerTabPayload })
  | (BaseTab & { kind: "event-designer"; payload: EventDesignerTabPayload })
  | (BaseTab & { kind: "sequence-designer"; payload: SequenceDesignerTabPayload })
  | (BaseTab & { kind: "erd"; payload: ErdTabPayload })
  | (BaseTab & { kind: "structure-sync"; payload: StructureSyncTabPayload })
  | (BaseTab & { kind: "data-sync"; payload: DataSyncTabPayload })
  | (BaseTab & { kind: "server-monitor"; payload: ServerMonitorTabPayload })
  | (BaseTab & { kind: "dashboard"; payload: DashboardTabPayload })
  | (BaseTab & { kind: "redis-browser"; payload: RedisBrowserTabPayload })
  | (BaseTab & { kind: "mongo-browser"; payload: MongoBrowserTabPayload });

/** Narrowed payload type for a given kind (used by updateTabPayload). */
export type PayloadForKind<K extends WorkspaceTabKind> =
  Extract<WorkspaceTab, { kind: K }>["payload"];

// ---- open intents ----------------------------------------------------------

/**
 * An intent is a tab WITHOUT an `id` (the reducer mints the id) and with an
 * optional `title` (derived via {@link defaultTitle} when omitted).
 */
export type WorkspaceTabIntent =
  | { kind: "table"; title?: string; payload: TableTabPayload }
  | { kind: "table-list"; title?: string; payload: TableListTabPayload }
  | { kind: "query"; title?: string; payload: QueryTabPayload }
  | { kind: "table-designer"; title?: string; payload: TableDesignerTabPayload }
  | { kind: "view-designer"; title?: string; payload: ViewDesignerTabPayload }
  | { kind: "routine-editor"; title?: string; payload: RoutineEditorTabPayload }
  | { kind: "trigger-designer"; title?: string; payload: TriggerDesignerTabPayload }
  | { kind: "event-designer"; title?: string; payload: EventDesignerTabPayload }
  | { kind: "sequence-designer"; title?: string; payload: SequenceDesignerTabPayload }
  | { kind: "erd"; title?: string; payload: ErdTabPayload }
  | { kind: "structure-sync"; title?: string; payload: StructureSyncTabPayload }
  | { kind: "data-sync"; title?: string; payload: DataSyncTabPayload }
  | { kind: "server-monitor"; title?: string; payload: ServerMonitorTabPayload }
  | { kind: "dashboard"; title?: string; payload: DashboardTabPayload }
  | { kind: "redis-browser"; title?: string; payload: RedisBrowserTabPayload }
  | { kind: "mongo-browser"; title?: string; payload: MongoBrowserTabPayload };

// ---- dedupe key ------------------------------------------------------------

/**
 * Stable dedupe key for dedupe-eligible kinds; null = always open a new tab.
 *
 * 'table' and 'table-list' (and a structure-focus open of a table) reuse an
 * already-open identical tab keyed by session+database+table[+schema]. The
 * `focus` field is intentionally NOT part of the key, so opening "structure"
 * for an already-open table focuses that same tab (and switches its sub-tab).
 */
export function tabDedupeKey(intent: WorkspaceTabIntent): string | null {
  switch (intent.kind) {
    case "table": {
      const p = intent.payload;
      return `table::${p.sessionId}::${p.database}::${p.schema ?? ""}::${p.table}`;
    }
    case "table-list": {
      const p = intent.payload;
      return `table-list::${p.sessionId}::${p.database}`;
    }
    case "erd": {
      // One ERD tab per session+database — reopening focuses the existing tab.
      const p = intent.payload;
      return `erd::${p.sessionId}::${p.database}`;
    }
    case "structure-sync":
      // A single Structure Sync tab app-wide — reopening focuses the existing
      // one (and re-seeds its source via the payload merge in openTab).
      return "structure-sync";
    case "data-sync":
      // A single Data Sync tab app-wide — reopening focuses the existing one
      // (and re-seeds its source via the payload merge in openTab).
      return "data-sync";
    case "server-monitor":
      // One monitor per session — reopening focuses the existing tab.
      return `server-monitor::${intent.payload.sessionId}`;
    case "dashboard":
      // A single Dashboards tab app-wide — reopening focuses the existing one.
      return "dashboard";
    case "redis-browser":
      // One key browser per redis session — reopening focuses the existing tab.
      return `redis-browser::${intent.payload.sessionId}`;
    case "mongo-browser":
      // One document browser per mongo session — reopening focuses the existing tab.
      return `mongo-browser::${intent.payload.sessionId}`;
    // query + all designers always open a new tab.
    case "query":
    case "table-designer":
    case "view-designer":
    case "routine-editor":
    case "trigger-designer":
    case "event-designer":
    case "sequence-designer":
      return null;
  }
}

// ---- default titles --------------------------------------------------------

export function defaultTitle(intent: WorkspaceTabIntent): string {
  switch (intent.kind) {
    case "table":
      return intent.payload.table;
    case "table-list":
      return intent.payload.database;
    case "query":
      return "Query";
    case "table-designer":
      return intent.payload.mode === "alter"
        ? intent.payload.tableName
        : "New Table";
    case "view-designer":
      return intent.payload.mode === "edit"
        ? intent.payload.viewName
        : "New View";
    case "routine-editor":
      return intent.payload.mode === "edit"
        ? intent.payload.routineName
        : intent.payload.kind === "procedure"
        ? "New Procedure"
        : "New Function";
    case "trigger-designer":
      return intent.payload.mode === "edit"
        ? intent.payload.existing.name
        : "New Trigger";
    case "event-designer":
      return intent.payload.mode === "edit"
        ? intent.payload.existing.name
        : "New Event";
    case "sequence-designer":
      return intent.payload.mode === "edit"
        ? intent.payload.existing.name
        : "New Sequence";
    case "erd":
      return `ERD: ${intent.payload.database}`;
    case "structure-sync":
      return "Structure Sync";
    case "data-sync":
      return "Data Sync";
    case "server-monitor":
      return "Server Monitor";
    case "dashboard":
      return "Dashboards";
    case "redis-browser":
      // The host passes the connection name as an explicit title; this is only
      // the fallback when none is supplied (the payload has no name to derive).
      return "Redis";
    case "mongo-browser":
      // The host passes the connection name as an explicit title; this is only
      // the fallback when none is supplied (the payload has no name to derive).
      return "MongoDB";
  }
}

// ---- state shape -----------------------------------------------------------

export interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeId: string | null;
}

export const emptyWorkspace: WorkspaceState = { tabs: [], activeId: null };

// ---- id generator ----------------------------------------------------------

let _tabSeq = 0;
/** Deterministic, collision-free within a session. */
export function nextTabId(): string {
  return `wt-${++_tabSeq}`;
}

// ---- reducer helpers (all pure, no React) ----------------------------------

/** Re-derive an intent from an open tab (used to compute its dedupe key). */
function intentOf(tab: WorkspaceTab): WorkspaceTabIntent {
  return { kind: tab.kind, payload: tab.payload } as WorkspaceTabIntent;
}

/**
 * Dedupe-or-append, then activate.
 * - If intent has a non-null dedupeKey AND a matching tab exists: update that
 *   tab's payload (so e.g. a structure-focus open changes `focus`), mark it
 *   active, do NOT append.
 * - Otherwise mint a new id, append, activate.
 */
export function openTab(state: WorkspaceState, intent: WorkspaceTabIntent): WorkspaceState {
  const key = tabDedupeKey(intent);
  if (key !== null) {
    const existing = state.tabs.find((t) => tabDedupeKey(intentOf(t)) === key);
    if (existing) {
      const tabs = state.tabs.map((t) =>
        t.id === existing.id
          ? ({ ...t, payload: { ...t.payload, ...intent.payload } } as WorkspaceTab)
          : t
      );
      return { tabs, activeId: existing.id };
    }
  }
  const tab = {
    id: nextTabId(),
    kind: intent.kind,
    title: intent.title ?? defaultTitle(intent),
    payload: intent.payload,
  } as WorkspaceTab;
  return { tabs: [...state.tabs, tab], activeId: tab.id };
}

/**
 * Close a tab. If it was active, activate the neighbour: prefer the tab to the
 * RIGHT, else the one to the LEFT, else null when none remain.
 */
export function closeTab(state: WorkspaceState, id: string): WorkspaceState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  let activeId = state.activeId;
  if (state.activeId === id) {
    const neighbour = tabs[idx] ?? tabs[idx - 1] ?? null;
    activeId = neighbour ? neighbour.id : null;
  }
  return { tabs, activeId };
}

export function activateTab(state: WorkspaceState, id: string): WorkspaceState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { ...state, activeId: id };
}

/** Shallow-merge a patch into a tab's payload. Caller passes a correctly-typed patch. */
export function updateTabPayload(
  state: WorkspaceState,
  id: string,
  patch: Partial<WorkspaceTab["payload"]>
): WorkspaceState {
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id === id ? ({ ...t, payload: { ...t.payload, ...patch } } as WorkspaceTab) : t
    ),
  };
}

export function setDirty(state: WorkspaceState, id: string, dirty: boolean): WorkspaceState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
  };
}

/** Optional: rename (designers set the title from the entered name). */
export function setTitle(state: WorkspaceState, id: string, title: string): WorkspaceState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
  };
}
