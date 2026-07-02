import { useEffect } from "react";
import { VaultUnlockDialog } from "../common/VaultUnlockDialog";
import type { AppState } from "../../hooks/useAppState";

/**
 * Holds the first paint until the vault mode check resolves, then blocks the
 * app behind the unlock dialog when running in 'master' mode. Returns null
 * once the vault is unlocked (the caller renders the main shell).
 */
export function VaultGate({ app }: { app: AppState }) {
  // Block the first paint of the main UI until the gate check resolves.
  if (!app.vaultGateChecked) {
    return <div className="h-screen bg-background" aria-hidden="true" />;
  }
  if (app.vaultLocked) {
    return (
      <VaultUnlockDialog
        onUnlock={app.handleVaultUnlock}
        onReset={app.handleVaultReset}
        error={app.unlockError}
        busy={app.unlockBusy}
      />
    );
  }
  return null;
}

/**
 * Registers the global keyboard shortcuts the app shell uses:
 *   Ctrl/Cmd+W   → close active tab
 *   Ctrl/Cmd+Shift+F → toggle Focus Mode
 */
export function useGlobalShortcuts(app: AppState) {
  const { activeId, closeTab } = app.ws;
  // Close active tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        if (activeId) {
          e.preventDefault();
          closeTab(activeId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, closeTab]);

  // Toggle focus mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        app.setFocusMode(!app.focusMode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app.focusMode, app]);
}
