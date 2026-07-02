import { useState, useEffect } from "react";
import { Star, X } from "lucide-react";
import { useTranslation } from "../../i18n";

interface SaveFavoriteDialogProps {
  open: boolean;
  /** The SQL that will be saved (shown as a read-only preview). */
  sql: string;
  onCancel: () => void;
  onSave: (name: string, description?: string) => Promise<void> | void;
}

/**
 * Small modal dialog to save the active editor's SQL as a favorite. Name is
 * required; description is optional.
 */
function SaveFavoriteDialog({ open, sql, onCancel, onSave }: SaveFavoriteDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset fields each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t("query.nameRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), description.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-[28rem] max-w-[90vw] rounded-lg bg-background border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Star className="w-4 h-4 text-muted-foreground" />
            {t("query.saveToFavorites")}
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-secondary rounded transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("query.name")} <span className="text-destructive">*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder={t("query.namePlaceholder")}
              className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("query.description")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("query.optional")}
              rows={2}
              className="w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("query.query")}
            </label>
            <pre className="max-h-32 overflow-auto bg-secondary/50 text-[11px] font-mono rounded px-3 py-2 whitespace-pre-wrap break-words text-muted-foreground">
              {sql.trim() || t("query.empty")}
            </pre>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-secondary transition-colors"
          >
            {t("query.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? t("query.saving") : t("query.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SaveFavoriteDialog;
