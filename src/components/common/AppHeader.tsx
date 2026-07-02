import { Fragment, useEffect, useState } from "react";
// useState is used by the vault indicator below; the Dropdown primitive owns
// the export menu's open state.
import {
  Database,
  Moon,
  Sun,
  Settings,
  Sparkles,
  Lock,
  Unlock,
  Download,
  Upload,
  ChevronDown,
  Maximize2,
  Minimize2,
  PanelRight,
  History,
} from "lucide-react";
import { TOOLBAR_MODULES, type ModuleTone } from "./headerModules";
import { isFeatureEnabled } from "../../lib/edition";
import { vaultCommands } from "../../lib/tauri-commands";
import { useTranslation } from "../../i18n";
import type { Theme } from "../../hooks/useTheme";
import { Dropdown, DropdownItem, Tooltip } from "../ui";

export type ExportFormat = "csv" | "json" | "xlsx" | "sql" | "html" | "xml" | "txt";

const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "csv", label: "CSV (.csv)" },
  { id: "txt", label: "Text (.txt)" },
  { id: "json", label: "JSON (.json)" },
  { id: "xlsx", label: "Excel (.xlsx)" },
  { id: "sql", label: "SQL (.sql)" },
  { id: "html", label: "HTML (.html)" },
  { id: "xml", label: "XML (.xml)" },
];

interface AppHeaderProps {
  theme: Theme;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  /** Toggle the AI Assistant right dock. */
  onToggleAi: () => void;
  /** Toggle Focus Mode (hides the explorer sidebar to maximize the active tab). */
  onToggleFocusMode: () => void;
  /** Whether Focus Mode is currently active (drives the button's icon/label). */
  focusMode: boolean;
  /** Toggle the Information pane right dock. */
  onToggleInfoPane: () => void;
  /** Whether the Information pane is currently visible. */
  infoPaneOpen: boolean;
  /** Open the Time Machine action timeline. */
  onOpenTimeline: () => void;
  /** Number of currently undoable actions (drives the badge on the History button). */
  undoableCount: number;
  onNewConnection: () => void;
  onNewQuery: () => void;
  onOpenTable: () => void;
  onNewView: () => void;
  onNewFunction: () => void;
  onOpenUsers: () => void;
  onOpenTransfer: () => void;
  onOpenStructureSync: () => void;
  onOpenModel: () => void;
  onOpenBackup: () => void;
  /** Open the BI Dashboards (charts) workspace tab. */
  onOpenDashboards: () => void;
  onExport: (format: ExportFormat) => void;
  /** Export all saved connections (secrets stripped) to a JSON file. */
  onExportConnections: () => void;
  /** Import connections from a JSON file. */
  onImportConnections: () => void;
  canOpenTable: boolean;
  canOpenRoutine: boolean;
  canManageUsers: boolean;
  canTransfer: boolean;
  canExport: boolean;
}

const TONE_CLASS: Record<ModuleTone, string> = {
  accent: "text-primary",
  green: "text-green-500",
  amber: "text-amber-500",
  teal: "text-teal-500",
  default: "text-foreground/80",
};

