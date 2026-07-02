// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { ErdFkDialog, type ErdFkDialogProps } from "./ErdFkDialog";

function renderDialog(over: Partial<ErdFkDialogProps> = {}) {
  const props: ErdFkDialogProps = {
    sourceTable: "orders",
    targetTable: "users",
    sourceColumns: [{ name: "user_id" }, { name: "id" }],
    targetColumns: [{ name: "id" }, { name: "email" }],
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  return { props, ...renderWithProviders(<ErdFkDialog {...props} />) };
}

describe("ErdFkDialog", () => {
  it("renders the title and the source/target table reference line", () => {
    renderDialog();
    expect(screen.getByText("New Foreign Key")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("references")).toBeInTheDocument();
  });

  it("seeds a default constraint name from the two table names", () => {
    renderDialog();
    const name = screen.getByDisplayValue("fk_orders_users");
    expect(name).toBeInTheDocument();
  });

  it("defaults the local and referenced column selects to the first option", () => {
    renderDialog();
    expect(screen.getByLabelText("Local column")).toHaveValue("user_id");
    expect(screen.getByLabelText("Referenced column")).toHaveValue("id");
  });

  it("confirms with the chosen name, columns, and referential actions", async () => {
    const onConfirm = vi.fn();
    const { user } = renderDialog({ onConfirm });

    await user.selectOptions(screen.getByLabelText("Local column"), "id");
    await user.selectOptions(screen.getByLabelText("Referenced column"), "email");
    await user.selectOptions(screen.getByLabelText("ON DELETE"), "CASCADE");

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      name: "fk_orders_users",
      localColumn: "id",
      refColumn: "email",
      onDelete: "CASCADE",
      onUpdate: undefined,
    });
  });

  it("disables Create when the constraint name is cleared", async () => {
    const onConfirm = vi.fn();
    const { user } = renderDialog({ onConfirm });

    const name = screen.getByDisplayValue("fk_orders_users");
    await user.clear(name);

    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();
    await user.click(create);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fires onCancel from the Cancel button and the close button", async () => {
    const onCancel = vi.fn();
    const { user } = renderDialog({ onCancel });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows a no-columns placeholder when a side has no columns", () => {
    renderDialog({ sourceColumns: [] });
    expect(screen.getByText("— no columns —")).toBeInTheDocument();
  });
});
