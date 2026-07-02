// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, fireEvent } from "../../../test/render";
import type { ComponentType } from "react";
import { dateCellRenderer, type DateCell } from "./DateCell";

type EditorComponent<T> = ComponentType<{
  value: T;
  onChange: (v: T) => void;
  onFinishedEditing: (v?: T) => void;
  initialValue: string;
}>;

/** Build the glide-data-grid editor element from the renderer's provideEditor. */
function renderEditor(data: DateCell["data"], onChange = vi.fn()) {
  const provided = dateCellRenderer.provideEditor!({ data } as DateCell) as unknown as {
    editor: EditorComponent<DateCell>;
  };
  const Editor = provided.editor;
  const value = { data } as DateCell;
  const result = renderWithProviders(
    <Editor value={value} onChange={onChange} onFinishedEditing={vi.fn()} initialValue="" />,
  );
  return { ...result, onChange };
}

const base: DateCell["data"] = { kind: "date-cell", value: "2024-01-15", inputType: "date" };

describe("DateCell editor", () => {
  it("renders an input of the column's inputType seeded with the value", () => {
    renderEditor(base);
    const input = document.querySelector("input")!;
    expect(input).toHaveAttribute("type", "date");
    expect(input).toHaveValue("2024-01-15");
  });

  it("emits the typed value through onChange", () => {
    const { onChange } = renderEditor(base);
    const input = document.querySelector("input")!;
    fireEvent.change(input, { target: { value: "2025-12-31" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].data.value).toBe("2025-12-31");
  });

  it("uses a datetime-local input when configured", () => {
    renderEditor({ ...base, inputType: "datetime-local", value: "" });
    const input = document.querySelector("input")!;
    expect(input).toHaveAttribute("type", "datetime-local");
    expect(input).toHaveValue("");
  });
});
