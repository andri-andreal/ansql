// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import { ParamInputDialog } from "./ParamInputDialog";

function renderDialog(props: Partial<React.ComponentProps<typeof ParamInputDialog>> = {}) {
  return renderWithProviders(
    <ParamInputDialog names={["id", "name"]} onSubmit={() => {}} onCancel={() => {}} {...props} />,
  );
}

describe("ParamInputDialog", () => {
  it("renders one labelled input per parameter name", () => {
    renderDialog({ names: ["userId", "status"] });
    expect(screen.getByText("Query Parameters")).toBeInTheDocument();
    expect(screen.getByText("userId")).toBeInTheDocument();
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Value for userId")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Value for status")).toBeInTheDocument();
  });

  it("submits the typed values with raw=false by default", async () => {
    const onSubmit = vi.fn();
    const { user } = renderDialog({ names: ["id"], onSubmit });
    await user.type(screen.getByPlaceholderText("Value for id"), "42");
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onSubmit).toHaveBeenCalledWith({ id: "42" }, false);
  });

  it("includes raw=true when the raw mode checkbox is checked", async () => {
    const onSubmit = vi.fn();
    const { user } = renderDialog({ names: ["id"], onSubmit });
    await user.type(screen.getByPlaceholderText("Value for id"), "7");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onSubmit).toHaveBeenCalledWith({ id: "7" }, true);
  });

  it("fills missing params with empty strings on submit", async () => {
    const onSubmit = vi.fn();
    const { user } = renderDialog({ names: ["a", "b"], onSubmit });
    await user.type(screen.getByPlaceholderText("Value for a"), "x");
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onSubmit).toHaveBeenCalledWith({ a: "x", b: "" }, false);
  });

  it("fires onCancel from the Cancel button", async () => {
    const onCancel = vi.fn();
    const { user } = renderDialog({ onCancel });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
