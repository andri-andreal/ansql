import { useState } from "react";
import { Variable, Play, X } from "lucide-react";
import { useTranslation } from "../../i18n";

export interface ParamInputDialogProps {
  names: string[];
  onSubmit: (values: Record<string, string>, raw: boolean) => void;
  onCancel: () => void;
}

/**
 * Small centered modal that prompts the user for one value per named query
 * parameter before running. A "Raw mode" toggle controls whether the values
 * are bound as parameters or substituted literally into the SQL.
 */
export function ParamInputDialog({ names, onSubmit, onCancel }: ParamInputDialogProps) {
  const { t } = useTranslation();
  // Seed each known parameter with an empty value.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(names.map((n) => [n, ""])),
  );
  const [raw, setRaw] = useState(false);

  const setValue = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = () => {
    // Ensure every name is present even if its input was never focused.
    const complete: Record<string, string> = {};
    for (const n of names) complete[n] = values[n] ?? "";
    onSubmit(complete, raw);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="bg-card shadow-xl w-[28rem] max-w-[90vw] max-h-[85vh] flex flex-col rounded-xl border border-border animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Variable className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">{t("query.queryParameters")}</h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 space-y-4">
          {names.map((name, i) => (
            <div key={name}>
              <label className="block text-sm font-medium mb-1.5">{name}</label>
              <input
                autoFocus={i === 0}
                type="text"
                value={values[name] ?? ""}
                onChange={(e) => setValue(name, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={t("query.valueFor", { name })}
                className="w-full px-3 py-2 bg-secondary rounded-lg border border-input focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
          ))}

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={raw}
              onChange={(e) => setRaw(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="text-sm font-medium">{t("query.rawMode")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("query.rawModeDescription")}
              </span>
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
          >
            {t("query.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Play className="w-4 h-4" />
            {t("query.run")}
          </button>
        </div>
      </div>
    </div>
  );
}
