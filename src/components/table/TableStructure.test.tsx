// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { makeColumn, makeIndex, makeForeignKey } from "../../test/fixtures";
import TableStructure from "./TableStructure";

function renderStructure(over: {
  columns?: ReturnType<typeof makeColumn>[];
  indexes?: ReturnType<typeof makeIndex>[];
  foreignKeys?: ReturnType<typeof makeForeignKey>[];
} = {}) {
  const getColumns = vi.fn().mockResolvedValue(over.columns ?? [makeColumn()]);
  const getIndexes = vi.fn().mockResolvedValue(over.indexes ?? []);
  const getForeignKeys = vi.fn().mockResolvedValue(over.foreignKeys ?? []);
  const result = renderWithProviders(
    <TableStructure
      sessionId="s1"
      database="shop"
      table="users"
      getColumns={getColumns}
      getIndexes={getIndexes}
      getForeignKeys={getForeignKeys}
    />,
  );
  return { ...result, getColumns, getIndexes, getForeignKeys };
}

describe("TableStructure", () => {
  it("loads and renders the columns tab with tab counts", async () => {
    renderStructure({
      columns: [
        makeColumn({ name: "id", data_type: "int", is_primary_key: true, is_auto_increment: true }),
        makeColumn({ name: "email", data_type: "varchar", nullable: true, is_primary_key: false, is_auto_increment: false, is_unique: true }),
      ],
      indexes: [makeIndex()],
    });
    expect(await screen.findByText("id")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
    // NOT NULL / NULL badges and the AUTO / UNIQUE attribute badges.
    expect(screen.getByText("NOT NULL")).toBeInTheDocument();
    expect(screen.getByText("NULL")).toBeInTheDocument();
    expect(screen.getByText("AUTO")).toBeInTheDocument();
    expect(screen.getByText("UNIQUE")).toBeInTheDocument();
    // Columns tab count badge shows 2.
    const columnsTab = screen.getByRole("button", { name: /Columns/ });
    expect(columnsTab).toHaveTextContent("2");
  });

  it("calls the loaders with the session/db/table identifiers", async () => {
    const { getColumns } = renderStructure();
    await waitFor(() =>
      expect(getColumns).toHaveBeenCalledWith("s1", "shop", "users", undefined),
    );
  });

  it("shows the empty message on the indexes tab when there are none", async () => {
    const { user } = renderStructure({ indexes: [] });
    await screen.findByText("id");
    await user.click(screen.getByRole("button", { name: /Indexes/ }));
    expect(screen.getByText("No indexes found")).toBeInTheDocument();
  });

  it("renders foreign keys with their references when switching tabs", async () => {
    const { user } = renderStructure({
      foreignKeys: [
        makeForeignKey({ name: "fk_org", columns: ["org_id"], referenced_table: "orgs", referenced_columns: ["id"], on_delete: "CASCADE" }),
      ],
    });
    await screen.findByText("id");
    await user.click(screen.getByRole("button", { name: /Foreign Keys/ }));
    expect(screen.getByText("fk_org")).toBeInTheDocument();
    expect(screen.getByText("orgs(id)")).toBeInTheDocument();
    expect(screen.getByText("CASCADE")).toBeInTheDocument();
  });
});
