// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "../../test/render";
import type { ResultEntry } from "../../hooks/useQueries";
import ResultTabs from "./ResultTabs";

function makeResult(overrides: Partial<ResultEntry> = {}): ResultEntry {
  return {
    id: "r1",
    snippet: "SELECT 1",
    sql: "SELECT 1",
    columns: [],
    rows: [],
    execTimeMs: 12,
    ...overrides,
  } as ResultEntry;
}

function renderTabs(props: Partial<React.ComponentProps<typeof ResultTabs>> = {}) {
  return renderWithProviders(
    <ResultTabs
      results={[makeResult()]}
      activeResultId="r1"
      onSelect={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("ResultTabs", () => {
  it("renders nothing when there are no results", () => {
    const { container } = renderTabs({ results: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the snippet label and exec time for a successful result", () => {
    renderTabs({ results: [makeResult({ snippet: "SELECT * FROM users", execTimeMs: 42 })] });
    expect(screen.getByText("SELECT * FROM users")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
  });

  it("prefers the custom name over the snippet", () => {
    renderTabs({ results: [makeResult({ customName: "My report", snippet: "SELECT 1" })] });
    expect(screen.getByText("My report")).toBeInTheDocument();
    expect(screen.queryByText("SELECT 1")).not.toBeInTheDocument();
  });

  it("fires onSelect with the result id when the tab is clicked", async () => {
    const onSelect = vi.fn();
    const { user } = renderTabs({
      results: [makeResult({ id: "r9", snippet: "pick me" })],
      activeResultId: null,
      onSelect,
    });
    await user.click(screen.getByText("pick me"));
    expect(onSelect).toHaveBeenCalledWith("r9");
  });

  it("fires onClose with the result id from the close button", async () => {
    const onClose = vi.fn();
    const { user } = renderTabs({ results: [makeResult({ id: "rc" })], onClose });
    await user.click(screen.getByTitle("Close result"));
    expect(onClose).toHaveBeenCalledWith("rc");
  });

  it("toggles pin and shows the correct tooltip per pinned state", async () => {
    const onTogglePin = vi.fn();
    const { user } = renderTabs({
      results: [makeResult({ id: "rp", pinned: false })],
      onTogglePin,
    });
    await user.click(screen.getByTitle("Pin result"));
    expect(onTogglePin).toHaveBeenCalledWith("rp");
  });

  it("shows the unpin tooltip when a result is already pinned", () => {
    renderTabs({
      results: [makeResult({ id: "rp", pinned: true })],
      onTogglePin: vi.fn(),
    });
    expect(screen.getByTitle("Unpin result")).toBeInTheDocument();
  });

  it("renames inline on double-click and commits on Enter", async () => {
    const onRename = vi.fn();
    const { user } = renderTabs({
      results: [makeResult({ id: "rn", snippet: "old label" })],
      onRename,
    });
    await user.dblClick(screen.getByText("old label"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "new label");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("rn", "new label");
  });

  it("does not commit a rename when editing is cancelled with Escape", async () => {
    const onRename = vi.fn();
    const { user } = renderTabs({
      results: [makeResult({ id: "rn", snippet: "old label" })],
      onRename,
    });
    await user.dblClick(screen.getByText("old label"));
    const input = screen.getByRole("textbox");
    await user.type(input, "x");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
  });
});
