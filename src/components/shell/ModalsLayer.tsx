// ModalsLayer — renders every modal/drawer the app can show.
// Each modal is conditionally mounted on its own state, so the parent doesn't
// have to juggle visibility flags.

import { X } from "lucide-react";
import ConnectionForm, { type ConnectionSecrets } from "../connection/ConnectionForm";
import PreferencesDialog from "../common/PreferencesDialog";
import ExportOptionsDialog from "../common/ExportOptionsDialog";
import { UserManager } from "../user/UserManager";
import { BackupDumpModal } from "../backup/BackupDumpModal";
import { ExecuteSqlFileModal } from "../backup/ExecuteSqlFileModal";
import { TimelinePanel } from "../journal/TimelinePanel";
import type { AppState } from "../../hooks/useAppState";

export function ModalsLayer({ app }: { app: AppState }) {
  return (
    <>
      <TimelinePanel
        open={app.showTimeline}
        onClose={() => app.setShowTimeline(false)}
        journal={app.journal}
        connections={app.connections}
        activeConnectionId={app.activeSession?.connection_id ?? null}
      />

      {app.showConnectionForm && (
        <ConnectionForm
          connection={app.editingConnection}
          onSave={app.handleSaveConnection}
          onCancel={() => {
            app.setShowConnectionForm(false);
            app.setEditingConnection(undefined);
          }}
          onTest={app.handleTest}
        />
      )}

      {app.showSettings && <PreferencesDialog onClose={() => app.setShowSettings(false)} />}

      {app.exportTextDialog && (
        <ExportOptionsDialog
          format={app.exportTextDialog}
          onConfirm={app.handleExportTextConfirm}
          onClose={() => app.setExportTextDialog(null)}
        />
      )}

      {app.userManager && (
        <UserManager
          dialect={app.userManager.dialect}
          runQuery={(sql) => app.executeQuery(app.userManager!.sessionId, sql)}
          onClose={() => app.setUserManager(null)}
        />
      )}

      {app.backupState && (
        <BackupDumpModal
          sessionId={app.backupState.sessionId}
          database={app.backupState.database}
          schema={app.backupState.schema}
          dialect={app.backupState.dialect}
          tables={app.backupState.tables}
          getColumns={app.getColumns}
          getIndexes={app.getIndexes}
          getForeignKeys={app.getForeignKeys}
          executeQuery={app.executeQuery}
          onClose={() => app.setBackupState(null)}
        />
      )}

      {app.executeSqlFileState && (
        <ExecuteSqlFileModal
          sessionId={app.executeSqlFileState.sessionId}
          title={app.executeSqlFileState.title}
          executeQuery={app.executeQuery}
          commitChanges={app.commitChangesForModal}
          onClose={() => app.setExecuteSqlFileState(null)}
        />
      )}

      {app.connectError && <ConnectionErrorToast message={app.connectError} onDismiss={() => app.setConnectError(null)} />}
    </>
  );
}

function ConnectionErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-md flex items-start gap-3 px-4 py-3 bg-destructive text-destructive-foreground rounded-lg shadow-xl animate-slide-up"
    >
      <span className="text-sm flex-1 break-words">{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="shrink-0 -mt-0.5 hover:opacity-80 p-0.5 rounded"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// Re-export for type-checkers that may import via barrel
export type { ConnectionSecrets };
