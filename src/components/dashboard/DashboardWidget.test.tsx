// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { makeQueryResult } from "../../test/fixtures";
import { DashboardWidget } from "./DashboardWidget";
import type { DashboardWidget as Widget } from "../../hooks/useDashboards";

function makeWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: "w1",
    title: "My Widget",
    sessionId: "s1",
    query: "SELECT 1",
    chart: { type: "bar", xColumn: "x", yColumns: ["y"] },
    size: "md",
    ...overrides,
  };
}

function renderWidget(props: Partial<React.ComponentProps<typeof DashboardWidget>> = {}) {
  const executeQuery =
    props.executeQuery ?? vi.fn().mockResolvedValue(makeQueryResult());
  const onEdit = props.onEdit ?? vi.fn();
  const onRemove = props.onRemove ?? vi.fn();
  const onMove = props.onMove ?? vi.fn();
  const result = renderWithProviders(
    <DashboardWidget
      widget={makeWidget()}
      executeQuery={executeQuery}
      onEdit={onEdit}
      onRemove={onRemove}
      onMove={onMove}
      {...props}
    />
  );
  return { ...result, executeQuery, onEdit, onRemove, onMove };
}

describe("DashboardWidget", () => {
  it("renders the widget title and runs its query on mount", async () => {
    const executeQuery = vi.fn().mockResolvedValue(makeQueryResult());
    renderWidget({ widget: makeWidget({ title: "Revenue" }), executeQuery });
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    await waitFor(() => {
      expect(executeQuery).toHaveBeenCalledWith("s1", "SELECT 1");
    });
  });

  it("shows the not-configured message when the widget has no session", () => {
    const executeQuery = vi.fn();
    renderWidget({ widget: makeWidget({ sessionId: undefined }), executeQuery });
    expect(
      screen.getByText("Not configured — edit this widget to pick a session.")
    ).toBeInTheDocument();
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("renders the query error inside the widget body", async () => {
    const executeQuery = vi.fn().mockRejectedValue(new Error("syntax error"));
    renderWidget({ executeQuery });
    await waitFor(() => {
      expect(screen.getByText("syntax error")).toBeInTheDocument();
    });
  });

  it("shows 'No data to plot' when the result has no numeric y values", async () => {
    const executeQuery = vi.fn().mockResolvedValue(
      makeQueryResult({
        columns: [
          { name: "x", data_type: "text", nullable: false },
          { name: "y", data_type: "text", nullable: false },
        ],
        rows: [{ x: "a", y: "not-a-number" }],
      })
    );
    renderWidget({
      widget: makeWidget({ chart: { type: "bar", xColumn: "x", yColumns: ["y"] } }),
      executeQuery,
    });
    await waitFor(() => {
      expect(
        screen.getByText("No data to plot for this chart configuration.")
      ).toBeInTheDocument();
    });
  });

  it("fires onEdit / onRemove / onMove from the header actions", async () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const onMove = vi.fn();
    const { user } = renderWidget({ onEdit, onRemove, onMove });

    await user.click(screen.getByRole("button", { name: "Edit widget" }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Remove widget" }));
    expect(onRemove).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Move up" }));
    expect(onMove).toHaveBeenCalledWith(-1);
    await user.click(screen.getByRole("button", { name: "Move down" }));
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it("re-runs the query when the Refresh button is clicked", async () => {
    const executeQuery = vi.fn().mockResolvedValue(makeQueryResult());
    const { user } = renderWidget({ executeQuery });
    await waitFor(() => {
      expect(executeQuery).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(executeQuery).toHaveBeenCalledTimes(2);
    });
  });
});
