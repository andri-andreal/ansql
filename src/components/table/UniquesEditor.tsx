/**
 * UniquesEditor — controlled grid of UNIQUE constraint rows.
 *
 * Fully presentational: state lives in the parent via `uniques` + `onChange`.
 * Each row is { Name input, multi-column chip-toggle selector } with per-row
 * remove and an "Add unique" button. Styling mirrors IndexEditor.tsx.
 */

import { Trash2 } from "lucide-react";
import { useTranslation } from "../../i18n";
import type { DesignerUnique } from "../../types";

// ---------------------------------------------------------------------------
// Unique-id counter (module-level; deterministic, no Date.now / Math.random)
// ---------------------------------------------------------------------------

let seq = 0;

export interface UniquesEditorProps {
  uniques: DesignerUnique[];
  availableColumns: string[];
  onChange: (uniques: DesignerUnique[]) => void;
}

export function UniquesEditor({ uniques, availableColumns, onChange }: UniquesEditorProps) {
  const { t } = useTranslation();
  const addUnique = () => {
    onChange([
      ...uniques,
      {
        id: `uq-${++seq}`,
        name: "uq_new",
        columns: [],
      },
    ]);
  };

  const updateUnique = (id: string, patch: Partial<DesignerUnique>) => {
    onChange(uniques.map((uq) => (uq.id === id ? { ...uq, ...patch } : uq)));
  };

  const removeUnique = (id: string) => {
    onChange(uniques.filter((uq) => uq.id !== id));
  };

  const toggleColumn = (uniqueId: string, col: string, currentColumns: string[]) => {
    const next = currentColumns.includes(col)
      ? currentColumns.filter((c) => c !== col)
      : [...currentColumns, col];
    updateUnique(uniqueId, { columns: next });
  };

  return (
    <div className="flex flex-col gap-3">
      {uniques.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("table.noUniqueConstraints")}</p>
      ) : (
        uniques.map((uq) => (
          <div
            key={uq.id}
            className="rounded-lg border border-border bg-secondary/40 p-3"
          >
            {/* Row 1: Name + Delete */}
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={uq.name}
                onChange={(e) => updateUnique(uq.id, { name: e.target.value })}
                placeholder={t("table.constraintNamePlaceholder")}
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                aria-label="Unique constraint name"
              />
              <button
                onClick={() => removeUnique(uq.id)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title={t("table.removeUniqueConstraint")}
                aria-label="Remove unique constraint"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {/* Row 2: Column chips */}
            {availableColumns.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {availableColumns.map((col) => {
                  const active = uq.columns.includes(col);
                  return (
                    <button
                      key={col}
                      onClick={() => toggleColumn(uq.id, col, uq.columns)}
                      className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                        active
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-secondary"
                      }`}
                      aria-pressed={active}
                      title={
                        active
                          ? t("table.removeColumnFromConstraint", { column: col })
                          : t("table.addColumnToConstraint", { column: col })
                      }
                    >
                      {col}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("table.noColumnsAvailable")}
              </p>
            )}

            {/* Selected columns summary */}
            {uq.columns.length > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t("table.columnsLabel")}{" "}
                <span className="font-mono text-foreground">{uq.columns.join(", ")}</span>
              </p>
            )}
          </div>
        ))
      )}

      <button
        onClick={addUnique}
        className="self-start rounded border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        {t("table.addUnique")}
      </button>
    </div>
  );
}
