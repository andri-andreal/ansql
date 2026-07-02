import { useEffect, useMemo, useState } from "react";
import { Link2, X } from "lucide-react";
import { useTranslation } from "../../i18n";

export interface ErdFkDialogProps {
  sourceTable: string;
  targetTable: string;
  sourceColumns: { name: string }[];
  targetColumns: { name: string }[];
  onConfirm: (fk: {
    name: string;
    localColumn: string;
    refColumn: string;
    onDelete?: string;
    onUpdate?: string;
  }) => void;
  onCancel: () => void;
}

// Referential actions offered for ON DELETE / ON UPDATE. Empty string = none.
const REFERENTIAL_ACTIONS = [
  "",
  "NO ACTION",
  "CASCADE",
  "SET NULL",
  "RESTRICT",
  "SET DEFAULT",
] as const;

/** Build a sensible default constraint name from the two table names. */
function defaultName(source: string, target: string) {
  const strip = (t: string) => t.split(".").pop() ?? t;
  return `fk_${strip(source)}_${strip(target)}`;
}

/**
 * Modal shown when the user drags an edge between two tables in the ER diagram
 * to create a foreign key. Picks the local column (on the source/owning table),
 * the referenced column (on the target table), a constraint name, and optional
 * ON DELETE / ON UPDATE referential actions.
 */
export function ErdFkDialog({
  sourceTable,
  targetTable,
  sourceColumns,
  targetColumns,
  onConfirm,
  onCancel,
}: ErdFkDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => defaultName(sourceTable, targetTable));
  const [localColumn, setLocalColumn] = useState(() => sourceColumns[0]?.name ?? "");
  const [refColumn, setRefColumn] = useState(() => targetColumns[0]?.name ?? "");
  const [onDelete, setOnDelete] = useState("");
  const [onUpdate, setOnUpdate] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const canConfirm = useMemo(
    () => name.trim().length > 0 && localColumn.length > 0 && refColumn.length > 0,
    [name, localColumn, refColumn],
  );

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      name: name.trim(),
      localColumn,
      refColumn,
      onDelete: onDelete || undefined,
      onUpdate: onUpdate || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-[30rem] max-w-[90vw] rounded-lg bg-background border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="w-4 h-4 text-muted-foreground" />
            {t("io.newForeignKey")}
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-secondary rounded transition-colors"
            aria-label={t("io.close")}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{sourceTable}</span> {t("io.references")}{" "}
            <span className="font-mono text-foreground">{targetTable}</span>
          </p>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("io.constraintName")} <span className="text-destructive">*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
              spellCheck={false}
              className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t("io.localColumn")} <span className="text-destructive">*</span>
              </label>
              <select
                value={localColumn}
                onChange={(e) => setLocalColumn(e.target.value)}
                aria-label={t("io.localColumn")}
                className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {sourceColumns.length === 0 && <option value="">{t("io.noColumns")}</option>}
                {sourceColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t("io.referencedColumn")} <span className="text-destructive">*</span>
              </label>
              <select
                value={refColumn}
                onChange={(e) => setRefColumn(e.target.value)}
                aria-label={t("io.referencedColumn")}
                className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {targetColumns.length === 0 && <option value="">{t("io.noColumns")}</option>}
                {targetColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                ON DELETE
              </label>
              <select
                value={onDelete}
                onChange={(e) => setOnDelete(e.target.value)}
                aria-label={t("io.onDelete")}
                className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {REFERENTIAL_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action === "" ? t("io.actionNone") : action}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                ON UPDATE
              </label>
              <select
                value={onUpdate}
                onChange={(e) => setOnUpdate(e.target.value)}
                aria-label={t("io.onUpdate")}
                className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {REFERENTIAL_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action === "" ? t("io.actionNone") : action}
                  </option>
                ))}
              </select>
            </div>
          </div>
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
            disabled={!canConfirm}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t("io.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
