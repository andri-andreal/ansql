// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within } from "@/test/render";
import { ColumnConfigPopover } from "./ColumnConfigPopover";

const cols = [{ name: "id" }, { name: "name" }, { name: "email" }];

function setup(over: Partial<React.ComponentProps<typeof ColumnConfigPopover>> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const utils = renderWithProviders(
    <ColumnConfigPopover
      columns={cols}
      hidden={[]}
      order={[]}
      frozenCount={0}
      rowHeight={34}
      onChange={onChange}
      onClose={onClose}
      {...over}
    />
  );
  return { onChange, onClose, ...utils };
}

describe("ColumnConfigPopover", () => {
  it("lists every column in resolved order even when order prop is empty", () => {
    setup();
    expect(screen.getByText("Columns & Layout")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["id", "name", "email"]);
  });

  it("toggling visibility pushes a hidden patch including the column", async () => {
    const { onChange, user } = setup();
    const firstRow = screen.getAllByRole("listitem")[0];
    await user.click(within(firstRow).getByTitle("Hide column"));
    expect(onChange).toHaveBeenCalledWith({ hidden: ["id"] });
  });

  it("moving a column down emits a reordered order patch", async () => {
    const { onChange, user } = setup();
    // first row's "Move down" button reorders id -> after name
    const firstRow = screen.getAllByRole("listitem")[0];
    await user.click(within(firstRow).getByTitle("Move down"));
    expect(onChange).toHaveBeenCalledWith({ order: ["name", "id", "email"] });
  });

  it("clamps the frozen count to the number of columns and emits frozenCount", async () => {
    const { onChange, user } = setup();
    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "9");
    // 9 clamps down to columns.length (3)
    const last = vi.mocked(onChange).mock.calls[vi.mocked(onChange).mock.calls.length - 1];
    expect(last[0]).toEqual({ frozenCount: 3 });
  });

  it("changing row height emits the selected pixel value", async () => {
    const { onChange, user } = setup();
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "48");
    expect(onChange).toHaveBeenCalledWith({ rowHeight: 48 });
  });

  it("Done and close (X) both fire onClose", async () => {
    const { onClose, user } = setup();
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders the no-columns empty state", () => {
    setup({ columns: [] });
    expect(screen.getByText("No columns.")).toBeInTheDocument();
  });
});
