// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders, screen, within, waitFor } from "../../test/render";
import { makeConnection } from "../../test/fixtures";
import { installFakeBackend } from "../../test/fakeBackend";
import { PasteProvider } from "../../hooks/usePaste";
import type { Connection, SessionInfo } from "../../types";
import DatabaseExplorer from "./DatabaseExplorer";

type Props = React.ComponentProps<typeof DatabaseExplorer>;

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    connections: [],
    groups: [],
    sessions: [],
    activeSessionId: null,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onEditConnection: vi.fn(),
    onDeleteConnection: vi.fn(),
    onSelectTable: vi.fn(),
    getTables: vi.fn().mockResolvedValue([]),
    getDatabases: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function renderExplorer(overrides: Partial<Props> = {}) {
  const props = baseProps(overrides);
  const result = renderWithProviders(
    <PasteProvider>
      <DatabaseExplorer {...props} />
    </PasteProvider>,
  );
  return { ...result, props };
}

// Expand a collapsed tree node by clicking the toggle chevron in its row.
async function expandRow(user: ReturnType<typeof renderExplorer>["user"], label: string) {
  const row = screen.getByText(label).closest("div")!;
  const toggle = within(row).getAllByRole("button")[0];
  await user.click(toggle);
}

beforeEach(() => {
  localStorage.clear();
  // useGroups/useConnections call invoke on mount; keep them inert + array-shaped.
  installFakeBackend().on("get_groups", () => []);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DatabaseExplorer", () => {
  it("renders the header, search box, and the 'My Connections' root with no connections", () => {
    renderExplorer();
    expect(screen.getByText("Explorer")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search objects…")).toBeInTheDocument();
    // The tree always renders its root node; with no connections it is empty.
    expect(screen.getByText("My Connections")).toBeInTheDocument();
  });

  it("renders the connection tree root and expands to show a connection", async () => {
    const conn = makeConnection({ id: "c1", name: "Prod MySQL", driver: "mysql" });
    const { user } = renderExplorer({ connections: [conn] });

    expect(screen.getByText("My Connections")).toBeInTheDocument();
    // Connections live under the collapsed root.
    expect(screen.queryByText("Prod MySQL")).not.toBeInTheDocument();

    await expandRow(user, "My Connections");
    expect(screen.getByText("Prod MySQL")).toBeInTheDocument();
  });

  it("double-clicking a Redis connection leaf calls onOpenRedis (not onConnect)", async () => {
    const conn = makeConnection({ id: "r1", name: "Cache", driver: "redis" });
    const onOpenRedis = vi.fn();
    const onConnect = vi.fn();
    const { user } = renderExplorer({ connections: [conn], onOpenRedis, onConnect });

    await expandRow(user, "My Connections");
    await user.dblClick(screen.getByText("Cache"));

    expect(onOpenRedis).toHaveBeenCalledTimes(1);
    expect(onOpenRedis).toHaveBeenCalledWith(conn);
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("double-clicking a MongoDB connection leaf calls onOpenMongo", async () => {
    const conn = makeConnection({ id: "m1", name: "Docs", driver: "mongodb" });
    const onOpenMongo = vi.fn();
    const { user } = renderExplorer({ connections: [conn], onOpenMongo });

    await expandRow(user, "My Connections");
    await user.dblClick(screen.getByText("Docs"));

    expect(onOpenMongo).toHaveBeenCalledTimes(1);
    expect(onOpenMongo).toHaveBeenCalledWith(conn);
  });

  it("double-clicking an unconnected SQL connection calls onConnect", async () => {
    const conn = makeConnection({ id: "p1", name: "Postgres One", driver: "postgres" });
    const onConnect = vi.fn();
    const { user } = renderExplorer({ connections: [conn], onConnect });

    await expandRow(user, "My Connections");
    await user.dblClick(screen.getByText("Postgres One"));

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith(conn);
  });

  it("right-clicking a SQL connection opens a context menu with Connect/Edit/Delete", async () => {
    const conn = makeConnection({ id: "p1", name: "Postgres One", driver: "postgres" });
    const onEditConnection = vi.fn();
    const { user } = renderExplorer({ connections: [conn], onEditConnection });

    await expandRow(user, "My Connections");
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Postgres One") });

    expect(screen.getByText("Connect")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();

    await user.click(screen.getByText("Edit"));
    expect(onEditConnection).toHaveBeenCalledWith(conn);
  });

  it("context menu Connect on a Redis connection routes to onOpenRedis", async () => {
    const conn = makeConnection({ id: "r1", name: "Cache", driver: "redis" });
    const onOpenRedis = vi.fn();
    const { user } = renderExplorer({ connections: [conn], onOpenRedis });

    await expandRow(user, "My Connections");
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Cache") });
    await user.click(screen.getByText("Connect"));

    expect(onOpenRedis).toHaveBeenCalledWith(conn);
  });

  it("filters the tree by the search query and shows 'No matches' when nothing matches", async () => {
    const conns: Connection[] = [
      makeConnection({ id: "a", name: "Alpha DB", driver: "mysql" }),
      makeConnection({ id: "b", name: "Beta DB", driver: "mysql" }),
    ];
    const { user } = renderExplorer({ connections: conns });

    const search = screen.getByPlaceholderText("Search objects…");
    await user.type(search, "Alpha");

    // Matching branch is force-expanded; only the match shows.
    await waitFor(() => expect(screen.getByText("Alpha DB")).toBeInTheDocument());
    expect(screen.queryByText("Beta DB")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzzz-nope");
    await waitFor(() => expect(screen.getByText("No matches")).toBeInTheDocument());
  });

  it("a connected session auto-expands to show its databases", async () => {
    const conn = makeConnection({ id: "c1", name: "Live MySQL", driver: "mysql" });
    const session: SessionInfo = {
      id: "s1",
      connection_id: "c1",
      connected_at: "2026-01-01T00:00:00Z",
    };
    const getDatabases = vi.fn().mockResolvedValue(["app_db"]);
    const { user } = renderExplorer({
      connections: [conn],
      sessions: [session],
      activeSessionId: "s1",
      getDatabases,
    });

    await waitFor(() => expect(getDatabases).toHaveBeenCalledWith("s1"));

    // The connected session node auto-expands, so its database shows once the
    // connection row is visible — no manual expand of "Live MySQL" needed.
    await expandRow(user, "My Connections");
    await waitFor(() => expect(screen.getByText("Live MySQL")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("app_db")).toBeInTheDocument());
  });
});
