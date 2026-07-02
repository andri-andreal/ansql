import { Fragment, useState } from "react";
import type { ColumnMap, ColumnMeta, ConflictMode } from "../../../types";
import type { TableSel } from "../TransferWizard";
import { databaseCommands } from "../../../lib/tauri-commands";
import { ColumnMapping, autoMap } from "../ColumnMapping";
import { useTranslation } from "../../../i18n";

const CONFLICTS: ConflictMode[] = ["drop", "truncate", "append", "skip"];

export function TablesStep({
  tables,
  onChange,
  sourceSessionId,
  sourceDatabase,
}: {
  tables: TableSel[];
  onChange: (t: TableSel[]) => void;
  sourceSessionId: string;
  sourceDatabase: string;
}) {
  const { t } = useTranslation();
  /** Which table row has its mapping / filter editor expanded. */
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Tables whose source columns are currently loading. */
  const [loading, setLoading] = useState<Set<string>>(new Set());

  const update = (i: number, patch: Partial<TableSel>) => {
    onChange(tables.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };

  /** Lazy-load source columns the first time a table editor is opened. */
  const ensureColumns = async (i: number) => {
    const t = tables[i];
    if (t.columns.length > 0 || loading.has(t.source_table)) return;
    setLoading((prev) => new Set(prev).add(t.source_table));
    try {
      const defs = await databaseCommands.getColumns(
        sourceSessionId,
        sourceDatabase,
        t.source_table
      );
      const columns: ColumnMeta[] = defs.map((c) => ({
        name: c.name,
        data_type: c.full_type ?? c.data_type,
        nullable: c.nullable,
      }));
      // Seed an identity mapping (kept empty until the user actually edits it so
      // the wizard can tell "untouched" from "explicitly all-columns").
      const mapping: ColumnMap[] =
        t.mapping.length > 0 ? t.mapping : autoMap(columns, []);
      onChange(
        tables.map((row, idx) =>
          idx === i ? { ...row, columns, mapping } : row
        )
      );
    } catch {
      /* Leave columns empty; the editor shows a load error hint. */
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(t.source_table);
        return next;
      });
    }
  };

  const toggleExpand = (i: number) => {
    const t = tables[i];
    if (expanded === t.source_table) {
      setExpanded(null);
    } else {
      setExpanded(t.source_table);
      void ensureColumns(i);
    }
  };

  const isCustomized = (t: TableSel) =>
    t.where.trim() !== "" ||
    t.mapping.some((m) => m.source !== m.target || m.target === "");

  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">{t("io.tablesToTransfer")}</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("io.tablesToTransferHint")}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="p-1"></th>
            <th className="p-1">{t("io.source")}</th>
            <th className="p-1">{t("io.targetName")}</th>
            <th className="p-1">{t("io.onConflict")}</th>
            <th className="p-1"></th>
          </tr>
        </thead>
        <tbody>
          {tables.map((row, i) => {
            const open = expanded === row.source_table;
            return (
              <Fragment key={row.source_table}>
                <tr className="border-t border-border">
                  <td className="p-1">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={(e) => update(i, { selected: e.target.checked })}
                    />
                  </td>
                  <td className="p-1">{row.source_table}</td>
                  <td className="p-1">
                    <input
                      className="w-full rounded border border-input bg-secondary px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                      value={row.target_table}
                      onChange={(e) => update(i, { target_table: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <select
                      className="rounded border border-input bg-secondary px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                      value={row.conflict}
                      onChange={(e) =>
                        update(i, { conflict: e.target.value as ConflictMode })
                      }
                    >
                      {CONFLICTS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-1 text-right">
                    <button
                      type="button"
                      onClick={() => toggleExpand(i)}
                      className={`rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary transition-colors ${
                        isCustomized(row) ? "text-primary" : "text-muted-foreground"
                      }`}
                      title={t("io.columnMappingAndWhere")}
                    >
                      {open ? t("io.hide") : isCustomized(row) ? t("io.editCustomized") : t("io.edit")}
                    </button>
                  </td>
                </tr>
                {open && (
                  <tr className="border-t border-border bg-secondary/30">
                    <td colSpan={5} className="p-3">
                      <div className="space-y-3">
                        {loading.has(row.source_table) ? (
                          <p className="text-xs text-muted-foreground">
                            {t("io.loadingColumns")}
                          </p>
                        ) : row.columns.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {t("io.couldNotLoadSourceColumns")}
                          </p>
                        ) : (
                          <ColumnMapping
                            sourceColumns={row.columns}
                            targetColumns={[]}
                            mapping={row.mapping}
                            onChange={(mapping) => update(i, { mapping })}
                          />
                        )}
                        <label className="block text-xs font-medium text-muted-foreground">
                          {t("io.whereFilter")}{" "}
                          <span className="font-normal">
                            {t("io.whereFilterHint")}
                          </span>
                          <input
                            value={row.where}
                            onChange={(e) => update(i, { where: e.target.value })}
                            placeholder={t("io.wherePlaceholder")}
                            className="mt-1 w-full rounded border border-input bg-background px-2 py-1 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                          />
                        </label>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
