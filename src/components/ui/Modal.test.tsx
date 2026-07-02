// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within } from "@/test/render";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    renderWithProviders(
      <Modal open={false} onClose={() => {}} title="Hidden">
        body content
      </Modal>,
    );
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders title, children, and footer when open", () => {
    renderWithProviders(
      <Modal
        open
        onClose={() => {}}
        title="My Title"
        footer={<button type="button">Save</button>}
      >
        <p>Body text here</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("My Title")).toBeInTheDocument();
    expect(within(dialog).getByText("Body text here")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <Modal open onClose={onClose} title="Closable">
        body
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <Modal open onClose={onClose} title="Escapable">
        body
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the close button and ignores Escape when not dismissable", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <Modal open onClose={onClose} title="Locked" dismissable={false}>
        body
      </Modal>,
    );
    expect(screen.queryByRole("button", { name: "Close dialog" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("exposes the dialog with aria-modal and a labelled title", () => {
    renderWithProviders(
      <Modal open onClose={() => {}} title="Accessible">
        body
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toHaveTextContent("Accessible");
  });
});
