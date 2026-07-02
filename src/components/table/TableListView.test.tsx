// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within, waitFor, fireEvent } from "../../test/render";
import { makeTable } from "../../test/fixtures";
import { TableListView } from "./TableListView";

const tables = [
  makeTable({ name: "users", row_count: 42 }),
  makeTable({ name: "orders", row_count: 1000 }),
  makeTable({ name: "user_view", table_type: "view", row_count: undefined }),
];

function renderList(over: Partial<React.ComponentProps<typeof TableListView>> = {}) {
  const getTables = vi.fn().mockResolvedValue(tables);
  const onOpenTable = vi.fn();
  const result = renderWithProviders(
    <TableListView
      sessionId="s1"
      database="shop"
      getTables={getTables}
      onOpenTable={onOpenTable}
      {...over}
    />,
  );
  return { ...result, getTables, onOpenTable };
}

describe("TableListView", () => {
  it("loads and lists tables with the object count and row counts", async () => {
    renderList();
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("user_view")).toBeInTheDocument();
    expect(screen.getByText("3 objects")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument();
    // View row with null row_count renders an em dash.
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("filters the list by name as the user types", async () => {
    const { user } = renderList();
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("Filter…"), "order");
    await waitFor(() => expect(screen.queryByText("users")).not.toBeInTheDocument());
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("1 object")).toBeInTheDocument();
  });

  it("opens a table on double-click", async () => {
    const { onOpenTable } = renderList();
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());
    fireEvent.doubleClick(screen.getByText("users"));
    expect(onOpenTable).toHaveBeenCalledWith("users", undefined);
  });

  it("shows the selection action bar and fires copy/transfer callbacks", async () => {
    const onCopyTables = vi.fn();
    const onTransferTables = vi.fn();
    const { user } = renderList({ onCopyTables, onTransferTables });
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());

    // Select the first data row (its row checkbox; index 0 is the header "Select all").
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Copy/ }));
    expect(onCopyTables).toHaveBeenCalledTimes(1);
    expect(onCopyTables.mock.calls[0][0]).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /Transfer/ }));
    expect(onTransferTables).toHaveBeenCalledTimes(1);
  });

  it("confirms and runs a delete via onDeleteTables", async () => {
    const onDeleteTables = vi.fn().mockResolvedValue(undefined);
    const { user } = renderList({ onDeleteTables });
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole("button", { name: /Delete…/ }));

    // Confirmation dialog appears.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete 1 object?")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Delete 1/ }));
    await waitFor(() => expect(onDeleteTables).toHaveBeenCalledTimes(1));
    // force defaults to false.
    expect(onDeleteTables.mock.calls[0][1]).toBe(false);
  });

  it("shows the empty state when there are no tables", async () => {
    const getTables = vi.fn().mockResolvedValue([]);
    renderList({ getTables });
    await waitFor(() =>
      expect(screen.getByText("No tables in this database")).toBeInTheDocument(),
    );
  });
});
