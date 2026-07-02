// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import ColumnFilterPopover from "./ColumnFilterPopover";
import type { ColumnFilter } from "../../lib/gridFilter";

function setup(filter?: ColumnFilter) {
  const onChange = vi.fn();
  const utils = renderWithProviders(
    <ColumnFilterPopover column="email" filter={filter} onChange={onChange} />
  );
  return { onChange, ...utils };
}

describe("ColumnFilterPopover", () => {
  it("opens the popover and shows the column name", async () => {
    const { user } = setup();
    await user.click(screen.getByTitle("Filter column"));
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("typing a value emits an active filter with the merged operator/value", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByTitle("Filter column"));
    await user.type(screen.getByPlaceholderText("value…"), "a");
    const last = vi.mocked(onChange).mock.calls[vi.mocked(onChange).mock.calls.length - 1];
    expect(last[0]).toEqual({ column: "email", operator: "contains", value: "a" });
  });

  it("choosing a valueless operator hides the input and emits filter with empty value", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByTitle("Filter column"));
    await user.selectOptions(screen.getByRole("combobox"), "is_null");
    expect(onChange).toHaveBeenCalledWith({ column: "email", operator: "is_null", value: "" });
  });

  it("shows the active funnel + clear control for an active filter and clears via onChange(undefined)", async () => {
    const { onChange, user } = setup({ column: "email", operator: "contains", value: "x" });
    // Active filter button tooltip becomes "Edit filter"
    await user.click(screen.getByTitle("Edit filter"));
    await user.click(screen.getByRole("button", { name: /Clear/ }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("seeds operator and value from the existing filter", async () => {
    const { user } = setup({ column: "email", operator: "starts_with", value: "ab" });
    await user.click(screen.getByTitle("Edit filter"));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("starts_with");
    expect((screen.getByPlaceholderText("value…") as HTMLInputElement).value).toBe("ab");
  });
});
