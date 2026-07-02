import { useEffect, useRef, useState } from "react";
import { X, Pencil } from "lucide-react";
import { useTranslation } from "../../i18n";

interface BulkEditDialogProps {
  /** How many cells will be changed. */
  cellCount: number;
  /** Distinct column names spanned by the selection (for the summary). */
  columnNames: string[];
  onApply: (value: string | null) => void;
  onCancel: () => void;
}

/**
 * Dialog to set the same value (or NULL) across all currently-selected cells.
 * The actual application flows through the host's edit-state + undo stack so the
 * change is undoable and included in the next commit.
 */
export function BulkEditDialog({ cellCount, columnNames, onApply, onCancel }: BulkEditDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [setNull, setSetNull] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const apply = () => onApply(setNull ? null : value);

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] bg-card border border-border rounded-lg shadow-2xl z-50 flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" />
            <h3 className="text-base font-semibold">{t("table.bulkEditCells")}</h3>
          </div>
          <button onClick={onCancel} className="p-1.5 hover:bg-secondary rounded transition-colors" title={t("table.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            This will set the same value across{" "}
            <span className="font-medium text-foreground">{cellCount}</span>{" "}
            {cellCount === 1 ? t("table.cell") : t("table.cells")}
            {columnNames.length > 0 && (
              <>
                {" "}
                {t("table.bulkEditInColumns")}{" "}
                <span className="font-medium text-foreground">
                  {columnNames.slice(0, 4).join(", ")}
                  {columnNames.length > 4
                    ? t("table.bulkEditMoreColumns", { count: columnNames.length - 4 })
                    : ""}
                </span>
              </>
            )}
            .
          </p>

          <div className="space-y-2">
            <label className="block text-sm font-medium">{t("table.newValue")}</label>
            <input
              ref={inputRef}
              type="text"
              value={value}
              disabled={setNull}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              placeholder={t("table.enterValuePlaceholder")}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={setNull}
                onChange={(e) => setSetNull(e.target.checked)}
                className="accent-primary"
              />
              {t("table.setToNull")}
            </label>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm bg-secondary hover:bg-secondary/80 rounded transition-colors font-medium"
          >
            {t("table.cancel")}
          </button>
          <button
            onClick={apply}
            disabled={cellCount === 0}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors font-medium disabled:opacity-50"
          >
            {cellCount === 1
              ? t("table.applyToCell", { count: cellCount })
              : t("table.applyToCells", { count: cellCount })}
          </button>
        </div>
      </div>
    </>
  );
}

export default BulkEditDialog;
