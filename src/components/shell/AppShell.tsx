// AppShell — the main layout: header + tab bar + workspace + modals + toaster.
// Consumes the entire useAppState object and renders nothing if the vault
// gate is still being checked (VaultGate handles that case).

import { useEffect } from "react";
import AppHeader from "../common/AppHeader";
import { WorkspaceTabBar } from "../workspace/WorkspaceTabBar";
import { WorkspaceArea } from "./WorkspaceArea";
import { ModalsLayer } from "./ModalsLayer";
import { useGlobalShortcuts } from "./VaultGate";
import { useToast } from "../ui";
import { PasteProvider, usePasteController } from "../../hooks/usePaste";
import { isFeatureEnabled } from "../../lib/edition";
import { PasteTransferModal } from "../transfer/PasteTransferModal";
import { JournalRecorderProvider } from "../../hooks/useActionJournal";
import type { AppState } from "../../hooks/useAppState";
import type { Connection, SessionInfo } from "../../types";

export function AppShell({ app }: { app: AppState }) {
  // Register global keyboard shortcuts (Ctrl/Cmd+W, Ctrl/Cmd+Shift+F).
  useGlobalShortcuts(app);

  return (
    // ToastProvider now lives above <App/> in main.tsx (useAppState needs it
    // during App's render), so the shell only needs a fragment here.
    <>
      <JournalShortcuts app={app} />
      <JournalRecorderProvider value={app.journal.recordAction}>
      <PasteProvider>
        <div className="h-screen flex flex-col bg-background text-foreground">
          {/* Portal for glide-data-grid overlay editor (kept for backward compat). */}
          <div id="portal" style={{ position: "fixed", left: 0, top: 0, zIndex: 9999 }} />

          <AppHeader
            theme={app.theme}
            onToggleTheme={app.toggleTheme}
            onOpenSettings={() => app.setShowSettings(true)}
            onToggleAi={() => {
              // Manual toggle opens a clean pane (no stale Ask AI seed replay).
              app.setShowAi((v) => !v);
            }}
            onToggleFocusMode={() => app.setFocusMode(!app.focusMode)}
            focusMode={app.focusMode}
            onToggleInfoPane={() => app.setShowInfo(!app.showInfo)}
            infoPaneOpen={app.showInfo}
            onOpenTimeline={() => app.setShowTimeline(true)}
            undoableCount={app.journal.undoableCount}
            onNewConnection={() => {
              app.setEditingConnection(undefined);
              app.setShowConnectionForm(true);
            }}
            onNewQuery={() => void app.handleNewQuery()}
            onOpenTable={() => {
              if (app.activeSession?.database)
                app.handleSelectTableList(app.activeSession.id, app.activeSession.database);
            }}
            onNewView={() => {
              if (app.activeSession?.database)
                app.handleNewView(app.activeSession.id, app.activeSession.database);
            }}
            onNewFunction={() => {
              if (app.activeSession?.database)
                app.handleNewRoutine(app.activeSession.id, app.activeSession.database, "function");
            }}
            onOpenUsers={() => {
              if (app.activeSession) app.handleOpenUsers(app.activeSession.id);
            }}
            onOpenTransfer={() => {
              if (app.activeSession?.database)
                app.handleTransferTables(app.activeSession.id, app.activeSession.database, []);
            }}
            onOpenStructureSync={() => {
              if (app.activeSession?.database)
                app.handleOpenStructureSync(app.activeSession.id, app.activeSession.database);
            }}
            onOpenModel={() => {
              if (app.activeSession?.database)
                app.handleOpenErd(app.activeSession.id, app.activeSession.database);
            }}
            onOpenBackup={() => {
              if (app.activeSession?.database)
                void app.handleOpenBackup(app.activeSession.id, app.activeSession.database);
            }}
            onOpenDashboards={() => app.handleOpenDashboards()}
            onExport={(format) => void app.handleHeaderExport(format)}
            onExportConnections={() => void app.handleExportConnections()}
            onImportConnections={() => void app.handleImportConnections()}
            canOpenTable={app.toolbar.canOpenTable}
            canOpenRoutine={app.canOpenRoutine}
            canManageUsers={app.canManageUsers}
            canTransfer={app.toolbar.canTransfer}
            canExport={app.toolbar.canExport}
          />

          <WorkspaceTabBar
            tabs={app.ws.tabs}
            activeId={app.ws.activeId}
            onActivate={app.ws.activateTab}
            onClose={app.ws.closeTab}
          />

          <WorkspaceArea app={app} />
          <ModalsLayer app={app} />
          {isFeatureEnabled("crossDbTransfer") && (
            <PasteHost sessions={app.sessionsList} connections={app.connections} />
          )}
        </div>
      </PasteProvider>
      </JournalRecorderProvider>
    </>
  );
}

/**
 * Time Machine global shortcuts:
 *   - Ctrl/Cmd+Alt+Z        → undo the most recent reversible action
 *   - Ctrl/Cmd+Alt+Shift+Z  → redo the most recent undone action
 *
 * Both replay against the active connection's session. Lives inside
 * ToastProvider so it can surface the outcome.
 */
function JournalShortcuts({ app }: { app: AppState }) {
  const toast = useToast();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      const connId = app.activeSession?.connection_id;
      const pending = e.shiftKey
        ? app.journal.redoLast(connId)
        : app.journal.undoLast(connId);
      if (!pending) {
        toast.info(e.shiftKey ? "Nothing to redo" : "Nothing to undo");
        return;
      }
      void pending.then((r) => {
        const verb = e.shiftKey ? "Redone" : "Undone";
        if (r.ok) {
          if (r.noop && r.noop > 0) {
            toast.warning(
              `${verb}, but ${r.noop} statement(s) matched no rows — the data may have changed since.`,
            );
          } else {
            toast.success(`Last action ${verb.toLowerCase()}`);
          }
        } else if (r.reason === "no-session") {
          toast.error(`Open a connection to that database to ${e.shiftKey ? "redo" : "undo"} this action.`);
        } else {
          toast.error(`${e.shiftKey ? "Redo" : "Undo"} failed: ${r.error ?? r.reason}`);
        }
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app.activeSession, app.journal, toast]);
  return null;
}

function PasteHost({ sessions, connections }: { sessions: SessionInfo[]; connections: Connection[] }) {
  const { pending, close } = usePasteController();
  if (!pending) return null;
  return (
    <PasteTransferModal
      clip={pending.clip}
      target={pending.target}
      sessions={sessions}
      connections={connections}
      onClose={close}
    />
  );
}
