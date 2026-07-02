import { X, Plus, FileCode } from "lucide-react";
import type { QueryTab } from "../../types";

interface QueryTabsProps {
  tabs: QueryTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}

function QueryTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: QueryTabsProps) {
  return (
    <div className="flex items-center border-b border-border bg-secondary/30">
      <div className="flex-1 flex items-center overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group flex items-center gap-2 px-4 py-2 cursor-pointer border-r border-border transition-colors ${
              activeTabId === tab.id
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background/50"
            }`}
            onClick={() => onSelectTab(tab.id)}
          >
            <FileCode className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm truncate max-w-[120px]">
              {tab.title}
              {tab.is_modified && <span className="text-primary ml-1">*</span>}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="p-0.5 rounded hover:bg-destructive/20 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={onNewTab}
        className="p-2 hover:bg-secondary transition-colors flex-shrink-0"
        title="New Query"
      >
        <Plus className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  );
}

export default QueryTabs;
