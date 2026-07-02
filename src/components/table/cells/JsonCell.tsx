import {
  GridCellKind,
  getMiddleCenterBias,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";

export interface JsonCellProps {
  readonly kind: "json-cell";
  readonly value: string; // raw JSON text (or "(Null)")
}
export type JsonCell = CustomCell<JsonCellProps>;

export const jsonCellRenderer: CustomRenderer<JsonCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is JsonCell => (c.data as JsonCellProps).kind === "json-cell",
  draw: (args, cell) => {
    const { ctx, theme, rect } = args;
    const text = cell.data.value;
    ctx.fillStyle = theme.textDark;
    ctx.fillText(
      text.length > 120 ? text.slice(0, 120) + "…" : text,
      rect.x + theme.cellHorizontalPadding,
      rect.y + rect.height / 2 + getMiddleCenterBias(ctx, theme)
    );
  },
  provideEditor: () => ({
    editor: (p) => {
      const v = p.value.data.value;
      return (
        <textarea
          autoFocus
          defaultValue={v === "(Null)" ? "" : v}
          onChange={(e) =>
            p.onChange({ ...p.value, data: { ...p.value.data, value: e.target.value } })
          }
          style={{ width: "100%", minHeight: 160, padding: 8, fontFamily: "monospace", fontSize: 12 }}
        />
      );
    },
    disablePadding: true,
  }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
