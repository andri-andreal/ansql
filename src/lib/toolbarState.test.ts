import { describe, it, expect } from "vitest";
import { resolveToolbarState } from "./toolbarState";
import type { SessionInfo } from "../types";

const session = (database?: string): SessionInfo => ({
  id: "s1",
  connection_id: "c1",
  database,
  connected_at: "2026-06-13T00:00:00Z",
});

describe("resolveToolbarState", () => {
  it("disables all context buttons when there is no active session", () => {
    const s = resolveToolbarState({ activeSession: null, view: "empty", hasQueryResult: false });
    expect(s).toEqual({ canOpenTable: false, canTransfer: false, canExport: false });
  });

  it("disables Table/Transfer when the active session has no database", () => {
    const s = resolveToolbarState({ activeSession: session(undefined), view: "empty", hasQueryResult: false });
    expect(s.canOpenTable).toBe(false);
    expect(s.canTransfer).toBe(false);
  });

  it("enables Table/Transfer when the active session has a database", () => {
    const s = resolveToolbarState({ activeSession: session("shop"), view: "tableList", hasQueryResult: false });
    expect(s.canOpenTable).toBe(true);
    expect(s.canTransfer).toBe(true);
  });

  it("enables Export only in the query view with a result", () => {
    expect(resolveToolbarState({ activeSession: session("shop"), view: "query", hasQueryResult: true }).canExport).toBe(true);
    expect(resolveToolbarState({ activeSession: session("shop"), view: "query", hasQueryResult: false }).canExport).toBe(false);
    expect(resolveToolbarState({ activeSession: session("shop"), view: "table", hasQueryResult: true }).canExport).toBe(false);
  });
});
