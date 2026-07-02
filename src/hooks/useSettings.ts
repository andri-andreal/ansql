import { useState, useEffect, useCallback } from "react";
import type { AppSettings } from "../types";

const STORAGE_KEY = "ansql.settings";

const DEFAULT_SETTINGS: AppSettings = {
  defaultPageSize: 1000,
  editorFontSize: 13,
  editorWordWrap: true,
  editorMinimap: false,
  timeMachineSnapshotCap: 1000,
};

/** Read persisted settings from localStorage, merged over the defaults so that
 * any missing keys fall back gracefully. */
function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** localStorage-backed application settings hook. Mirrors useTheme's simple
 * pattern: state initialised from storage, persisted on change. */
export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  /** Partial updater — merges the given patch over the current settings. */
  const setSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...patch }));
  }, []);

  return { settings, setSettings };
}
