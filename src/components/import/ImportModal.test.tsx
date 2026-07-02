// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderWithProviders,
  screen,
  waitFor,
} from "../../test/render";
import { makeConnection } from "../../test/fixtures";
import { installFakeBackend } from "../../test/fakeBackend";
import type { SessionInfo } from "../../types";
import { ImportModal } from "./ImportModal";

const session: SessionInfo = {
  id: "sess-1",
  connection_id: "conn-1",
  database: "shop",
  connected_at: "2026-01-01T00:00:00Z",
};

function renderModal(
  props: Partial<React.ComponentProps<typeof ImportModal>> = {},
) {
  const onClose = vi.fn();
  const result = renderWithProviders(
    <ImportModal
      targetSession="sess-1"
      targetDatabase="shop"
      mode="existing"
      sessions={[session]}
      connections={[makeConnection({ id: "conn-1", name: "Prod" })]}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose, ...result };
}

describe("ImportModal", () => {
  beforeEach(() => {
    // get_databases fires on mount; seed a stable list so the DB select fills.
    installFakeBackend({
      handlers: { get_databases: () => ["shop", "analytics"] },
    });
  });

  it("renders the title and the file-picker call to action", () => {
    renderModal();
    expect(screen.getByText("Import from file")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Choose file/ }),
    ).toBeInTheDocument();
  });

  it("pre-populates the target connection and database from props", async () => {
    renderModal();
    // The connection select shows the resolved connection name.
    expect(
      screen.getByRole("option", { name: /Prod/ }),
    ).toBeInTheDocument();
    // The database select is seeded via get_databases on mount.
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "analytics" }),
      ).toBeInTheDocument(),
    );
    const dbSelect = screen.getByText("Database").closest("label")!
      .querySelector("select")!;
    expect(dbSelect).toHaveValue("shop");
  });

  it("disables the Import action until a file has been parsed", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("lets the user edit the target table and schema fields", async () => {
    const { user } = renderModal();
    const tableInput = screen.getByPlaceholderText("table name");
    await user.type(tableInput, "customers");
    expect(tableInput).toHaveValue("customers");

    const schemaInput = screen.getByPlaceholderText("(default)");
    await user.type(schemaInput, "public");
    expect(schemaInput).toHaveValue("public");
  });

  it("shows the new-target affordance (create-table checkbox) for mode=new", () => {
    renderModal({ mode: "new", targetTable: undefined });
    // With no existing columns, the target reads as new.
    expect(screen.getByText("Target is new →")).toBeInTheDocument();
    expect(screen.getByText("Create table from file")).toBeInTheDocument();
  });

  it("clamps the batch-size field to a minimum of 1 when emptied", async () => {
    const { user } = renderModal();
    const batch = screen.getByDisplayValue("500");
    // Clearing fires onChange with "" → Number("") || 1 → Math.max(1, 1) = 1.
    await user.clear(batch);
    expect(batch).toHaveValue(1);
  });

  it("closes via the footer Close button", async () => {
    const { user, onClose } = renderModal();
    // Two "Close" affordances exist (header X + footer button); click the last.
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    await user.click(closeButtons[closeButtons.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
