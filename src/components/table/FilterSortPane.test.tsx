// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within } from "@/test/render";
import { FilterSortPane } from "./FilterSortPane";
import type { ColumnFilter } from "../../lib/gridFilter";
import type { SortSpec } from "../../lib/whereBuilder";

const cols = [{ name: "id" }, { name: "name" }, { name: "age" }];

function setup(over: Partial<React.ComponentProps<typeof FilterSortPane>> = {}) {
  const onApply = vi.fn();
  const onClear = vi.fn();
  const onClose = vi.fn();
  const utils = renderWithProviders(
    <FilterSortPane
      columns={cols}
      filters={[]}
      combinator="AND"
      sorts={[]}
      onApply={onApply}
      onClear={onClear}
      onClose={onClose}
      {...over}
    />
  );
  return { onApply, onClear, onClose, ...utils };
}

describe("FilterSortPane", () => {
  it("shows empty states for filters and sorts", () => {
    setup();
    expect(screen.getByText("No conditions.")).toBeInTheDocument();
    expect(screen.getByText("No sorting.")).toBeInTheDocument();
  });

  it("adds a filter row seeded with the first column and applies the draft", async () => {
    const { onApply, user } = setup();
    await user.click(screen.getByText("Add condition"));
    expect(screen.queryByText("No conditions.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    const [filters, combinator, sorts] = vi.mocked(onApply).mock.calls[0];
    expect(filters).toEqual([{ column: "id", operator: "contains", value: "" }]);
    expect(combinator).toBe("AND");
    expect(sorts).toEqual([]);
  });

  it("seeds from props and applies edited filter values", async () => {
    const filters: ColumnFilter[] = [{ column: "name", operator: "contains", value: "ab" }];
    const { onApply, user } = setup({ filters });
    const valueInput = screen.getByDisplayValue("ab");
    await user.type(valueInput, "c");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    const applied = vi.mocked(onApply).mock.calls[0][0];
    expect(applied).toEqual([{ column: "name", operator: "contains", value: "abc" }]);
  });

  it("toggles the AND/OR combinator only with multiple filters", async () => {
    const filters: ColumnFilter[] = [
      { column: "id", operator: "equals", value: "1" },
      { column: "name", operator: "contains", value: "x" },
    ];
    const { onApply, user } = setup({ filters });
    await user.click(screen.getByRole("button", { name: "OR" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(vi.mocked(onApply).mock.calls[0][1]).toBe("OR");
  });

  it("adds a sort, flips its direction, and applies it", async () => {
    const { onApply, user } = setup();
    await user.click(screen.getByText("Add sort"));
    // direction toggle button shows ASC by default
    await user.click(screen.getByRole("button", { name: /ASC/ }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    const sorts: SortSpec[] = vi.mocked(onApply).mock.calls[0][2];
    expect(sorts).toEqual([{ column: "id", direction: "desc" }]);
  });

  it("removing a filter row drops it from the applied draft", async () => {
    const filters: ColumnFilter[] = [{ column: "id", operator: "equals", value: "1" }];
    const { onApply, user } = setup({ filters });
    const row = screen.getByDisplayValue("1").closest("li") as HTMLElement;
    await user.click(within(row).getByTitle("Remove condition"));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(vi.mocked(onApply).mock.calls[0][0]).toEqual([]);
  });

  it("wires Clear and Close footer buttons", async () => {
    const { onClear, onClose, user } = setup();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    // Footer "Close" is the one with visible text (the header X also has title=Close).
    const footerClose = screen
      .getAllByRole("button", { name: "Close" })
      .find((b) => b.textContent === "Close")!;
    await user.click(footerClose);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
