// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { installFakeBackend } from "../../test/fakeBackend";
import AppHeader from "./AppHeader";

function makeProps(
  overrides: Partial<React.ComponentProps<typeof AppHeader>> = {},
): React.ComponentProps<typeof AppHeader> {
  return {
    theme: "light",
    onToggleTheme: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleAi: vi.fn(),
    onToggleFocusMode: vi.fn(),
    focusMode: false,
    onToggleInfoPane: vi.fn(),
    infoPaneOpen: false,
    onOpenTimeline: vi.fn(),
    undoableCount: 0,
    onNewConnection: vi.fn(),
    onNewQuery: vi.fn(),
    onOpenTable: vi.fn(),
    onNewView: vi.fn(),
    onNewFunction: vi.fn(),
    onOpenUsers: vi.fn(),
    onOpenTransfer: vi.fn(),
    onOpenStructureSync: vi.fn(),
    onOpenModel: vi.fn(),
    onOpenBackup: vi.fn(),
    onOpenDashboards: vi.fn(),
    onExport: vi.fn(),
    onExportConnections: vi.fn(),
    onImportConnections: vi.fn(),
    canOpenTable: true,
    canOpenRoutine: true,
    canManageUsers: true,
    canTransfer: true,
    canExport: true,
    ...overrides,
  };
}

function renderHeader(
  overrides: Partial<React.ComponentProps<typeof AppHeader>> = {},
) {
  installFakeBackend();
  const props = makeProps(overrides);
  return { props, ...renderWithProviders(<AppHeader {...props} />) };
}

describe("AppHeader", () => {
  it("fires onOpenSettings, onToggleAi, and onToggleInfoPane from the brand-bar buttons", async () => {
    const { props, user } = renderHeader();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "AI Assistant" }));
    await user.click(screen.getByRole("button", { name: "Information pane" }));

    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(props.onToggleAi).toHaveBeenCalledTimes(1);
    expect(props.onToggleInfoPane).toHaveBeenCalledTimes(1);
  });

  it("offers Switch to dark mode in light theme and fires onToggleTheme", async () => {
    const { props, user } = renderHeader({ theme: "light" });

    const btn = screen.getByRole("button", { name: "Switch to dark mode" });
    await user.click(btn);
    expect(props.onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("shows the Focus Mode enter label and fires onToggleFocusMode", async () => {
    const { props, user } = renderHeader({ focusMode: false });

    await user.click(
      screen.getByRole("button", { name: "Focus Mode (Ctrl/Cmd+Shift+F)" }),
    );
    expect(props.onToggleFocusMode).toHaveBeenCalledTimes(1);
  });

  it("fires onNewConnection and onNewQuery from the module ribbon", async () => {
    const { props, user } = renderHeader();

    await user.click(screen.getByRole("button", { name: "Connection" }));
    await user.click(screen.getByRole("button", { name: "New Query" }));

    expect(props.onNewConnection).toHaveBeenCalledTimes(1);
    expect(props.onNewQuery).toHaveBeenCalledTimes(1);
  });

  it("disables the Table module when canOpenTable is false and does not fire its handler", async () => {
    const { props, user } = renderHeader({ canOpenTable: false });

    const tableBtn = screen.getByRole("button", { name: "Table" });
    expect(tableBtn).toBeDisabled();
    await user.click(tableBtn);
    expect(props.onOpenTable).not.toHaveBeenCalled();
  });

  it("opens the export format menu and fires onExport with the chosen format", async () => {
    const { props, user } = renderHeader({ canExport: true });

    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByText("JSON (.json)"));

    expect(props.onExport).toHaveBeenCalledWith("json");
  });

  it("opens the connections menu and fires onExportConnections / onImportConnections", async () => {
    const { props, user } = renderHeader();

    await user.click(
      screen.getByRole("button", { name: "Import / export connections" }),
    );
    await user.click(screen.getByText("Export connections…"));
    expect(props.onExportConnections).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText("Import connections…"));
    expect(props.onImportConnections).toHaveBeenCalledTimes(1);
  });

  it("shows the undoable-count badge and fires onOpenTimeline", async () => {
    const { props, user } = renderHeader({ undoableCount: 3 });

    expect(screen.getByText("3")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Time Machine — 3 undoable" }),
    );
    expect(props.onOpenTimeline).toHaveBeenCalledTimes(1);
  });

  it("reflects the vault lock state from the backend (device key → unlocked)", async () => {
    installFakeBackend({ handlers: { is_vault_locked: () => false } });
    renderWithProviders(<AppHeader {...makeProps()} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Vault is unlocked — click to lock" }),
      ).toBeInTheDocument();
    });
  });
});
