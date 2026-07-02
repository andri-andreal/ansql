// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderWithProviders,
  screen,
  waitFor,
} from "@/test/render";
import { makeConnection } from "@/test/fixtures";
import type { ActionJournalApi } from "../../hooks/useActionJournal";
import type { ActionJournalEntry } from "../../types";
import { TimelinePanel } from "./TimelinePanel";

function makeEntry(
  overrides: Partial<ActionJournalEntry> = {},
): ActionJournalEntry {
  return {
    id: "e1",
    connection_id: "c1",
    database: "appdb",
    table: "users",
    kind: "raw_update",
    label: "UPDATE users SET name = 'x'",
    forward_sql: "[]",
    inverse_sql: "[]",
    tier: 1,
    status: "applied",
    affected_rows: 3,
    created_at: "2026-06-20T10:00:00.000Z",
    ...overrides,
  } as ActionJournalEntry;
}

function makeJournal(
  overrides: Partial<ActionJournalApi> = {},
): ActionJournalApi {
  const api = {
    entries: [],
    busy: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    undo: vi.fn().mockResolvedValue({ ok: true }),
    redo: vi.fn().mockResolvedValue({ ok: true }),
    clear: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return api as unknown as ActionJournalApi;
}

const connections = [
  makeConnection({ id: "c1", name: "Local MySQL" }),
  makeConnection({ id: "c2", name: "Prod Postgres" }),
];

describe("TimelinePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes on open and renders the empty state with no entries", async () => {
    const journal = makeJournal({ entries: [] });
    renderWithProviders(
      <TimelinePanel
        open
        onClose={() => {}}
        journal={journal}
        connections={connections}
        activeConnectionId="c1"
      />,
    );

    await waitFor(() => expect(journal.refresh).toHaveBeenCalled());
    expect(screen.getByText("Time Machine")).toBeInTheDocument();
    expect(
      screen.getByText(/No reversible actions yet/),
    ).toBeInTheDocument();
  });

  it("lists entries with label, tier badge and row count", () => {
    const journal = makeJournal({
      entries: [
        makeEntry({ id: "e1", label: "Edit users", tier: 1, affected_rows: 3 }),
        makeEntry({
          id: "e2",
          label: "Bulk delete",
          tier: 2,
          affected_rows: 10,
        }),
      ],
    });
    renderWithProviders(
      <TimelinePanel
        open
        onClose={() => {}}
        journal={journal}
        connections={connections}
        activeConnectionId="c1"
      />,
    );

    expect(screen.getByText("Edit users")).toBeInTheDocument();
    expect(screen.getByText("Bulk delete")).toBeInTheDocument();
    expect(screen.getByText("Reversible")).toBeInTheDocument();
    expect(screen.getByText("Best-effort")).toBeInTheDocument();
    // affected_rows rendered as "· 3 row(s)" inside the meta line.
    expect(screen.getByText(/3 row\(s\)/)).toBeInTheDocument();
  });

  it("calls journal.undo for an applied entry's Undo button", async () => {
    const journal = makeJournal({
      entries: [makeEntry({ id: "e1", status: "applied" })],
    });
    const { user } = renderWithProviders(
      <TimelinePanel
        open
        onClose={() => {}}
        journal={journal}
        connections={connections}
        activeConnectionId="c1"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() =>
      expect(journal.undo).toHaveBeenCalledTimes(1),
    );
    expect(vi.mocked(journal.undo).mock.calls[0][0].id).toBe("e1");
  });

  it("renders Redo (not Undo) for an undone entry and calls journal.redo", async () => {
    const journal = makeJournal({
      entries: [makeEntry({ id: "e1", status: "undone" })],
    });
    const { user } = renderWithProviders(
      <TimelinePanel
        open
        onClose={() => {}}
        journal={journal}
        connections={connections}
        activeConnectionId="c1"
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Undo/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Redo/ }));
    await waitFor(() =>
      expect(journal.redo).toHaveBeenCalledTimes(1),
    );
  });

  it("filters entries to the chosen connection via the filter dropdown", async () => {
    const journal = makeJournal({
      entries: [
        makeEntry({ id: "e1", label: "On c1", connection_id: "c1" }),
        makeEntry({ id: "e2", label: "On c2", connection_id: "c2" }),
      ],
    });
    const { user } = renderWithProviders(
      <TimelinePanel
        open
        onClose={() => {}}
        journal={journal}
        connections={connections}
        activeConnectionId="c1"
      />,
    );

    // Both visible under the default "All connections" filter.
    expect(screen.getByText("On c1")).toBeInTheDocument();
    expect(screen.getByText("On c2")).toBeInTheDocument();

    // Open the connection filter dropdown and pick Prod Postgres (c2).
    await user.click(
      screen.getByRole("button", { name: /Filter by connection/ }),
    );
    await user.click(await screen.findByText("Prod Postgres"));

    await waitFor(() => {
      expect(screen.queryByText("On c1")).not.toBeInTheDocument();
    });
    expect(screen.getByText("On c2")).toBeInTheDocument();
  });

  it("asks for confirmation before clearing, then calls journal.clear", async () => {
    const journal = makeJournal({
      entries: [makeEntry({ id: "e1" })],
    });
    const { user } = renderWithProviders(
      <TimelinePanel
        open
        onClose={() => {}}
        journal={journal}
        connections={connections}
        activeConnectionId="c1"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Clear/ }));
    // Confirm dialog appears.
    expect(
      await screen.findByText("Clear Time Machine history?"),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Clear history" }),
    );
    await waitFor(() => expect(journal.clear).toHaveBeenCalledTimes(1));
  });
});
