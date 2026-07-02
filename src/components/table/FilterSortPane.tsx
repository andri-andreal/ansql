import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import {
  OPERATOR_LABELS,
  OPERATOR_ORDER,
  VALUELESS_OPERATORS,
  type ColumnFilter,
  type FilterOperator,
} from "../../lib/gridFilter";
import { useTranslation } from "../../i18n";
import type { SortSpec } from "../../lib/whereBuilder";

/**
 * A compact, dockable Filter & Sort pane. Holds local draft state for a list of
 * column filters (combined with AND/OR) and a list of sort specs. Editing here
 * never touches the DB — Apply hands the draft back to the parent, which is
 * responsible for re-querying / re-sorting. Seeded from props on mount.
 */
export interface FilterSortPaneProps {
  columns: { name: string }[];
  filters: ColumnFilter[];
  combinator: "AND" | "OR";
  sorts: SortSpec[];
  onApply: (filters: ColumnFilter[], combinator: "AND" | "OR", sorts: SortSpec[]) => void;
  onClear: () => void;
  onClose: () => void;
}

const selectClass =
  "px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary";
const inputClass =
  "px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary";

export function FilterSortPane(props: FilterSortPaneProps) {
  const { t } = useTranslation();
  const { columns, onApply, onClear, onClose } = props;
  const firstColumn = columns[0]?.name ?? "";

  const [filters, setFilters] = useState<ColumnFilter[]>(() => props.filters.map((f) => ({ ...f })));
  const [combinator, setCombinator] = useState<"AND" | "OR">(props.combinator);
  const [sorts, setSorts] = useState<SortSpec[]>(() => props.sorts.map((s) => ({ ...s })));

  // ── Filter row helpers ──────────────────────────────────────────────────
  const addFilter = () => {
    setFilters((prev) => [...prev, { column: firstColumn, operator: "contains", value: "" }]);
  };
  const removeFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };
  const updateFilter = (index: number, patch: Partial<ColumnFilter>) => {
    setFilters((prev) =>
      prev.map((f, i) => {
        if (i !== index) return f;
        const next: ColumnFilter = { ...f, ...patch };
        // Switching to a valueless operator clears the operand.
        if (VALUELESS_OPERATORS.has(next.operator)) next.value = "";
        return next;
      })
    );
  };

  // ── Sort row helpers ────────────────────────────────────────────────────
  const addSort = () => {
    setSorts((prev) => [...prev, { column: firstColumn, direction: "asc" }]);
  };
  const removeSort = (index: number) => {
    setSorts((prev) => prev.filter((_, i) => i !== index));
  };
  const updateSort = (index: number, patch: Partial<SortSpec>) => {
    setSorts((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const handleApply = () => {
    onApply(filters, combinator, sorts);
  };

  return (
    <div className="flex flex-col w-72 bg-card border border-border rounded-md shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-foreground">{t("table.filterAndSort")}</span>
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
        {/* ── Filter section ── */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("table.filter")}
            </h3>
            {filters.length > 1 && (
              <div className="inline-flex rounded border border-border overflow-hidden text-[10px] font-medium">
                {(["AND", "OR"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCombinator(c)}
                    className={`px-2 py-0.5 transition-colors ${
                      combinator === c
                        ? "bg-blue-600 text-white"
                        : "bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {filters.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("table.noConditions")}</p>
          ) : (
            <ul className="space-y-1.5">
              {filters.map((f, i) => {
                const valueless = VALUELESS_OPERATORS.has(f.operator);
                return (
                  <li key={i} className="flex items-center gap-1">
                    <select
                      value={f.column}
                      onChange={(e) => updateFilter(i, { column: e.target.value })}
                      className={`${selectClass} flex-1 min-w-0`}
                    >
                      {columns.map((col) => (
                        <option key={col.name} value={col.name}>
                          {col.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={f.operator}
                      onChange={(e) =>
                        updateFilter(i, { operator: e.target.value as FilterOperator })
                      }
                      className={`${selectClass} shrink-0`}
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
                        value={f.value}
                        onChange={(e) => updateFilter(i, { value: e.target.value })}
                        placeholder={t("table.valuePlaceholder")}
                        className={`${inputClass} flex-1 min-w-0`}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeFilter(i)}
                      className="p-1 shrink-0 rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
                      title={t("table.removeCondition")}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            onClick={addFilter}
            disabled={columns.length === 0}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> {t("table.addCondition")}
          </button>
        </section>

        {/* ── Sort section ── */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("table.sort")}
          </h3>

          {sorts.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("table.noSorting")}</p>
          ) : (
            <ul className="space-y-1.5">
              {sorts.map((s, i) => (
                <li key={i} className="flex items-center gap-1">
                  <select
                    value={s.column}
                    onChange={(e) => updateSort(i, { column: e.target.value })}
                    className={`${selectClass} flex-1 min-w-0`}
                  >
                    {columns.map((col) => (
                      <option key={col.name} value={col.name}>
                        {col.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      updateSort(i, { direction: s.direction === "asc" ? "desc" : "asc" })
                    }
                    className="flex items-center gap-1 px-2 py-1 shrink-0 text-xs bg-background border border-border rounded text-muted-foreground hover:text-foreground transition-colors"
                    title={s.direction === "asc" ? t("table.ascending") : t("table.descending")}
                  >
                    {s.direction === "asc" ? (
                      <ArrowUp className="w-3 h-3" />
                    ) : (
                      <ArrowDown className="w-3 h-3" />
                    )}
                    {s.direction === "asc" ? "ASC" : "DESC"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSort(i)}
                    className="p-1 shrink-0 rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
                    title={t("table.removeSort")}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={addSort}
            disabled={columns.length === 0}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> {t("table.addSort")}
          </button>
        </section>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border">
        <button
          type="button"
          onClick={onClear}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded transition-colors font-medium"
        >
          {t("table.clear")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs bg-secondary hover:bg-secondary/80 rounded transition-colors font-medium"
        >
          {t("table.close")}
        </button>
        <button
          type="button"
          onClick={handleApply}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors font-medium"
        >
          {t("table.apply")}
        </button>
      </div>
    </div>
  );
}

export default FilterSortPane;
