import { describe, it, expect } from "vitest";
import {
  emptyWorkspace,
  openTab,
  closeTab,
  activateTab,
  updateTabPayload,
  setDirty,
  setTitle,
  tabDedupeKey,
  defaultTitle,
  nextTabId,
  type WorkspaceState,
  type WorkspaceTabIntent,
  type TableTabPayload,
  type QueryTabPayload,
} from "./workspaceTabs";

// ---- intent fixtures -------------------------------------------------------

const tablePayload = (over: Partial<TableTabPayload> = {}): TableTabPayload => ({
  sessionId: "s1",
  connectionId: "c1",
  database: "db",
  table: "users",
  driver: "mysql",
  focus: "data",
  ...over,
});

const tableIntent = (over: Partial<TableTabPayload> = {}): WorkspaceTabIntent => ({
  kind: "table",
  payload: tablePayload(over),
});

const tableListIntent = (
  sessionId = "s1",
  database = "db",
): WorkspaceTabIntent => ({
  kind: "table-list",
  payload: { sessionId, database },
});

const queryPayload = (content = ""): QueryTabPayload => ({
  sessionId: "s1",
  database: "db",
  content,
  results: [],
  activeResultId: null,
  error: null,
});

const queryIntent = (content = ""): WorkspaceTabIntent => ({
  kind: "query",
  payload: queryPayload(content),
});

const designerIntent = (): WorkspaceTabIntent => ({
  kind: "table-designer",
  payload: { mode: "create", sessionId: "s1", database: "db", dialect: "mysql" },
});

// ---- nextTabId -------------------------------------------------------------

describe("nextTabId", () => {
  it("is monotonic and wt-prefixed", () => {
    const a = nextTabId();
    const b = nextTabId();
    const c = nextTabId();
    expect(a).toMatch(/^wt-\d+$/);
    const na = Number(a.slice(3));
    const nb = Number(b.slice(3));
    const nc = Number(c.slice(3));
    expect(nb).toBe(na + 1);
    expect(nc).toBe(nb + 1);
  });
});

// ---- tabDedupeKey / defaultTitle -------------------------------------------

describe("tabDedupeKey", () => {
  it("keys table by session+database+schema+table, ignoring focus", () => {
    const data = tabDedupeKey(tableIntent({ focus: "data" }));
    const structure = tabDedupeKey(tableIntent({ focus: "structure" }));
    expect(data).not.toBeNull();
    expect(data).toBe(structure);
  });

  it("keys table-list by session+database", () => {
    expect(tabDedupeKey(tableListIntent("s1", "db"))).toBe("table-list::s1::db");
  });

  it("keys server-monitor by session", () => {
    expect(
      tabDedupeKey({ kind: "server-monitor", payload: { sessionId: "s9" } }),
    ).toBe("server-monitor::s9");
  });

  it("returns null for query and all designers", () => {
    expect(tabDedupeKey(queryIntent())).toBeNull();
    expect(tabDedupeKey(designerIntent())).toBeNull();
    expect(
      tabDedupeKey({
        kind: "view-designer",
        payload: { mode: "create", sessionId: "s1", database: "db", dialect: "mysql" },
      }),
    ).toBeNull();
    expect(
      tabDedupeKey({
        kind: "routine-editor",
        payload: {
          mode: "create",
          sessionId: "s1",
          database: "db",
          dialect: "mysql",
          kind: "procedure",
        },
      }),
    ).toBeNull();
  });
});

