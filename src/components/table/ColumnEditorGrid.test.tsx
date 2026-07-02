// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import type { DesignerColumn } from "../../types";
import { ColumnEditorGrid } from "./ColumnEditorGrid";

function makeCol(over: Partial<DesignerColumn> = {}): DesignerColumn {
  return {
    id: "c1",
    name: "id",
    type: "int",
    length: null,
    precision: null,
    scale: null,
    nullable: false,
    defaultValue: null,
    isPrimaryKey: true,
    isAutoIncrement: true,
    comment: null,
    ...over,
  };
}

function renderGrid(
  cols: DesignerColumn[],
  over: Partial<React.ComponentProps<typeof ColumnEditorGrid>> = {},
) {
  const onChange = vi.fn();
  const result = renderWithProviders(
    <ColumnEditorGrid columns={cols} onChange={onChange} dialect="mysql" {...over} />,
  );
  return { ...result, onChange };
}

describe("ColumnEditorGrid", () => {
  it("shows the empty-state row when there are no columns", () => {
    renderGrid([]);
    expect(
      screen.getByText('No columns yet — click "+ Add column" to start.'),
    ).toBeInTheDocument();
  });

  it("appends a blank varchar column when Add column is clicked", async () => {
    const { user, onChange } = renderGrid([]);
    await user.click(screen.getByRole("button", { name: "+ Add column" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as DesignerColumn[];
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ name: "", type: "varchar", nullable: true });
  });

  it("edits the column name through onChange", async () => {
    const { user, onChange } = renderGrid([makeCol({ name: "" })]);
    await user.type(screen.getByLabelText("Column name"), "x");
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as DesignerColumn[];
    expect(next[0].name).toBe("x");
  });

  it("changing the type clears auto-increment for non-integer types", async () => {
    const { user, onChange } = renderGrid([makeCol({ type: "int", isAutoIncrement: true })]);
    await user.selectOptions(screen.getByLabelText("Column type"), "varchar");
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as DesignerColumn[];
    expect(next[0].type).toBe("varchar");
    expect(next[0].isAutoIncrement).toBe(false);
  });

  it("removes a column via the remove button", async () => {
    const { user, onChange } = renderGrid([makeCol({ id: "c1", name: "id" })]);
    await user.click(screen.getByRole("button", { name: /Remove column id/ }));
    const next = onChange.mock.calls[0][0] as DesignerColumn[];
    expect(next).toHaveLength(0);
  });

  it("reorders columns with the move-down button", async () => {
    const cols = [makeCol({ id: "a", name: "a" }), makeCol({ id: "b", name: "b" })];
    const { user, onChange } = renderGrid(cols);
    await user.click(screen.getByRole("button", { name: /Move column a down/ }));
    const next = onChange.mock.calls[0][0] as DesignerColumn[];
    expect(next.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("toggles primary key and nullable checkboxes", async () => {
    const { user, onChange } = renderGrid([makeCol({ isPrimaryKey: false, nullable: false })]);
    await user.click(screen.getByLabelText("Primary key"));
    let next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as DesignerColumn[];
    expect(next[0].isPrimaryKey).toBe(true);

    await user.click(screen.getByLabelText("Nullable"));
    next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as DesignerColumn[];
    expect(next[0].nullable).toBe(true);
  });

  it("disables the comment field on SQLite", () => {
    renderGrid([makeCol()], { dialect: "sqlite" });
    expect(screen.getByLabelText("Column comment")).toBeDisabled();
  });
});
