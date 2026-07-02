import { useEffect, useMemo, useState } from "react";
import { Table2, X } from "lucide-react";
import { useTranslation } from "../../i18n";

export interface TableSelectionDialogProps {
  tables: { name: string }[];
  selected: string[];
  onConfirm: (selected: string[]) => void;
  onCancel: () => void;
}

/**
 * Modal presenting a checklist of tables with select-all / select-none, used to
 * choose which tables participate in an ERD action (e.g. forward-engineer /
 * export). Confirms with the chosen subset.
 */
export function TableSelectionDialog({
  tables,
  selected,
  onConfirm,
  onCancel,
}: TableSelectionDialogProps) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const allChecked = useMemo(
    () => tables.length > 0 && tables.every((t) => checked.has(t.name)),
    [tables, checked],
  );

  const toggle = (name: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => setChecked(new Set(tables.map((t) => t.name)));
  const selectNone = () => setChecked(new Set());

  const handleConfirm = () => {
    // Preserve incoming table order in the result.
    onConfirm(tables.filter((t) => checked.has(t.name)).map((t) => t.name));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-[26rem] max-w-[90vw] rounded-lg bg-background border border-border shadow-xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Table2 className="w-4 h-4 text-muted-foreground" />
            {t("io.selectTablesTitle")}
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-secondary rounded transition-colors"
            aria-label={t("io.close")}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Select all / none */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <span className="text-xs text-muted-foreground">
            {t("io.selectedOfTotal", { selected: checked.size, total: tables.length })}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              disabled={allChecked}
              className="text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {t("io.selectAll")}
            </button>
            <span className="text-border">|</span>
            <button
              onClick={selectNone}
              disabled={checked.size === 0}
              className="text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {t("io.selectNone")}
            </button>
          </div>
        </div>

        {/* Checklist */}
        <div className="flex-1 overflow-auto px-2 py-2">
          {tables.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t("io.noTablesPeriod")}</p>
          ) : (
            <ul className="space-y-0.5">
              {tables.map((tbl) => (
                <li key={tbl.name}>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-secondary">
                    <input
                      type="checkbox"
                      checked={checked.has(tbl.name)}
                      onChange={() => toggle(tbl.name)}
                      className="accent-primary"
                    />
                    <span className="truncate font-mono">{tbl.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-secondary transition-colors"
          >
            {t("io.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={checked.size === 0}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t("io.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
