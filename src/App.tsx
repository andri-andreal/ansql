// App — composition root. All app-level state is owned by useAppState; the
// AppShell renders the layout; VaultGate handles the locked-vault startup.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useAppState } from "./hooks/useAppState";
import { VaultUnlockDialog } from "./components/common/VaultUnlockDialog";
import { AppShell } from "./components/shell/AppShell";

interface State {
  error: Error | null;
  stack: string | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: null };
  static getDerivedStateFromError(error: Error): State {
    return { error, stack: error.stack ?? null };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 32,
            fontFamily: "ui-monospace, monospace",
            color: "#dc2626",
            background: "#fef2f2",
            height: "100vh",
            overflow: "auto",
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>ANSQL crashed</h1>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const app = useAppState();

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

  return (
    <AppErrorBoundary>
      <AppShell app={app} />
    </AppErrorBoundary>
  );
}

export default App;
