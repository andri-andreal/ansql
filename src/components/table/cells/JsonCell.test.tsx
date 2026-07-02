// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, fireEvent } from "../../../test/render";
import type { ComponentType } from "react";
import { jsonCellRenderer, type JsonCell } from "./JsonCell";

type EditorComponent<T> = ComponentType<{
  value: T;
  onChange: (v: T) => void;
  onFinishedEditing: (v?: T) => void;
  initialValue: string;
}>;

function renderEditor(data: JsonCell["data"], onChange = vi.fn()) {
  const provided = jsonCellRenderer.provideEditor!({ data } as JsonCell) as unknown as {
    editor: EditorComponent<JsonCell>;
  };
  const Editor = provided.editor;
  const result = renderWithProviders(
    <Editor value={{ data } as JsonCell} onChange={onChange} onFinishedEditing={vi.fn()} initialValue="" />,
  );
  return { ...result, onChange };
}

describe("JsonCell editor", () => {
  it("seeds the textarea with the raw JSON text", () => {
    renderEditor({ kind: "json-cell", value: '{"a":1}' });
    const ta = document.querySelector("textarea")!;
    expect(ta).toHaveValue('{"a":1}');
  });

  it("shows an empty textarea for a (Null) value", () => {
    renderEditor({ kind: "json-cell", value: "(Null)" });
    const ta = document.querySelector("textarea")!;
    expect(ta).toHaveValue("");
  });

  it("propagates edited JSON through onChange", () => {
    const { onChange } = renderEditor({ kind: "json-cell", value: "{}" });
    const ta = document.querySelector("textarea")!;
    fireEvent.change(ta, { target: { value: '{"b":2}' } });
    expect(onChange.mock.calls[0][0].data.value).toBe('{"b":2}');
  });
});
