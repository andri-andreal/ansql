// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { TableSelectionDialog, type TableSelectionDialogProps } from "./TableSelectionDialog";

function renderDialog(over: Partial<TableSelectionDialogProps> = {}) {
  const props: TableSelectionDialogProps = {
    tables: [{ name: "users" }, { name: "orders" }, { name: "products" }],
    selected: ["users", "orders"],
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  return { props, ...renderWithProviders(<TableSelectionDialog {...props} />) };
}

describe("TableSelectionDialog", () => {
  it("renders the title and every table name as a checkbox row", () => {
    renderDialog();
    expect(screen.getByText("Select Tables")).toBeInTheDocument();
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("products")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("reflects the initial selection and the selected-of-total counter", () => {
    renderDialog();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[0].checked).toBe(true); // users
    expect(boxes[1].checked).toBe(true); // orders
    expect(boxes[2].checked).toBe(false); // products
    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();
  });

  it("toggles a table and confirms with the chosen names in incoming order", async () => {
    const onConfirm = vi.fn();
    const { user } = renderDialog({ onConfirm });

    // Check products (third row).
    await user.click(screen.getAllByRole("checkbox")[2]);
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onConfirm).toHaveBeenCalledWith(["users", "orders", "products"]);
  });

  it("select all checks everything and disables itself; select none clears and disables Confirm", async () => {
    const { user } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Select none" }));
    expect(screen.getByText("0 of 3 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("fires onCancel from Cancel and the close button", async () => {
    const onCancel = vi.fn();
    const { user } = renderDialog({ onCancel });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows an empty message when there are no tables", () => {
    renderDialog({ tables: [], selected: [] });
    expect(screen.getByText("No tables.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });
});
