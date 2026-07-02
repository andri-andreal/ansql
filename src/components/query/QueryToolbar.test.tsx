// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import { installFakeBackend } from "../../test/fakeBackend";
import { makeConnection } from "../../test/fixtures";
import type { SessionInfo } from "../../types";
import QueryToolbar from "./QueryToolbar";

function fakeBackend(connections = [makeConnection()]) {
  // get_databases must yield an array; the component maps over it on render.
  return installFakeBackend({ connections }).on("get_databases", () => []);
}

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "sess-1",
    connection_id: "conn-1",
    database: "test",
    connected_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderToolbar(props: Partial<React.ComponentProps<typeof QueryToolbar>> = {}) {
  return renderWithProviders(
    <QueryToolbar
      sessions={[session()]}
      activeSessionId="sess-1"
      isExecuting={false}
      onExecute={() => {}}
      onCancel={() => {}}
      onSave={() => {}}
      onFormat={() => {}}
      onSessionChange={() => {}}
      {...props}
    />,
  );
}

describe("QueryToolbar", () => {
  it("shows Execute and runs onExecute when not executing", async () => {
    fakeBackend();
    const onExecute = vi.fn();
    const { user } = renderToolbar({ onExecute, isExecuting: false });
    const btn = screen.getByRole("button", { name: "Execute" });
    await user.click(btn);
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("shows Cancel and runs onCancel when executing", async () => {
    fakeBackend();
    const onCancel = vi.fn();
    const { user } = renderToolbar({ onCancel, isExecuting: true });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables the execute button when there is no active session", () => {
    fakeBackend();
    renderToolbar({ activeSessionId: null });
    expect(screen.getByRole("button", { name: "Execute" })).toBeDisabled();
  });

  it("renders optional Run All / Run Selected / Explain controls and wires callbacks", async () => {
    fakeBackend();
    const onRunAll = vi.fn();
    const onExplain = vi.fn();
    const { user } = renderToolbar({ onRunAll, onExplain, hasSelection: false });
    await user.click(screen.getByRole("button", { name: /Run All/ }));
    expect(onRunAll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /Explain/ }));
    expect(onExplain).toHaveBeenCalledTimes(1);
  });

  it("disables Run Selected until there is a selection", async () => {
    fakeBackend();
    const onRunSelected = vi.fn();
    renderToolbar({ onRunSelected, hasSelection: false });
    expect(screen.getByRole("button", { name: /Run Selected/ })).toBeDisabled();
  });

  it("opens the Ask AI menu and fires onAskAi with the chosen action", async () => {
    fakeBackend();
    const onAskAi = vi.fn();
    const { user } = renderToolbar({ onAskAi });
    await user.click(screen.getByRole("button", { name: /Ask AI/ }));
    await user.click(screen.getByRole("button", { name: "Optimize" }));
    expect(onAskAi).toHaveBeenCalledWith("optimize");
  });

  it("populates the connection selector from the backend", async () => {
    fakeBackend([makeConnection({ id: "conn-1", name: "Prod DB" })]);
    renderToolbar();
    expect(await screen.findByRole("option", { name: "Prod DB" })).toBeInTheDocument();
  });

  it("toggles history/favorites/snippet panels via their buttons", async () => {
    fakeBackend();
    const onToggleHistory = vi.fn();
    const onToggleFavorites = vi.fn();
    const onToggleSnippets = vi.fn();
    const { user } = renderToolbar({ onToggleHistory, onToggleFavorites, onToggleSnippets });
    await user.click(screen.getByTitle("Query History"));
    await user.click(screen.getByTitle("Saved Queries"));
    await user.click(screen.getByTitle("Snippets"));
    expect(onToggleHistory).toHaveBeenCalledTimes(1);
    expect(onToggleFavorites).toHaveBeenCalledTimes(1);
    expect(onToggleSnippets).toHaveBeenCalledTimes(1);
  });
});
