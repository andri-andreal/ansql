// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  within,
  waitFor,
} from "@/test/render";
import { makeQueryResult } from "@/test/fixtures";
import { ServerMonitorView } from "./ServerMonitorView";

describe("ServerMonitorView", () => {
  it("renders the SQLite not-supported notice and never queries", () => {
    const executeQuery = vi.fn();
    renderWithProviders(
      <ServerMonitorView
        sessionId="s1"
        dialect="sqlite"
        executeQuery={executeQuery}
      />,
    );

    expect(
      screen.getByText("Server monitoring is not supported for SQLite."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "SQLite is an embedded engine with no server process to monitor.",
      ),
    ).toBeInTheDocument();
    // No tabs, no refresh, and crucially no backend call.
    expect(executeQuery).not.toHaveBeenCalled();
    expect(screen.queryByText("Processes")).not.toBeInTheDocument();
  });

  it("loads the process list on mount and renders rows with a Kill action", async () => {
    const result = makeQueryResult({
      columns: [
        { name: "Id", data_type: "int", nullable: false },
        { name: "User", data_type: "text", nullable: false },
      ],
      rows: [{ Id: 42, User: "root" }],
    });
    const executeQuery = vi.fn().mockResolvedValue(result);

    renderWithProviders(
      <ServerMonitorView
        sessionId="s1"
        dialect="mysql"
        executeQuery={executeQuery}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("root")).toBeInTheDocument();
    });
    // Header column + cell value present.
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    // Processes is the default tab and uses the process-list query.
    expect(executeQuery).toHaveBeenCalledWith("s1", "SHOW FULL PROCESSLIST");
    // Per-row Kill button is offered (Id column present for mysql).
    expect(screen.getByRole("button", { name: /Kill/ })).toBeInTheDocument();
  });

  it("issues a KILL then refreshes when the Kill button is clicked", async () => {
    const result = makeQueryResult({
      columns: [{ name: "Id", data_type: "int", nullable: false }],
      rows: [{ Id: 42 }],
    });
    const executeQuery = vi.fn().mockResolvedValue(result);

    const { user } = renderWithProviders(
      <ServerMonitorView
        sessionId="s1"
        dialect="mysql"
        executeQuery={executeQuery}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Kill/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Kill/ }));

    await waitFor(() => {
      const killCalls = executeQuery.mock.calls.filter(
        (c) => c[1] === "KILL 42",
      );
      expect(killCalls.length).toBe(1);
    });
  });

  it("switches tabs and runs the matching query", async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValue(makeQueryResult({ rows: [] }));

    const { user } = renderWithProviders(
      <ServerMonitorView
        sessionId="s1"
        dialect="mysql"
        executeQuery={executeQuery}
      />,
    );

    // Wait for initial processes load.
    await waitFor(() => expect(executeQuery).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Status" }));

    await waitFor(() => {
      const lastSql =
        executeQuery.mock.calls[executeQuery.mock.calls.length - 1][1];
      expect(lastSql).toBe("SHOW STATUS");
    });
  });

  it("surfaces a query error in the body", async () => {
    const executeQuery = vi
      .fn()
      .mockRejectedValue(new Error("connection refused"));

    renderWithProviders(
      <ServerMonitorView
        sessionId="s1"
        dialect="postgres"
        executeQuery={executeQuery}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("connection refused")).toBeInTheDocument();
    });
  });

  it("shows the empty state when a tab returns no rows", async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValue(makeQueryResult({ rows: [] }));

    renderWithProviders(
      <ServerMonitorView
        sessionId="s1"
        dialect="postgres"
        executeQuery={executeQuery}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("No rows.")).toBeInTheDocument();
    });
  });

  it("invokes onClose from the header close button", async () => {
    const onClose = vi.fn();
    const executeQuery = vi
      .fn()
      .mockResolvedValue(makeQueryResult({ rows: [] }));

    const { user } = renderWithProviders(
      <ServerMonitorView
        sessionId="s1"
        dialect="mysql"
        executeQuery={executeQuery}
        onClose={onClose}
      />,
    );

    const header = screen.getByText("Server Monitor").closest("div")!;
    await user.click(within(header).getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
