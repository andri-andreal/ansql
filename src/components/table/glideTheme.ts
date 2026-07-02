import type { Theme } from "@glideapps/glide-data-grid";

/**
 * Glide's canvas renderer needs concrete colors (hex/rgb). ANSQL's CSS tokens are
 * authored in OKLCH, which is unreliable to feed into canvas `fillStyle` in the
 * Tauri WebKitGTK WebView. So we keep two hand-tuned palettes that mirror the
 * light/dark tokens in src/index.css and pick by the `.dark` class on <html>.
 */

const LIGHT: Partial<Theme> = {
  accentColor: "#3b82f6",
  accentLight: "#3b82f622",
  textDark: "#27272a",
  textMedium: "#52525b",
  textLight: "#a1a1aa",
  textBubble: "#27272a",
  textHeader: "#3f3f46",
  textHeaderSelected: "#ffffff",
  bgCell: "#ffffff",
  bgCellMedium: "#fafafa",
  bgHeader: "#f4f4f5",
  bgHeaderHasFocus: "#e4e4e7",
  bgHeaderHovered: "#ececee",
  bgBubble: "#f4f4f5",
  bgSearchResult: "#fff3c4",
  borderColor: "#e4e4e7",
  drilldownBorder: "#e4e4e7",
};

const DARK: Partial<Theme> = {
  accentColor: "#4d8df0",
  accentLight: "#4d8df033",
  textDark: "#f4f4f5",
  textMedium: "#d4d4d8",
  textLight: "#8b8b94",
  textBubble: "#f4f4f5",
  textHeader: "#e4e4e7",
  textHeaderSelected: "#ffffff",
  bgCell: "#1e1e1e",
  bgCellMedium: "#242424",
  bgHeader: "#262626",
  bgHeaderHasFocus: "#2f2f2f",
  bgHeaderHovered: "#2a2a2a",
  bgBubble: "#262626",
  bgSearchResult: "#4a4320",
  borderColor: "#3a3a3a",
  drilldownBorder: "#3a3a3a",
};

const COMMON: Partial<Theme> = {
  cellHorizontalPadding: 8,
  cellVerticalPadding: 4,
  headerFontStyle: "600 12px",
  baseFontStyle: "13px",
  fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

/** Whether the app is currently in dark mode (set by useTheme via `.dark` on <html>). */
export function isDarkMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/** Build a partial glide Theme matching the app's current light/dark mode. */
export function buildGlideTheme(): Partial<Theme> {
  return { ...COMMON, ...(isDarkMode() ? DARK : LIGHT) };
}
