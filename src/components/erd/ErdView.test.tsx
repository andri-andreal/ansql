// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { makeTable, makeColumn } from "@/test/fixtures";
import { ErdView, type ErdViewProps } from "./ErdView";

// Default stub backend: two base tables, each with one PK column, no FKs.
function makeProps(over: Partial<ErdViewProps> = {}): ErdViewProps {
  return {
    sessionId: "s1",
    database: "app",
    schema: null,
    dialect: "postgres",
    getTables: vi.fn().mockResolvedValue([
      makeTable({ name: "users", table_type: "table" }),
      makeTable({ name: "orders", table_type: "table" }),
    ]),
    getColumns: vi.fn().mockResolvedValue([makeColumn({ name: "id" })]),
    getForeignKeys: vi.fn().mockResolvedValue([]),
    getSchemaGraph: undefined,
    getIndexes: vi.fn().mockResolvedValue([]),
    executeQuery: vi.fn().mockResolvedValue(undefined),
    onOpenTable: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("ErdView toolbar", () => {
  it("renders the core toolbar buttons", async () => {
    renderWithProviders(<ErdView {...makeProps()} />);
    expect(await screen.findByRole("button", { name: /Reload/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Select tables/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reset layout/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PNG/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SVG/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export SQL/ })).toBeInTheDocument();
  });

  it("calls getTables to build the diagram and renders the table/relation counter", async () => {
    const props = makeProps();
    renderWithProviders(<ErdView {...props} />);

    await waitFor(() => expect(props.getTables).toHaveBeenCalled());
    // Two base tables, zero relations once the diagram has loaded.
    await waitFor(() => expect(screen.getByText("2 tables · 0 relations")).toBeInTheDocument());
  });

  it("re-fetches tables when Reload is clicked", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<ErdView {...props} />);

    await waitFor(() => expect(props.getTables).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /Reload/ }));
    await waitFor(() => expect(vi.mocked(props.getTables).mock.calls.length).toBeGreaterThan(1));
  });

  it("opens the table-selection dialog from the Select tables button", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<ErdView {...props} />);

    await waitFor(() => expect(props.getTables).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Select tables/ }));

    // The dialog title appears, seeded with both base tables as checkboxes.
    expect(await screen.findByText("Select Tables")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("PNG/SVG/SQL export buttons enable once the diagram has tables", async () => {
    renderWithProviders(<ErdView {...makeProps()} />);
    await waitFor(() =>
      expect(screen.getByText("2 tables · 0 relations")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /PNG/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Export SQL/ })).not.toBeDisabled();
  });

  it("shows the empty state when there are no base tables to diagram", async () => {
    const props = makeProps({ getTables: vi.fn().mockResolvedValue([]) });
    renderWithProviders(<ErdView {...props} />);
    expect(await screen.findByText("No tables to diagram")).toBeInTheDocument();
  });
});
