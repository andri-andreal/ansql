import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { useTheme, type Theme } from "../../hooks/useTheme";
import { useSettings } from "../../hooks/useSettings";
import { useTranslation, LANGUAGES } from "../../i18n";
import { useAiConfig } from "../../hooks/useAiConfig";
import { vaultCommands } from "../../lib/tauri-commands";
import {
  DEFAULT_MODELS,
  PROVIDER_LABELS,
  PROVIDER_MODELS,
  type AiProvider,
} from "../../lib/aiProviders";
import { useDialogs } from "../ui";

interface PreferencesDialogProps {
  onClose: () => void;
}

const THEME_OPTIONS: { value: Theme; labelKey: string; icon: typeof Sun }[] = [
  { value: "light", labelKey: "shell.themeLight", icon: Sun },
  { value: "dark", labelKey: "shell.themeDark", icon: Moon },
  { value: "system", labelKey: "shell.themeSystem", icon: Monitor },
];

const PAGE_SIZE_OPTIONS = [100, 500, 1000, 2000];

const AI_PROVIDERS: AiProvider[] = ["anthropic", "openai", "ollama"];

type VaultMode = "device" | "master" | "uninitialized";

// Vault master-password controls. Reads the current mode on mount; offers
// "Set master password" in device mode and disable / change / reset in master
// mode. Re-keying happens in the backend (verify-before-commit, no data loss).
function SecuritySection() {
  const { t } = useTranslation();
  const dialogs = useDialogs();
  const [mode, setMode] = useState<VaultMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // "set" (device → master) or "change" (master → master) inline form, or null.
  const [form, setForm] = useState<"set" | "change" | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const refreshMode = async () => {
    try {
      setMode(await vaultCommands.vaultMode());
    } catch (err) {
      setMode(null);
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    void refreshMode();
  }, []);

  const closeForm = () => {
    setForm(null);
    setNewPassword("");
    setConfirmPassword("");
  };

  // Apply a set / change: validates input, re-keys, then refreshes the mode.
  // For "change" we disable first (back to a fresh device key) then re-set, so
  // the new password derives from a clean baseline.
  const handleApplyPassword = async () => {
    if (busy) return;
    if (!newPassword) {
      setMessage({ kind: "error", text: t("shell.passwordEmpty") });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ kind: "error", text: t("shell.passwordsDoNotMatch") });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (form === "change") await vaultCommands.disableMasterPassword();
      await vaultCommands.setMasterPassword(newPassword);
      setMessage({
        kind: "ok",
        text: t("shell.masterPasswordSet"),
      });
      closeForm();
      await refreshMode();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await vaultCommands.disableMasterPassword();
      setMessage({ kind: "ok", text: t("shell.masterPasswordDisabled") });
      await refreshMode();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (busy) return;
    const confirmed = await dialogs.confirm({ title: t("shell.resetVaultConfirm"), danger: true });
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    try {
      await vaultCommands.resetVault();
      setMessage({
        kind: "ok",
        text: t("shell.vaultReset"),
      });
      closeForm();
      await refreshMode();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3 className="text-sm font-semibold mb-3">{t("shell.security")}</h3>
      <div className="space-y-3">
        {/* Current mode */}
        <div className="flex items-center justify-between gap-4">
          <label className="text-sm text-muted-foreground">{t("shell.vault")}</label>
          <span className="inline-flex items-center gap-1.5 text-sm">
            {mode === "master" ? (
              <>
                <ShieldCheck className="w-4 h-4 text-primary" />
                {t("shell.vaultMasterPassword")}
              </>
            ) : mode === "device" ? (
              <>
                <ShieldAlert className="w-4 h-4 text-muted-foreground" />
                {t("shell.vaultDeviceKey")}
              </>
            ) : mode === "uninitialized" ? (
              t("shell.vaultNotInitialized")
            ) : (
              "…"
            )}
          </span>
        </div>

        {/* Device mode → offer to set a master password */}
        {mode === "device" && form === null && (
          <button
            onClick={() => {
              setMessage(null);
              setForm("set");
            }}
            className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
          >
            {t("shell.setMasterPassword")}
          </button>
        )}

        {/* Master mode → change / disable / reset */}
        {mode === "master" && form === null && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setMessage(null);
                setForm("change");
              }}
              disabled={busy}
              className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50"
            >
              {t("shell.changeMasterPassword")}
            </button>
            <button
              onClick={handleDisable}
              disabled={busy}
              className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50"
            >
              {t("shell.disableMasterPassword")}
            </button>
            <button
              onClick={handleReset}
              disabled={busy}
              className="px-3 py-1.5 text-sm text-destructive bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50"
            >
              {t("shell.resetVault")}
            </button>
          </div>
        )}

        {/* Set / change inline form */}
        {form !== null && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <input
              type="password"
              autoFocus
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={busy}
              placeholder={t("shell.newMasterPasswordPlaceholder")}
              autoComplete="new-password"
              className="w-full px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleApplyPassword();
                }
              }}
              disabled={busy}
              placeholder={t("shell.confirmMasterPasswordPlaceholder")}
              autoComplete="new-password"
              className="w-full px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={closeForm}
                disabled={busy}
                className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded-md transition-colors disabled:opacity-50"
              >
                {t("shell.cancel")}
              </button>
              <button
                onClick={handleApplyPassword}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {form === "change" ? t("shell.change") : t("shell.setPassword")}
              </button>
            </div>
          </div>
        )}

        {message && (
          <p
            className={`text-xs ${
              message.kind === "error" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {message.text}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {t("shell.securityHint")}
        </p>
      </div>
    </section>
  );
}

function PreferencesDialog({ onClose }: PreferencesDialogProps) {
  const { theme, setTheme } = useTheme();
  const { settings, setSettings } = useSettings();
  const { config: ai, setConfig: setAi, commitApiKey } = useAiConfig();
  const { t, language, setLanguage } = useTranslation();

  // Switching provider resets the model to that provider's default so the field
  // never carries a stale model id from another provider.
  const handleAiProviderChange = (provider: AiProvider) => {
    setAi({ provider, model: DEFAULT_MODELS[provider] });
  };

  const aiModels = PROVIDER_MODELS[ai.provider];
  // Whether the persisted model is one of the known presets — when it isn't (a
  // free-typed model), the <select> falls back to a "custom" sentinel.
  const aiModelIsPreset = aiModels.includes(ai.model);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg p-6 shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-6">{t("shell.preferences")}</h2>

        <div className="space-y-6 overflow-y-auto -mr-2 pr-2">
          {/* Appearance */}
          <section>
            <h3 className="text-sm font-semibold mb-3">
              {t("shell.preferencesAppearance")}
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-muted-foreground">
                  {t("shell.preferencesTheme")}
                </label>
                <div className="inline-flex rounded-lg border border-border overflow-hidden">
                  {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => {
                    const active = theme === value;
                    return (
                      <button
                        key={value}
                        onClick={() => setTheme(value)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary hover:bg-secondary/80 text-foreground"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {t(labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Language */}
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-muted-foreground">
                  {t("shell.preferencesLanguage")}
                </label>
                <select
                  value={language}
                  onChange={(e) =>
                    setLanguage(e.target.value as (typeof LANGUAGES)[number]["code"])
                  }
                  className="px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Data grid */}
          <section>
            <h3 className="text-sm font-semibold mb-3">{t("shell.preferencesDataGrid")}</h3>
            <div className="flex items-center justify-between gap-4">
              <label className="text-sm text-muted-foreground">
                {t("shell.preferencesDefaultRows")}
              </label>
              <select
                value={settings.defaultPageSize}
                onChange={(e) =>
                  setSettings({ defaultPageSize: Number(e.target.value) })
                }
                className="px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* SQL editor */}
          <section>
            <h3 className="text-sm font-semibold mb-3">{t("shell.preferencesSqlEditor")}</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-muted-foreground">{t("shell.preferencesFontSize")}</label>
                <select
                  value={settings.editorFontSize}
                  onChange={(e) =>
                    setSettings({ editorFontSize: Number(e.target.value) })
                  }
                  className="px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {Array.from({ length: 8 }, (_, i) => 11 + i).map((n) => (
                    <option key={n} value={n}>
                      {n}px
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <span className="text-sm text-muted-foreground">{t("shell.preferencesWordWrap")}</span>
                <input
                  type="checkbox"
                  checked={settings.editorWordWrap}
                  onChange={(e) =>
                    setSettings({ editorWordWrap: e.target.checked })
                  }
                />
              </label>

              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <span className="text-sm text-muted-foreground">{t("shell.preferencesMinimap")}</span>
                <input
                  type="checkbox"
                  checked={settings.editorMinimap}
                  onChange={(e) =>
                    setSettings({ editorMinimap: e.target.checked })
                  }
                />
              </label>
            </div>
          </section>

          {/* Query safety */}
          <section>
            <h3 className="text-sm font-semibold mb-3">{t("shell.preferencesQuerySafety")}</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <span className="text-sm text-muted-foreground">{t("shell.preferencesPreflight")}</span>
                <input
                  type="checkbox"
                  checked={settings.preflightEnabled}
                  onChange={(e) =>
                    setSettings({ preflightEnabled: e.target.checked })
                  }
                />
              </label>
              <p className="text-xs text-muted-foreground">{t("shell.preferencesPreflightHint")}</p>
            </div>
          </section>

          {/* AI Assistant */}
          <section>
            <h3 className="text-sm font-semibold mb-3">{t("shell.preferencesAiAssistant")}</h3>
            <div className="space-y-3">
              {/* Provider */}
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-muted-foreground">{t("shell.preferencesProvider")}</label>
                <select
                  value={ai.provider}
                  onChange={(e) =>
                    handleAiProviderChange(e.target.value as AiProvider)
                  }
                  className="px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
                >
                  {AI_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Model — a preset <select> when the provider has known models,
                  with a free-text fallback (always available for custom ids). */}
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-muted-foreground">{t("shell.preferencesModel")}</label>
                <div className="flex flex-col items-end gap-1.5 min-w-[180px]">
                  {aiModels.length > 0 && (
                    <select
                      value={aiModelIsPreset ? ai.model : "__custom__"}
                      onChange={(e) => {
                        if (e.target.value !== "__custom__")
                          setAi({ model: e.target.value });
                      }}
                      className="w-full px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {aiModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      <option value="__custom__">{t("shell.preferencesModelCustom")}</option>
                    </select>
                  )}
                  <input
                    type="text"
                    value={ai.model}
                    onChange={(e) => setAi({ model: e.target.value })}
                    placeholder={DEFAULT_MODELS[ai.provider]}
                    className="w-full px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* API key — hidden for Ollama (runs locally, no key). */}
              {ai.provider !== "ollama" && (
                <div className="flex items-center justify-between gap-4">
                  <label className="text-sm text-muted-foreground">{t("shell.preferencesApiKey")}</label>
                  <input
                    type="password"
                    value={ai.apiKey ?? ""}
                    onChange={(e) => setAi({ apiKey: e.target.value })}
                    onBlur={() => void commitApiKey()}
                    placeholder="sk-…"
                    autoComplete="off"
                    className="px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
                  />
                </div>
              )}

              {/* Base URL — only meaningful for OpenAI-compatible / Ollama hosts. */}
              {ai.provider !== "anthropic" && (
                <div className="flex items-center justify-between gap-4">
                  <label className="text-sm text-muted-foreground">
                    {t("shell.preferencesBaseUrl")}
                  </label>
                  <input
                    type="text"
                    value={ai.baseUrl ?? ""}
                    onChange={(e) => setAi({ baseUrl: e.target.value })}
                    placeholder={
                      ai.provider === "ollama"
                        ? "http://localhost:11434"
                        : "https://api.openai.com"
                    }
                    className="px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
                  />
                </div>
              )}

              {/* Max tokens */}
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-muted-foreground">
                  {t("shell.preferencesMaxTokens")}
                </label>
                <input
                  type="number"
                  min={1}
                  value={ai.maxTokens ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setAi({
                      maxTokens: e.target.value === "" || Number.isNaN(n) ? undefined : n,
                    });
                  }}
                  className="px-2 py-1.5 text-sm bg-secondary rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-primary w-[100px]"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                {t("shell.preferencesKeysStoredLocally")}
              </p>
            </div>
          </section>

          {/* Security */}
          <SecuritySection />
        </div>

        <div className="flex justify-end mt-8">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg transition-colors"
          >
            {t("shell.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PreferencesDialog;
