// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("renders its child trigger and hides the tooltip initially", () => {
    renderWithProviders(
      <Tooltip content="Helpful hint">
        <button type="button">Hover me</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "Hover me" })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows the tooltip on hover after the delay", async () => {
    const { user } = renderWithProviders(
      <Tooltip content="Helpful hint" delay={0}>
        <button type="button">Hover me</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole("button", { name: "Hover me" }));
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent("Helpful hint");
    });
  });

  it("hides the tooltip on unhover", async () => {
    const { user } = renderWithProviders(
      <Tooltip content="Bye" delay={0}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    await user.hover(trigger);
    await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());

    await user.unhover(trigger);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("does not show a tooltip when disabled", async () => {
    const { user } = renderWithProviders(
      <Tooltip content="Never" delay={0} disabled>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole("button", { name: "Trigger" }));
    // Give any pending timer a chance to flush; it should remain absent.
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
