// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { installFakeBackend } from "@/test/fakeBackend";
import type { FavoriteQueryEntry } from "@/lib/queryPanelCommands";
import SavedQueriesPanel from "./SavedQueriesPanel";

function makeFav(over: Partial<FavoriteQueryEntry> = {}): FavoriteQueryEntry {
  return {
    id: "f1",
    name: "Active users",
    description: "users seen recently",
    connection_id: "conn-1",
    query: "SELECT * FROM users WHERE active = 1",
    created_at: "2026-06-20T10:00:00.000Z",
    updated_at: "2026-06-20T10:00:00.000Z",
    ...over,
  };
}

describe("SavedQueriesPanel", () => {
  it("shows the empty state when there are no saved queries", async () => {
    installFakeBackend({ handlers: { get_favorite_queries: () => [] } });
    renderWithProviders(
      <SavedQueriesPanel connectionId="conn-1" onLoadQuery={vi.fn()} onClose={vi.fn()} />
    );
    await waitFor(() =>
      expect(screen.getByText("No saved queries yet.")).toBeInTheDocument()
    );
  });

  it("lists favorites with name + description and loads SQL on click", async () => {
    const onLoadQuery = vi.fn();
    installFakeBackend({
      handlers: { get_favorite_queries: () => [makeFav()] },
    });
    const { user } = renderWithProviders(
      <SavedQueriesPanel connectionId="conn-1" onLoadQuery={onLoadQuery} onClose={vi.fn()} />
    );

    await waitFor(() =>
      expect(screen.getByText("Active users")).toBeInTheDocument()
    );
    expect(screen.getByText("users seen recently")).toBeInTheDocument();

    await user.click(screen.getByText("Active users"));
    expect(onLoadQuery).toHaveBeenCalledWith("SELECT * FROM users WHERE active = 1");
  });

  it("filters out favorites bound to a different connection", async () => {
    installFakeBackend({
      handlers: {
        get_favorite_queries: () => [
          makeFav({ id: "f1", name: "Mine", connection_id: "conn-1" }),
          makeFav({ id: "f2", name: "Theirs", connection_id: "conn-2" }),
          makeFav({ id: "f3", name: "Global", connection_id: undefined }),
        ],
      },
    });
    renderWithProviders(
      <SavedQueriesPanel connectionId="conn-1" onLoadQuery={vi.fn()} onClose={vi.fn()} />
    );

    await waitFor(() => expect(screen.getByText("Mine")).toBeInTheDocument());
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.queryByText("Theirs")).not.toBeInTheDocument();
  });

  it("delete button invokes delete_favorite_query and removes the item", async () => {
    const fake = installFakeBackend({
      handlers: { get_favorite_queries: () => [makeFav({ id: "f1", name: "Active users" })] },
    });
    const { user } = renderWithProviders(
      <SavedQueriesPanel connectionId="conn-1" onLoadQuery={vi.fn()} onClose={vi.fn()} />
    );
    await waitFor(() =>
      expect(screen.getByText("Active users")).toBeInTheDocument()
    );

    await user.click(screen.getByTitle("Delete"));
    await waitFor(() =>
      expect(fake.calls.some((c) => c.cmd === "delete_favorite_query")).toBe(true)
    );
    expect(
      fake.calls.find((c) => c.cmd === "delete_favorite_query")?.args.id
    ).toBe("f1");
    await waitFor(() =>
      expect(screen.queryByText("Active users")).not.toBeInTheDocument()
    );
  });

  it("close button fires onClose", async () => {
    const onClose = vi.fn();
    installFakeBackend({ handlers: { get_favorite_queries: () => [] } });
    const { user } = renderWithProviders(
      <SavedQueriesPanel connectionId="conn-1" onLoadQuery={vi.fn()} onClose={onClose} />
    );
    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
