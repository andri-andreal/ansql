// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { PasteProvider } from "../../hooks/usePaste";
import { makeColumn, makeQueryResult } from "../../test/fixtures";
import TableViewer from "./TableViewer";

// The Data tab embeds TableData (which needs PasteProvider + calls executeQuery)
// and the glide-data-grid canvas, which is not assertable in jsdom. We only test
// the non-grid controls: the Data/Structure tabs and the Design button.

function renderViewer(over: Partial<React.ComponentProps<typeof TableViewer>> = {}) {
  const getColumns = vi.fn().mockResolvedValue([makeColumn({ name: "id" })]);
  const getIndexes = vi.fn().mockResolvedValue([]);
  const getForeignKeys = vi.fn().mockResolvedValue([]);
  const executeQuery = vi.fn().mockResolvedValue(makeQueryResult());
  const onClose = vi.fn();
  const onEditStructure = vi.fn();
  const result = renderWithProviders(
    <PasteProvider>
      <TableViewer
        sessionId="s1"
        connectionId="c1"
        database="shop"
        table="users"
        getColumns={getColumns}
        getIndexes={getIndexes}
        getForeignKeys={getForeignKeys}
        executeQuery={executeQuery}
        onClose={onClose}
        onEditStructure={onEditStructure}
        {...over}
      />
    </PasteProvider>,
  );
  return { ...result, getColumns, getIndexes, getForeignKeys, executeQuery, onEditStructure };
}

describe("TableViewer", () => {
  it("renders the Data and Structure tabs, with Data active by default", () => {
    renderViewer();
    expect(screen.getByRole("button", { name: /Data/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Structure/ })).toBeInTheDocument();
    // Design button is structure-only, so it is hidden initially.
    expect(screen.queryByRole("button", { name: /Design/ })).not.toBeInTheDocument();
  });

  it("switches to the Structure tab and fetches its metadata", async () => {
    const { user, getColumns } = renderViewer();
    await user.click(screen.getByRole("button", { name: /Structure/ }));
    await waitFor(() => expect(getColumns).toHaveBeenCalled());
    expect(getColumns.mock.calls[0]).toEqual(["s1", "shop", "users", undefined]);
  });

  it("shows the Design button on the Structure tab and fires onEditStructure", async () => {
    const { user, onEditStructure } = renderViewer();
    await user.click(screen.getByRole("button", { name: /Structure/ }));
    const design = await screen.findByRole("button", { name: /Design/ });
    await user.click(design);
    expect(onEditStructure).toHaveBeenCalledTimes(1);
  });

  it("omits the Design button when onEditStructure is not provided", async () => {
    const { user } = renderViewer({ onEditStructure: undefined });
    await user.click(screen.getByRole("button", { name: /Structure/ }));
    // Allow structure tab to settle, then assert no Design control.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Design/ })).not.toBeInTheDocument(),
    );
  });
});
