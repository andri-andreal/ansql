// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import type { QueryTab } from "../../types";
import QueryTabs from "./QueryTabs";

function tab(overrides: Partial<QueryTab> = {}): QueryTab {
  return {
    id: "t1",
    title: "Query 1",
    content: "SELECT 1",
    is_modified: false,
    ...overrides,
  };
}

function renderTabs(props: Partial<React.ComponentProps<typeof QueryTabs>> = {}) {
  return renderWithProviders(
    <QueryTabs
      tabs={[tab()]}
      activeTabId="t1"
      onSelectTab={() => {}}
      onCloseTab={() => {}}
      onNewTab={() => {}}
      {...props}
    />,
  );
}

describe("QueryTabs", () => {
  it("renders a tab per entry with its title", () => {
    renderTabs({
      tabs: [tab({ id: "a", title: "Users" }), tab({ id: "b", title: "Orders" })],
    });
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument();
  });

  it("marks a modified tab with an asterisk", () => {
    renderTabs({ tabs: [tab({ title: "Draft", is_modified: true })] });
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("fires onSelectTab with the tab id when clicked", async () => {
    const onSelectTab = vi.fn();
    const { user } = renderTabs({
      tabs: [tab({ id: "x", title: "Pick me" })],
      activeTabId: null,
      onSelectTab,
    });
    await user.click(screen.getByText("Pick me"));
    expect(onSelectTab).toHaveBeenCalledWith("x");
  });

  it("fires onNewTab from the new-query button", async () => {
    const onNewTab = vi.fn();
    const { user } = renderTabs({ onNewTab });
    await user.click(screen.getByTitle("New Query"));
    expect(onNewTab).toHaveBeenCalledTimes(1);
  });

  it("fires onCloseTab without selecting the tab", async () => {
    const onCloseTab = vi.fn();
    const onSelectTab = vi.fn();
    const { user, container } = renderTabs({
      tabs: [tab({ id: "c1", title: "Closable" })],
      onCloseTab,
      onSelectTab,
    });
    // The per-tab close button is the only button inside the tab row.
    const closeBtn = container.querySelector(".group button");
    await user.click(closeBtn!);
    expect(onCloseTab).toHaveBeenCalledWith("c1");
    expect(onSelectTab).not.toHaveBeenCalled();
  });
});
