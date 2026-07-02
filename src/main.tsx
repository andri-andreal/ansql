import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import { ToastProvider, DialogProvider } from "./components/ui";
import "./index.css";

// Global error catcher so a crash in App's first render still surfaces a
// visible message in the webview (default behavior is a silent white page).
function showFatalError(prefix: string, err: unknown) {
  const root = document.getElementById("root");
  if (!root) return;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? "" : "";
  root.innerHTML = `
    <div style="padding:32px;font-family:ui-monospace,monospace;color:#dc2626;background:#fef2f2;height:100vh;overflow:auto;box-sizing:border-box">
      <h1 style="font-size:20px;margin:0 0 12px 0">ANSQL failed to start</h1>
      <p style="color:#7f1d1d;margin:0 0 12px 0">${prefix}</p>
      <pre style="white-space:pre-wrap;font-size:12px;line-height:1.5">${message}\n\n${stack}</pre>
    </div>
  `;
}

window.addEventListener("error", (e) => showFatalError("Uncaught error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showFatalError("Unhandled promise rejection", e.reason));

try {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider>
        {/* ToastProvider must sit ABOVE App: useAppState() → useActionJournal()
            calls useToast() during App's own render, before AppShell mounts. */}
        <ToastProvider>
          <DialogProvider>
            <App />
          </DialogProvider>
        </ToastProvider>
      </I18nProvider>
    </React.StrictMode>
  );
} catch (err) {
  showFatalError("Synchronous render error", err);
}
