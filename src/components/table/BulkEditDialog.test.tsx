// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import { BulkEditDialog } from "./BulkEditDialog";

function renderDialog(props: Partial<React.ComponentProps<typeof BulkEditDialog>> = {}) {
  return renderWithProviders(
    <BulkEditDialog
      cellCount={3}
      columnNames={["a", "b"]}
      onApply={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  );
}

describe("BulkEditDialog", () => {
  it("summarises the affected cell count and columns", () => {
    renderDialog({ cellCount: 3, columnNames: ["status", "role"] });
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("status, role")).toBeInTheDocument();
    // Apply button reflects the plural count.
    expect(screen.getByRole("button", { name: "Apply to 3 cells" })).toBeInTheDocument();
  });

  it("applies the typed value to all cells", async () => {
    const onApply = vi.fn();
    const { user } = renderDialog({ cellCount: 2, onApply });
    await user.type(screen.getByPlaceholderText("Enter value…"), "hello");
    await user.click(screen.getByRole("button", { name: "Apply to 2 cells" }));
    expect(onApply).toHaveBeenCalledWith("hello");
  });

  it("applies NULL (and disables the value input) when 'Set to NULL' is checked", async () => {
    const onApply = vi.fn();
    const { user } = renderDialog({ cellCount: 1, onApply });
    await user.click(screen.getByLabelText("Set to NULL"));
    expect(screen.getByPlaceholderText("Enter value…")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Apply to 1 cell" }));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("cancels via the Cancel button", async () => {
    const onCancel = vi.fn();
    const { user } = renderDialog({ onCancel });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables Apply when there are no cells to edit", () => {
    renderDialog({ cellCount: 0 });
    expect(screen.getByRole("button", { name: /Apply to 0/ })).toBeDisabled();
  });
});
