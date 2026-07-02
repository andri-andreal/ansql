import { Trash2 } from "lucide-react";
import { useTranslation } from "../../i18n";
import type { DesignerIndex, Dialect } from "../../types";

interface IndexEditorProps {
  indexes: DesignerIndex[];
  availableColumns: string[];
  onChange: (indexes: DesignerIndex[]) => void;
  /** Active dialect — gates engine-aware method/kind/prefix controls. */
  dialect: Dialect;
}

let seq = 0;

// Access-method options per dialect (value = stored DesignerIndex.method).
// MySQL accepts BTREE/HASH; Postgres accepts btree/hash/gin/gist (+ brin/spgist
// in the builder, but the common four cover the UI).
const MYSQL_METHODS = ["BTREE", "HASH"];
const POSTGRES_METHODS = ["btree", "hash", "gin", "gist"];

type IndexKind = "normal" | "fulltext" | "spatial";

export function IndexEditor({ indexes, availableColumns, onChange, dialect }: IndexEditorProps) {
  const { t } = useTranslation();
  const isMysql = dialect === "mysql";
  const isPostgres = dialect === "postgres";
  const methodSupported = isMysql || isPostgres;
  const methodOptions = isMysql ? MYSQL_METHODS : POSTGRES_METHODS;

  const addIndex = () => {
    onChange([
      ...indexes,
      {
        id: `idx-${++seq}`,
        name: "idx_new",
        unique: false,
        columns: [],
      },
    ]);
  };

  const updateIndex = (id: string, patch: Partial<DesignerIndex>) => {
    onChange(indexes.map((idx) => (idx.id === id ? { ...idx, ...patch } : idx)));
  };

  const removeIndex = (id: string) => {
    onChange(indexes.filter((idx) => idx.id !== id));
  };

  const toggleColumn = (idx: DesignerIndex, col: string) => {
    if (idx.columns.includes(col)) {
      // Removing a column also drops its per-column order/prefix entries.
      const nextColumns = idx.columns.filter((c) => c !== col);
      const nextOrders = { ...(idx.columnOrders ?? {}) };
      const nextPrefixes = { ...(idx.prefixLengths ?? {}) };
      delete nextOrders[col];
      delete nextPrefixes[col];
      updateIndex(idx.id, {
        columns: nextColumns,
        columnOrders: nextOrders,
        prefixLengths: nextPrefixes,
      });
    } else {
      updateIndex(idx.id, { columns: [...idx.columns, col] });
    }
  };

  const setColumnOrder = (idx: DesignerIndex, col: string, order: "ASC" | "DESC") => {
    updateIndex(idx.id, {
      columnOrders: { ...(idx.columnOrders ?? {}), [col]: order },
    });
  };

  const setPrefixLength = (idx: DesignerIndex, col: string, raw: string) => {
    const next = { ...(idx.prefixLengths ?? {}) };
    if (raw === "") {
      delete next[col];
    } else {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) next[col] = parsed;
      else delete next[col];
    }
    updateIndex(idx.id, { prefixLengths: next });
  };

  // FULLTEXT/SPATIAL indexes (MySQL only) cannot also be UNIQUE.
  const handleKind = (idx: DesignerIndex, kind: IndexKind) => {
    const special = kind === "fulltext" || kind === "spatial";
    updateIndex(idx.id, {
      indexKind: kind === "normal" ? null : kind,
      ...(special ? { unique: false } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {indexes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("table.noIndexes")}</p>
      ) : (
        indexes.map((idx) => {
          const kind: IndexKind = idx.indexKind ?? "normal";
          const isSpecial = kind === "fulltext" || kind === "spatial";

          return (
            <div
              key={idx.id}
              className="rounded-lg border border-border bg-secondary/40 p-3"
            >
              {/* Row 1: Name + Unique + Delete */}
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={idx.name}
                  onChange={(e) => updateIndex(idx.id, { name: e.target.value })}
                  placeholder={t("table.indexNamePlaceholder")}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                  aria-label="Index name"
                />
                <label
                  className={`flex shrink-0 items-center gap-1.5 text-sm ${
                    isSpecial ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={idx.unique}
                    disabled={isSpecial}
                    onChange={(e) => updateIndex(idx.id, { unique: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span className="text-muted-foreground">{t("table.unique")}</span>
                </label>
                <button
                  onClick={() => removeIndex(idx.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t("table.removeIndex")}
                  aria-label="Remove index"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Row 1b: Kind (MySQL only) + Method (MySQL/Postgres) */}
              {(isMysql || methodSupported) && (
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  {isMysql && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t("table.kind")}
                      <select
                        value={kind}
                        onChange={(e) => handleKind(idx, e.target.value as IndexKind)}
                        aria-label="Index kind"
                        className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="normal">{t("table.indexKindNormal")}</option>
                        <option value="fulltext">FULLTEXT</option>
                        <option value="spatial">SPATIAL</option>
                      </select>
                    </label>
                  )}

                  {methodSupported && (
                    <label
                      className={`flex items-center gap-2 text-xs text-muted-foreground ${
                        isSpecial ? "opacity-40" : ""
                      }`}
                    >
                      {t("table.method")}
                      <select
                        value={idx.method ?? ""}
                        disabled={isSpecial}
                        onChange={(e) =>
                          updateIndex(idx.id, {
                            method: e.target.value === "" ? null : e.target.value,
                          })
                        }
                        aria-label="Index method"
                        title={t("table.usingAccessMethod")}
                        className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed"
                      >
                        <option value="">{t("table.default")}</option>
                        {methodOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              {/* Row 2: Column chips */}
              {availableColumns.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {availableColumns.map((col) => {
                    const active = idx.columns.includes(col);
                    return (
                      <button
                        key={col}
                        onClick={() => toggleColumn(idx, col)}
                        className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                          active
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground hover:bg-secondary"
                        }`}
                        aria-pressed={active}
                        title={active ? t("table.removeColumnFromIndex", { column: col }) : t("table.addColumnToIndex", { column: col })}
                      >
                        {col}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("table.noColumnsAvailable")}
                </p>
              )}

              {/* Row 3: Per-column order (+ MySQL prefix length). FULLTEXT/SPATIAL
                  indexes ignore order/prefix, so hide the controls then. */}
              {idx.columns.length > 0 && !isSpecial && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {idx.columns.map((col) => (
                    <div key={col} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="w-28 truncate font-mono text-foreground" title={col}>
                        {col}
                      </span>
                      <select
                        value={idx.columnOrders?.[col] ?? "ASC"}
                        onChange={(e) =>
                          setColumnOrder(idx, col, e.target.value as "ASC" | "DESC")
                        }
                        aria-label={`Sort direction for ${col}`}
                        className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="ASC">ASC</option>
                        <option value="DESC">DESC</option>
                      </select>
                      {isMysql && (
                        <label className="flex items-center gap-1 text-muted-foreground">
                          {t("table.prefix")}
                          <input
                            type="number"
                            min={1}
                            value={idx.prefixLengths?.[col] ?? ""}
                            onChange={(e) => setPrefixLength(idx, col, e.target.value)}
                            placeholder="—"
                            aria-label={`Prefix length for ${col}`}
                            title={t("table.mysqlPrefixLength")}
                            className="w-16 rounded border border-border bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Selected columns summary */}
              {idx.columns.length > 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("table.columnsLabel")}{" "}
                  <span className="font-mono text-foreground">{idx.columns.join(", ")}</span>
                </p>
              )}
            </div>
          );
        })
      )}

      <button
        onClick={addIndex}
        className="self-start rounded border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        {t("table.addIndex")}
      </button>
    </div>
  );
}
