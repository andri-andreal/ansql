// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title with a status role", () => {
    renderWithProviders(
      <EmptyState icon={<svg data-testid="icon" />} title="No connections" />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No connections");
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("renders an optional description", () => {
    renderWithProviders(
      <EmptyState
        icon={<svg />}
        title="No results"
        description="Try a different query."
      />,
    );
    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByText("Try a different query.")).toBeInTheDocument();
  });

  it("does not render a description when omitted", () => {
    renderWithProviders(<EmptyState icon={<svg />} title="Empty" />);
    expect(screen.queryByText("Try a different query.")).not.toBeInTheDocument();
  });

  it("renders an action and forwards its clicks", async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <EmptyState
        icon={<svg />}
        title="No data"
        action={
          <button type="button" onClick={onClick}>
            Add connection
          </button>
        }
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add connection" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