describe("defaultTitle", () => {
  it("derives titles per kind", () => {
    expect(defaultTitle(tableIntent({ table: "orders" }))).toBe("orders");
    expect(defaultTitle(tableListIntent("s1", "shop"))).toBe("shop");
    expect(defaultTitle(queryIntent())).toBe("Query");
    expect(defaultTitle(designerIntent())).toBe("New Table");
    expect(
      defaultTitle({
        kind: "table-designer",
        payload: {
          mode: "alter",
          sessionId: "s1",
          database: "db",
          dialect: "mysql",
          tableName: "users",
          originalColumns: [],
          originalIndexes: [],
          originalForeignKeys: [],
        },
      }),
    ).toBe("users");
    expect(
      defaultTitle({
        kind: "routine-editor",
        payload: {
          mode: "create",
          sessionId: "s1",
          database: "db",
          dialect: "mysql",
          kind: "function",
        },
      }),
    ).toBe("New Function");
    expect(
      defaultTitle({ kind: "server-monitor", payload: { sessionId: "s1" } }),
    ).toBe("Server Monitor");
  });
});

// ---- server-monitor dedupe -------------------------------------------------

describe("openTab server-monitor", () => {
  it("reuses an open monitor tab for the same session", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, { kind: "server-monitor", payload: { sessionId: "s1" } });
    const id = s.activeId;
    s = openTab(s, queryIntent());
    s = openTab(s, { kind: "server-monitor", payload: { sessionId: "s1" } });
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(id);
  });

  it("opens a separate monitor tab per session", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, { kind: "server-monitor", payload: { sessionId: "s1" } });
    s = openTab(s, { kind: "server-monitor", payload: { sessionId: "s2" } });
    expect(s.tabs).toHaveLength(2);
  });
});

// ---- openTab: dedupe behaviour ---------------------------------------------

describe("openTab dedupe", () => {
  it("reuses an open table tab, updates its payload, and activates it", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableIntent());
    const firstId = s.activeId;
    // open an unrelated tab so the table tab is no longer active
    s = openTab(s, queryIntent());
    expect(s.activeId).not.toBe(firstId);
    expect(s.tabs).toHaveLength(2);

    // re-open the SAME table -> reuse + reactivate, no append
    s = openTab(s, tableIntent({ focus: "data" }));
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(firstId);
  });

  it("structure-focus open reuses the table tab and sets focus:'structure'", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableIntent({ focus: "data" }));
    const id = s.activeId!;
    s = openTab(s, tableIntent({ focus: "structure" }));
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(id);
    const tab = s.tabs[0];
    expect(tab.kind).toBe("table");
    if (tab.kind === "table") {
      expect(tab.payload.focus).toBe("structure");
    }
  });

  it("reuses an open table-list tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableListIntent("s1", "db"));
    const id = s.activeId;
    s = openTab(s, queryIntent());
    s = openTab(s, tableListIntent("s1", "db"));
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(id);
  });

  it("does NOT dedupe different tables / databases", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableIntent({ table: "users" }));
    s = openTab(s, tableIntent({ table: "orders" }));
    expect(s.tabs).toHaveLength(2);
  });
});

describe("openTab always-new kinds", () => {
  it("query always appends a new tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, queryIntent("select 1"));
    s = openTab(s, queryIntent("select 1"));
    s = openTab(s, queryIntent("select 1"));
    expect(s.tabs).toHaveLength(3);
    // all distinct ids
    expect(new Set(s.tabs.map((t) => t.id)).size).toBe(3);
    expect(s.activeId).toBe(s.tabs[2].id);
  });

  it("designers always append a new tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, designerIntent());
    s = openTab(s, designerIntent());
    expect(s.tabs).toHaveLength(2);
  });

  it("uses the intent title when provided, otherwise defaultTitle", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, { kind: "query", title: "My Query", payload: queryPayload() });
    expect(s.tabs[0].title).toBe("My Query");
    s = openTab(s, queryIntent());
    expect(s.tabs[1].title).toBe("Query");
  });
});

// ---- closeTab --------------------------------------------------------------

