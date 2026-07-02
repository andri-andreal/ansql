// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within } from "../../test/render";
import type { DesignerIndex } from "../../types";
import { IndexEditor } from "./IndexEditor";

const COLS = ["id", "name", "created_at"];

function makeIndex(over: Partial<DesignerIndex> = {}): DesignerIndex {
  return { id: "i1", name: "idx_name", unique: false, columns: ["name"], ...over };
}

describe("IndexEditor", () => {
  it("shows the empty state when there are no indexes", () => {
    renderWithProviders(
      <IndexEditor
        indexes={[]}
        availableColumns={COLS}
        onChange={() => {}}
        dialect="mysql"
      />,
    );
    expect(screen.getByText("No indexes")).toBeInTheDocument();
  });

  it("adds a non-unique index with a default name", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <IndexEditor
        indexes={[]}
        availableColumns={COLS}
        onChange={onChange}
        dialect="mysql"
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ Add index" }));

    const next = onChange.mock.calls[0][0] as DesignerIndex[];
    expect(next[0]).toMatchObject({ name: "idx_new", unique: false, columns: [] });
  });

  it("toggles the unique checkbox", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <IndexEditor
        indexes={[makeIndex({ unique: false })]}
        availableColumns={COLS}
        onChange={onChange}
        dialect="mysql"
      />,
    );

    await user.click(screen.getByRole("checkbox"));

    const next = onChange.mock.calls[0][0] as DesignerIndex[];
    expect(next[0].unique).toBe(true);
  });

  it("toggles a column chip into the index", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <IndexEditor
        indexes={[makeIndex({ columns: ["name"] })]}
        availableColumns={COLS}
        onChange={onChange}
        dialect="mysql"
      />,
    );

    await user.click(screen.getByRole("button", { name: "created_at" }));

    const next = onChange.mock.calls[0][0] as DesignerIndex[];
    expect(next[0].columns).toEqual(["name", "created_at"]);
  });

  it("selecting FULLTEXT clears unique (MySQL only)", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <IndexEditor
        indexes={[makeIndex({ unique: true })]}
        availableColumns={COLS}
        onChange={onChange}
        dialect="mysql"
      />,
    );

    await user.selectOptions(screen.getByLabelText("Index kind"), "fulltext");

    const next = onChange.mock.calls[0][0] as DesignerIndex[];
    expect(next[0].indexKind).toBe("fulltext");
    expect(next[0].unique).toBe(false);
  });

  it("offers Postgres access methods and hides the MySQL Kind control", () => {
    renderWithProviders(
      <IndexEditor
        indexes={[makeIndex()]}
        availableColumns={COLS}
        onChange={() => {}}
        dialect="postgres"
      />,
    );
    expect(screen.queryByLabelText("Index kind")).not.toBeInTheDocument();
    const method = screen.getByLabelText("Index method");
    expect(within(method).getByRole("option", { name: "gin" })).toBeInTheDocument();
  });

  it("sets a per-column sort direction", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <IndexEditor
        indexes={[makeIndex({ columns: ["name"] })]}
        availableColumns={COLS}
        onChange={onChange}
        dialect="mysql"
      />,
    );

    await user.selectOptions(screen.getByLabelText("Sort direction for name"), "DESC");

    const next = onChange.mock.calls[0][0] as DesignerIndex[];
    expect(next[0].columnOrders).toMatchObject({ name: "DESC" });
  });
});
