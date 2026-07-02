// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    renderWithProviders(
      <ConfirmDialog
        open={false}
        title="Delete?"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
  });

  it("renders title, message, and default labels when open", () => {
    renderWithProviders(
      <ConfirmDialog
        open
        title="Delete record?"
        message="This cannot be undone."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Delete record?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("uses custom confirm/cancel labels", () => {
    renderWithProviders(
      <ConfirmDialog
        open
        title="Clear timeline"
        message="msg"
        confirmLabel="Clear all"
        cancelLabel="Keep"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  });

  it("fires onConfirm when the confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const { user } = renderWithProviders(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires onCancel from the cancel button", async () => {
    const onCancel = vi.fn();
    const { user } = renderWithProviders(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("treats the modal close (Escape) as a cancel", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { user } = renderWithProviders(
      <ConfirmDialog
        open
        title="t"
        message="m"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
