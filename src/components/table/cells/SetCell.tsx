import { useMemo, useState } from "react";
import {
  GridCellKind,
  getMiddleCenterBias,
  type CustomCell,
  type CustomRenderer,
  type ProvideEditorComponent,
} from "@glideapps/glide-data-grid";
import { useTranslation } from "../../../i18n";

/**
 * A MySQL SET cell. The stored value is a comma-joined subset of the column's
 * allowed members. Editing opens a checklist of all members; the committed
 * value is the comma-joined selected subset (MySQL SET semantics — order
 * follows the column's definition, no duplicates).
 */
export interface SetCellProps {
  readonly kind: "set-cell";
  /** Current cell value as comma-joined members ("" / null for empty/null). */
  readonly value: string | null;
  /** Allowed SET members, in definition order. */
  readonly options: string[];
  /** Optional commit hook (parity with FkCell-style cells). */
  readonly onChange?: (value: string) => void;
}
export type SetCell = CustomCell<SetCellProps>;

/** Splits a stored SET value into its member set. */
function parseSelected(value: string | null): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

const SetEditor: ProvideEditorComponent<SetCell> = (p) => {
  const { t } = useTranslation();
  const data = p.value.data;
  const [selected, setSelected] = useState<Set<string>>(() => parseSelected(data.value));

  // Join in definition order to honor MySQL SET storage semantics.
  const joined = useMemo(
    () => data.options.filter((o) => selected.has(o)).join(","),
    [data.options, selected]
  );

  const toggle = (opt: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      const value = data.options.filter((o) => next.has(o)).join(",");
      p.onChange({ ...p.value, data: { ...data, value } });
      data.onChange?.(value);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: 240, maxHeight: 320 }}>
      <div
        style={{
          padding: "6px 10px",
          fontSize: 11,
          opacity: 0.7,
          borderBottom: "1px solid var(--border, #3a3a3a)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={joined}
      >
        {joined === "" ? <span style={{ fontStyle: "italic" }}>{t("table.empty")}</span> : joined}
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {data.options.length === 0 && <div style={infoStyle}>{t("table.noOptions")}</div>}
        {data.options.map((opt) => {
          const checked = selected.has(opt);
          return (
            <label
              key={opt}
              style={optionStyle(checked)}
              title={opt}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(opt)}
                style={{ margin: 0, cursor: "pointer" }}
              />
              <span
                style={{
                  flex: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {opt}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

const infoStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 12,
  opacity: 0.7,
};

function optionStyle(selected: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    boxSizing: "border-box",
    textAlign: "left",
    padding: "6px 10px",
    fontSize: 13,
    cursor: "pointer",
    background: selected ? "rgba(59,130,246,0.18)" : "transparent",
    color: "inherit",
  };
}

export const setCellRenderer: CustomRenderer<SetCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is SetCell => (c.data as SetCellProps).kind === "set-cell",
  draw: (args, cell) => {
    const { ctx, theme, rect } = args;
    const isNull = cell.data.value === null;
    const text = isNull ? "(Null)" : (cell.data.value as string);
    ctx.fillStyle = isNull || text === "" ? theme.textLight : theme.textDark;
    ctx.fillText(
      isNull ? "(Null)" : text,
      rect.x + theme.cellHorizontalPadding,
      rect.y + rect.height / 2 + getMiddleCenterBias(ctx, theme)
    );
  },
  provideEditor: () => ({
    editor: SetEditor,
    disablePadding: true,
  }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
