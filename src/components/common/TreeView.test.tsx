// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within } from "../../test/render";
import TreeView, { type TreeNode } from "./TreeView";

const leaf = (id: string, label: string, data?: unknown): TreeNode => ({
  id,
  label,
  data,
});

function tree(): TreeNode[] {
  return [
    {
      id: "root",
      label: "Root",
      children: [leaf("child-a", "Child A"), leaf("child-b", "Child B")],
    },
  ];
}

describe("TreeView", () => {
  it("renders top-level node labels and hides collapsed children", () => {
    renderWithProviders(<TreeView nodes={tree()} />);
    expect(screen.getByText("Root")).toBeInTheDocument();
    // Children live under a collapsed parent → not rendered yet.
    expect(screen.queryByText("Child A")).not.toBeInTheDocument();
  });

  it("expands a node on toggle-button click and reveals its children", async () => {
    const onToggle = vi.fn();
    const { user } = renderWithProviders(<TreeView nodes={tree()} onToggle={onToggle} />);

    // The toggle chevron is the first button in the row.
    const row = screen.getByText("Root").closest("div")!;
    const toggleBtn = within(row).getByRole("button");
    await user.click(toggleBtn);

    expect(onToggle).toHaveBeenCalledWith("root", true);
    expect(screen.getByText("Child A")).toBeInTheDocument();
    expect(screen.getByText("Child B")).toBeInTheDocument();
  });

  it("fires onSelect with the node when a row is clicked", async () => {
    const onSelect = vi.fn();
    const nodes = [leaf("solo", "Solo", { type: "table" })];
    const { user } = renderWithProviders(<TreeView nodes={nodes} onSelect={onSelect} />);

    await user.click(screen.getByText("Solo"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "solo", label: "Solo" });
  });

  it("fires onDoubleClick with the node and onContextMenu on right-click", async () => {
    const onDoubleClick = vi.fn();
    const onContextMenu = vi.fn();
    const nodes = [leaf("solo", "Solo")];
    const { user } = renderWithProviders(
      <TreeView nodes={nodes} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu} />,
    );

    const label = screen.getByText("Solo");
    await user.dblClick(label);
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
    expect(onDoubleClick.mock.calls[0][0]).toMatchObject({ id: "solo" });

    await user.pointer({ keys: "[MouseRight]", target: label });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][1]).toMatchObject({ id: "solo" });
  });

  it("renders a forced-expanded branch via forceExpandedIds without a manual toggle", () => {
    renderWithProviders(
      <TreeView nodes={tree()} forceExpandedIds={new Set(["root"])} />,
    );
    expect(screen.getByText("Child A")).toBeInTheDocument();
  });

  it("shows a secondaryLabel when provided", () => {
    const nodes = [leaf("t1", "users")].map((n) => ({ ...n, secondaryLabel: "42" }));
    renderWithProviders(<TreeView nodes={nodes} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
