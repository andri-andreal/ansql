import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import { useTranslation } from "../../i18n";
import type { ColumnDefinition } from "../../types";

export interface FormViewProps {
  columns: ColumnDefinition[];
  /** Current (possibly edited) values of the active row. */
  values: Record<string, unknown>;
  /** e.g. "Record 3 of 120". */
  rowLabel: string;
  canPrev: boolean;
  canNext: boolean;
  onNavigate: (dir: "first" | "prev" | "next" | "last") => void;
  /** Routes through the same edit pipeline as the grid. */
  onEdit: (column: string, value: unknown) => void;
  /** Columns with uncommitted edits (highlight). */
  dirtyColumns?: Set<string>;
}

/** Types that warrant a multi-line <textarea> rather than a single <input>. */
const MULTILINE_TYPES = ["text", "json", "jsonb", "blob", "bytea", "xml"];

function isMultiline(col: ColumnDefinition): boolean {
  const t = (col.full_type ?? col.data_type ?? "").toLowerCase();
  return MULTILINE_TYPES.some((m) => t.includes(m));
}

/** A muted type hint shown next to the field label. */
function typeHint(col: ColumnDefinition): string {
  return col.full_type ?? col.data_type ?? "";
}

/**
 * Single-record (form) view of the active row. Pure presentational: it renders
 * one labeled field per column and routes every change through `onEdit`, which
 * shares the grid's edit pipeline. Navigation is delegated to `onNavigate`.
 */
export function FormView({
  columns,
  values,
  rowLabel,
  canPrev,
  canNext,
  onNavigate,
  onEdit,
  dirtyColumns,
}: FormViewProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Navigation toolbar */}
      <div className="flex items-center justify-center gap-1 px-3 py-2 border-b border-border bg-card">
        <button
          onClick={() => onNavigate("first")}
          disabled={!canPrev}
          className="p-1.5 hover:bg-secondary rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("table.firstRecord")}
        >
          <ChevronsLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <button
          onClick={() => onNavigate("prev")}
          disabled={!canPrev}
          className="p-1.5 hover:bg-secondary rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("table.previousRecord")}
        >
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <span className="px-3 text-sm text-muted-foreground whitespace-nowrap tabular-nums">
          {rowLabel}
        </span>
        <button
          onClick={() => onNavigate("next")}
          disabled={!canNext}
          className="p-1.5 hover:bg-secondary rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("table.nextRecord")}
        >
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
        <button
          onClick={() => onNavigate("last")}
          disabled={!canNext}
          className="p-1.5 hover:bg-secondary rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("table.lastRecord")}
        >
          <ChevronsRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Scrollable form */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 py-4 space-y-4">
          {columns.map((col) => {
            const raw = values[col.name];
            const isNull = raw === null || raw === undefined;
            const dirty = dirtyColumns?.has(col.name) ?? false;
            const multiline = isMultiline(col);
            const fieldValue = isNull ? "" : String(raw);

            const fieldClass = [
              "w-full px-3 py-2 text-sm bg-background border rounded transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-primary",
              dirty
                ? "border-amber-500/60 ring-1 ring-amber-500/40"
                : "border-border",
            ].join(" ");

            return (
              <div key={col.name} className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <label
                    htmlFor={`form-field-${col.name}`}
                    className="text-sm font-medium"
                  >
                    {col.name}
                  </label>
                  <span className="text-xs text-muted-foreground font-mono">
                    {typeHint(col)}
                  </span>
                  {col.is_primary_key && (
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      PK
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {col.nullable ? "NULL" : "NOT NULL"}
                  </span>
                  {dirty && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      {t("table.edited")}
                    </span>
                  )}
                </div>

                <div className="flex items-start gap-2">
                  {multiline ? (
                    <textarea
                      id={`form-field-${col.name}`}
                      value={fieldValue}
                      placeholder={isNull ? "(NULL)" : undefined}
                      rows={4}
                      onChange={(e) => onEdit(col.name, e.target.value)}
                      className={`${fieldClass} resize-y font-mono`}
                    />
                  ) : (
                    <input
                      id={`form-field-${col.name}`}
                      type="text"
                      value={fieldValue}
                      placeholder={isNull ? "(NULL)" : undefined}
                      onChange={(e) => onEdit(col.name, e.target.value)}
                      className={fieldClass}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onEdit(col.name, null)}
                    disabled={isNull}
                    className="shrink-0 px-2.5 py-2 text-xs bg-secondary hover:bg-secondary/80 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    title={col.nullable ? t("table.setFieldToNull") : t("table.columnIsNotNull")}
                  >
                    {t("table.setNull")}
                  </button>
                </div>

                {isNull && (
                  <p className="text-xs text-muted-foreground italic">(NULL)</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default FormView;
