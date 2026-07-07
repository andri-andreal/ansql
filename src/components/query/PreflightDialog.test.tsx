// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { PreflightDialog, type PreflightData } from "./PreflightDialog";

const updateData = (partial?: Partial<PreflightData>): PreflightData => ({
  verb: "update",
  table: "users",
  sql: "UPDATE users SET status = 'inactive' WHERE id < 3",
  hasWhere: true,
  totalRows: 2,
  truncated: false,
  cap: 1000,
  rows: [
    {
      before: { id: 1, name: "alice", status: "active" },
      after: { id: 1, name: "alice", status: "inactive" },
      changedColumns: ["status"],
    },
    {
      before: { id: 2, name: "bob", status: "inactive" },
      after: { id: 2, name: "bob", status: "inactive" },
      changedColumns: [],
    },
  ],
  columns: ["id", "name", "status"],
  keyColumns: ["id"],
  assignments: [{ column: "status", exprSql: "'inactive'" }],
  irreversible: null,
  ...partial,
});

describe("PreflightDialog", () => {
  it("renders nothing when data is null", () => {
    renderWithProviders(<PreflightDialog data={null} onCommit={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the headline with count and table", () => {
    renderWithProviders(
      <PreflightDialog data={updateData()} onCommit={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByText("2 row(s) will change in users")).toBeInTheDocument();
  });

  it("renders old → new for changed cells and (no change) otherwise", () => {
    renderWithProviders(
      <PreflightDialog data={updateData()} onCommit={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByText("'active'")).toBeInTheDocument();
    expect(screen.getAllByText("'inactive'").length).toBeGreaterThan(0);
    expect(screen.getByText("(no change)")).toBeInTheDocument();
  });

  it("shows the no-WHERE danger banner only when hasWhere is false", () => {
    const { unmount } = renderWithProviders(
      <PreflightDialog data={updateData()} onCommit={() => {}} onCancel={() => {}} />,
    );
    expect(screen.queryByText(/no WHERE clause/)).not.toBeInTheDocument();
    unmount();
    renderWithProviders(
      <PreflightDialog
        data={updateData({ hasWhere: false })}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/no WHERE clause/)).toBeInTheDocument();
  });

  it("shows the reversible badge when irreversible is null", () => {
    renderWithProviders(
      <PreflightDialog data={updateData()} onCommit={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByText(/Reversible — undo will be recorded/)).toBeInTheDocument();
  });

  it("shows the per-reason badge when irreversible is set", () => {
    renderWithProviders(
      <PreflightDialog
        data={updateData({ irreversible: "no-pk" })}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/no primary key/)).toBeInTheDocument();
  });

  it("shows the truncation notice with the exact total", () => {
    renderWithProviders(
      <PreflightDialog
        data={updateData({ truncated: true, totalRows: 5000, cap: 1000, irreversible: "truncated" })}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Showing the first 1000 of 5000 row(s).")).toBeInTheDocument();
    expect(screen.getByText(/more rows than the snapshot cap \(1000\)/)).toBeInTheDocument();
  });

  it("falls back to the at-least headline when the count is unknown", () => {
    renderWithProviders(
      <PreflightDialog
        data={updateData({ truncated: true, totalRows: null })}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText("At least 1000 row(s) will be affected in users"),
    ).toBeInTheDocument();
  });

  it("renders full rows for DELETE", () => {
    renderWithProviders(
      <PreflightDialog
        data={updateData({
          verb: "delete",
          assignments: [],
          rows: [{ before: { id: 4, name: "dave", status: "trial" }, after: null, changedColumns: [] }],
          totalRows: 1,
        })}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("1 row(s) will be deleted from users")).toBeInTheDocument();
    expect(screen.getByText("'dave'")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run DELETE" })).toBeInTheDocument();
  });

  it("invokes onCommit and onCancel from the footer buttons", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { user } = renderWithProviders(
      <PreflightDialog data={updateData()} onCommit={onCommit} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole("button", { name: "Run UPDATE" }));
    expect(onCommit).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
