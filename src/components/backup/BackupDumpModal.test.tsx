// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, within, waitFor } from "../../test/render";
import {
  makeColumn,
  makeIndex,
  makeForeignKey,
  makeQueryResult,
} from "../../test/fixtures";
import { BackupDumpModal } from "./BackupDumpModal";

function makeProps(
  overrides: Partial<React.ComponentProps<typeof BackupDumpModal>> = {},
) {
  const getColumns = vi.fn().mockResolvedValue([makeColumn()]);
  const getIndexes = vi.fn().mockResolvedValue([makeIndex()]);
  const getForeignKeys = vi.fn().mockResolvedValue([makeForeignKey()]);
  const executeQuery = vi.fn().mockResolvedValue(makeQueryResult());
  const onClose = vi.fn();
  return {
    sessionId: "sess-1",
    database: "shop",
    schema: null,
    dialect: "mysql" as const,
    tables: ["users", "orders"],
    getColumns,
    getIndexes,
    getForeignKeys,
    executeQuery,
    onClose,
    ...overrides,
  };
}

// navigator.clipboard.writeText may be missing in jsdom; ensure the object
// exists, then spy on the exact method the component awaits.
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  if (!("clipboard" in navigator)) {
    Object.defineProperty(navigator, "clipboard", {
      value: {},
      configurable: true,
      writable: true,
    });
  }
  writeText = vi.fn().mockResolvedValue(undefined);
  (navigator.clipboard as { writeText: unknown }).writeText = writeText;
});

describe("BackupDumpModal", () => {
  it("renders the title with the database and pre-selects every table", () => {
    const props = makeProps();
    renderWithProviders(<BackupDumpModal {...props} />);
    expect(screen.getByText("Backup / Dump SQL — shop")).toBeInTheDocument();
    // Tables (2/2) — all selected by default.
    expect(screen.getByText("Tables (2/2)")).toBeInTheDocument();
    expect(screen.getByText("All tables selected.")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    // First two are the table rows, both checked.
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();
  });

  it("Select none / Select all drive the selection count and disable Run when empty", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<BackupDumpModal {...props} />);

    await user.click(screen.getByRole("button", { name: "None" }));
    expect(screen.getByText("Tables (0/2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy to clipboard/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save to .sql file/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByText("Tables (2/2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy to clipboard/ })).toBeEnabled();
  });

  it("builds a structure-and-data dump for selected tables and copies it to the clipboard", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<BackupDumpModal {...props} />);

    await user.click(screen.getByRole("button", { name: /Copy to clipboard/ }));

    await waitFor(() =>
      expect(
        screen.getByText("Copied dump of 2 table(s) to clipboard"),
      ).toBeInTheDocument(),
    );
    // Both selected tables were introspected (structure) for the dump.
    expect(props.getColumns).toHaveBeenCalledWith("sess-1", "shop", "users", undefined);
    expect(props.getColumns).toHaveBeenCalledWith("sess-1", "shop", "orders", undefined);
    // Structure-and-data is the default, so a SELECT ran per table.
    expect(props.executeQuery).toHaveBeenCalledTimes(2);
    expect(props.executeQuery).toHaveBeenCalledWith(
      "sess-1",
      expect.stringContaining("SELECT * FROM"),
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("CREATE TABLE");
  });

  it("structure-only mode skips the data SELECT", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<BackupDumpModal {...props} />);

    await user.click(screen.getByRole("radio", { name: "Structure only" }));
    await user.click(screen.getByRole("button", { name: /Copy to clipboard/ }));

    await waitFor(() =>
      expect(
        screen.getByText("Copied dump of 2 table(s) to clipboard"),
      ).toBeInTheDocument(),
    );
    expect(props.getColumns).toHaveBeenCalledTimes(2);
    expect(props.executeQuery).not.toHaveBeenCalled();
  });

  it("only dumps the still-selected tables after deselecting one", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<BackupDumpModal {...props} />);

    // Deselect the "orders" table checkbox (its row label contains "orders").
    const ordersRow = screen.getByText("orders").closest("label")!;
    await user.click(within(ordersRow).getByRole("checkbox"));
    expect(screen.getByText("Tables (1/2)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Copy to clipboard/ }));
    await waitFor(() =>
      expect(
        screen.getByText("Copied dump of 1 table(s) to clipboard"),
      ).toBeInTheDocument(),
    );
    expect(props.getColumns).toHaveBeenCalledTimes(1);
    expect(props.getColumns).toHaveBeenCalledWith("sess-1", "shop", "users", undefined);
  });

  it("surfaces a per-table error without aborting the whole dump", async () => {
    const props = makeProps({ tables: ["bad"] });
    props.getColumns = vi.fn().mockRejectedValue(new Error("boom"));
    const { user } = renderWithProviders(<BackupDumpModal {...props} />);

    await user.click(screen.getByRole("button", { name: /Copy to clipboard/ }));
    await waitFor(() =>
      expect(screen.getByText("1 error(s):")).toBeInTheDocument(),
    );
    expect(screen.getByText(/bad: .*boom/)).toBeInTheDocument();
  });

  it("save-to-file is a no-op build when the inert save dialog returns no path", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<BackupDumpModal {...props} />);

    await user.click(screen.getByRole("button", { name: /Save to .sql file/ }));
    // The plugin-dialog save() resolves null in jsdom, so no dump is built.
    await waitFor(() => expect(props.getColumns).not.toHaveBeenCalled());
    expect(props.executeQuery).not.toHaveBeenCalled();
  });

  it("renders the empty-state when there are no tables", () => {
    const props = makeProps({ tables: [] });
    renderWithProviders(<BackupDumpModal {...props} />);
    expect(screen.getByText("No tables to dump.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy to clipboard/ })).toBeDisabled();
  });

  it("closes via the footer Close button", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<BackupDumpModal {...props} />);
    // Header X and footer button both label "Close"; click the footer one.
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    await user.click(closeButtons[closeButtons.length - 1]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
