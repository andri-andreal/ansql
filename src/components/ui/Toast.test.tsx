// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { useToast } from "./Toast";

// renderWithProviders already wraps the tree in a ToastProvider, so a child
// that calls useToast can show toasts through the live context.
function Trigger() {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.success("Saved!")}>
        success
      </button>
      <button type="button" onClick={() => toast.error("Boom")}>
        error
      </button>
      <button type="button" onClick={() => toast.info("FYI", 0)}>
        info
      </button>
    </div>
  );
}

describe("Toast", () => {
  it("shows a success toast with its message", async () => {
    const { user } = renderWithProviders(<Trigger />);
    await user.click(screen.getByRole("button", { name: "success" }));
    await waitFor(() => {
      expect(screen.getByText("Saved!")).toBeInTheDocument();
    });
  });

  it("renders error toasts with the alert role", async () => {
    const { user } = renderWithProviders(<Trigger />);
    await user.click(screen.getByRole("button", { name: "error" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Boom");
    });
  });

  it("dismisses a toast via its close button", async () => {
    const { user } = renderWithProviders(<Trigger />);
    // duration 0 = sticky, so it won't auto-dismiss while we test the button.
    await user.click(screen.getByRole("button", { name: "info" }));
    await waitFor(() => expect(screen.getByText("FYI")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Dismiss notification" }));
    await waitFor(() => expect(screen.queryByText("FYI")).not.toBeInTheDocument());
  });

  it("stacks multiple toasts at once", async () => {
    const { user } = renderWithProviders(<Trigger />);
    await user.click(screen.getByRole("button", { name: "info" }));
    await user.click(screen.getByRole("button", { name: "error" }));
    await waitFor(() => {
      expect(screen.getByText("FYI")).toBeInTheDocument();
      expect(screen.getByText("Boom")).toBeInTheDocument();
    });
  });
});