function AppHeader({
  theme, onToggleTheme, onOpenSettings, onToggleAi,
  onToggleFocusMode, focusMode, onToggleInfoPane, infoPaneOpen, onOpenTimeline, undoableCount,
  onNewConnection, onNewQuery, onOpenTable, onNewView, onNewFunction, onOpenUsers, onOpenTransfer, onOpenStructureSync, onOpenModel, onOpenBackup, onOpenDashboards, onExport,
  onExportConnections, onImportConnections,
  canOpenTable, canOpenRoutine, canManageUsers, canTransfer, canExport,
}: AppHeaderProps) {
  const { t } = useTranslation();
  // The export menu is handled by the Dropdown primitive. The ribbon button's
  // onClick is wired through the `wired` map (see `onExport` in the action map).

  // Vault lock indicator — reflects the vault's locked state. The device key
  // auto-unlocks the vault on startup, so this usually reads "unlocked"; the
  // user can explicitly Lock it. A full master-password unlock needs Rust and is
  // out of scope here — re-locking is recovered transparently by the device-key
  // auto-unlock on the next DB access.
  const [vaultLocked, setVaultLocked] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    vaultCommands
      .isVaultLocked()
      .then((locked) => {
        if (!cancelled) setVaultLocked(locked);
      })
      .catch(() => {
        if (!cancelled) setVaultLocked(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleVault = async () => {
    if (vaultLocked) {
      // No interactive unlock here (needs the master password / Rust). The device
      // key auto-unlocks on the next DB access; just re-check the current state.
      try {
        setVaultLocked(await vaultCommands.isVaultLocked());
      } catch {
        /* leave indicator as-is */
      }
      return;
    }
    try {
      await vaultCommands.lockVault();
      setVaultLocked(true);
    } catch {
      /* ignore — indicator stays in its prior state */
    }
  };

  // id -> { onClick, enabled } for the wired modules. Coming-soon modules are
  // resolved as disabled below. The "export" entry toggles a format menu.
  const wired: Record<string, { onClick: () => void; enabled: boolean }> = {
    connection: { onClick: onNewConnection, enabled: true },
    "new-query": { onClick: onNewQuery, enabled: true },
    table: { onClick: onOpenTable, enabled: canOpenTable },
    view: { onClick: onNewView, enabled: canOpenTable },
    // Function/procedure editor — disabled on SQLite (no stored routines).
    function: { onClick: onNewFunction, enabled: canOpenRoutine },
    // User/role manager — disabled on SQLite (no users/roles).
    user: { onClick: onOpenUsers, enabled: canManageUsers },
    transfer: { onClick: onOpenTransfer, enabled: canTransfer },
    // Structure Synchronization seeded with the active session's database as the
    // source. Reuse the "a session with a database is active" gate (canOpenTable).
    sync: { onClick: onOpenStructureSync, enabled: canOpenTable },
    // ER Diagram for the active session's database. Reuse the "a session with a
    // database is active" gate (canOpenTable).
    model: { onClick: onOpenModel, enabled: canOpenTable },
    // Backup / Dump SQL for the active session's current database. Reuse the
    // "a session with a database is active" gate (canOpenTable).
    backup: { onClick: onOpenBackup, enabled: canOpenTable },
    // Export: onClick is a no-op because the Dropdown primitive wires the
    // trigger's own onClick. We still need an entry so the ribbon button
    // shows the enabled state from `canExport`.
    export: { onClick: () => {}, enabled: canExport },
    // BI Dashboards workspace. Always available — dashboards persist independently
    // of the active session and let the user pick a session per widget.
    charts: { onClick: onOpenDashboards, enabled: true },
  };

  return (
    <header className="shrink-0 border-b border-border">
      {/* Row 1 — slim brand bar */}
      <div className="h-8 flex items-center justify-between px-3 bg-secondary/60 border-b border-border">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">ANSQL</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Connections import/export menu — uses the Dropdown primitive for
              outside-click + Escape + ARIA. */}
          <Dropdown
            placement="bottom-end"
            trigger={
              <button
                className="flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-accent text-muted-foreground"
                title={t("shell.importExportConnections")}
                aria-label={t("shell.importExportConnections")}
              >
                <Database className="w-4 h-4" />
                <ChevronDown className="w-3 h-3" />
              </button>
            }
          >
            {() => (
              <>
                <DropdownItem
                  icon={<Download className="w-4 h-4" />}
                  onClick={onExportConnections}
                >
                  {t("shell.exportConnections")}
                </DropdownItem>
                <DropdownItem
                  icon={<Upload className="w-4 h-4" />}
                  onClick={onImportConnections}
                >
                  {t("shell.importConnections")}
                </DropdownItem>
              </>
            )}
          </Dropdown>
          {/* Vault lock indicator */}
          <Tooltip
            content={
              vaultLocked === null
                ? t("shell.vaultStatusUnavailable")
                : vaultLocked
                  ? t("shell.vaultLockedTooltip")
                  : t("shell.vaultUnlockedTooltip")
            }
          >
            <button
              onClick={handleToggleVault}
              disabled={vaultLocked === null}
              className={[
                "p-1.5 rounded-md hover:bg-accent",
                vaultLocked ? "text-amber-500" : "text-muted-foreground",
                vaultLocked === null ? "opacity-40 cursor-not-allowed" : "",
              ].join(" ")}
              aria-label={
                vaultLocked
                  ? t("shell.vaultLockedTooltip")
                  : t("shell.vaultUnlockedTooltip")
              }
            >
              {vaultLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </button>
          </Tooltip>
          <Tooltip
            content={
              undoableCount > 0
                ? `Time Machine — ${undoableCount} undoable change${undoableCount > 1 ? "s" : ""} (Ctrl+Alt+Z to undo last)`
                : "Time Machine — no undoable changes (Ctrl+Alt+Z)"
            }
          >
            <button
              onClick={onOpenTimeline}
              className="relative p-1.5 rounded-md hover:bg-accent text-muted-foreground"
              aria-label={`Time Machine — ${undoableCount} undoable`}
            >
              <History className="w-4 h-4" />
              {undoableCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center pointer-events-none"
                >
                  {undoableCount > 99 ? "99+" : undoableCount}
                </span>
              )}
            </button>
          </Tooltip>
          {isFeatureEnabled("ai") && (
            <Tooltip content={t("shell.aiAssistant")}>
              <button
                onClick={onToggleAi}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
                aria-label={t("shell.aiAssistant")}
              >
                <Sparkles className="w-4 h-4" />
              </button>
            </Tooltip>
          )}
          <Tooltip content={t("shell.informationPane")}>
            <button
              onClick={onToggleInfoPane}
              className={[
                "p-1.5 rounded-md hover:bg-accent",
                infoPaneOpen ? "text-primary" : "text-muted-foreground",
              ].join(" ")}
              aria-label={t("shell.informationPane")}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip content={focusMode ? t("shell.focusModeExit") : t("shell.focusModeEnter")}>
            <button
              onClick={onToggleFocusMode}
              className={[
                "p-1.5 rounded-md hover:bg-accent",
                focusMode ? "text-primary" : "text-muted-foreground",
              ].join(" ")}
              aria-label={focusMode ? t("shell.focusModeExit") : t("shell.focusModeEnter")}
            >
              {focusMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </Tooltip>
          <Tooltip content={theme === "light" ? t("shell.switchToDarkMode") : t("shell.switchToLightMode")}>
            <button
              onClick={onToggleTheme}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
              aria-label={theme === "light" ? t("shell.switchToDarkMode") : t("shell.switchToLightMode")}
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </Tooltip>
          <Tooltip content={t("shell.settings")}>
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
              aria-label={t("shell.settings")}
            >
              <Settings className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Row 2 — module ribbon */}
      <div className="h-[66px] flex items-stretch px-2 gap-0.5">
        {TOOLBAR_MODULES.filter((m) => !m.feature || isFeatureEnabled(m.feature)).map((mod, i, modules) => {
          const prev = modules[i - 1];
          const sep = prev && prev.group !== mod.group;
          const Icon = mod.icon;
          const action = wired[mod.id];
          const enabled = mod.comingSoon ? false : action?.enabled ?? false;
          const tone = TONE_CLASS[mod.tone ?? "default"];
          const label = t(mod.labelKey);
          const button = (
            <button
              type="button"
              disabled={!enabled}
              onClick={enabled ? action?.onClick : undefined}
              title={mod.comingSoon ? t("shell.comingSoon") : label}
              aria-label={mod.comingSoon ? t("shell.comingSoon") : label}
              className={[
                "flex flex-col items-center justify-center gap-1.5 min-w-[58px] px-2 rounded-md",
                enabled ? "hover:bg-accent cursor-pointer" : "opacity-40 cursor-not-allowed",
              ].join(" ")}
            >
              <Icon className={`w-5 h-5 ${enabled ? tone : "text-muted-foreground"}`} />
              <span className="text-[10.5px] leading-none">{label}</span>
            </button>
          );
          return (
            <Fragment key={mod.id}>
              {sep && <div className="w-px bg-border my-3 mx-1.5" aria-hidden="true" />}
              {mod.id === "export" ? (
                <Dropdown
                  placement="bottom-start"
                  trigger={button}
                >
                  {(close) => (
                    <>
                      {EXPORT_FORMATS.map((f) => (
                        <DropdownItem
                          key={f.id}
                          onClick={() => {
                            close();
                            onExport(f.id);
                          }}
                        >
                          {f.label}
                        </DropdownItem>
                      ))}
                    </>
                  )}
                </Dropdown>
              ) : (
                button
              )}
            </Fragment>
          );
        })}
      </div>
    </header>
  );
}

export default AppHeader;
