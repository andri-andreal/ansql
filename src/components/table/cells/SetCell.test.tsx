// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../../test/render";
import type { ComponentType } from "react";
import { setCellRenderer, type SetCell } from "./SetCell";

type EditorComponent<T> = ComponentType<{
  value: T;
  onChange: (v: T) => void;
  onFinishedEditing: (v?: T) => void;
  initialValue: string;
}>;

function renderEditor(data: SetCell["data"], onChange = vi.fn()) {
  const provided = setCellRenderer.provideEditor!({ data } as SetCell) as unknown as {
    editor: EditorComponent<SetCell>;
  };
  const Editor = provided.editor;
  const result = renderWithProviders(
    <Editor value={{ data } as SetCell} onChange={onChange} onFinishedEditing={vi.fn()} initialValue="" />,
  );
  return { ...result, onChange };
}

const base: SetCell["data"] = {
  kind: "set-cell",
  value: "read",
  options: ["read", "write", "admin"],
};

describe("SetCell editor", () => {
  it("renders a checkbox per member, pre-checking the stored subset", () => {
    renderEditor(base);
    // Members render in definition order: read, write, admin.
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toBeChecked(); // read
    expect(boxes[1]).not.toBeChecked(); // write
  });

  it("toggling a member emits the comma-joined subset in definition order", async () => {
    const { user, onChange } = renderEditor(base);
    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[2]); // admin
    // read was already selected; adding admin -> "read,admin" in definition order.
    const calls = onChange.mock.calls;
    const last = calls[calls.length - 1][0];
    expect(last.data.value).toBe("read,admin");
  });

  it("unchecking the last member yields an empty value and the (empty) summary", async () => {
    const { user, onChange } = renderEditor(base);
    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[0]); // uncheck read
    const calls = onChange.mock.calls;
    expect(calls[calls.length - 1][0].data.value).toBe("");
    expect(screen.getByText("(empty)")).toBeInTheDocument();
  });

  it("shows 'No options' when the member list is empty", () => {
    renderEditor({ kind: "set-cell", value: "", options: [] });
    expect(screen.getByText("No options")).toBeInTheDocument();
  });
});
