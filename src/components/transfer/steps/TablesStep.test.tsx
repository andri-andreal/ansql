// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../../test/render";
import { installFakeBackend } from "../../../test/fakeBackend";
import { makeColumn } from "../../../test/fixtures";
import type { TableSel } from "../TransferWizard";
import { TablesStep } from "./TablesStep";

function makeTableSel(over: Partial<TableSel> = {}): TableSel {
  return {
    source_table: "users",
    target_table: "users",
    target_schema: null,
    conflict: "drop",
    selected: false,
    mapping: [],
    columns: [],
    where: "",
    ...over,
  };
}

describe("TablesStep", () => {
  it("lists each source table with an editable target name", () => {
    renderWithProviders(
      <TablesStep
        tables={[makeTableSel(), makeTableSel({ source_table: "orders", target_table: "orders" })]}
        onChange={vi.fn()}
        sourceSessionId="s1"
        sourceDatabase="db"
      />,
    );
    expect(screen.getByText("Tables to transfer")).toBeInTheDocument();
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    // Two editable target-name inputs (one per row).
    expect(screen.getAllByDisplayValue("users").length).toBeGreaterThanOrEqual(1);
  });

  it("checking a row's checkbox marks it selected", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <TablesStep
        tables={[makeTableSel()]}
        onChange={onChange}
        sourceSessionId="s1"
        sourceDatabase="db"
      />,
    );
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ source_table: "users", selected: true }),
    ]);
  });

  it("editing the target name re-emits the patched table", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <TablesStep
        tables={[makeTableSel()]}
        onChange={onChange}
        sourceSessionId="s1"
        sourceDatabase="db"
      />,
    );
    const input = screen.getByDisplayValue("users");
    await user.type(input, "2");
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last[0].target_table).toContain("2");
  });

  it("expanding a row lazy-loads source columns via get_columns and shows the WHERE filter", async () => {
    const fake = installFakeBackend();
    fake.on("get_columns", () => [
      makeColumn({ name: "id" }),
      makeColumn({ name: "email", data_type: "varchar", is_primary_key: false }),
    ]);
    const { user } = renderWithProviders(
      <TablesStep
        tables={[makeTableSel()]}
        onChange={vi.fn()}
        sourceSessionId="s1"
        sourceDatabase="db"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => {
      expect(fake.calls.some((c) => c.cmd === "get_columns")).toBe(true);
    });
    expect(screen.getByText("WHERE filter")).toBeInTheDocument();
  });
});
