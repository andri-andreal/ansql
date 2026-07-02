import type { ColumnMap, ColumnMeta } from "../../types";
import { useTranslation } from "../../i18n";

interface ColumnMappingProps {
  sourceColumns: ColumnMeta[];
  /** Known target column names; empty when the target table is being created. */
  targetColumns: string[];
  mapping: ColumnMap[];
  onChange: (mapping: ColumnMap[]) => void;
  /**
   * Per-target-column type override (target column name → SQL type), used when
   * the target table is being CREATED so the user can pick column types. Ignored
   * when mapping into an existing table. Optional — omit to hide the type column.
   */
  types?: Record<string, string>;
  onTypesChange?: (types: Record<string, string>) => void;
}

/**
 * Auto-map source→target by exact name; let the user override each target via a
 * dropdown (or free text when the target table does not exist yet). A target of
 * "" drops that source column from the transfer.
 */
export function autoMap(sourceColumns: ColumnMeta[], targetColumns: string[]): ColumnMap[] {
  const targetSet = new Set(targetColumns.map((c) => c.toLowerCase()));
  return sourceColumns.map((c) => ({
    source: c.name,
    target:
      targetColumns.length === 0 || targetSet.has(c.name.toLowerCase()) ? c.name : "",
  }));
}

export function ColumnMapping({
  sourceColumns,
  targetColumns,
  mapping,
  onChange,
  types,
  onTypesChange,
}: ColumnMappingProps) {
  const { t } = useTranslation();
  const setTarget = (source: string, target: string) => {
    onChange(mapping.map((m) => (m.source === source ? { ...m, target } : m)));
  };

  const creating = targetColumns.length === 0;
  // The type-override column only makes sense when creating a new table AND the
  // caller wired up a types handler.
  const showTypes = creating && !!onTypesChange;

  /** Bulk: re-derive targets from source names (matching existing target names). */
  const matchByName = () => {
    onChange(autoMap(sourceColumns, targetColumns));
  };
  /** Bulk: clear every target ("" drops the column from the transfer). */
  const clearAll = () => {
    onChange(mapping.map((m) => ({ ...m, target: "" })));
  };

  const gridCols = showTypes ? "grid-cols-3" : "grid-cols-2";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground">{t("io.columnMapping")}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={matchByName}
            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
          >
            {t("io.matchByName")}
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary"
          >
            {t("io.clearAll")}
          </button>
        </div>
      </div>
      <div className={`grid ${gridCols} gap-2 text-xs font-medium text-muted-foreground px-1`}>
        <span>{t("io.sourceColumn")}</span>
        <span>{t("io.targetColumn")}</span>
        {showTypes && <span>{t("io.targetType")}</span>}
      </div>
      {sourceColumns.map((c, i) => {
        const current = mapping.find((m) => m.source === c.name)?.target ?? "";
        return (
          <div key={`${c.name}-${i}`} className={`grid ${gridCols} gap-2 items-center`}>
            <span className="truncate text-sm" title={`${c.name} (${c.data_type})`}>
              {c.name} <span className="text-muted-foreground">{c.data_type}</span>
            </span>
            {creating ? (
              <input
                value={current}
                onChange={(e) => setTarget(c.name, e.target.value)}
                className="rounded border border-border bg-background px-2 py-1 text-sm"
              />
            ) : (
              <select
                value={current}
                onChange={(e) => setTarget(c.name, e.target.value)}
                className="rounded border border-border bg-background px-2 py-1 text-sm"
              >
                <option value="">{t("io.skip")}</option>
                {targetColumns.map((tc) => (
                  <option key={tc} value={tc}>
                    {tc}
                  </option>
                ))}
              </select>
            )}
            {showTypes &&
              (current ? (
                <input
                  value={types?.[current] ?? ""}
                  onChange={(e) =>
                    onTypesChange!({ ...(types ?? {}), [current]: e.target.value })
                  }
                  placeholder={t("io.inferredPlaceholder")}
                  className="rounded border border-border bg-background px-2 py-1 text-sm"
                />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              ))}
          </div>
        );
      })}
    </div>
  );
}
