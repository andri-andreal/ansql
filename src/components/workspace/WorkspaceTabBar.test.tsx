// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within, fireEvent } from "@/test/render";
import { WorkspaceTabBar } from "./WorkspaceTabBar";
import type { WorkspaceTab } from "@/lib/workspaceTabs";

const tableTab = {
  id: "t1",
  title: "users",
  kind: "table",
  payload: {} as never,
} as unknown as WorkspaceTab;

const queryTab = {
  id: "q1",
  title: "Query 1",
  kind: "query",
  dirty: true,
  payload: {} as never,
} as unknown as WorkspaceTab;

describe("WorkspaceTabBar", () => {
  it("renders nothing when there are no tabs", () => {
    const { container } = renderWithProviders(
      <WorkspaceTabBar tabs={[]} activeId={null} onActivate={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one tab per entry with its title and marks the active one", () => {
    renderWithProviders(
      <WorkspaceTabBar
        tabs={[tableTab, queryTab]}
        activeId="q1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("Query 1")).toBeInTheDocument();

    // active = q1
    const active = tabs.find((el) => within(el).queryByText("Query 1"));
    expect(active).toHaveAttribute("aria-selected", "true");
    const inactive = tabs.find((el) => within(el).queryByText("users"));
    expect(inactive).toHaveAttribute("aria-selected", "false");
  });

  it("fires onActivate with the tab id when the tab body is clicked", async () => {
    const onActivate = vi.fn();
    const { user } = renderWithProviders(
      <WorkspaceTabBar
        tabs={[tableTab, queryTab]}
        activeId="t1"
        onActivate={onActivate}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByText("Query 1"));
    expect(onActivate).toHaveBeenCalledWith("q1");
  });

  it("fires onClose (not onActivate) when the close button is clicked", async () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <WorkspaceTabBar
        tabs={[tableTab]}
        activeId="t1"
        onActivate={onActivate}
        onClose={onClose}
      />
    );
    const closeBtn = screen.getByRole("button", { name: "Close tab" });
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledWith("t1");
    // stopPropagation: the tab activate handler must not have fired
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("shows the unsaved-changes dot for dirty tabs only", () => {
    renderWithProviders(
      <WorkspaceTabBar
        tabs={[tableTab, queryTab]}
        activeId="t1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const dots = screen.getAllByTitle("Unsaved changes");
    expect(dots).toHaveLength(1); // only the dirty query tab
  });

  it("closes on middle-click (auxclick button 1)", () => {
    const onClose = vi.fn();
    renderWithProviders(
      <WorkspaceTabBar
        tabs={[tableTab]}
        activeId="t1"
        onActivate={vi.fn()}
        onClose={onClose}
      />
    );
    const tab = screen.getByRole("tab");
    fireEvent(
      tab,
      new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })
    );
    expect(onClose).toHaveBeenCalledWith("t1");
  });
});
