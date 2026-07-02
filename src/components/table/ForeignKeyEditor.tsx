import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "../../i18n";
import type { DesignerForeignKey, Dialect } from "../../types";

interface ForeignKeyEditorProps {
  foreignKeys: DesignerForeignKey[];
  /** Current table's column names (for the local-columns multi-select). */
  localColumns: string[];
  /** Referenced-table options (loaded once). */
  listTables: () => Promise<string[]>;
  /** Referenced columns for a chosen table (lazy-loaded, cached per table). */
  getTableColumns: (table: string) => Promise<string[]>;
  onChange: (fks: DesignerForeignKey[]) => void;
  /** Active dialect — gates the Postgres cross-schema referenced-schema input. */
  dialect: Dialect;
}

// Module-level id counter — deterministic, no Date.now / Math.random.
let seq = 0;

const REFERENTIAL_ACTIONS = [
  "", // none
  "NO ACTION",
  "RESTRICT",
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
] as const;

export function ForeignKeyEditor({
  foreignKeys,
  localColumns,
  listTables,
  getTableColumns,
  onChange,
  dialect,
}: ForeignKeyEditorProps) {
  const { t } = useTranslation();
  // Cross-schema REFERENCES are only meaningful on Postgres (MySQL keys are
  // database-local; SQLite has no FK editing path here).
  const schemaSupported = dialect === "postgres";
  // Referenced-table options, loaded once.
  const [tableOptions, setTableOptions] = useState<string[]>([]);
  const [tablesError, setTablesError] = useState<string | null>(null);

  // Cache of referenced-table → its column names. `undefined` = not yet loaded.
  const [refColumnCache, setRefColumnCache] = useState<Record<string, string[]>>({});
  // Tables whose columns are currently loading (to avoid duplicate fetches).
  const [loadingTables, setLoadingTables] = useState<Set<string>>(new Set());

  // Load referenced-table options once on mount.
  useEffect(() => {
    let alive = true;
    listTables()
      .then((tables) => {
        if (alive) setTableOptions(tables);
      })
      .catch((e) => {
        if (alive) setTablesError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [listTables]);

  // Lazy-load the referenced columns for every distinct referenced table in use,
  // caching per table so a given table is fetched at most once.
  useEffect(() => {
    const wanted = new Set(
      foreignKeys.map((fk) => fk.referencedTable).filter((t) => t.length > 0),
    );
    for (const table of wanted) {
      if (table in refColumnCache || loadingTables.has(table)) continue;
      setLoadingTables((prev) => new Set(prev).add(table));
      getTableColumns(table)
        .then((cols) => {
          setRefColumnCache((prev) => ({ ...prev, [table]: cols }));
        })
        .catch(() => {
          // On error cache an empty list so we don't retry forever; the row
          // just shows "no columns available".
          setRefColumnCache((prev) => ({ ...prev, [table]: [] }));
        })
        .finally(() => {
          setLoadingTables((prev) => {
            const next = new Set(prev);
            next.delete(table);
            return next;
          });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foreignKeys, getTableColumns]);

  const addForeignKey = () => {
    onChange([
      ...foreignKeys,
      {
        id: `fk-${++seq}`,
        name: "fk_new",
        columns: [],
        referencedTable: "",
        referencedColumns: [],
        onDelete: "",
        onUpdate: "",
      },
    ]);
  };

  const updateForeignKey = (id: string, patch: Partial<DesignerForeignKey>) => {
    onChange(foreignKeys.map((fk) => (fk.id === id ? { ...fk, ...patch } : fk)));
  };

  const removeForeignKey = (id: string) => {
    onChange(foreignKeys.filter((fk) => fk.id !== id));
  };

  const toggleLocalColumn = (fk: DesignerForeignKey, col: string) => {
    const next = fk.columns.includes(col)
      ? fk.columns.filter((c) => c !== col)
      : [...fk.columns, col];
    updateForeignKey(fk.id, { columns: next });
  };

  const toggleReferencedColumn = (fk: DesignerForeignKey, col: string) => {
    const next = fk.referencedColumns.includes(col)
      ? fk.referencedColumns.filter((c) => c !== col)
      : [...fk.referencedColumns, col];
    updateForeignKey(fk.id, { referencedColumns: next });
  };

  const handleReferencedTableChange = (fk: DesignerForeignKey, table: string) => {
    // Changing the referenced table clears any previously chosen ref columns,
    // since they belonged to the old table.
    updateForeignKey(fk.id, { referencedTable: table, referencedColumns: [] });
  };

  return (
    <div className="flex flex-col gap-3">
      {tablesError && (
        <p className="text-xs text-destructive">
          {t("table.couldNotLoadTables", { error: tablesError })}
        </p>
      )}

      {foreignKeys.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("table.noForeignKeys")}</p>
      ) : (
        foreignKeys.map((fk) => {
          const refCols = fk.referencedTable ? refColumnCache[fk.referencedTable] : undefined;
          const refColsLoading =
            fk.referencedTable.length > 0 && loadingTables.has(fk.referencedTable);

          return (
            <div
              key={fk.id}
              className="rounded-lg border border-border bg-secondary/40 p-3"
            >
              {/* Row 1: Name + Delete */}
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={fk.name}
                  onChange={(e) => updateForeignKey(fk.id, { name: e.target.value })}
                  placeholder={t("table.constraintNamePlaceholder")}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                  aria-label="Foreign key name"
                />
                <button
                  onClick={() => removeForeignKey(fk.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t("table.removeForeignKey")}
                  aria-label="Remove foreign key"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Local columns */}
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                  {t("table.localColumns")}
                </p>
                {localColumns.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {localColumns.map((col) => {
                      const active = fk.columns.includes(col);
                      return (
                        <button
                          key={col}
                          onClick={() => toggleLocalColumn(fk, col)}
                          className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                            active
                              ? "border-primary/60 bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground hover:bg-secondary"
                          }`}
                          aria-pressed={active}
                          title={active ? t("table.removeColumnGeneric", { column: col }) : t("table.addColumnGeneric", { column: col })}
                        >
                          {col}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("table.noColumnsAvailable")}
                  </p>
                )}
                {fk.columns.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("table.columnsLabel")}{" "}
                    <span className="font-mono text-foreground">{fk.columns.join(", ")}</span>
                  </p>
                )}
              </div>

              {/* Referenced schema (Postgres cross-schema FKs only) + table */}
              <div className="mt-3 flex flex-wrap items-end gap-3">
                {schemaSupported && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                      {t("table.referencedSchema")}
                    </p>
                    <input
                      type="text"
                      value={fk.referencedSchema ?? ""}
                      onChange={(e) =>
                        updateForeignKey(fk.id, {
                          referencedSchema: e.target.value === "" ? null : e.target.value,
                        })
                      }
                      placeholder={t("table.sameSchemaPlaceholder")}
                      aria-label="Referenced schema"
                      title={t("table.referencedSchemaTooltip")}
                      className="w-40 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      spellCheck={false}
                    />
                  </div>
                )}
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                    {t("table.referencedTable")}
                  </p>
                  <select
                    value={fk.referencedTable}
                    onChange={(e) => handleReferencedTableChange(fk, e.target.value)}
                    aria-label="Referenced table"
                    className="w-full max-w-xs rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">{t("table.selectTableOption")}</option>
                    {/* If the current value isn't in the loaded options yet (e.g. baseline
                        FK before tables load), show it so it isn't silently dropped. */}
                    {fk.referencedTable && !tableOptions.includes(fk.referencedTable) && (
                      <option value={fk.referencedTable}>{fk.referencedTable}</option>
                    )}
                    {tableOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Referenced columns */}
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                  {t("table.referencedColumns")}
                </p>
                {!fk.referencedTable ? (
                  <p className="text-xs text-muted-foreground">
                    {t("table.selectReferencedTableFirst")}
                  </p>
                ) : refColsLoading || refCols === undefined ? (
                  <p className="text-xs text-muted-foreground">{t("table.loadingColumns")}</p>
                ) : refCols.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("table.noColumnsFoundFor", { table: fk.referencedTable })}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {refCols.map((col) => {
                      const active = fk.referencedColumns.includes(col);
                      return (
                        <button
                          key={col}
                          onClick={() => toggleReferencedColumn(fk, col)}
                          className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                            active
                              ? "border-primary/60 bg-primary/10 text-primary"
                              : "border-border bg-background text-muted-foreground hover:bg-secondary"
                          }`}
                          aria-pressed={active}
                          title={active ? t("table.removeColumnGeneric", { column: col }) : t("table.addColumnGeneric", { column: col })}
                        >
                          {col}
                        </button>
                      );
                    })}
                  </div>
                )}
                {fk.referencedColumns.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("table.columnsLabel")}{" "}
                    <span className="font-mono text-foreground">
                      {fk.referencedColumns.join(", ")}
                    </span>
                  </p>
                )}
              </div>

              {/* Referential actions */}
              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  ON DELETE
                  <select
                    value={fk.onDelete ?? ""}
                    onChange={(e) => updateForeignKey(fk.id, { onDelete: e.target.value })}
                    aria-label="On delete action"
                    className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {REFERENTIAL_ACTIONS.map((action) => (
                      <option key={action} value={action}>
                        {action === "" ? t("table.noneAction") : action}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  ON UPDATE
                  <select
                    value={fk.onUpdate ?? ""}
                    onChange={(e) => updateForeignKey(fk.id, { onUpdate: e.target.value })}
                    aria-label="On update action"
                    className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {REFERENTIAL_ACTIONS.map((action) => (
                      <option key={action} value={action}>
                        {action === "" ? t("table.noneAction") : action}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          );
        })
      )}

      <button
        onClick={addForeignKey}
        className="self-start rounded border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        {t("table.addForeignKey")}
      </button>
    </div>
  );
}
