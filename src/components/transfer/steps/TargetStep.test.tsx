// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../../test/render";
import { installFakeBackend } from "../../../test/fakeBackend";
import { makeConnection } from "../../../test/fixtures";
import type { Connection, SessionInfo } from "../../../types";
import type { TargetSel } from "../TransferWizard";
import { TargetStep } from "./TargetStep";

const connections: Connection[] = [
  makeConnection({ id: "c1", name: "Prod DB" }),
  makeConnection({ id: "c2", name: "Staging DB" }),
];

const sessions: SessionInfo[] = [
  { id: "src", connection_id: "c1", database: "app", connected_at: "x" },
  { id: "tgt", connection_id: "c2", database: "staging", connected_at: "x" },
];

describe("TargetStep", () => {
  it("offers the .sql-file option and the other (non-source) session", () => {
    renderWithProviders(
      <TargetStep
        sessions={sessions}
        connections={connections}
        sourceSessionId="src"
        value={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Target connection")).toBeInTheDocument();
    expect(screen.getByText("File (.sql script)")).toBeInTheDocument();
    // The target session is shown; the source session is excluded.
    expect(screen.getByText("Staging DB / staging")).toBeInTheDocument();
    expect(screen.queryByText("Prod DB / app")).toBeNull();
  });

  it("selecting the file option emits a sql-file target", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <TargetStep
        sessions={sessions}
        connections={connections}
        sourceSessionId="src"
        value={null}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByRole("combobox"), "File (.sql script)");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "sql-file" }),
    );
  });

  it("selecting a live session emits a session target with its database", async () => {
    installFakeBackend();
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <TargetStep
        sessions={sessions}
        connections={connections}
        sourceSessionId="src"
        value={null}
        onChange={onChange}
      />,
    );
    await user.selectOptions(
      screen.getByRole("combobox"),
      "Staging DB / staging",
    );
    expect(onChange).toHaveBeenCalledWith({
      kind: "session",
      sessionId: "tgt",
      database: "staging",
      schema: null,
    });
  });

  it("shows the database picker (loaded via get_databases) once a session target is chosen", async () => {
    const fake = installFakeBackend();
    fake.on("get_databases", () => ["staging", "analytics"]);
    const value: TargetSel = {
      kind: "session",
      sessionId: "tgt",
      database: "staging",
      schema: null,
    };
    renderWithProviders(
      <TargetStep
        sessions={sessions}
        connections={connections}
        sourceSessionId="src"
        value={value}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Target database")).toBeInTheDocument();
    await waitFor(() => {
      expect(fake.calls.some((c) => c.cmd === "get_databases")).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText("analytics")).toBeInTheDocument();
    });
  });

  it("warns when there is no other session to target", () => {
    renderWithProviders(
      <TargetStep
        sessions={[sessions[0]]}
        connections={connections}
        sourceSessionId="src"
        value={null}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/No other connected session/i),
    ).toBeInTheDocument();
  });
});
