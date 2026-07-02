// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { makeTable, makeColumn, makeForeignKey } from "../../test/fixtures";
import { SqlBuilderView } from "./SqlBuilderView";

function renderBuilder(props: Partial<React.ComponentProps<typeof SqlBuilderView>> = {}) {
  return renderWithProviders(
    <SqlBuilderView
      sessionId="s1"
      database="test"
      schema={null}
      dialect="postgres"
      getTables={vi.fn().mockResolvedValue([])}
      getColumns={vi.fn().mockResolvedValue([])}
      getForeignKeys={vi.fn().mockResolvedValue([])}
      onApply={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

describe("SqlBuilderView", () => {
  it("loads base tables and shows the pick-a-table empty state", async () => {
    const getTables = vi.fn().mockResolvedValue([makeTable({ name: "users" })]);
    renderBuilder({ getTables });
    expect(screen.getByText("Query Builder")).toBeInTheDocument();
    await waitFor(() => expect(getTables).toHaveBeenCalledWith("s1", "test", undefined));
    expect(screen.getByText("Pick a table to start building a query.")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "users" })).toBeInTheDocument();
  });

  it("selecting a base table fetches its columns and builds a preview", async () => {
    const getTables = vi.fn().mockResolvedValue([makeTable({ name: "users" })]);
    const getColumns = vi
      .fn()
      .mockResolvedValue([makeColumn({ name: "id" }), makeColumn({ name: "email" })]);
    const { user } = renderBuilder({ getTables, getColumns });

    await screen.findByRole("option", { name: "users" });
    const tableSelect = screen.getByRole("combobox");
    await user.selectOptions(tableSelect, "users");

    await waitFor(() =>
      expect(getColumns).toHaveBeenCalledWith("s1", "test", "users", undefined),
    );
    // Column checklist appears.
    expect(await screen.findByText("email")).toBeInTheDocument();
    // Live preview (in the <pre>) defaults to SELECT * when no columns are ticked.
    const preview = screen.getByText(
      (text, el) => el?.tagName === "PRE" && /select/i.test(text),
    );
    expect(preview).toHaveTextContent(/from/i);
    expect(preview).toHaveTextContent(/users/i);
  });

  it("emits the built SQL via onApply when Use query is clicked", async () => {
    const getTables = vi.fn().mockResolvedValue([makeTable({ name: "users" })]);
    const getColumns = vi.fn().mockResolvedValue([makeColumn({ name: "id" })]);
    const onApply = vi.fn();
    const onClose = vi.fn();
    const { user } = renderBuilder({ getTables, getColumns, onApply, onClose });

    await screen.findByRole("option", { name: "users" });
    await user.selectOptions(screen.getByRole("combobox"), "users");
    await screen.findByText("id");

    await user.click(screen.getByRole("button", { name: "Use query" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toMatch(/select/i);
    expect(onApply.mock.calls[0][0]).toMatch(/users/i);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers FK-derived join suggestions for the base table", async () => {
    const getTables = vi.fn().mockResolvedValue([makeTable({ name: "orders" })]);
    const getColumns = vi.fn().mockResolvedValue([makeColumn({ name: "user_id" })]);
    const getForeignKeys = vi.fn().mockResolvedValue([
      makeForeignKey({
        columns: ["user_id"],
        referenced_table: "users",
        referenced_columns: ["id"],
      }),
    ]);
    const { user } = renderBuilder({ getTables, getColumns, getForeignKeys });

    await screen.findByRole("option", { name: "orders" });
    await user.selectOptions(screen.getByRole("combobox"), "orders");

    expect(await screen.findByText("Suggested from foreign keys")).toBeInTheDocument();
    expect(
      screen.getByText((t) => t.includes("orders.user_id") && t.includes("users.id")),
    ).toBeInTheDocument();
  });

  it("fires onClose from the Cancel button", async () => {
    const onClose = vi.fn();
    const { user } = renderBuilder({ onClose });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("adds a WHERE filter row when Add filter is clicked", async () => {
    const getTables = vi.fn().mockResolvedValue([makeTable({ name: "users" })]);
    const getColumns = vi.fn().mockResolvedValue([makeColumn({ name: "id" })]);
    const { user } = renderBuilder({ getTables, getColumns });

    await screen.findByRole("option", { name: "users" });
    await user.selectOptions(screen.getByRole("combobox"), "users");
    await screen.findByText("id");

    expect(screen.getByText("No filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add filter/ }));
    expect(screen.queryByText("No filters.")).not.toBeInTheDocument();
  });
});
