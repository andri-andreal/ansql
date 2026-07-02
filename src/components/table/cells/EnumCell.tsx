import { useEffect, useRef, useState } from "react";
import {
  GridCellKind,
  getMiddleCenterBias,
  type CustomCell,
  type CustomRenderer,
  type ProvideEditorComponent,
} from "@glideapps/glide-data-grid";
import { useTranslation } from "../../../i18n";

/**
 * A MySQL ENUM dropdown cell. Editing opens a list of the column's allowed
 * values (plus an optional NULL option for nullable columns). Selecting writes
 * the chosen value into `value`; the cell renders the current value.
 */
export interface EnumCellProps {
  readonly kind: "enum-cell";
  /** Current cell value as text ("" / null for null). */
  readonly value: string | null;
  /** Allowed ENUM members. */
  readonly options: string[];
  /** Whether the column is nullable (controls the NULL option). */
  readonly nullable: boolean;
  /** Optional commit hook (parity with FkCell-style cells). */
  readonly onSelect?: (value: string | null) => void;
}
export type EnumCell = CustomCell<EnumCellProps>;

const NULL_DISPLAY = "(Null)";

const EnumEditor: ProvideEditorComponent<EnumCell> = (p) => {
  const { t } = useTranslation();
  const data = p.value.data;
  const [search, setSearch] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const select = (value: string | null) => {
    const next = { ...p.value, data: { ...data, value } };
    p.onChange(next);
    data.onSelect?.(value);
    // Commit the overlay selection.
    p.onFinishedEditing(next as EnumCell);
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? data.options.filter((o) => o.toLowerCase().includes(q))
    : data.options;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: 240, maxHeight: 320 }}>
      <input
        ref={inputRef}
        type="text"
        placeholder={t("table.filterPlaceholder")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: 8,
          fontSize: 13,
          boxSizing: "border-box",
          border: "none",
          borderBottom: "1px solid var(--border, #3a3a3a)",
          outline: "none",
          background: "transparent",
          color: "inherit",
        }}
      />
      <div style={{ overflowY: "auto", flex: 1 }}>
        {data.nullable && (
          <button
            type="button"
            onClick={() => select(null)}
            style={optionStyle(data.value === null || data.value === "")}
          >
            <span style={{ fontStyle: "italic", opacity: 0.6 }}>{NULL_DISPLAY}</span>
          </button>
        )}
        {filtered.length === 0 && <div style={infoStyle}>{t("table.noMatches")}</div>}
        {filtered.map((opt) => (
          <button
            type="button"
            key={opt}
            onClick={() => select(opt)}
            style={optionStyle(opt === data.value)}
            title={opt}
          >
            {opt}
          </button>
        ))}
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
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "6px 10px",
    fontSize: 13,
    border: "none",
    cursor: "pointer",
    background: selected ? "rgba(59,130,246,0.18)" : "transparent",
    color: "inherit",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

export const enumCellRenderer: CustomRenderer<EnumCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is EnumCell => (c.data as EnumCellProps).kind === "enum-cell",
  draw: (args, cell) => {
    const { ctx, theme, rect } = args;
    const isNull = cell.data.value === null || cell.data.value === "";
    const text = isNull ? NULL_DISPLAY : (cell.data.value as string);
    ctx.fillStyle = isNull ? theme.textLight : theme.textDark;
    ctx.fillText(
      text,
      rect.x + theme.cellHorizontalPadding,
      rect.y + rect.height / 2 + getMiddleCenterBias(ctx, theme)
    );
  },
  provideEditor: () => ({
    editor: EnumEditor,
    disablePadding: true,
  }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
