import { describe, it, expect, beforeEach } from "vitest";
import { clipboardStore } from "./clipboardStore";
import type { AnsqlClipboard, SourceRef } from "../types";

const source: SourceRef = {
  sessionId: "s1",
  connectionId: "c1",
  dbType: "sqlite",
  database: "main",
  schema: null,
};

describe("clipboardStore", () => {
  beforeEach(() => clipboardStore.clear());

  it("starts empty", () => {
    expect(clipboardStore.get()).toBeNull();
  });

  it("stores a payload and bumps seq each set", () => {
    const a: AnsqlClipboard = { kind: "table-ref", source, tables: [{ name: "t", schema: null }] };
    clipboardStore.set(a);
    const first = clipboardStore.peek();
    expect(first?.payload).toEqual(a);
    clipboardStore.set(a);
    expect(clipboardStore.peek()!.seq).toBe(first!.seq + 1);
  });

  it("treats a payload whose source session is closed as stale", () => {
    const a: AnsqlClipboard = { kind: "table-ref", source, tables: [{ name: "t", schema: null }] };
    clipboardStore.set(a);
    expect(clipboardStore.isStale(["s1"])).toBe(false);
    expect(clipboardStore.isStale(["other"])).toBe(true);
  });

  it("does not notify on a redundant clear", () => {
    clipboardStore.set({ kind: "table-ref", source, tables: [] });
    clipboardStore.clear();
    let calls = 0;
    const unsub = clipboardStore.subscribe(() => calls++);
    clipboardStore.clear(); // already empty → no emit
    unsub();
    expect(calls).toBe(0);
  });

  it("notifies subscribers on change", () => {
    let calls = 0;
    const unsub = clipboardStore.subscribe(() => calls++);
    clipboardStore.set({ kind: "table-ref", source, tables: [] });
    clipboardStore.clear();
    unsub();
    clipboardStore.set({ kind: "table-ref", source, tables: [] });
    expect(calls).toBe(2);
  });
});
