// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { makeColumn, makeIndex, makeForeignKey } from "../../test/fixtures";
import { InfoPane, type InfoPaneTarget } from "./InfoPane";

function tableTarget(overrides: Partial<InfoPaneTarget> = {}): InfoPaneTarget {
  return {
    kind: "table",
    sessionId: "s1",
    database: "db1",
    schema: null,
    name: "users",
    ...overrides,
  };
}

function renderPane(
  props: Partial<React.ComponentProps<typeof InfoPane>> = {},
) {
  return renderWithProviders(
    <InfoPane
      target={null}
      getColumns={vi.fn().mockResolvedValue([])}
      getIndexes={vi.fn().mockResolvedValue([])}
      getForeignKeys={vi.fn().mockResolvedValue([])}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

describe("InfoPane", () => {
  it("shows the empty placeholder when no target is selected", () => {
    renderPane({ target: null });
    expect(
      screen.getByText("Select an object to view its details."),
    ).toBeInTheDocument();
  });

  it("shows a not-inspectable placeholder for non-table/view kinds and does not introspect", () => {
    const getColumns = vi.fn().mockResolvedValue([]);
    renderPane({ target: tableTarget({ kind: "routine", name: "do_thing" }), getColumns });

    expect(
      screen.getByText("No detailed information available for this routine."),
    ).toBeInTheDocument();
    expect(getColumns).not.toHaveBeenCalled();
  });

  it("fetches and renders columns, indexes, and foreign keys for a table target", async () => {
    const getColumns = vi
      .fn()
      .mockResolvedValue([
        makeColumn({ name: "id", full_type: "int", is_primary_key: true }),
        makeColumn({ name: "email", full_type: "varchar(255)", is_primary_key: false, nullable: false }),
      ]);
    const getIndexes = vi
      .fn()
      .mockResolvedValue([makeIndex({ name: "PRIMARY", columns: ["id"] })]);
    const getForeignKeys = vi
      .fn()
      .mockResolvedValue([
        makeForeignKey({ name: "fk_org", columns: ["org_id"], referenced_table: "orgs" }),
      ]);

    renderPane({
      target: tableTarget(),
      getColumns,
      getIndexes,
      getForeignKeys,
    });

    await waitFor(() => {
      expect(screen.getByText("email")).toBeInTheDocument();
    });
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("PRIMARY")).toBeInTheDocument();
    expect(screen.getByText("fk_org")).toBeInTheDocument();
    expect(getColumns).toHaveBeenCalledWith("s1", "db1", "users", undefined);
  });

  it("renders the error message when getColumns rejects", async () => {
    const getColumns = vi.fn().mockRejectedValue(new Error("boom"));
    renderPane({ target: tableTarget(), getColumns });

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
  });

  it("fires onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const { user } = renderPane({ target: tableTarget(), onClose });

    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refetches when the refresh button is clicked on an inspectable target", async () => {
    const getColumns = vi.fn().mockResolvedValue([makeColumn({ name: "id" })]);
    const { user } = renderPane({ target: tableTarget(), getColumns });

    await waitFor(() => expect(getColumns).toHaveBeenCalledTimes(1));

    await user.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(getColumns).toHaveBeenCalledTimes(2));
  });
});
