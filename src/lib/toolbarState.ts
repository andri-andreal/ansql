import type { SessionInfo } from "../types";

/** Which main-pane content is currently showing. */
export type MainView = "empty" | "table" | "tableList" | "query";

export interface ToolbarStateInput {
  activeSession: SessionInfo | null;
  view: MainView;
  hasQueryResult: boolean;
}

export interface ToolbarState {
  /** Open the active DB's table list — needs an active session with a database. */
  canOpenTable: boolean;
  /** Open the transfer wizard — needs an active session with a database. */
  canTransfer: boolean;
  /** Export the current result — only the query view, only with a result (v1). */
  canExport: boolean;
}

export function resolveToolbarState(input: ToolbarStateInput): ToolbarState {
  const hasDb = !!input.activeSession?.database;
  return {
    canOpenTable: hasDb,
    canTransfer: hasDb,
    canExport: input.view === "query" && input.hasQueryResult,
  };
}
