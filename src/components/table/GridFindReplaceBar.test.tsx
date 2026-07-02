// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import { GridFindReplaceBar } from "./GridFindReplaceBar";

function renderBar(props: Partial<React.ComponentProps<typeof GridFindReplaceBar>> = {}) {
  return renderWithProviders(
    <GridFindReplaceBar
      onFind={vi.fn()}
      matchCount={0}
      current={0}
      onNext={vi.fn()}
      onPrev={vi.fn()}
      replaceEnabled={false}
      onReplace={vi.fn()}
      onReplaceAll={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

describe("GridFindReplaceBar", () => {
  it("reports the query and case option through onFind as the user types", async () => {
    const onFind = vi.fn();
    const { user } = renderBar({ onFind });
    await user.type(screen.getByPlaceholderText("Find in grid…"), "ab");
    // Last call carries the full query.
    const findCalls = onFind.mock.calls;
    expect(findCalls[findCalls.length - 1]).toEqual(["ab", { matchCase: false }]);
  });

  it("re-runs the search with matchCase=true when toggled", async () => {
    const onFind = vi.fn();
    const { user } = renderBar({ onFind, matchCount: 2, current: 0 });
    await user.type(screen.getByPlaceholderText("Find in grid…"), "x");
    await user.click(screen.getByTitle("Match case"));
    const findCalls = onFind.mock.calls;
    expect(findCalls[findCalls.length - 1]).toEqual(["x", { matchCase: true }]);
  });

  it("shows a 1-based current/total counter once a query is present", async () => {
    const { user } = renderBar({ matchCount: 5, current: 2 });
    // No query yet -> no counter.
    expect(screen.queryByText("3/5")).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Find in grid…"), "q");
    // current=2 (0-based) of 5 -> "3/5".
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });

  it("steps through matches and only enables nav when matches exist", async () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const { user } = renderBar({ onNext, onPrev, matchCount: 3, current: 0 });
    const next = screen.getByTitle("Next match (Enter)");
    const prev = screen.getByTitle("Previous match (Shift+Enter)");
    expect(next).not.toBeDisabled();
    await user.click(next);
    await user.click(prev);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("disables the nav buttons when there are no matches", () => {
    renderBar({ matchCount: 0 });
    expect(screen.getByTitle("Next match (Enter)")).toBeDisabled();
    expect(screen.getByTitle("Previous match (Shift+Enter)")).toBeDisabled();
  });

  it("expands replace controls and fires onReplaceAll with the query/replacement", async () => {
    const onReplaceAll = vi.fn();
    const { user } = renderBar({ replaceEnabled: true, matchCount: 1, current: 0, onReplaceAll });
    // Replace row is collapsed initially.
    expect(screen.queryByPlaceholderText("Replace with…")).not.toBeInTheDocument();
    await user.click(screen.getByTitle("Show replace"));
    await user.type(screen.getByPlaceholderText("Find in grid…"), "x");
    await user.type(screen.getByPlaceholderText("Replace with…"), "y");
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(onReplaceAll).toHaveBeenCalledWith("x", "y", { matchCase: false });
  });

  it("never shows replace controls when replaceEnabled is false", () => {
    renderBar({ replaceEnabled: false });
    expect(screen.queryByTitle("Show replace")).not.toBeInTheDocument();
  });

  it("closes via the close button", async () => {
    const onClose = vi.fn();
    const { user } = renderBar({ onClose });
    await user.click(screen.getByTitle("Close (Esc)"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
