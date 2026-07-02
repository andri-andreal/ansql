// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { makeTable, makeColumn, makeIndex } from "../../test/fixtures";
import type { ColumnDefinition, TableInfo } from "../../types";
import {
  StructureSyncView,
  type StructureSyncViewProps,
  type SyncSession,
} from "./StructureSyncView";

// Monaco doesn't render in jsdom — swap it for a plain textarea that mirrors
// the script value/onChange contract used by the view.
vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
  }) => (
    <textarea
      data-testid="sql-editor"
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

const sessions: SyncSession[] = [
  { id: "s1", label: "Prod", databases: ["app", "analytics"], dialect: "mysql" },
  { id: "s2", label: "Staging", databases: ["app"], dialect: "mysql" },
];

// users exists on both sides (identical → "same"); each side also has a unique
// table so the diff yields a create-table (source-only) + drop-table (target-only).
const usersCol: ColumnDefinition = makeColumn({ name: "id" });

function tablesFor(session: string, _db: string): TableInfo[] {
  return session === "s1"
    ? [makeTable({ name: "users" }), makeTable({ name: "audit" })]
    : [makeTable({ name: "users" }), makeTable({ name: "legacy" })];
}

function makeProps(
  over: Partial<StructureSyncViewProps> = {},
): StructureSyncViewProps {
  return {
    sessions,
    getTables: vi.fn((s: string, db: string) =>
      Promise.resolve(tablesFor(s, db)),
    ),
    getColumns: vi.fn(() => Promise.resolve([usersCol])),
    getIndexes: vi.fn(() => Promise.resolve([makeIndex()])),
    getForeignKeys: vi.fn(() => Promise.resolve([])),
    executeQuery: vi.fn(() => Promise.resolve(undefined)),
    ...over,
  };
}

describe("StructureSyncView", () => {
  it("renders source/target pickers and the empty-state hint before comparing", () => {
    renderWithProviders(<StructureSyncView {...makeProps()} />);
    expect(screen.getByText("Differences")).toBeInTheDocument();
    expect(
      screen.getByText("Pick a source and target, then press Compare."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The generated SQL will appear here after you compare.",
      ),
    ).toBeInTheDocument();
  });

  it("disables Compare while source and target point at the same db", () => {
    renderWithProviders(<StructureSyncView {...makeProps()} />);
    // Defaults: both sides → first session/first db → same db warning + disabled.
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    expect(
      screen.getByText(/Source and target are the same database/i),
    ).toBeInTheDocument();
  });

  it("compares two distinct databases and lists create/drop diffs with checkboxes", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<StructureSyncView {...props} />);

    // Point target at the second session so source !== target.
    const targetSessionSelect = screen.getAllByRole("combobox")[2];
    await user.selectOptions(targetSessionSelect, "Staging");

    await user.click(screen.getByRole("button", { name: "Compare" }));

    // Source-only table → create; target-only table → drop.
    await waitFor(() => {
      expect(screen.getByText("audit")).toBeInTheDocument();
    });
    expect(screen.getByText("legacy")).toBeInTheDocument();
    expect(props.getTables).toHaveBeenCalled();

    // A destructive drop is selected by default → destructive warning shows.
    expect(
      screen.getByText(
        "Selection includes DROP operations that can lose data on the target.",
      ),
    ).toBeInTheDocument();
  });

  it("generates a deployment script into the editor after Compare", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<StructureSyncView {...props} />);
    await user.selectOptions(screen.getAllByRole("combobox")[2], "Staging");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    await waitFor(() => {
      const editor = screen.getByTestId("sql-editor") as HTMLTextAreaElement;
      // The generated script references the created/dropped tables.
      expect(editor.value.toLowerCase()).toContain("audit");
    });
  });

  it("runs the script on the target via executeQuery", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<StructureSyncView {...props} />);
    await user.selectOptions(screen.getAllByRole("combobox")[2], "Staging");
    await user.click(screen.getByRole("button", { name: "Compare" }));

    await waitFor(() =>
      expect(screen.getByText("audit")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Run on target" }));
    await waitFor(() => expect(props.executeQuery).toHaveBeenCalled());
  });
});
