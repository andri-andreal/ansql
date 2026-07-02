// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import type { ColumnMap, ColumnMeta } from "../../types";
import { ColumnMapping, autoMap } from "./ColumnMapping";

const sourceColumns: ColumnMeta[] = [
  { name: "id", data_type: "int", nullable: false },
  { name: "email", data_type: "varchar", nullable: false },
];

describe("autoMap", () => {
  it("maps every source column to its own name when target is empty (create mode)", () => {
    expect(autoMap(sourceColumns, [])).toEqual([
      { source: "id", target: "id" },
      { source: "email", target: "email" },
    ]);
  });

  it("maps to a target only when a case-insensitive match exists", () => {
    expect(autoMap(sourceColumns, ["ID"])).toEqual([
      { source: "id", target: "id" },
      { source: "email", target: "" },
    ]);
  });
});

describe("ColumnMapping", () => {
  const mapping: ColumnMap[] = [
    { source: "id", target: "id" },
    { source: "email", target: "email" },
  ];

  it("renders source columns with their data types", () => {
    renderWithProviders(
      <ColumnMapping
        sourceColumns={sourceColumns}
        targetColumns={["id", "email"]}
        mapping={mapping}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Column mapping")).toBeInTheDocument();
    expect(screen.getByText("int")).toBeInTheDocument();
    expect(screen.getByText("varchar")).toBeInTheDocument();
  });

  it("Clear all empties every target", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ColumnMapping
        sourceColumns={sourceColumns}
        targetColumns={["id", "email"]}
        mapping={mapping}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByText("Clear all"));
    expect(onChange).toHaveBeenCalledWith([
      { source: "id", target: "" },
      { source: "email", target: "" },
    ]);
  });

  it("changing a target via the dropdown (existing table) re-emits that one mapping", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ColumnMapping
        sourceColumns={sourceColumns}
        targetColumns={["id", "email"]}
        mapping={mapping}
        onChange={onChange}
      />,
    );
    // First source row (id) — change its target to skip.
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "— skip —");
    expect(onChange).toHaveBeenCalledWith([
      { source: "id", target: "" },
      { source: "email", target: "email" },
    ]);
  });

  it("renders free-text inputs (not dropdowns) when creating a new table", () => {
    renderWithProviders(
      <ColumnMapping
        sourceColumns={sourceColumns}
        targetColumns={[]}
        mapping={mapping}
        onChange={vi.fn()}
      />,
    );
    // Create mode → text inputs, no comboboxes.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getAllByRole("textbox").length).toBe(2);
  });
});
