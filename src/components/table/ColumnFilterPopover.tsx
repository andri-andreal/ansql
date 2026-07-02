import { useEffect, useRef, useState } from "react";
import { Filter, X } from "lucide-react";
import {
  OPERATOR_LABELS,
  OPERATOR_ORDER,
  VALUELESS_OPERATORS,
  isFilterActive,
  type ColumnFilter,
  type FilterOperator,
} from "../../lib/gridFilter";
import { useTranslation } from "../../i18n";

interface ColumnFilterPopoverProps {
  column: string;
  filter: ColumnFilter | undefined;
  onChange: (filter: ColumnFilter | undefined) => void;
}

/**
 * A small filter button + popover for a single column header. Clicking the funnel
 * opens operator + value controls; the funnel turns accent-colored when a filter
 * is active. Used by ResultsGrid (and surfaced through DataGridView's filter bar).
 */
export function ColumnFilterPopover({ column, filter, onChange }: ColumnFilterPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const operator: FilterOperator = filter?.operator ?? "contains";
  const value = filter?.value ?? "";
  const active = filter ? isFilterActive(filter) : false;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const update = (next: Partial<ColumnFilter>) => {
    const merged: ColumnFilter = {
      column,
      operator: next.operator ?? operator,
      value: next.value ?? value,
    };
    // When switching to a valueless operator, clear any operand.
    if (VALUELESS_OPERATORS.has(merged.operator)) merged.value = "";
    onChange(isFilterActive(merged) ? merged : undefined);
  };

  const valueless = VALUELESS_OPERATORS.has(operator);

  return (
    <div ref={ref} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`p-0.5 rounded transition-colors ${
          active ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"
        }`}
        title={active ? t("table.editFilter") : t("table.filterColumn")}
      >
        <Filter className="w-3 h-3" fill={active ? "currentColor" : "none"} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-56 bg-card border border-border rounded-md shadow-lg p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground truncate">{column}</span>
            {active && (
              <button
                type="button"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                title={t("table.clearThisFilter")}
              >
                <X className="w-3 h-3" /> {t("table.clear")}
              </button>
            )}
          </div>
          <select
            value={operator}
            onChange={(e) => update({ operator: e.target.value as FilterOperator })}
            className="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {OPERATOR_ORDER.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </option>
            ))}
          </select>
          {!valueless && (
            <input
              type="text"
              autoFocus
              value={value}
              onChange={(e) => update({ value: e.target.value })}
              placeholder={t("table.valuePlaceholder")}
              className="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}
        </div>
      )}
    </div>
  );
}

export default ColumnFilterPopover;
