// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within, waitFor, fireEvent } from "@/test/render";
import { makeQueryResult } from "@/test/fixtures";
import ResultsGrid from "./ResultsGrid";

function dataResult() {
  return makeQueryResult({
    columns: [
      { name: "id", data_type: "int", nullable: false },
      { name: "name", data_type: "text", nullable: false },
      { name: "age", data_type: "int", nullable: true },
    ],
    rows: [
      { id: 1, name: "Charlie", age: 30 },
      { id: 2, name: "Alice", age: null },
      { id: 3, name: "Bob", age: 22 },
    ],
    execution_time_ms: 7,
  });
}

describe("ResultsGrid", () => {
  it("renders an empty-state when there are no rows", () => {
    renderWithProviders(
      <ResultsGrid
        result={makeQueryResult({
          rows: [],
          affected_rows: 5,
          execution_time_ms: 3,
        })}
      />
    );
    expect(screen.getByText("Query executed successfully")).toBeInTheDocument();
    expect(screen.getByText("5 row(s) affected")).toBeInTheDocument();
    expect(screen.getByText("Execution time: 3ms")).toBeInTheDocument();
  });

  it("renders column headers, data types and all data rows", () => {
    renderWithProviders(<ResultsGrid result={dataResult()} />);

    const table = screen.getByRole("table");
    // Header columns
    expect(within(table).getByText("name")).toBeInTheDocument();
    expect(within(table).getByText("text")).toBeInTheDocument();
    // Data cells
    expect(within(table).getByText("Charlie")).toBeInTheDocument();
    expect(within(table).getByText("Bob")).toBeInTheDocument();
    // NULL rendering for the null age cell
    expect(within(table).getByText("NULL")).toBeInTheDocument();
    // Row summary in toolbar (text node is interleaved, so match a substring)
    expect(screen.getByText(/3 row\(s\)/)).toBeInTheDocument();
  });

  it("sorts ascending then descending when a header is clicked", async () => {
    const { user } = renderWithProviders(<ResultsGrid result={dataResult()} />);

    const nameHeader = screen.getByText("name");
    // First click -> ascending: Alice, Bob, Charlie
    await user.click(nameHeader);
    await waitFor(() => {
      const bodyRows = screen.getAllByRole("row").slice(1); // drop header row
      const firstDataCells = within(bodyRows[0]).getAllByRole("cell");
      // cell[0] is the index column, cell[2] is name
      expect(firstDataCells[2]).toHaveTextContent("Alice");
    });

    // Second click -> descending: Charlie first
    await user.click(nameHeader);
    await waitFor(() => {
      const bodyRows = screen.getAllByRole("row").slice(1);
      const firstDataCells = within(bodyRows[0]).getAllByRole("cell");
      expect(firstDataCells[2]).toHaveTextContent("Charlie");
    });
  });

  it("filters rows by the global search box and shows the filtered-from summary", async () => {
    const { user } = renderWithProviders(<ResultsGrid result={dataResult()} />);

    const search = screen.getByPlaceholderText("Search...");
    await user.type(search, "Alice");

    await waitFor(() => {
      expect(screen.getByText(/1 row\(s\)/)).toBeInTheDocument();
      expect(screen.getByText(/\(filtered from 3\)/)).toBeInTheDocument();
    });
    const table = screen.getByRole("table");
    expect(within(table).getByText("Alice")).toBeInTheDocument();
    expect(within(table).queryByText("Charlie")).not.toBeInTheDocument();

    // Clear filters restores all rows
    await user.click(screen.getByText("Clear filters"));
    await waitFor(() => {
      expect(screen.getByText(/3 row\(s\)/)).toBeInTheDocument();
    });
  });

  it("copies the visible rows (tab/newline-separated) to the clipboard", async () => {
    renderWithProviders(<ResultsGrid result={dataResult()} />);

    // Override the clipboard AFTER render so user-event's setup doesn't replace it,
    // and use fireEvent so our stub is the one the handler calls.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    fireEvent.click(screen.getByText("Copy"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = vi.mocked(writeText).mock.calls[0][0] as string;
    expect(text).toContain("id\tname\tage");
    expect(text).toContain("1\tCharlie\t30");
    // null becomes empty string in copy output
    expect(text).toContain("2\tAlice\t");
  });

  it("fires onExport with the chosen format", async () => {
    const onExport = vi.fn();
    const { user } = renderWithProviders(
      <ResultsGrid result={dataResult()} onExport={onExport} />
    );

    await user.click(screen.getByText("CSV"));
    await user.click(screen.getByText("JSON"));

    expect(vi.mocked(onExport).mock.calls.map((c) => c[0])).toEqual([
      "csv",
      "json",
    ]);
  });
});
