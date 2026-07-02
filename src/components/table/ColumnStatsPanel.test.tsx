// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { ColumnStatsPanel } from "./ColumnStatsPanel";
import type { ColumnStats } from "../../lib/gridStats";

const stats: ColumnStats = {
  total: 1000,
  nonNull: 750,
  distinct: 42,
  nullPct: 25,
  min: 1,
  max: 999,
};

describe("ColumnStatsPanel", () => {
  it("shows the loading state while computing", () => {
    renderWithProviders(
      <ColumnStatsPanel column="age" stats={null} loading onClose={vi.fn()} />
    );
    expect(screen.getByText("Computing…")).toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
  });

  it("shows the empty state when not loading and stats is null", () => {
    renderWithProviders(
      <ColumnStatsPanel column="age" stats={null} loading={false} onClose={vi.fn()} />
    );
    expect(screen.getByText("No statistics available.")).toBeInTheDocument();
  });

  it("renders formatted counts, computed null %, and min/max", () => {
    renderWithProviders(
      <ColumnStatsPanel column="age" stats={stats} loading={false} onClose={vi.fn()} />
    );
    expect(screen.getByText("age")).toBeInTheDocument();
    expect(screen.getByText("Column statistics")).toBeInTheDocument();
    // thousands separators on total
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("750")).toBeInTheDocument();
    // null pct computed from total/nonNull => (250/1000)*100 = 25%
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("999")).toBeInTheDocument();
  });

  it("renders em-dash for null min/max sentinels", () => {
    renderWithProviders(
      <ColumnStatsPanel
        column="age"
        stats={{ ...stats, min: null, max: null }}
        loading={false}
        onClose={vi.fn()}
      />
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("fires onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <ColumnStatsPanel column="age" stats={stats} loading={false} onClose={onClose} />
    );
    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
