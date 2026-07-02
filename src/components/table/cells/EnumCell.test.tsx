// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../../test/render";
import type { ComponentType } from "react";
import { enumCellRenderer, type EnumCell } from "./EnumCell";

type EditorComponent<T> = ComponentType<{
  value: T;
  onChange: (v: T) => void;
  onFinishedEditing: (v?: T) => void;
  initialValue: string;
}>;

function renderEditor(data: EnumCell["data"], onChange = vi.fn(), onFinishedEditing = vi.fn()) {
  const provided = enumCellRenderer.provideEditor!({ data } as EnumCell) as unknown as {
    editor: EditorComponent<EnumCell>;
  };
  const Editor = provided.editor;
  const result = renderWithProviders(
    <Editor value={{ data } as EnumCell} onChange={onChange} onFinishedEditing={onFinishedEditing} initialValue="" />,
  );
  return { ...result, onChange, onFinishedEditing };
}

const base: EnumCell["data"] = {
  kind: "enum-cell",
  value: "active",
  options: ["active", "inactive", "pending"],
  nullable: false,
};

describe("EnumCell editor", () => {
  it("lists every allowed member as a clickable option", () => {
    renderEditor(base);
    expect(screen.getByRole("button", { name: "active" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "inactive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pending" })).toBeInTheDocument();
  });

  it("selecting an option commits the value via onChange + onFinishedEditing", async () => {
    const { user, onChange, onFinishedEditing } = renderEditor(base);
    await user.click(screen.getByRole("button", { name: "pending" }));
    expect(onChange.mock.calls[0][0].data.value).toBe("pending");
    expect(onFinishedEditing.mock.calls[0][0].data.value).toBe("pending");
  });

  it("offers a (Null) option only when the column is nullable", () => {
    const { rerender } = renderEditor(base);
    expect(screen.queryByText("(Null)")).not.toBeInTheDocument();
    rerender(<></>);
    renderEditor({ ...base, nullable: true });
    expect(screen.getByText("(Null)")).toBeInTheDocument();
  });

  it("filters options by the search box and shows 'No matches' when none remain", async () => {
    const { user } = renderEditor(base);
    const search = screen.getByPlaceholderText("Filter…");
    await user.type(search, "pend");
    expect(screen.getByRole("button", { name: "pending" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "inactive" })).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });
});
