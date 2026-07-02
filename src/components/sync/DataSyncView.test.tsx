// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { makeColumn, makeTable, makeQueryResult } from "../../test/fixtures";
import type { ColumnDefinition, QueryResult, TableInfo } from "../../types";
import {
  DataSyncView,
  type DataSyncViewProps,
  type DataSyncSession,
} from "./DataSyncView";

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

const sessions: DataSyncSession[] = [
  { id: "s1", label: "Prod", databases: ["main", "app"], dialect: "mysql" },
  { id: "s2", label: "Staging", databases: ["main", "app"], dialect: "mysql" },
];

const columns: ColumnDefinition[] = [
  makeColumn({ name: "id", is_primary_key: true }),
  makeColumn({ name: "email", data_type: "varchar", is_primary_key: false }),
];

// id=1 unchanged, id=2 is source-only (insert), id=3 is target-only (delete).
const sourceRows: QueryResult = makeQueryResult({
  columns: [
    { name: "id", data_type: "int", nullable: false },
    { name: "email", data_type: "varchar", nullable: false },
  ],
  rows: [
    { id: 1, email: "a@x.com" },
    { id: 2, email: "b@x.com" },
  ],
});
const targetRows: QueryResult = makeQueryResult({
  columns: sourceRows.columns,
  rows: [
    { id: 1, email: "a@x.com" },
    { id: 3, email: "c@x.com" },
  ],
});

function makeProps(over: Partial<DataSyncViewProps> = {}): DataSyncViewProps {
  return {
    sessions,
    getTables: vi.fn(
      (): Promise<TableInfo[]> =>
        Promise.resolve([makeTable({ name: "users" })]),
    ),
    getColumns: vi.fn((): Promise<ColumnDefinition[]> => Promise.resolve(columns)),
    executeQuery: vi.fn((sid: string): Promise<QueryResult> =>
      Promise.resolve(sid === "s1" ? sourceRows : targetRows),
    ),
    runOnTarget: vi.fn(() => Promise.resolve(undefined)),
    onClose: vi.fn(),
    ...over,
  };
}

/** Drive the pickers to a source(s1.app.users) → target(s2.app.users) selection. */
async function pickTables(
  user: ReturnType<typeof renderWithProviders>["user"],
) {
  const combos = () => screen.getAllByRole("combobox");
  // Source side: [sessionSel, dbSel, tableSel] = combos[0..2].
  // Change the source database (main → app) to trigger loadTables (tables
  // aren't fetched until session/db actually changes).
  await user.selectOptions(combos()[1], "app");
  await waitFor(() => {
    expect(
      combos()[2].querySelectorAll("option").length,
    ).toBeGreaterThan(1);
  });
  await user.selectOptions(combos()[2], "users");

  // Target side: sessionSel, dbSel, tableSel = combos[3..5].
  await user.selectOptions(combos()[3], "Staging");
  await waitFor(() => {
    expect(
      combos()[5].querySelectorAll("option").length,
    ).toBeGreaterThan(1);
  });
  await user.selectOptions(combos()[5], "users");
}

describe("DataSyncView", () => {
  it("renders the key-columns bar and the pre-compare empty state", () => {
    renderWithProviders(<DataSyncView {...makeProps()} />);
    expect(screen.getByText("Key columns")).toBeInTheDocument();
    expect(
      screen.getByText("Choose a source table to pick key columns."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Pick a source and target table/i),
    ).toBeInTheDocument();
  });

  it("loads source columns as key-column chips when a source table is chosen", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<DataSyncView {...props} />);
    const combos = () => screen.getAllByRole("combobox");
    await user.selectOptions(combos()[1], "app");
    await waitFor(() => {
      expect(combos()[2].querySelectorAll("option").length).toBeGreaterThan(1);
    });
    await user.selectOptions(combos()[2], "users");
    await waitFor(() => {
      expect(props.getColumns).toHaveBeenCalled();
    });
    // The PK column chip renders with a "PK" marker.
    await waitFor(() => {
      expect(screen.getByText("PK")).toBeInTheDocument();
    });
  });

  it("compares two tables and lists insert + delete row diffs", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<DataSyncView {...props} />);
    await pickTables(user);
    await user.click(screen.getByRole("button", { name: "Compare" }));

    await waitFor(() => {
      expect(props.executeQuery).toHaveBeenCalledTimes(2);
    });
    // One insert (id=2) and one delete (id=3) badge appear.
    await waitFor(() => {
      expect(screen.getByText("insert")).toBeInTheDocument();
    });
    expect(screen.getByText("delete")).toBeInTheDocument();
  });

  it("applies the generated statements to the target via runOnTarget", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<DataSyncView {...props} />);
    await pickTables(user);
    await user.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() =>
      expect(screen.getByText("insert")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Run on target" }));
    await waitFor(() => expect(props.runOnTarget).toHaveBeenCalled());
    expect(vi.mocked(props.runOnTarget).mock.calls[0][0]).toBe("s2");
  });
});
