import {
  Table as TableIcon,
  List,
  FileCode,
  Columns,
  Eye,
  FunctionSquare,
  Zap,
  CalendarClock,
  ListOrdered,
  Network,
  GitCompareArrows,
  Activity,
  LayoutDashboard,
  KeyRound,
  Leaf,
  X,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceTab, WorkspaceTabKind } from "../../lib/workspaceTabs";
import { useTranslation } from "../../i18n";

const KIND_ICON: Record<WorkspaceTabKind, LucideIcon> = {
  "table": TableIcon,
  "table-list": List,
  "query": FileCode,
  "table-designer": Columns,
  "view-designer": Eye,
  "routine-editor": FunctionSquare,
  "trigger-designer": Zap,
  "event-designer": CalendarClock,
  "sequence-designer": ListOrdered,
  "erd": Network,
  "structure-sync": GitCompareArrows,
  "data-sync": GitCompareArrows,
  "server-monitor": Activity,
  "dashboard": LayoutDashboard,
  "redis-browser": KeyRound,
  "mongo-browser": Leaf,
};

interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

export function WorkspaceTabBar({ tabs, activeId, onActivate, onClose }: WorkspaceTabBarProps) {
  const { t } = useTranslation();
  if (tabs.length === 0) return null; // no tab bar when zero tabs
  return (
    <div className="flex items-center border-b border-border bg-secondary/30 overflow-x-auto flex-shrink-0">
      {tabs.map((tab) => {
        const Icon = KIND_ICON[tab.kind];
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={`group flex items-center gap-2 px-3 py-2 cursor-pointer border-r border-border whitespace-nowrap transition-colors ${
              active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-background/50"
            }`}
            onClick={() => onActivate(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              } // middle-click close
            }}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm truncate max-w-[160px]">{tab.title}</span>
            {tab.dirty && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"
                title={t("shell.unsavedChanges")}
              />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className="p-0.5 rounded hover:bg-destructive/20 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              title={t("shell.closeTab")}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
