// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor, within } from "../../test/render";
import type { DesignerForeignKey } from "../../types";
import { ForeignKeyEditor } from "./ForeignKeyEditor";

const LOCAL = ["user_id", "tenant_id"];

function makeFk(over: Partial<DesignerForeignKey> = {}): DesignerForeignKey {
  return {
    id: "fk1",
    name: "fk_user",
    columns: [],
    referencedTable: "",
    referencedColumns: [],
    onDelete: "",
    onUpdate: "",
    ...over,
  };
}

function deps() {
  return {
    listTables: vi.fn().mockResolvedValue(["users", "tenants"]),
    getTableColumns: vi.fn().mockResolvedValue(["id", "uuid"]),
  };
}

describe("ForeignKeyEditor", () => {
  it("shows the empty state when there are no foreign keys", () => {
    const d = deps();
    renderWithProviders(
      <ForeignKeyEditor
        foreignKeys={[]}
        localColumns={LOCAL}
        onChange={() => {}}
        dialect="mysql"
        {...d}
      />,
    );
    expect(screen.getByText("No foreign keys")).toBeInTheDocument();
  });

  it("adds a foreign key with default fields", async () => {
    const d = deps();
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ForeignKeyEditor
        foreignKeys={[]}
        localColumns={LOCAL}
        onChange={onChange}
        dialect="mysql"
        {...d}
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ Add foreign key" }));

    const next = onChange.mock.calls[0][0] as DesignerForeignKey[];
    expect(next[0]).toMatchObject({
      name: "fk_new",
      columns: [],
      referencedTable: "",
      referencedColumns: [],
    });
  });

  it("loads the referenced-table options into the select", async () => {
    const d = deps();
    renderWithProviders(
      <ForeignKeyEditor
        foreignKeys={[makeFk()]}
        localColumns={LOCAL}
        onChange={() => {}}
        dialect="mysql"
        {...d}
      />,
    );

    const select = screen.getByLabelText("Referenced table");
    await waitFor(() =>
      expect(within(select).getByRole("option", { name: "users" })).toBeInTheDocument(),
    );
    expect(d.listTables).toHaveBeenCalledTimes(1);
  });

  it("toggles a local column into the FK", async () => {
    const d = deps();
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ForeignKeyEditor
        foreignKeys={[makeFk()]}
        localColumns={LOCAL}
        onChange={onChange}
        dialect="mysql"
        {...d}
      />,
    );

    await user.click(screen.getByRole("button", { name: "user_id" }));

    const next = onChange.mock.calls[0][0] as DesignerForeignKey[];
    expect(next[0].columns).toEqual(["user_id"]);
  });

  it("choosing a referenced table clears any previous ref columns", async () => {
    const d = deps();
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ForeignKeyEditor
        foreignKeys={[makeFk({ referencedColumns: ["stale"] })]}
        localColumns={LOCAL}
        onChange={onChange}
        dialect="mysql"
        {...d}
      />,
    );

    const select = screen.getByLabelText("Referenced table");
    await waitFor(() =>
      expect(within(select).getByRole("option", { name: "users" })).toBeInTheDocument(),
    );
    await user.selectOptions(select, "users");

    const fkCalls = onChange.mock.calls;
    const next = fkCalls[fkCalls.length - 1][0] as DesignerForeignKey[];
    expect(next[0]).toMatchObject({ referencedTable: "users", referencedColumns: [] });
  });

  it("lazy-loads referenced columns for the chosen table and toggles one", async () => {
    const d = deps();
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ForeignKeyEditor
        foreignKeys={[makeFk({ referencedTable: "users" })]}
        localColumns={LOCAL}
        onChange={onChange}
        dialect="mysql"
        {...d}
      />,
    );

    // Columns for "users" are fetched once.
    await waitFor(() => expect(d.getTableColumns).toHaveBeenCalledWith("users"));
    const idChip = await screen.findByRole("button", { name: "id" });
    await user.click(idChip);

    const fkCalls = onChange.mock.calls;
    const next = fkCalls[fkCalls.length - 1][0] as DesignerForeignKey[];
    expect(next[0].referencedColumns).toEqual(["id"]);
  });

  it("sets an ON DELETE action", async () => {
    const d = deps();
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ForeignKeyEditor
        foreignKeys={[makeFk()]}
        localColumns={LOCAL}
        onChange={onChange}
        dialect="mysql"
        {...d}
      />,
    );

    await user.selectOptions(screen.getByLabelText("On delete action"), "CASCADE");

    const fkCalls = onChange.mock.calls;
    const next = fkCalls[fkCalls.length - 1][0] as DesignerForeignKey[];
    expect(next[0].onDelete).toBe("CASCADE");
  });

  it("exposes the referenced-schema input only on Postgres", () => {
    const d = deps();
    const { rerender } = renderWithProviders(
      <ForeignKeyEditor
        foreignKeys={[makeFk()]}
        localColumns={LOCAL}
        onChange={() => {}}
        dialect="mysql"
        {...d}
      />,
    );
    expect(screen.queryByLabelText("Referenced schema")).not.toBeInTheDocument();

    rerender(
      <ForeignKeyEditor
        foreignKeys={[makeFk()]}
        localColumns={LOCAL}
        onChange={() => {}}
        dialect="postgres"
        {...d}
      />,
    );
    expect(screen.getByLabelText("Referenced schema")).toBeInTheDocument();
  });
});
