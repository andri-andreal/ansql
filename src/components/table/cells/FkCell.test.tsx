// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../../test/render";

// The FK editor fetches its option list on mount via fetchFkOptions, which goes
// to the backend. Stub it so the dropdown is deterministic.
const fetchFkOptions = vi.fn();
vi.mock("../../../lib/fkLookup", () => ({
  fetchFkOptions: (...args: unknown[]) => fetchFkOptions(...args),
}));

import type { ComponentType } from "react";
import { fkCellRenderer, type FkCell } from "./FkCell";

type EditorComponent<T> = ComponentType<{
  value: T;
  onChange: (v: T) => void;
  onFinishedEditing: (v?: T) => void;
  initialValue: string;
}>;

function renderEditor(data: FkCell["data"], onChange = vi.fn(), onFinishedEditing = vi.fn()) {
  const provided = fkCellRenderer.provideEditor!({ data } as FkCell) as unknown as {
    editor: EditorComponent<FkCell>;
  };
  const Editor = provided.editor;
  const result = renderWithProviders(
    <Editor value={{ data } as FkCell} onChange={onChange} onFinishedEditing={onFinishedEditing} initialValue="" />,
  );
  return { ...result, onChange, onFinishedEditing };
}

const base: FkCell["data"] = {
  kind: "fk-cell",
  value: "1",
  nullable: false,
  sessionId: "s1",
  database: "db",
  schema: null,
  target: { localColumn: "org_id", referencedTable: "orgs", valueColumn: "id" },
  labelColumn: "name",
};

beforeEach(() => {
  fetchFkOptions.mockReset();
});

describe("FkCell editor", () => {
  it("renders the fetched referenced rows as options with their labels", async () => {
    fetchFkOptions.mockResolvedValue([
      { value: "1", label: "Acme" },
      { value: "2", label: "Globex" },
    ]);
    renderEditor(base);
    expect(await screen.findByRole("button", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Globex" })).toBeInTheDocument();
  });

  it("selecting an option commits its value via onChange + onFinishedEditing", async () => {
    fetchFkOptions.mockResolvedValue([{ value: "2", label: "Globex" }]);
    const { user, onChange, onFinishedEditing } = renderEditor(base);
    await user.click(await screen.findByRole("button", { name: "Globex" }));
    expect(onChange.mock.calls[0][0].data.value).toBe("2");
    expect(onFinishedEditing.mock.calls[0][0].data.value).toBe("2");
  });

  it("offers a (Null) option for nullable columns and commits empty on click", async () => {
    fetchFkOptions.mockResolvedValue([]);
    const { user, onFinishedEditing } = renderEditor({ ...base, nullable: true });
    const nullBtn = await screen.findByText("(Null)");
    await user.click(nullBtn);
    expect(onFinishedEditing.mock.calls[0][0].data.value).toBe("");
  });

  it("shows the referenced table in the search placeholder", async () => {
    fetchFkOptions.mockResolvedValue([]);
    renderEditor(base);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Search orgs…")).toBeInTheDocument(),
    );
  });

  it("surfaces a fetch error in the dropdown", async () => {
    fetchFkOptions.mockRejectedValue(new Error("boom"));
    renderEditor(base);
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
