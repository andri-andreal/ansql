import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, X } from "lucide-react";
import { useTranslation } from "../../i18n";

/**
 * A dockable column-config popover for the data grid. Holds local draft state for
 * column visibility, column order, the frozen-column count and the row height,
 * pushing each change back to the parent via `onChange` (the parent owns the grid
 * and re-renders). Seeded from props.
 *
 * `order` is the authoritative column ordering (an array of column names). Any
 * column missing from `order` is appended in its `columns` order, so the list is
 * always complete and stable. `hidden` lists the column names the user hid.
 */
export interface ColumnConfigPopoverProps {
  columns: { name: string }[];
  hidden: string[];
  order: string[];
  frozenCount: number;
  rowHeight: number;
  onChange: (patch: {
    hidden?: string[];
    order?: string[];
    frozenCount?: number;
    rowHeight?: number;
  }) => void;
  onClose: () => void;
}

/** Row-height presets the select offers (label key → px). */
const ROW_HEIGHTS: { labelKey: string; value: number }[] = [
  { labelKey: "table.rowHeightCompact", value: 28 },
  { labelKey: "table.rowHeightNormal", value: 34 },
  { labelKey: "table.rowHeightTall", value: 48 },
];

/** Merge `order` with `columns` so every column appears exactly once, in order. */
function resolveOrder(columns: { name: string }[], order: string[]): string[] {
  const names = columns.map((c) => c.name);
  const known = new Set(names);
  const ordered = order.filter((n) => known.has(n));
  const seen = new Set(ordered);
  for (const n of names) if (!seen.has(n)) ordered.push(n);
  return ordered;
}

export function ColumnConfigPopover(props: ColumnConfigPopoverProps) {
  const { t } = useTranslation();
  const { columns, onChange, onClose } = props;

  const ordered = resolveOrder(columns, props.order);
  const hiddenSet = new Set(props.hidden);
  const [frozen, setFrozen] = useState(props.frozenCount);

  // ── Visibility ────────────────────────────────────────────────────────────
  const toggleHidden = (name: string) => {
    const next = new Set(hiddenSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange({ hidden: Array.from(next) });
  };

  // ── Reorder ───────────────────────────────────────────────────────────────
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const next = ordered.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange({ order: next });
  };

  // ── Frozen count ──────────────────────────────────────────────────────────
  const applyFrozen = (raw: number) => {
    const clamped = Math.max(0, Math.min(columns.length, Math.floor(raw) || 0));
    setFrozen(clamped);
    onChange({ frozenCount: clamped });
  };

  return (
    <div className="flex flex-col w-72 bg-card border border-border rounded-md shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-foreground">{t("table.columnsAndLayout")}</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 hover:bg-secondary rounded transition-colors text-muted-foreground hover:text-foreground"
          title={t("table.close")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-3 space-y-4 max-h-[60vh] overflow-y-auto">
        {/* ── Columns (hide/show + reorder) ── */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("table.columns")}
          </h3>
          {ordered.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("table.noColumns")}</p>
          ) : (
            <ul className="space-y-1">
              {ordered.map((name, i) => {
                const isHidden = hiddenSet.has(name);
                return (
                  <li key={name} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleHidden(name)}
                      className={`p-1 shrink-0 rounded transition-colors ${
                        isHidden
                          ? "text-muted-foreground/50 hover:text-muted-foreground"
                          : "text-primary"
                      }`}
                      title={isHidden ? t("table.showColumn") : t("table.hideColumn")}
                    >
                      {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <span
                      className={`flex-1 min-w-0 truncate text-xs ${
                        isHidden ? "text-muted-foreground/60 line-through" : "text-foreground"
                      }`}
                      title={name}
                    >
                      {name}
                    </span>
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="p-1 shrink-0 rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                      title={t("table.moveUp")}
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === ordered.length - 1}
                      className="p-1 shrink-0 rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                      title={t("table.moveDown")}
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Freeze ── */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("table.freeze")}
          </h3>
          <label className="flex items-center justify-between gap-2 text-xs text-foreground">
            <span>{t("table.freezeFirstNColumns")}</span>
            <input
              type="number"
              min={0}
              max={columns.length}
              value={frozen}
              onChange={(e) => applyFrozen(Number(e.target.value))}
              className="w-16 px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
        </section>

        {/* ── Row height ── */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("table.rowHeight")}
          </h3>
          <select
            value={props.rowHeight}
            onChange={(e) => onChange({ rowHeight: Number(e.target.value) })}
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {ROW_HEIGHTS.map((h) => (
              <option key={h.value} value={h.value}>
                {t(h.labelKey)} ({h.value}px)
              </option>
            ))}
          </select>
        </section>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs bg-secondary hover:bg-secondary/80 rounded transition-colors font-medium"
        >
          {t("table.done")}
        </button>
      </div>
    </div>
  );
}

export default ColumnConfigPopover;
