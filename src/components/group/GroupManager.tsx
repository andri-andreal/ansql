import { useState } from "react";
import {
  X,
  FolderTree,
  Plus,
  Edit,
  Trash2,
  Loader2,
  AlertCircle,
  Check,
} from "lucide-react";
import { useGroups } from "../../hooks/useGroups";
import { useTranslation } from "../../i18n";
import type { ConnectionGroup } from "../../types";

interface GroupManagerProps {
  onClose: () => void;
  /** Notified after any create/update/delete so callers can refresh selectors. */
  onChange?: () => void;
}

const INPUT_CLASS =
  "w-full px-3 py-2 bg-secondary rounded-lg border border-input focus:outline-none focus:ring-2 focus:ring-primary transition-all";

const COLOR_PRESETS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface DraftState {
  name: string;
  description: string;
  color: string;
  icon: string;
  parent_id: string;
}

const EMPTY_DRAFT: DraftState = {
  name: "",
  description: "",
  color: "",
  icon: "",
  parent_id: "",
};

function GroupManager({ onClose, onChange }: GroupManagerProps) {
  const { t } = useTranslation();
  const { groups, loading, error, createGroup, updateGroup, deleteGroup } = useGroups();

  // null = creating a new group; otherwise the id of the group being edited.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isEditing = editingId !== null;

  const startCreate = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
  };

  const startEdit = (group: ConnectionGroup) => {
    setEditingId(group.id);
    setDraft({
      name: group.name,
      description: group.description ?? "",
      color: group.color ?? "",
      icon: group.icon ?? "",
      parent_id: group.parent_id ?? "",
    });
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!draft.name.trim()) {
      setFormError(t("shell.nameRequired"));
      return;
    }

    // Guard against self-parenting (the dropdown already excludes self, but be safe).
    if (editingId && draft.parent_id === editingId) {
      setFormError(t("shell.cannotBeOwnParent"));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        color: draft.color || undefined,
        icon: draft.icon.trim() || undefined,
        parent_id: draft.parent_id || undefined,
      };

      if (editingId) {
        await updateGroup(editingId, payload);
      } else {
        await createGroup(payload);
      }
      onChange?.();
      startCreate();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("shell.failedToSaveGroup"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteGroup(id);
      onChange?.();
      if (editingId === id) startCreate();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("shell.failedToDeleteGroup"));
    } finally {
      setDeletingId(null);
    }
  };

  // Parent options exclude the group being edited (no self-parent).
  const parentOptions = groups.filter((g) => g.id !== editingId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] animate-fade-in">
      <div className="bg-card shadow-xl w-[42rem] max-w-[90vw] max-h-[85vh] flex flex-col rounded-xl border border-border animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <FolderTree className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">{t("shell.manageGroups")}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-2 overflow-hidden">
          {/* Group list */}
          <div className="border-r border-border overflow-y-auto p-3 space-y-1">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("shell.groups")}
              </span>
              <button
                type="button"
                onClick={startCreate}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 rounded-md transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t("shell.new")}
              </button>
            </div>

            {loading && (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("shell.loading")}
              </div>
            )}

            {!loading && groups.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {t("shell.noGroupsYet")}
              </p>
            )}

            {groups.map((group) => (
              <div
                key={group.id}
                className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                  editingId === group.id ? "bg-accent" : "hover:bg-secondary"
                }`}
                onClick={() => startEdit(group)}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0 border border-border"
                  style={{ backgroundColor: group.color || "transparent" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{group.name}</p>
                  {group.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {group.description}
                    </p>
                  )}
                </div>
                {deletingId === group.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(group.id);
                      }}
                      className="p-1 text-destructive hover:bg-destructive/10 rounded transition-colors"
                      title={t("shell.confirmDelete")}
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingId(null);
                      }}
                      className="p-1 text-muted-foreground hover:bg-secondary rounded transition-colors"
                      title={t("shell.cancel")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(group);
                      }}
                      className="p-1 text-muted-foreground hover:bg-secondary rounded transition-colors"
                      title={t("shell.edit")}
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingId(group.id);
                      }}
                      className="p-1 text-destructive hover:bg-destructive/10 rounded transition-colors"
                      title={t("shell.delete")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Editor form */}
          <form onSubmit={handleSubmit} className="overflow-y-auto p-4 space-y-4">
            <h3 className="text-sm font-semibold">
              {isEditing ? t("shell.editGroup") : t("shell.newGroup")}
            </h3>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                {t("shell.name")} <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder={t("shell.groupNamePlaceholder")}
                className={INPUT_CLASS}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">{t("shell.description")}</label>
              <textarea
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                placeholder={t("shell.groupDescriptionPlaceholder")}
                rows={2}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">{t("shell.color")}</label>
              <div className="flex items-center gap-2 flex-wrap">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, color: c }))}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      draft.color === c
                        ? "border-foreground scale-110"
                        : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, color: "" }))}
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${
                    draft.color === ""
                      ? "border-foreground"
                      : "border-border hover:border-muted-foreground"
                  }`}
                  title={t("shell.noColor")}
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                {t("shell.icon")}
                <span className="ml-1 text-xs text-muted-foreground">{t("shell.optional")}</span>
              </label>
              <input
                type="text"
                value={draft.icon}
                onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))}
                placeholder={t("shell.groupIconPlaceholder")}
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">{t("shell.parentGroup")}</label>
              <select
                value={draft.parent_id}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, parent_id: e.target.value }))
                }
                className={INPUT_CLASS}
              >
                <option value="">{t("shell.noneTopLevel")}</option>
                {parentOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            {(formError || error) && (
              <div className="flex items-start gap-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{formError || error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              {isEditing && (
                <button
                  type="button"
                  onClick={startCreate}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
                >
                  {t("shell.cancelEdit")}
                </button>
              )}
              <button
                type="submit"
                disabled={saving || !draft.name.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isEditing ? t("shell.saveChanges") : t("shell.createGroup")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default GroupManager;
