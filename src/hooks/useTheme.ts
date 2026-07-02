import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** Resolve whether dark mode should be applied for a given theme choice. */
function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MEDIA_QUERY).matches;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Get theme from localStorage or default to light
    const saved = localStorage.getItem('theme') as Theme | null;
    return saved || 'light';
  });

  // The actually-applied appearance ('light' | 'dark'), resolving 'system' to the
  // OS preference. Components that need a concrete light/dark value (e.g. Monaco's
  // 'vs' / 'vs-dark' theme) should read this rather than the raw `theme`.
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    (localStorage.getItem('theme') as Theme | null) === 'system'
      ? (prefersDark() ? 'dark' : 'light')
      : (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light')
  );

  useEffect(() => {
    const root = document.documentElement;

    const apply = (dark: boolean) => {
      if (dark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      setResolvedTheme(dark ? 'dark' : 'light');
    };

    // Save the chosen mode (light | dark | system) to localStorage.
    localStorage.setItem('theme', theme);

    if (theme === 'system') {
      const media = window.matchMedia(MEDIA_QUERY);
      apply(media.matches);
      const onChange = (e: MediaQueryListEvent) => apply(e.matches);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }

    apply(theme === 'dark');
  }, [theme]);

  /** Header button toggle: flips between light and dark. From 'system', resolve
   * the current effective theme first so the flip is intuitive. */
  const toggleTheme = () => {
    setTheme((prev) => {
      const effectiveDark = prev === 'system' ? prefersDark() : prev === 'dark';
      return effectiveDark ? 'light' : 'dark';
    });
  };

  return { theme, resolvedTheme, toggleTheme, setTheme };
}
