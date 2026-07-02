import {
  GridCellKind,
  getMiddleCenterBias,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";
import type { DateInputType } from "../columnTypes";

export interface DateCellProps {
  readonly kind: "date-cell";
  readonly value: string;       // display/edit string ("" for null)
  readonly inputType: DateInputType;
}
export type DateCell = CustomCell<DateCellProps>;

export const dateCellRenderer: CustomRenderer<DateCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is DateCell => (c.data as DateCellProps).kind === "date-cell",
  draw: (args, cell) => {
    const { ctx, theme, rect } = args;
    const text = cell.data.value === "" ? "(Null)" : cell.data.value;
    ctx.fillStyle = cell.data.value === "" ? theme.textLight : theme.textDark;
    ctx.fillText(
      text,
      rect.x + theme.cellHorizontalPadding,
      rect.y + rect.height / 2 + getMiddleCenterBias(ctx, theme)
    );
  },
  provideEditor: () => ({
    editor: (p) => (
      <input
        type={p.value.data.inputType}
        autoFocus
        defaultValue={p.value.data.value}
        onChange={(e) =>
          p.onChange({ ...p.value, data: { ...p.value.data, value: e.target.value } })
        }
        style={{ width: "100%", padding: 8, fontSize: 13 }}
      />
    ),
  }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
