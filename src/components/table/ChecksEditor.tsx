/**
 * ChecksEditor — controlled grid of CHECK constraint rows.
 *
 * Fully presentational: state lives in the parent via `checks` + `onChange`.
 * Each row is { Name input, Expression input } with per-row remove and an
 * "Add check" button. Styling mirrors IndexEditor.tsx.
 */

import { Trash2 } from "lucide-react";
import { useTranslation } from "../../i18n";
import type { DesignerCheck, Dialect } from "../../types";

// ---------------------------------------------------------------------------
// Unique-id counter (module-level; deterministic, no Date.now / Math.random)
// ---------------------------------------------------------------------------

let seq = 0;

export interface ChecksEditorProps {
  checks: DesignerCheck[];
  onChange: (checks: DesignerCheck[]) => void;
  dialect: Dialect;
}

export function ChecksEditor({ checks, onChange, dialect }: ChecksEditorProps) {
  const { t } = useTranslation();
  const addCheck = () => {
    onChange([
      ...checks,
      {
        id: `chk-${++seq}`,
        name: "chk_new",
        expression: "",
      },
    ]);
  };

  const updateCheck = (id: string, patch: Partial<DesignerCheck>) => {
    onChange(checks.map((chk) => (chk.id === id ? { ...chk, ...patch } : chk)));
  };

  const removeCheck = (id: string) => {
    onChange(checks.filter((chk) => chk.id !== id));
  };

  return (
    <div className="flex flex-col gap-3">
      {checks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("table.noCheckConstraints")}</p>
      ) : (
        checks.map((chk) => (
          <div
            key={chk.id}
            className="rounded-lg border border-border bg-secondary/40 p-3"
          >
            {/* Row 1: Name + Delete */}
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={chk.name}
                onChange={(e) => updateCheck(chk.id, { name: e.target.value })}
                placeholder={t("table.constraintNamePlaceholder")}
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                aria-label="Check constraint name"
              />
              <button
                onClick={() => removeCheck(chk.id)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title={t("table.removeCheckConstraint")}
                aria-label="Remove check constraint"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {/* Row 2: Expression */}
            <div className="mt-2">
              <input
                type="text"
                value={chk.expression}
                onChange={(e) => updateCheck(chk.id, { expression: e.target.value })}
                placeholder={t("table.checkExpressionPlaceholder")}
                className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-sm"
                aria-label="Check expression"
                spellCheck={false}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("table.checkExpressionHint")}
                <span className="font-mono"> CHECK ( )</span>).
              </p>
            </div>
          </div>
        ))
      )}

      <button
        onClick={addCheck}
        className="self-start rounded border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        title={
          dialect === "sqlite"
            ? t("table.sqliteSupportsChecks")
            : t("table.addCheckConstraintTooltip")
        }
      >
        {t("table.addCheck")}
      </button>
    </div>
  );
}
