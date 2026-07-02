import { useState } from "react";
import { Database, Lock, Loader2 } from "lucide-react";
import { useTranslation } from "../../i18n";

export interface VaultUnlockDialogProps {
  onUnlock: (password: string) => Promise<void>;
  onReset: () => void;
  error?: string | null;
  busy?: boolean;
}

/**
 * Centered, blocking modal shown at startup when the vault is in master-password
 * mode and locked. It cannot be dismissed — the user must enter their master
 * password to unlock, or reset the vault (which the parent confirms; resetting
 * wipes saved secrets but keeps connections).
 */
export function VaultUnlockDialog({ onUnlock, onReset, error, busy }: VaultUnlockDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");

  const handleUnlock = async () => {
    if (!password || busy) return;
    await onUnlock(password);
  };

  return (
    // Blocking overlay: no onClick handler, so clicking outside does nothing.
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="bg-card shadow-xl w-[24rem] max-w-[90vw] flex flex-col rounded-xl border border-border animate-scale-in">
        {/* Header — app logo + title */}
        <div className="flex flex-col items-center gap-3 px-6 pt-7 pb-5">
          <div className="flex items-center gap-2 text-primary">
            <Database className="w-6 h-6" />
            <span className="text-xl font-semibold tracking-tight">ANSQL</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="w-4 h-4" />
            {t("shell.vaultIsLocked")}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pb-2 space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("shell.masterPasswordLabel")}
            </label>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleUnlock();
                }
              }}
              disabled={busy}
              placeholder={t("shell.enterMasterPassword")}
              className="w-full px-3 py-2 bg-secondary rounded-lg border border-input focus:outline-none focus:ring-2 focus:ring-primary transition-all disabled:opacity-50"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            onClick={() => void handleUnlock()}
            disabled={!password || busy}
            className="flex w-full items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy ? t("shell.unlocking") : t("shell.unlock")}
          </button>
        </div>

        {/* Footer — reset escape hatch */}
        <div className="px-6 pb-6 pt-3 text-center">
          <button
            onClick={onReset}
            disabled={busy}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors disabled:opacity-50"
          >
            {t("shell.forgotPasswordReset")}
          </button>
        </div>
      </div>
    </div>
  );
}
