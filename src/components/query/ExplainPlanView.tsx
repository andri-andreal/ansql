import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Network, X } from "lucide-react";
import { flattenPlan, type PlanNode } from "../../lib/explainPlan";
import { useTranslation } from "../../i18n";

export interface ExplainPlanViewProps {
  /** Root plan nodes parsed from an EXPLAIN result. */
  nodes: PlanNode[];
  /** Close the panel. */
  onClose: () => void;
}

/** Format a numeric metric compactly; returns null when the value is absent. */
function fmtNum(n: number | null | undefined): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  if (Number.isInteger(n)) return n.toLocaleString();
  // Trim noisy trailing zeros on fractional costs/times.
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface PlanBadgeProps {
  label: string;
  value: number | null | undefined;
  suffix?: string;
}

/** A small metric chip (cost / rows / time). Renders nothing when value is null. */
function PlanBadge({ label, value, suffix }: PlanBadgeProps) {
  const text = fmtNum(value);
  if (text === null) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground tabular-nums whitespace-nowrap">
      {label} {text}
      {suffix ?? ""}
    </span>
  );
}

interface PlanRowProps {
  node: PlanNode;
  level: number;
  /** Stable path key for this node's expansion state. */
  pathKey: string;
  maxCost: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}

function PlanRow({ node, level, pathKey, maxCost, expanded, onToggle }: PlanRowProps) {
  const { t } = useTranslation();
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expanded.has(pathKey);

  // Warm tint for the costliest node(s): anything at >=80% of the max cost when
  // there is a meaningful (positive) cost to compare against.
  const cost = node.cost;
  const isHot =
    typeof cost === "number" &&
    !Number.isNaN(cost) &&
    maxCost > 0 &&
    cost >= maxCost * 0.8;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-1 pr-2 rounded transition-colors ${
          isHot ? "bg-amber-500/15 hover:bg-amber-500/20" : "hover:bg-accent/50"
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {/* Expand / collapse */}
        <button
          onClick={() => hasChildren && onToggle(pathKey)}
          className={`p-0.5 rounded hover:bg-secondary transition-colors flex-shrink-0 ${
            hasChildren ? "" : "invisible"
          }`}
          title={isExpanded ? t("query.collapse") : t("query.expand")}
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>

        {/* Node type + label */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-xs font-medium flex-shrink-0 ${
                isHot ? "text-amber-700 dark:text-amber-400" : "text-foreground"
              }`}
            >
              {node.nodeType}
            </span>
            {node.label && (
              <span className="text-xs text-muted-foreground truncate font-mono">
                {node.label}
              </span>
            )}
          </div>
        </div>

        {/* Metric badges */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <PlanBadge label="cost" value={node.cost} />
          <PlanBadge label="rows" value={node.rows} />
          <PlanBadge label="" value={node.actualMs} suffix="ms" />
        </div>
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {children.map((child, i) => (
            <PlanRow
              key={`${pathKey}.${i}`}
              node={child}
              level={level + 1}
              pathKey={`${pathKey}.${i}`}
              maxCost={maxCost}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Dockable panel that renders an EXPLAIN plan as a collapsible, indented tree.
 * Each node shows its node type, a label, and cost/rows/time badges. The
 * highest-cost node(s) — computed via flattenPlan — get a warm tint so hot
 * spots stand out. Every node with children can be expanded/collapsed; all
 * nodes start expanded.
 */
export function ExplainPlanView({ nodes, onClose }: ExplainPlanViewProps) {
  const { t } = useTranslation();
  const maxCost = useMemo(() => {
    let max = 0;
    for (const n of flattenPlan(nodes)) {
      const c = n.cost;
      if (typeof c === "number" && !Number.isNaN(c) && c > max) max = c;
    }
    return max;
  }, [nodes]);

  // Collect every node path so the tree starts fully expanded.
  const allKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (list: PlanNode[], prefix: string) => {
      list.forEach((n, i) => {
        const key = `${prefix}${i}`;
        keys.push(key);
        if (n.children && n.children.length > 0) walk(n.children, `${key}.`);
      });
    };
    walk(nodes, "");
    return keys;
  }, [nodes]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allKeys));

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Network className="w-4 h-4 text-muted-foreground" />
          {t("query.explainPlan")}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(new Set(allKeys))}
            disabled={expanded.size >= allKeys.length}
            className="px-2 py-1 text-[11px] rounded hover:bg-secondary text-muted-foreground transition-colors disabled:opacity-40"
            title={t("query.expandAllTooltip")}
          >
            {t("query.expandAll")}
          </button>
          <button
            onClick={() => setExpanded(new Set())}
            disabled={expanded.size === 0}
            className="px-2 py-1 text-[11px] rounded hover:bg-secondary text-muted-foreground transition-colors disabled:opacity-40"
            title={t("query.collapseAllTooltip")}
          >
            {t("query.collapseAll")}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-secondary rounded transition-colors"
            title={t("query.close")}
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto select-none p-1">
        {nodes.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            {t("query.noPlanNodes")}
          </div>
        ) : (
          nodes.map((node, i) => (
            <PlanRow
              key={`${i}`}
              node={node}
              level={0}
              pathKey={`${i}`}
              maxCost={maxCost}
              expanded={expanded}
              onToggle={toggle}
            />
          ))
        )}
      </div>
    </div>
  );
}
