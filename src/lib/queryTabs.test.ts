import { describe, it, expect } from "vitest";
import {
  computeTabsAfterClose,
  capResults,
  togglePinned,
  renameResult,
  type ResultEntry,
} from "./queryTabs";

const tab = (id: string) => ({ id });

const result = (id: string, over: Partial<ResultEntry> = {}): ResultEntry => ({
  id,
  snippet: id,
  columns: [],
  rows: [],
  execTimeMs: 0,
  ...over,
});

describe("computeTabsAfterClose", () => {
  it("removes a non-active tab and keeps the active one", () => {
    const r = computeTabsAfterClose([tab("a"), tab("b")], "a", "b");
    expect(r.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(r.activeTabId).toBe("a");
  });

  it("closing the active middle tab activates the previous neighbor", () => {
    const r = computeTabsAfterClose([tab("a"), tab("b"), tab("c")], "b", "b");
    expect(r.tabs.map((t) => t.id)).toEqual(["a", "c"]);
    expect(r.activeTabId).toBe("a");
  });

  it("closing the active first tab activates the new first tab", () => {
    const r = computeTabsAfterClose([tab("a"), tab("b")], "a", "a");
    expect(r.tabs.map((t) => t.id)).toEqual(["b"]);
    expect(r.activeTabId).toBe("b");
  });

  it("closing the active last tab activates the previous one", () => {
    const r = computeTabsAfterClose([tab("a"), tab("b"), tab("c")], "c", "c");
    expect(r.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(r.activeTabId).toBe("b");
  });

  it("closing the only tab leaves an empty list with no active tab", () => {
    const r = computeTabsAfterClose([tab("a")], "a", "a");
    expect(r.tabs).toEqual([]);
    expect(r.activeTabId).toBeNull();
  });

  it("is a no-op for an unknown tab id", () => {
    const r = computeTabsAfterClose([tab("a")], "a", "zzz");
    expect(r.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(r.activeTabId).toBe("a");
  });
});

describe("capResults", () => {
  it("returns the same reference when within the cap", () => {
    const entries = [result("a"), result("b")];
    expect(capResults(entries, 3)).toBe(entries);
  });

  it("evicts the oldest unpinned entries to satisfy the cap", () => {
    const entries = [result("a"), result("b"), result("c"), result("d")];
    expect(capResults(entries, 2).map((e) => e.id)).toEqual(["c", "d"]);
  });

  it("never drops a pinned entry, evicting unpinned ones instead", () => {
    const entries = [
      result("a", { pinned: true }),
      result("b"),
      result("c"),
      result("d"),
    ];
    // cap=2: must drop 2, but "a" is pinned -> drop oldest unpinned (b, c).
    expect(capResults(entries, 2).map((e) => e.id)).toEqual(["a", "d"]);
  });

  it("keeps all entries when every droppable one is pinned, exceeding the cap", () => {
    const entries = [
      result("a", { pinned: true }),
      result("b", { pinned: true }),
      result("c", { pinned: true }),
    ];
    expect(capResults(entries, 1)).toBe(entries);
  });

  it("pin survives cap eviction across many entries", () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      result(`r${i}`, i === 0 ? { pinned: true } : {})
    );
    const capped = capResults(entries, 10);
    expect(capped).toHaveLength(10);
    expect(capped.map((e) => e.id)).toContain("r0"); // pinned oldest kept
    expect(capped.map((e) => e.id)).not.toContain("r1"); // oldest unpinned dropped
    expect(capped.map((e) => e.id)).toContain("r11"); // newest kept
  });
});

describe("togglePinned", () => {
  it("toggles the pinned flag of the matching entry only", () => {
    const entries = [result("a"), result("b")];
    const once = togglePinned(entries, "a");
    expect(once.find((e) => e.id === "a")?.pinned).toBe(true);
    expect(once.find((e) => e.id === "b")?.pinned).toBeUndefined();

    const twice = togglePinned(once, "a");
    expect(twice.find((e) => e.id === "a")?.pinned).toBe(false);
  });

  it("is a no-op for an unknown id and does not mutate input", () => {
    const entries = [result("a")];
    const out = togglePinned(entries, "zzz");
    expect(out.map((e) => e.id)).toEqual(["a"]);
    expect(out[0].pinned).toBeUndefined();
  });
});

describe("renameResult", () => {
  it("sets a custom name on the matching entry", () => {
    const entries = [result("a"), result("b")];
    const out = renameResult(entries, "b", "My Result");
    expect(out.find((e) => e.id === "b")?.customName).toBe("My Result");
    expect(out.find((e) => e.id === "a")?.customName).toBeUndefined();
  });

  it("trims the name and clears it when blank", () => {
    const named = renameResult([result("a")], "a", "  spaced  ");
    expect(named[0].customName).toBe("spaced");

    const cleared = renameResult(named, "a", "   ");
    expect(cleared[0].customName).toBeUndefined();
  });

  it("is a no-op for an unknown id", () => {
    const entries = [result("a")];
    const out = renameResult(entries, "zzz", "x");
    expect(out[0].customName).toBeUndefined();
  });
});
