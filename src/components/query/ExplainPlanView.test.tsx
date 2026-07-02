// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import type { PlanNode } from "../../lib/explainPlan";
import { ExplainPlanView } from "./ExplainPlanView";

function node(overrides: Partial<PlanNode> = {}): PlanNode {
  return { nodeType: "Seq Scan", label: "users", children: [], ...overrides };
}

function renderView(props: Partial<React.ComponentProps<typeof ExplainPlanView>> = {}) {
  return renderWithProviders(<ExplainPlanView nodes={[node()]} onClose={() => {}} {...props} />);
}

describe("ExplainPlanView", () => {
  it("renders the header and node types/labels", () => {
    renderView({
      nodes: [node({ nodeType: "Hash Join", label: "orders ⋈ users" })],
    });
    expect(screen.getByText("Explain Plan")).toBeInTheDocument();
    expect(screen.getByText("Hash Join")).toBeInTheDocument();
    expect(screen.getByText("orders ⋈ users")).toBeInTheDocument();
  });

  it("renders the empty state when there are no nodes", () => {
    renderView({ nodes: [] });
    expect(screen.getByText("No plan nodes to display.")).toBeInTheDocument();
  });

  it("shows children expanded by default and collapses them on toggle", async () => {
    const tree = [
      node({
        nodeType: "Aggregate",
        label: "count",
        children: [node({ nodeType: "Seq Scan", label: "child-scan" })],
      }),
    ];
    const { user } = renderView({ nodes: tree });
    expect(screen.getByText("child-scan")).toBeInTheDocument();

    // First per-row collapse toggle (the Aggregate's own chevron). The leaf's
    // own toggle shares the same title, so click the first (the parent).
    await user.click(screen.getAllByTitle("Collapse")[0]);
    expect(screen.queryByText("child-scan")).not.toBeInTheDocument();
  });

  it("collapse-all hides children and expand-all brings them back", async () => {
    const tree = [
      node({
        nodeType: "Aggregate",
        label: "agg",
        children: [node({ nodeType: "Seq Scan", label: "leaf" })],
      }),
    ];
    const { user } = renderView({ nodes: tree });
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("leaf")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("leaf")).toBeInTheDocument();
  });

  it("fires onClose from the close button", async () => {
    const onClose = vi.fn();
    const { user } = renderView({ onClose });
    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders cost and rows metric badges", () => {
    renderView({ nodes: [node({ cost: 1234, rows: 500 })] });
    expect(screen.getByText(/cost/)).toBeInTheDocument();
    expect(screen.getByText(/rows/)).toBeInTheDocument();
  });
});
