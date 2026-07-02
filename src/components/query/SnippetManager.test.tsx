// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { SnippetManager } from "./SnippetManager";

beforeEach(() => {
  localStorage.clear();
});

function seedSnippets(snippets: unknown[]) {
  localStorage.setItem("ansql.snippets", JSON.stringify(snippets));
}

describe("SnippetManager", () => {
  it("shows the empty state when there are no snippets", () => {
    renderWithProviders(<SnippetManager onClose={vi.fn()} />);
    expect(
      screen.getByText("No snippets yet. Use the + button to add one.")
    ).toBeInTheDocument();
  });

  it("lists persisted snippets with name, description and body preview", () => {
    seedSnippets([
      {
        id: "s1",
        name: "Recent orders",
        body: "SELECT * FROM orders ORDER BY created_at DESC",
        description: "last orders",
      },
    ]);
    renderWithProviders(<SnippetManager onClose={vi.fn()} />);
    expect(screen.getByText("Recent orders")).toBeInTheDocument();
    expect(screen.getByText("last orders")).toBeInTheDocument();
    expect(
      screen.getByText("SELECT * FROM orders ORDER BY created_at DESC")
    ).toBeInTheDocument();
  });

  it("adds a new snippet via the form", async () => {
    const { user } = renderWithProviders(<SnippetManager onClose={vi.fn()} />);

    await user.click(screen.getByTitle("New snippet"));
    await user.type(screen.getByPlaceholderText("e.g. Select all"), "Count rows");
    await user.type(
      screen.getByPlaceholderText("SELECT * FROM ..."),
      "SELECT COUNT(*) FROM t"
    );

    const addBtn = screen.getByRole("button", { name: "Add" });
    expect(addBtn).toBeEnabled();
    await user.click(addBtn);

    await waitFor(() =>
      expect(screen.getByText("Count rows")).toBeInTheDocument()
    );
    expect(screen.getByText("SELECT COUNT(*) FROM t")).toBeInTheDocument();
    // Persisted to localStorage.
    const stored = JSON.parse(localStorage.getItem("ansql.snippets") ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Count rows");
  });

  it("disables the save button until name and body are both filled", async () => {
    const { user } = renderWithProviders(<SnippetManager onClose={vi.fn()} />);
    await user.click(screen.getByTitle("New snippet"));

    const addBtn = screen.getByRole("button", { name: "Add" });
    expect(addBtn).toBeDisabled();

    await user.type(screen.getByPlaceholderText("e.g. Select all"), "OnlyName");
    expect(addBtn).toBeDisabled();

    await user.type(
      screen.getByPlaceholderText("SELECT * FROM ..."),
      "SELECT 1"
    );
    expect(addBtn).toBeEnabled();
  });

  it("inserts a snippet body via onInsert", async () => {
    const onInsert = vi.fn();
    seedSnippets([{ id: "s1", name: "Greeting", body: "SELECT 'hi'" }]);
    const { user } = renderWithProviders(
      <SnippetManager onClose={vi.fn()} onInsert={onInsert} />
    );

    await user.click(screen.getByTitle("Insert into editor"));
    expect(onInsert).toHaveBeenCalledWith("SELECT 'hi'");
  });

  it("deletes a snippet", async () => {
    seedSnippets([{ id: "s1", name: "ToDelete", body: "SELECT 1" }]);
    const { user } = renderWithProviders(<SnippetManager onClose={vi.fn()} />);
    expect(screen.getByText("ToDelete")).toBeInTheDocument();

    await user.click(screen.getByTitle("Delete"));
    await waitFor(() =>
      expect(screen.queryByText("ToDelete")).not.toBeInTheDocument()
    );
  });

  it("edits an existing snippet", async () => {
    seedSnippets([{ id: "s1", name: "OldName", body: "SELECT 1" }]);
    const { user } = renderWithProviders(<SnippetManager onClose={vi.fn()} />);

    await user.click(screen.getByTitle("Edit"));
    const nameInput = screen.getByPlaceholderText("e.g. Select all");
    await user.clear(nameInput);
    await user.type(nameInput, "NewName");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("NewName")).toBeInTheDocument()
    );
    expect(screen.queryByText("OldName")).not.toBeInTheDocument();
  });

  it("close button fires onClose", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<SnippetManager onClose={onClose} />);
    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
