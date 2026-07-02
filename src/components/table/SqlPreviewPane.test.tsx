// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { SqlPreviewPane } from "./SqlPreviewPane";
import type { Statement } from "../../types";

describe("SqlPreviewPane", () => {
  it("renders the empty state when there are no statements", () => {
    renderWithProviders(<SqlPreviewPane statements={[]} />);
    expect(screen.getByText("No changes to apply.")).toBeInTheDocument();
  });

  it("joins multiple statement SQLs into a single pre block", () => {
    const statements: Statement[] = [
      { sql: "UPDATE t SET a = 1", params: [] },
      { sql: "DELETE FROM t WHERE id = 2", params: [] },
    ];
    const { container } = renderWithProviders(<SqlPreviewPane statements={statements} />);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe("UPDATE t SET a = 1\n\nDELETE FROM t WHERE id = 2");
  });

  it("renders the warnings panel with each warning line", () => {
    const statements: Statement[] = [{ sql: "DROP TABLE t", params: [] }];
    renderWithProviders(
      <SqlPreviewPane statements={statements} warnings={["Destructive", "No backup"]} />
    );
    expect(screen.getByText("Warnings")).toBeInTheDocument();
    expect(screen.getByText("Destructive")).toBeInTheDocument();
    expect(screen.getByText("No backup")).toBeInTheDocument();
  });

  it("omits the warnings panel when there are no warnings", () => {
    const statements: Statement[] = [{ sql: "SELECT 1", params: [] }];
    renderWithProviders(<SqlPreviewPane statements={statements} warnings={[]} />);
    expect(screen.queryByText("Warnings")).not.toBeInTheDocument();
  });
});