describe("closeTab", () => {
  it("activates the right neighbour when closing the active tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableIntent({ table: "a" }));
    s = openTab(s, tableIntent({ table: "b" }));
    s = openTab(s, tableIntent({ table: "c" }));
    const [a, b, c] = s.tabs.map((t) => t.id);
    s = activateTab(s, b);
    s = closeTab(s, b);
    expect(s.tabs.map((t) => t.id)).toEqual([a, c]);
    expect(s.activeId).toBe(c); // right neighbour
  });

  it("activates the left neighbour when closing the active LAST tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableIntent({ table: "a" }));
    s = openTab(s, tableIntent({ table: "b" }));
    const [a, b] = s.tabs.map((t) => t.id);
    s = activateTab(s, b);
    s = closeTab(s, b);
    expect(s.tabs.map((t) => t.id)).toEqual([a]);
    expect(s.activeId).toBe(a); // left neighbour (no right)
  });

  it("sets activeId null when closing the only tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableIntent());
    const id = s.activeId!;
    s = closeTab(s, id);
    expect(s.tabs).toEqual([]);
    expect(s.activeId).toBeNull();
  });

  it("keeps activeId when closing a NON-active tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableIntent({ table: "a" }));
    s = openTab(s, tableIntent({ table: "b" }));
    const [a, b] = s.tabs.map((t) => t.id);
    s = activateTab(s, a);
    s = closeTab(s, b);
    expect(s.tabs.map((t) => t.id)).toEqual([a]);
    expect(s.activeId).toBe(a);
  });

  it("is a no-op for an unknown id", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableIntent());
    const before = s;
    const after = closeTab(s, "does-not-exist");
    expect(after).toBe(before);
  });
});

// ---- activateTab -----------------------------------------------------------

describe("activateTab", () => {
  it("activates an existing tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableIntent({ table: "a" }));
    s = openTab(s, tableIntent({ table: "b" }));
    const [a] = s.tabs.map((t) => t.id);
    s = activateTab(s, a);
    expect(s.activeId).toBe(a);
  });

  it("is a no-op for an unknown id", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, tableIntent());
    const before = s;
    const after = activateTab(s, "nope");
    expect(after).toBe(before);
  });
});

// ---- updateTabPayload ------------------------------------------------------

describe("updateTabPayload", () => {
  it("shallow-merges a patch into the target tab's payload", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, queryIntent("select 1"));
    const id = s.activeId!;
    s = updateTabPayload(s, id, { content: "select 2", error: "boom" });
    const tab = s.tabs[0];
    expect(tab.kind).toBe("query");
    if (tab.kind === "query") {
      expect(tab.payload.content).toBe("select 2");
      expect(tab.payload.error).toBe("boom");
      // untouched fields preserved
      expect(tab.payload.sessionId).toBe("s1");
    }
  });

  it("only patches the targeted tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, queryIntent("a"));
    s = openTab(s, queryIntent("b"));
    const [first, second] = s.tabs.map((t) => t.id);
    s = updateTabPayload(s, first, { content: "patched" });
    const t0 = s.tabs.find((t) => t.id === first)!;
    const t1 = s.tabs.find((t) => t.id === second)!;
    if (t0.kind === "query") expect(t0.payload.content).toBe("patched");
    if (t1.kind === "query") expect(t1.payload.content).toBe("b");
  });
});

// ---- setDirty / setTitle ---------------------------------------------------

describe("setDirty", () => {
  it("toggles the dirty flag on the target tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, queryIntent());
    const id = s.activeId!;
    expect(s.tabs[0].dirty).toBeUndefined();
    s = setDirty(s, id, true);
    expect(s.tabs[0].dirty).toBe(true);
    s = setDirty(s, id, false);
    expect(s.tabs[0].dirty).toBe(false);
  });
});

describe("setTitle", () => {
  it("renames the target tab", () => {
    let s: WorkspaceState = emptyWorkspace;
    s = openTab(s, queryIntent());
    const id = s.activeId!;
    s = setTitle(s, id, "Renamed");
    expect(s.tabs[0].title).toBe("Renamed");
  });
});
