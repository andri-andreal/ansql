import { useState } from "react";
import { Code2, Plus, Trash2, Pencil, X, Check } from "lucide-react";
import { useSnippets, type UserSnippet } from "../../hooks/useSnippets";
import { useTranslation } from "../../i18n";

export interface SnippetManagerProps {
  /** Close the panel. */
  onClose: () => void;
  /** Insert a snippet's body into the active editor. */
  onInsert?: (body: string) => void;
}

/** Collapse whitespace and clip long snippet bodies for the list preview. */
function preview(body: string, max = 90): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

const inputClass =
  "w-full bg-secondary text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary";

/**
 * Dockable side panel for managing the user's SQL snippet library. Lists saved
 * snippets, lets you add/edit (name, body, optional description), delete, and
 * insert a snippet's body into the active editor. Persists via useSnippets.
 */
export function SnippetManager({ onClose, onInsert }: SnippetManagerProps) {
  const { t } = useTranslation();
  const { snippets, add, update, remove } = useSnippets();

  // null = form hidden, "new" = creating, otherwise the id being edited.
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [description, setDescription] = useState("");

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setBody("");
    setDescription("");
  };

  const startNew = () => {
    setEditingId("new");
    setName("");
    setBody("");
    setDescription("");
  };

  const startEdit = (s: UserSnippet) => {
    setEditingId(s.id);
    setName(s.name);
    setBody(s.body);
    setDescription(s.description ?? "");
  };

  const canSave = name.trim() !== "" && body.trim() !== "";

  const handleSave = () => {
    if (!canSave) return;
    const payload = {
      name: name.trim(),
      body,
      description: description.trim() || undefined,
    };
    if (editingId === "new") {
      add(payload);
    } else if (editingId) {
      update(editingId, payload);
    }
    resetForm();
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-border w-80">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Code2 className="w-4 h-4 text-muted-foreground" />
          {t("query.snippets")}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startNew}
            className="p-1.5 hover:bg-secondary rounded transition-colors"
            title={t("query.newSnippet")}
          >
            <Plus className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-secondary rounded transition-colors"
            title={t("query.close")}
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Add / edit form */}
      {editingId !== null && (
        <div className="px-3 py-3 space-y-2 border-b border-border bg-background">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("query.name")} <span className="text-destructive">*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("query.snippetNamePlaceholder")}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("query.body")} <span className="text-destructive">*</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("query.snippetBodyPlaceholder")}
              rows={4}
              className={`${inputClass} font-mono resize-none`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("query.description")}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("query.optional")}
              className={inputClass}
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={resetForm}
              className="px-3 py-1.5 text-sm rounded-lg hover:bg-secondary transition-colors"
            >
              {t("query.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {editingId === "new" ? t("query.add") : t("query.save")}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {snippets.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            {t("query.noSnippets")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {snippets.map((item) => (
              <li
                key={item.id}
                className="group px-3 py-2 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">
                      {item.name}
                    </p>
                    {item.description && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {item.description}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] font-mono text-muted-foreground break-words">
                      {preview(item.body)}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onInsert && (
                      <button
                        onClick={() => onInsert(item.body)}
                        className="p-1 rounded hover:bg-secondary text-muted-foreground"
                        title={t("query.insertIntoEditor")}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(item)}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground"
                      title={t("query.edit")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => remove(item.id)}
                      className="p-1 rounded hover:bg-destructive/20 hover:text-destructive text-muted-foreground"
                      title={t("query.delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
