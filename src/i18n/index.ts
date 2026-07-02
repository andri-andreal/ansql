import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Per-area namespace catalogs. Each file exports a flat Record<string,string>
// of FLAT dotted keys prefixed with its namespace (e.g. "shell.newQuery").
// Extraction lanes fill these stubs; this index just merges them per language.
import enShell from "./en/shell";
import idShell from "./id/shell";
import enConnection from "./en/connection";
import idConnection from "./id/connection";
import enExplorer from "./en/explorer";
import idExplorer from "./id/explorer";
import enQuery from "./en/query";
import idQuery from "./id/query";
import enTable from "./en/table";
import idTable from "./id/table";
import enIo from "./en/io";
import idIo from "./id/io";

export type Language = "en" | "id";

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "id", label: "Bahasa Indonesia" },
];

const STORAGE_KEY = "ansql.language";
const DEFAULT_LANGUAGE: Language = "en";

// One merged flat catalog per language. Namespaces are spread in order; since
// every key is namespace-prefixed they never collide across namespaces.
const CATALOGS: Record<Language, Record<string, string>> = {
  en: {
    ...enShell,
    ...enConnection,
    ...enExplorer,
    ...enQuery,
    ...enTable,
    ...enIo,
  },
  id: {
    ...idShell,
    ...idConnection,
    ...idExplorer,
    ...idQuery,
    ...idTable,
    ...idIo,
  },
};

/** Substitute {{name}} placeholders from `params` into a resolved string. */
function interpolate(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Read the persisted language, validating against the known set. */
function readStoredLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "en" || saved === "id" ? saved : DEFAULT_LANGUAGE;
}

interface I18nContextValue {
  t: (key: string, params?: Record<string, string | number>) => string;
  language: Language;
  setLanguage: (language: Language) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  // Look up the merged catalog for the active language; fall back to "en", then
  // to the key itself; finally interpolate any {{param}} placeholders.
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const template =
        CATALOGS[language][key] ?? CATALOGS.en[key] ?? key;
      return interpolate(template, params);
    },
    [language]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ t, language, setLanguage }),
    [t, language, setLanguage]
  );

  return createElement(I18nContext.Provider, { value }, children);
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within an <I18nProvider>");
  }
  return ctx;
}
