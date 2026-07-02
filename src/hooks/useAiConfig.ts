import { useState, useEffect, useCallback, useRef } from "react";
import type { AiConfig, AiProvider } from "../lib/aiProviders";
import { credentialCommands } from "../lib/tauri-commands";

/** localStorage holds only the NON-secret AI config (provider/model/baseUrl/…).
 * The provider API key is a billable secret, so it is kept in the encrypted
 * credential vault (AES-256-GCM) instead of plaintext web storage — here we
 * persist only the vault credential id that points at it. */
const STORAGE_KEY = "ansql.ai";
const CRED_ID_KEY = "ansql.ai.keyCredId";

const DEFAULT_CONFIG: AiConfig = {
  provider: "anthropic",
  model: "claude-opus-4-8",
  maxTokens: 4096,
};

/** A provider is usable once it's selected and (for hosted providers) an API
 * key is present. Ollama runs locally and needs no key. */
function configured(config: AiConfig): boolean {
  return config.provider === "ollama" || !!config.apiKey;
}

/** Initial read of the persisted config from localStorage, merged over the
 * defaults. A legacy plaintext `apiKey` (written by older builds) is kept in
 * the returned config so it stays usable in-session; the mount effect migrates
 * it into the vault and the persist effect strips it from storage. */
function loadInitialConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Persist `key` into the encrypted vault, reusing the existing credential id
 * when present (update) or creating one (save); an empty key deletes any stored
 * credential. Returns the credential id (or null when cleared). Requires the
 * vault to be unlocked — callers handle the rejection. */
async function persistKeyToVault(
  key: string,
  credId: string | null,
): Promise<string | null> {
  if (!key) {
    if (credId) {
      await credentialCommands.deleteCredential(credId);
      localStorage.removeItem(CRED_ID_KEY);
    }
    return null;
  }
  if (credId) {
    await credentialCommands.updateCredential(credId, key);
    return credId;
  }
  const id = await credentialCommands.saveCredential("ai_api_key", key);
  localStorage.setItem(CRED_ID_KEY, id);
  return id;
}

/** localStorage-backed AI provider config hook. Non-secret fields live in
 * localStorage; the API key lives in the encrypted credential vault and is
 * loaded into memory on mount and committed back on blur (see commitApiKey). */
export function useAiConfig() {
  const [config, setConfigState] = useState<AiConfig>(loadInitialConfig);

  // Mirror of the latest apiKey so commitApiKey can read a fresh value without
  // being re-created (and re-bound) on every keystroke.
  const apiKeyRef = useRef<string | undefined>(config.apiKey);
  apiKeyRef.current = config.apiKey;

  // Persist only the NON-secret fields to localStorage. apiKey is deliberately
  // excluded so the billable secret never lands in plaintext web storage.
  useEffect(() => {
    const nonSecret: Omit<AiConfig, "apiKey"> = {
      provider: config.provider,
      model: config.model,
      maxTokens: config.maxTokens,
      baseUrl: config.baseUrl,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nonSecret));
  }, [config.provider, config.model, config.maxTokens, config.baseUrl]);

  // On mount: load the key from the vault, or migrate a legacy plaintext key
  // into it. Silent no-op if the vault is locked or no key is stored (the AI
  // pane simply shows "not configured" until a key is set / the vault unlocks).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const credId = localStorage.getItem(CRED_ID_KEY);
        if (credId) {
          // The vault is the source of truth once a credential exists.
          const key = await credentialCommands.getCredential(credId);
          if (!cancelled && key) {
            setConfigState((prev) => ({ ...prev, apiKey: key }));
          }
        } else if (apiKeyRef.current) {
          // Legacy plaintext key from an older build, not yet in the vault.
          await persistKeyToVault(apiKeyRef.current, null);
        }
      } catch {
        // Vault locked / no credential — leave apiKey as-is for this session.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Partial updater — merges the given patch over the current config. */
  const setConfig = useCallback((patch: Partial<AiConfig>) => {
    setConfigState((prev) => ({ ...prev, ...patch }));
  }, []);

  /** Persist the current in-memory API key to the encrypted vault. Call on blur
   * (not per keystroke) so the vault isn't written on every character typed. */
  const commitApiKey = useCallback(async () => {
    try {
      const credId = localStorage.getItem(CRED_ID_KEY);
      await persistKeyToVault(apiKeyRef.current ?? "", credId);
    } catch {
      // Vault locked — the key stays usable in-session but isn't persisted.
    }
  }, []);

  return {
    config,
    setConfig,
    isConfigured: configured(config),
    commitApiKey,
  };
}

export type { AiConfig, AiProvider };
