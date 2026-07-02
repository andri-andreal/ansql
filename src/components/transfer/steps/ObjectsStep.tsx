import { useState } from "react";
import { useTranslation } from "../../../i18n";

export interface TransferObjectSel {
  kind: "view" | "routine" | "trigger";
  name: string;
  schema?: string | null;
  routineKind?: "function" | "procedure";
  selected: boolean;
}

export interface ObjectsStepProps {
  views: TransferObjectSel[];
  routines: TransferObjectSel[];
  triggers: TransferObjectSel[];
  onChange: (
    kind: "view" | "routine" | "trigger",
    next: TransferObjectSel[]
  ) => void;
  loading?: boolean;
}

function Section({
  title,
  kind,
  items,
  onChange,
}: {
  title: string;
  kind: "view" | "routine" | "trigger";
  items: TransferObjectSel[];
  onChange: (
    kind: "view" | "routine" | "trigger",
    next: TransferObjectSel[]
  ) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  const selectedCount = items.filter((o) => o.selected).length;
  const allSelected = items.length > 0 && selectedCount === items.length;

  const update = (i: number, selected: boolean) => {
    onChange(
      kind,
      items.map((o, idx) => (idx === i ? { ...o, selected } : o))
    );
  };

  const setAll = (selected: boolean) => {
    onChange(
      kind,
      items.map((o) => ({ ...o, selected }))
    );
  };

  const label = (o: TransferObjectSel) => {
    const name = o.schema ? `${o.schema}.${o.name}` : o.name;
    if (o.routineKind) return `${name} (${o.routineKind})`;
    return name;
  };

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
          {title}
          <span className="font-normal text-muted-foreground">
            ({selectedCount}/{items.length})
          </span>
        </button>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setAll(!allSelected)}
            className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
          >
            {allSelected ? t("io.selectNone") : t("io.selectAll")}
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-border px-3 py-2">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("io.none")}</p>
          ) : (
            <div className="space-y-1 text-sm">
              {items.map((o, i) => (
                <label
                  key={`${o.schema ?? ""}.${o.name}`}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={o.selected}
                    onChange={(e) => update(i, e.target.checked)}
                  />
                  {label(o)}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ObjectsStep({
  views,
  routines,
  triggers,
  onChange,
  loading,
}: ObjectsStepProps) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">{t("io.objectsToTransfer")}</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("io.objectsToTransferHint")}
      </p>
      {loading ? (
        <p className="text-xs text-muted-foreground">{t("io.loadingObjects")}</p>
      ) : (
        <div className="space-y-3">
          <Section
            title={t("io.views")}
            kind="view"
            items={views}
            onChange={onChange}
          />
          <Section
            title={t("io.functionsProcedures")}
            kind="routine"
            items={routines}
            onChange={onChange}
          />
          <Section
            title={t("io.triggers")}
            kind="trigger"
            items={triggers}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}
