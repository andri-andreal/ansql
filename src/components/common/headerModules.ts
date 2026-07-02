import {
  Plug, FileCode, Table2, ArrowRightLeft, Download,
  Eye, FunctionSquare, Users, DatabaseBackup, Bot, Network, BarChart3,
  GitCompareArrows,
  type LucideIcon,
} from "lucide-react";
import type { ProFeature } from "../../lib/edition";

export type ModuleTone = "accent" | "green" | "amber" | "teal" | "default";

export interface ToolbarModule {
  id: string;
  /** Fallback English label. The ribbon renders the translated `labelKey`. */
  label: string;
  /** i18n key (shell namespace) for the ribbon label / tooltip. */
  labelKey: string;
  icon: LucideIcon;
  group: number;
  tone?: ModuleTone;
  comingSoon?: boolean;
  /** When set, this module belongs to ANSQL Pro and is hidden in the toolbar
   * unless that feature is enabled in the running edition (see `lib/edition`). */
  feature?: ProFeature;
}

// Order + grouping mirrors Navicat. Wired modules first, placeholders after.
export const TOOLBAR_MODULES: ToolbarModule[] = [
  { id: "connection", label: "Connection", labelKey: "shell.moduleConnection", icon: Plug, group: 1, tone: "accent" },
  { id: "new-query", label: "New Query", labelKey: "shell.moduleNewQuery", icon: FileCode, group: 2, tone: "green" },
  { id: "table", label: "Table", labelKey: "shell.moduleTable", icon: Table2, group: 2 },
  { id: "transfer", label: "Transfer", labelKey: "shell.moduleTransfer", icon: ArrowRightLeft, group: 3, tone: "amber", feature: "crossDbTransfer" },
  { id: "sync", label: "Sync", labelKey: "shell.moduleSync", icon: GitCompareArrows, group: 3, tone: "teal", feature: "structureSync" },
  { id: "export", label: "Export", labelKey: "shell.moduleExport", icon: Download, group: 3, tone: "teal" },
  { id: "view", label: "View", labelKey: "shell.moduleView", icon: Eye, group: 4 },
  { id: "function", label: "Function", labelKey: "shell.moduleFunction", icon: FunctionSquare, group: 4 },
  { id: "user", label: "User", labelKey: "shell.moduleUser", icon: Users, group: 4 },
  { id: "backup", label: "Backup", labelKey: "shell.moduleBackup", icon: DatabaseBackup, group: 4 },
  { id: "automation", label: "Automation", labelKey: "shell.moduleAutomation", icon: Bot, group: 4, comingSoon: true },
  { id: "model", label: "Model", labelKey: "shell.moduleModel", icon: Network, group: 4 },
  { id: "charts", label: "Charts", labelKey: "shell.moduleCharts", icon: BarChart3, group: 4, feature: "dashboards" },
];
