// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { installFakeBackend } from "@/test/fakeBackend";
import type { QueryHistoryEntry } from "@/lib/queryPanelCommands";
import HistoryPanel from "./HistoryPanel";

function makeEntry(over: Partial<QueryHistoryEntry> = {}): QueryHistoryEntry {
  return {
    id: "h1",
    connection_id: "conn-1",
    query: "SELECT * FROM users",
    execution_time_ms: 12,
    row_count: 3,
    success: true,
    created_at: "2026-06-20T10:00:00.000Z",
    ...over,
  };
}

describe("HistoryPanel", () => {
  it("prompts to select a connection when none is active", () => {
    installFakeBackend();
    renderWithProviders(
      <HistoryPanel connectionId={null} onLoadQuery={vi.fn()} onClose={vi.fn()} />
    );
    expect(
      screen.getByText("Select a connection to view its history.")
    ).toBeInTheDocument();
  });

  it("shows the empty state when the connection has no history", async () => {
    installFakeBackend({ handlers: { get_query_history: () => [] } });
    renderWithProviders(
      <HistoryPanel connectionId="conn-1" onLoadQuery={vi.fn()} onClose={vi.fn()} />
    );
    await waitFor(() =>
      expect(screen.getByText("No query history yet.")).toBeInTheDocument()
    );
  });

  it("lists history entries and loads one on click", async () => {
    const onLoadQuery = vi.fn();
    installFakeBackend({
      handlers: {
        get_query_history: () => [
          makeEntry({ id: "h1", query: "SELECT * FROM users", row_count: 3 }),
          makeEntry({
            id: "h2",
            query: "DROP TABLE bad",
            success: false,
            row_count: undefined,
            error_message: "permission denied",
          }),
        ],
      },
    });
    const { user } = renderWithProviders(
      <HistoryPanel connectionId="conn-1" onLoadQuery={onLoadQuery} onClose={vi.fn()} />
    );

    await waitFor(() =>
      expect(screen.getByText("SELECT * FROM users")).toBeInTheDocument()
    );
    // Failed entry surfaces its error message.
    expect(screen.getByText("permission denied")).toBeInTheDocument();
    // Row count rendered for the successful entry.
    expect(screen.getByText("3 rows")).toBeInTheDocument();

    await user.click(screen.getByText("SELECT * FROM users"));
    expect(onLoadQuery).toHaveBeenCalledWith("SELECT * FROM users");
  });

  it("clear button invokes clear_query_history for the connection", async () => {
    const fake = installFakeBackend({
      handlers: { get_query_history: () => [makeEntry()] },
    });
    const { user } = renderWithProviders(
      <HistoryPanel connectionId="conn-1" onLoadQuery={vi.fn()} onClose={vi.fn()} />
    );
    await waitFor(() =>
      expect(screen.getByText("SELECT * FROM users")).toBeInTheDocument()
    );

    await user.click(screen.getByTitle("Clear history"));
    await waitFor(() =>
      expect(fake.calls.some((c) => c.cmd === "clear_query_history")).toBe(true)
    );
    const call = fake.calls.find((c) => c.cmd === "clear_query_history");
    expect(call?.args.connectionId).toBe("conn-1");
    // List empties after clearing.
    await waitFor(() =>
      expect(screen.getByText("No query history yet.")).toBeInTheDocument()
    );
  });

  it("close button fires onClose", async () => {
    const onClose = vi.fn();
    installFakeBackend({ handlers: { get_query_history: () => [] } });
    const { user } = renderWithProviders(
      <HistoryPanel connectionId="conn-1" onLoadQuery={vi.fn()} onClose={onClose} />
    );
    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
