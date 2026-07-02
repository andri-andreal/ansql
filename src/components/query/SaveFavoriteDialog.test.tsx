// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import SaveFavoriteDialog from "./SaveFavoriteDialog";

function renderDialog(props: Partial<React.ComponentProps<typeof SaveFavoriteDialog>> = {}) {
  return renderWithProviders(
    <SaveFavoriteDialog
      open
      sql="SELECT 1"
      onCancel={() => {}}
      onSave={() => {}}
      {...props}
    />,
  );
}

describe("SaveFavoriteDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = renderDialog({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the SQL preview and the save form", () => {
    renderDialog({ sql: "SELECT * FROM orders" });
    expect(screen.getByText("Save to Favorites")).toBeInTheDocument();
    expect(screen.getByText("SELECT * FROM orders")).toBeInTheDocument();
  });

  it("disables Save until a name is entered", async () => {
    const { user } = renderDialog();
    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeDisabled();
    await user.type(
      screen.getByPlaceholderText("e.g. Active users last 30 days"),
      "Recent orders",
    );
    expect(saveBtn).toBeEnabled();
  });

  it("calls onSave with the trimmed name and description", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { user } = renderDialog({ onSave });
    const [nameInput, descInput] = screen.getAllByRole("textbox");
    await user.type(nameInput, "  My query  ");
    await user.type(descInput, "  notes  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("My query", "notes"));
  });

  it("omits the description when it is left blank", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { user } = renderDialog({ onSave });
    await user.type(screen.getAllByRole("textbox")[0], "Just a name");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Just a name", undefined));
  });

  it("surfaces an error thrown by onSave", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("duplicate name"));
    const { user } = renderDialog({ onSave });
    await user.type(screen.getAllByRole("textbox")[0], "Dup");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("duplicate name")).toBeInTheDocument());
  });

  it("fires onCancel from the Cancel button", async () => {
    const onCancel = vi.fn();
    const { user } = renderDialog({ onCancel });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
