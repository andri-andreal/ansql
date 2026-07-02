// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { makeQueryResult } from "@/test/fixtures";
import { ChartView } from "./ChartView";

// recharts renders zero-size SVG in jsdom; we assert the surrounding controls
// and the empty / pick-axes state rather than chart geometry.

function chartResult() {
  return makeQueryResult({
    columns: [
      { name: "month", data_type: "text", nullable: false },
      { name: "revenue", data_type: "int", nullable: false },
      { name: "cost", data_type: "int", nullable: false },
    ],
    rows: [
      { month: "Jan", revenue: 100, cost: 40 },
      { month: "Feb", revenue: 150, cost: 60 },
    ],
  });
}

describe("ChartView", () => {
  it("renders the four chart-type buttons and X/Y axis controls", () => {
    renderWithProviders(<ChartView result={chartResult()} onClose={() => {}} />);

    expect(screen.getByRole("button", { name: "Bar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Line" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Area" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pie" })).toBeInTheDocument();

    // X selector defaults to the first column.
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("month");

    // Y toggles exist for the non-X columns.
    expect(screen.getByRole("button", { name: "revenue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "cost" })).toBeInTheDocument();
  });

  it("shows the pick-axes hint when no numeric Y column is selected", async () => {
    const { user } = renderWithProviders(
      <ChartView result={chartResult()} onClose={() => {}} />
    );

    // revenue is selected by default (second column) -> chart shown, no hint.
    expect(
      screen.queryByText(
        "Pick an X column and at least one numeric Y column to plot."
      )
    ).not.toBeInTheDocument();

    // Deselect the default revenue series -> hint appears.
    await user.click(screen.getByRole("button", { name: "revenue" }));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Pick an X column and at least one numeric Y column to plot."
        )
      ).toBeInTheDocument();
    });
  });

  it("shows the pick-axes hint for a single-column (no Y) result", () => {
    const result = makeQueryResult({
      columns: [{ name: "label", data_type: "text", nullable: false }],
      rows: [{ label: "a" }, { label: "b" }],
    });
    renderWithProviders(<ChartView result={result} onClose={() => {}} />);

    expect(
      screen.getByText(
        "Pick an X column and at least one numeric Y column to plot."
      )
    ).toBeInTheDocument();
    // No Y toggle buttons besides the chart-type buttons.
    expect(screen.queryByRole("button", { name: "label" })).not.toBeInTheDocument();
  });

  it("changes the active chart type when a type button is clicked", async () => {
    const { user } = renderWithProviders(
      <ChartView result={chartResult()} onClose={() => {}} />
    );

    const pieBtn = screen.getByRole("button", { name: "Pie" });
    const barBtn = screen.getByRole("button", { name: "Bar" });
    // Bar is the default active type.
    expect(barBtn.className).toContain("bg-primary");
    expect(pieBtn.className).not.toContain("bg-primary");

    await user.click(pieBtn);
    await waitFor(() => {
      expect(pieBtn.className).toContain("bg-primary");
      expect(barBtn.className).not.toContain("bg-primary");
    });
  });

  it("toggles a Y series on click and lets the X column be changed", async () => {
    const { user } = renderWithProviders(
      <ChartView result={chartResult()} onClose={() => {}} />
    );

    const costToggle = screen.getByRole("button", { name: "cost" });
    expect(costToggle.className).not.toContain("bg-primary");
    await user.click(costToggle);
    await waitFor(() => expect(costToggle.className).toContain("bg-primary"));

    // Switching X to revenue should drop revenue from the Y toggle list.
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "revenue");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "revenue" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "month" })).toBeInTheDocument();
    });
  });

  it("fires onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <ChartView result={chartResult()} onClose={onClose} />
    );

    await user.click(screen.getByTitle("Close chart"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
