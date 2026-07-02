import { useEffect, useRef, useState, ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

export interface TreeNode {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Optional muted trailing text (e.g. a table's row count). */
  secondaryLabel?: ReactNode;
  children?: TreeNode[];
  data?: unknown;
  isLoading?: boolean;
}

interface TreeItemProps {
  node: TreeNode;
  level: number;
  selectedId?: string;
  expandedIds: Set<string>;
  onSelect: (node: TreeNode) => void;
  onToggle: (nodeId: string) => void;
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void;
  onDoubleClick?: (node: TreeNode) => void;
}

function TreeItem({
  node,
  level,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  onContextMenu,
  onDoubleClick,
}: TreeItemProps) {
  const hasChildren = (node.children && node.children.length > 0) || node.isLoading;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(node.id);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(e, node);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) {
      onToggle(node.id);
    }
    onDoubleClick?.(node);
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 px-2 rounded cursor-pointer transition-colors ${
          isSelected
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/50"
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
      >
        {/* Expand/Collapse Icon */}
        <button
          onClick={handleToggle}
          className={`p-0.5 rounded hover:bg-secondary transition-colors ${
            !hasChildren && !node.isLoading ? "invisible" : ""
          }`}
        >
          {node.isLoading ? (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {/* Node Icon */}
        {node.icon && (
          <span className="flex-shrink-0">{node.icon}</span>
        )}

        {/* Node Label */}
        <span className="text-sm truncate">{node.label}</span>

        {/* Optional muted trailing text (e.g. row count) */}
        {node.secondaryLabel != null && (
          <span className="ml-auto pl-2 text-xs text-muted-foreground/60 flex-shrink-0 tabular-nums">
            {node.secondaryLabel}
          </span>
        )}
      </div>

      {/* Children */}
      {isExpanded && node.children && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              onContextMenu={onContextMenu}
              onDoubleClick={onDoubleClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TreeViewProps {
  nodes: TreeNode[];
  selectedId?: string;
  defaultExpandedIds?: string[];
  /**
   * Ids that must always render expanded, merged on top of the user's internal
   * expansion state (e.g. ancestors of search matches). Lets a parent drive
   * filtered branches open without destroying the user's own expansion.
   */
  forceExpandedIds?: Set<string>;
  /**
   * Ids that should auto-expand the first time they appear (e.g. a connection
   * node that just connected). Unlike `forceExpandedIds` these are merged once
   * into the user's expansion state, so the node can still be collapsed again.
   */
  autoExpandIds?: readonly string[];
  onSelect?: (node: TreeNode) => void;
  onToggle?: (nodeId: string, isExpanded: boolean) => void;
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void;
  onDoubleClick?: (node: TreeNode) => void;
  className?: string;
}

function TreeView({
  nodes,
  selectedId,
  defaultExpandedIds = [],
  forceExpandedIds,
  autoExpandIds,
  onSelect,
  onToggle,
  onContextMenu,
  onDoubleClick,
  className = "",
}: TreeViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(defaultExpandedIds)
  );

  // Auto-expand ids the first time they appear (e.g. a node that just
  // connected). Each id is expanded only once: collapsing it afterwards sticks,
  // and an id that goes away and comes back (reconnect) auto-expands again.
  const autoExpandedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = autoExpandIds ?? [];
    const seen = autoExpandedRef.current;
    const fresh = ids.filter((id) => !seen.has(id));
    autoExpandedRef.current = new Set(ids);
    if (fresh.length === 0) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      fresh.forEach((id) => next.add(id));
      return next;
    });
  }, [autoExpandIds]);

  // Merge the forced (search-driven) ids with the user's internal expansion so
  // matching branches open up without clobbering the user's manual expansion.
  const effectiveExpandedIds = forceExpandedIds
    ? new Set([...expandedIds, ...forceExpandedIds])
    : expandedIds;

  const handleToggle = (nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      const isExpanded = next.has(nodeId);
      if (isExpanded) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      onToggle?.(nodeId, !isExpanded);
      return next;
    });
  };

  const handleSelect = (node: TreeNode) => {
    onSelect?.(node);
  };

  return (
    <div className={`select-none ${className}`}>
      {nodes.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          level={0}
          selectedId={selectedId}
          expandedIds={effectiveExpandedIds}
          onSelect={handleSelect}
          onToggle={handleToggle}
          onContextMenu={onContextMenu}
          onDoubleClick={onDoubleClick}
        />
      ))}
    </div>
  );
}

export default TreeView;
