import { describe, it, expect } from "vitest";
import { decidePaste, type PasteTarget } from "./usePaste";
import type { AnsqlClipboard, SourceRef } from "../types";

const source: SourceRef = {
  sessionId: "s1",
  connectionId: "c1",
  dbType: "sqlite",
  database: "main",
  schema: null,
};

const snapshot: AnsqlClipboard = {
  kind: "row-snapshot",
  source,
  table: "t",
  columns: [{ name: "id", data_type: "int", nullable: false }],
  rows: [[1]],
};

const tableRef: AnsqlClipboard = {
  kind: "table-ref",
  source,
  tables: [{ name: "t", schema: null }],
};

describe("decidePaste", () => {
  it("returns 'none' when clipboard is empty", () => {
    expect(decidePaste(null, { kind: "grid", sessionId: "s1", database: "main", table: "t" }).action).toBe("none");
  });

  it("uses the grid fast path for a same-DB cell snapshot", () => {
    const target: PasteTarget = { kind: "grid", sessionId: "s1", database: "main", table: "t" };
    expect(decidePaste(snapshot, target).action).toBe("grid-fast-path");
  });

  it("opens the modal for a snapshot pasted into a different session", () => {
    const target: PasteTarget = { kind: "grid", sessionId: "s2", database: "main", table: "t" };
    expect(decidePaste(snapshot, target).action).toBe("open-modal");
  });

  it("opens the modal for a snapshot pasted into a different database (same session)", () => {
    const target: PasteTarget = { kind: "grid", sessionId: "s1", database: "other", table: "t" };
    expect(decidePaste(snapshot, target).action).toBe("open-modal");
  });

  it("always opens the modal for a table-ref, even same-DB", () => {
    const target: PasteTarget = { kind: "grid", sessionId: "s1", database: "main", table: "t" };
    expect(decidePaste(tableRef, target).action).toBe("open-modal");
  });

  it("opens the modal when target is unresolved (button/global paste)", () => {
    expect(decidePaste(snapshot, null).action).toBe("open-modal");
  });

  it("opens the modal for a query-ref pasted into the same DB grid", () => {
    const queryRef: AnsqlClipboard = {
      kind: "query-ref",
      source,
      sql: "SELECT 1",
      columns: [{ name: "x", data_type: "int", nullable: false }],
    };
    const target: PasteTarget = { kind: "grid", sessionId: "s1", database: "main", table: "t" };
    expect(decidePaste(queryRef, target).action).toBe("open-modal");
  });
});
