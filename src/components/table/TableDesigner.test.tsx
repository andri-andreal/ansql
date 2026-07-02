// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { TableDesigner } from "./TableDesigner";

function baseProps() {
  return {
    mode: "create" as const,
    dialect: "postgres" as const,
    database: "appdb",
    schema: "public",
    onApply: vi.fn().mockResolvedValue(undefined),
    onApplied: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("TableDesigner", () => {
  it("renders the create title and an editable table name", async () => {
    const { user } = renderWithProviders(<TableDesigner {...baseProps()} />);
    expect(screen.getByText("New Table")).toBeInTheDocument();
    const name = screen.getByLabelText("Table name");
    await user.type(name, "orders");
    expect(name).toHaveValue("orders");
  });

  it("starts on the Columns tab with one blank column row", () => {
    renderWithProviders(<TableDesigner {...baseProps()} />);
    // ColumnEditorGrid renders a DOM table with a Column name input per row.
    expect(screen.getByLabelText("Column name")).toBeInTheDocument();
  });

  it("switches to the Indexes tab and shows its empty state", async () => {
    const { user } = renderWithProviders(<TableDesigner {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: "Indexes" }));
    expect(screen.getByText("No indexes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add index" })).toBeInTheDocument();
  });

  it("switches to the Checks tab and shows its empty state", async () => {
    const { user } = renderWithProviders(<TableDesigner {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: "Checks" }));
    expect(screen.getByText("No check constraints")).toBeInTheDocument();
  });

  it("switches to the Uniques tab and shows its empty state", async () => {
    const { user } = renderWithProviders(<TableDesigner {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: "Uniques" }));
    expect(screen.getByText("No unique constraints")).toBeInTheDocument();
  });

  it("shows a live SQL preview that reflects the typed table name", async () => {
    const { user } = renderWithProviders(<TableDesigner {...baseProps()} />);
    await user.type(screen.getByLabelText("Table name"), "orders");
    await user.type(screen.getByLabelText("Column name"), "id");

    await user.click(screen.getByRole("button", { name: "SQL Preview" }));
    await waitFor(() =>
      expect(screen.getByText(/CREATE TABLE/)).toBeInTheDocument(),
    );
  });

  it("create-mode Save applies CREATE TABLE statements and closes", async () => {
    const props = baseProps();
    const { user } = renderWithProviders(<TableDesigner {...props} />);

    await user.type(screen.getByLabelText("Table name"), "orders");
    await user.type(screen.getByLabelText("Column name"), "id");

    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(props.onApply).toHaveBeenCalledTimes(1));
    const statements = props.onApply.mock.calls[0][0] as { sql: string }[];
    expect(statements.some((s) => /CREATE TABLE/i.test(s.sql))).toBe(true);
    expect(statements.some((s) => /orders/.test(s.sql))).toBe(true);
    await waitFor(() => expect(props.onApplied).toHaveBeenCalled());
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("cancel fires onClose without applying", async () => {
    const props = baseProps();
    const { user } = renderWithProviders(<TableDesigner {...props} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onApply).not.toHaveBeenCalled();
  });
});
