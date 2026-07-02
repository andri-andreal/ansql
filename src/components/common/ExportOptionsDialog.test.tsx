// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import ExportOptionsDialog from "./ExportOptionsDialog";

function renderDialog(
  props: Partial<React.ComponentProps<typeof ExportOptionsDialog>> = {},
) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const result = renderWithProviders(
    <ExportOptionsDialog
      format="csv"
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
  );
  return { onConfirm, onClose, ...result };
}

describe("ExportOptionsDialog", () => {
  it("titles itself by the format (csv vs txt)", () => {
    const { unmount } = renderDialog({ format: "csv" });
    expect(screen.getByText("Export CSV")).toBeInTheDocument();
    unmount();
    renderDialog({ format: "txt" });
    expect(screen.getByText("Export Text")).toBeInTheDocument();
  });

  it("confirms with the default CSV options (comma, double quote, headers on)", async () => {
    const { user, onConfirm } = renderDialog({ format: "csv" });
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      delimiter: ",",
      quoteChar: '"',
      includeHeaders: true,
      nullToken: "",
    });
  });

  it("defaults TXT exports to a tab delimiter", async () => {
    const { user, onConfirm } = renderDialog({ format: "txt" });
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ delimiter: "\t" }),
    );
  });

  it("reveals a custom-delimiter field and uses its value on confirm", async () => {
    const { user, onConfirm } = renderDialog({ format: "csv" });
    // Delimiter preset select is the first combobox.
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "custom");
    const custom = screen.getByPlaceholderText(",");
    await user.clear(custom);
    await user.type(custom, "~");
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ delimiter: "~" }),
    );
  });

  it("threads the quote-char choice, NULL token, and header toggle through onConfirm", async () => {
    const { user, onConfirm } = renderDialog({ format: "csv" });
    const selects = screen.getAllByRole("combobox");
    // Second combobox is the text qualifier; pick "None (no quoting)" -> "".
    await user.selectOptions(selects[1], "");
    await user.type(screen.getByPlaceholderText("(empty)"), "NULL");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onConfirm).toHaveBeenCalledWith({
      delimiter: ",",
      quoteChar: "",
      includeHeaders: false,
      nullToken: "NULL",
    });
  });

  it("calls onClose from the Cancel button without confirming", async () => {
    const { user, onClose, onConfirm } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
