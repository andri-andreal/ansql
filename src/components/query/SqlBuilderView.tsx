import { useEffect, useMemo, useState } from "react";
import {
  Blocks,
  X,
  Plus,
  Trash2,
  Table2,
  Link2,
  Filter,
  ArrowDownUp,
  Loader2,
  Wand2,
} from "lucide-react";
import type { Dialect, TableInfo, ColumnDefinition, ForeignKeyInfo } from "../../types";
import {
  OPERATOR_ORDER,
  OPERATOR_LABELS,
  VALUELESS_OPERATORS,
  type FilterOperator,
} from "../../lib/gridFilter";
import {
  buildSelectQuery,
  type QueryBuilderSpec,
  type BuilderJoin,
  type BuilderFilter,
  type BuilderSort,
} from "../../lib/sqlQueryBuilder";
import { useTranslation } from "../../i18n";

export interface SqlBuilderViewProps {
  sessionId: string;
  database: string;
  schema?: string | null;
  dialect: Dialect;
  getTables: (s: string, db: string, schema?: string) => Promise<TableInfo[]>;
  getColumns: (s: string, db: string, t: string, schema?: string) => Promise<ColumnDefinition[]>;
  getForeignKeys: (s: string, db: string, t: string, schema?: string) => Promise<ForeignKeyInfo[]>;
  /** Emit the built SELECT into the editor. */
  onApply: (sql: string) => void;
  onClose: () => void;
}

type JoinKind = BuilderJoin["kind"];

const JOIN_KINDS: JoinKind[] = ["INNER", "LEFT", "RIGHT"];

/**
 * Visual SELECT builder. Opens as a centered modal over the query workspace.
 * The user picks a base table, ticks SELECT columns, wires JOINs (seeded from
 * foreign keys), adds WHERE / ORDER BY rows and DISTINCT / LIMIT. A live,
 * read-only preview is produced by `buildSelectQuery`; "Use query" emits the
 * SQL into the editor via `onApply`.
 */
export function SqlBuilderView({
  sessionId,
  database,
  schema,
  dialect,
  getTables,
  getColumns,
  getForeignKeys,
  onApply,
  onClose,
}: SqlBuilderViewProps) {
  const { t } = useTranslation();
  const schemaArg = schema ?? undefined;

  // --- base table list -----------------------------------------------------
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);

  // --- builder model -------------------------------------------------------
  const [baseTable, setBaseTable] = useState<string>("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [joins, setJoins] = useState<BuilderJoin[]>([]);
  const [filters, setFilters] = useState<BuilderFilter[]>([]);
  const [sorts, setSorts] = useState<BuilderSort[]>([]);
  const [distinct, setDistinct] = useState(false);
  const [limit, setLimit] = useState<string>("");

  // Per-table column cache so checklists / dropdowns don't re-fetch.
  const [columnsByTable, setColumnsByTable] = useState<Record<string, ColumnDefinition[]>>({});
  // FK-derived join candidates for the currently involved tables.
  const [suggestions, setSuggestions] = useState<BuilderJoin[]>([]);

  // Tables currently in play (base + every joined table).
  const involvedTables = useMemo(() => {
    const set = new Set<string>();
    if (baseTable) set.add(baseTable);
    for (const j of joins) set.add(j.rightTable);
    return Array.from(set);
  }, [baseTable, joins]);

  // ---- load base tables on mount ------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoadingTables(true);
    setTablesError(null);
    getTables(sessionId, database, schemaArg)
      .then((rows) => {
        if (cancelled) return;
        setTables(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setTablesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingTables(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, database, schemaArg]);

  // ---- fetch columns for any involved table that isn't cached yet ---------
  useEffect(() => {
    let cancelled = false;
    const missing = involvedTables.filter((t) => !(t in columnsByTable));
    if (missing.length === 0) return;
    Promise.all(
      missing.map((t) =>
        getColumns(sessionId, database, t, schemaArg)
          .then((cols) => [t, cols] as const)
          .catch(() => [t, [] as ColumnDefinition[]] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setColumnsByTable((prev) => {
        const next = { ...prev };
        for (const [t, cols] of entries) next[t] = cols;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [involvedTables, sessionId, database, schemaArg]);

  // ---- gather FK join suggestions for involved tables ---------------------
  useEffect(() => {
    let cancelled = false;
    if (involvedTables.length === 0) {
      setSuggestions([]);
      return;
    }
    Promise.all(
      involvedTables.map((t) =>
        getForeignKeys(sessionId, database, t, schemaArg)
          .then((fks) => [t, fks] as const)
          .catch(() => [t, [] as ForeignKeyInfo[]] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      const out: BuilderJoin[] = [];
      for (const [owner, fks] of entries) {
        for (const fk of fks) {
          // Pair columns positionally; single-column FKs dominate.
          fk.columns.forEach((col, i) => {
            const refCol = fk.referenced_columns[i] ?? fk.referenced_columns[0];
            if (!refCol) return;
            out.push({
              kind: "INNER",
              leftTable: owner,
              leftColumn: col,
              rightTable: fk.referenced_table,
              rightColumn: refCol,
            });
          });
        }
      }
      setSuggestions(out);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [involvedTables, sessionId, database, schemaArg]);

  // ---- changing the base table resets the dependent model -----------------
  const handleBaseTableChange = (table: string) => {
    setBaseTable(table);
    setSelectedColumns([]);
    setJoins([]);
    setFilters([]);
    setSorts([]);
  };

  const baseColumns = columnsByTable[baseTable] ?? [];

  const toggleColumn = (name: string) => {
    setSelectedColumns((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name],
    );
  };

  const selectAllColumns = () => setSelectedColumns(baseColumns.map((c) => c.name));
  const clearColumns = () => setSelectedColumns([]);

  // Suggestions that aren't already present (in either direction).
  const usableSuggestions = useMemo(() => {
    const have = new Set(
      joins.map(
        (j) => `${j.leftTable}.${j.leftColumn}=${j.rightTable}.${j.rightColumn}`,
      ),
    );
    return suggestions.filter((s) => {
      const key = `${s.leftTable}.${s.leftColumn}=${s.rightTable}.${s.rightColumn}`;
      const reverse = `${s.rightTable}.${s.rightColumn}=${s.leftTable}.${s.leftColumn}`;
      return !have.has(key) && !have.has(reverse);
    });
  }, [suggestions, joins]);

  const addJoinFromSuggestion = (s: BuilderJoin) => {
    setJoins((prev) => [...prev, { ...s }]);
  };

  const updateJoinKind = (index: number, kind: JoinKind) => {
    setJoins((prev) => prev.map((j, i) => (i === index ? { ...j, kind } : j)));
  };

  const removeJoin = (index: number) => {
    setJoins((prev) => prev.filter((_, i) => i !== index));
  };

  // ---- WHERE rows ---------------------------------------------------------
  const addFilter = () => {
    setFilters((prev) => [
      ...prev,
      {
        table: baseTable,
        column: "",
        operator: OPERATOR_ORDER[0],
        value: "",
        combinator: "AND",
      },
    ]);
  };
  const updateFilter = (index: number, patch: Partial<BuilderFilter>) => {
    setFilters((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };
  const removeFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };

  // ---- ORDER BY rows ------------------------------------------------------
  const addSort = () => {
    setSorts((prev) => [...prev, { table: baseTable, column: "", direction: "asc" }]);
  };
  const updateSort = (index: number, patch: Partial<BuilderSort>) => {
    setSorts((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };
  const removeSort = (index: number) => {
    setSorts((prev) => prev.filter((_, i) => i !== index));
  };

  // Columns available across every involved table, for WHERE / ORDER BY pickers.
  const columnOptions = useMemo(() => {
    const out: { table: string; column: string }[] = [];
    for (const t of involvedTables) {
      for (const c of columnsByTable[t] ?? []) out.push({ table: t, column: c.name });
    }
    return out;
  }, [involvedTables, columnsByTable]);

  // ---- assemble the spec & live preview -----------------------------------
  const spec: QueryBuilderSpec = useMemo(() => {
    const parsed = limit.trim() === "" ? null : Number.parseInt(limit, 10);
    return {
      fromTable: baseTable,
      fromSchema: schemaArg ?? null,
      selectedColumns: selectedColumns.map((column) => ({ table: baseTable, column })),
      joins,
      filters,
      sorts,
      distinct,
      limit: parsed != null && Number.isFinite(parsed) ? parsed : null,
    };
  }, [baseTable, schemaArg, selectedColumns, joins, filters, sorts, distinct, limit]);

  const preview = useMemo(() => {
    if (!baseTable) return "";
    try {
      return buildSelectQuery(dialect, spec);
    } catch (err) {
      return `-- ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [dialect, spec, baseTable]);

  const canApply = baseTable !== "" && preview.trim() !== "" && !preview.startsWith("--");

  const handleApply = () => {
    if (!canApply) return;
    onApply(preview);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-card shadow-xl w-[56rem] max-w-[90vw] max-h-[88vh] flex flex-col rounded-xl border border-border animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Blocks className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">{t("query.queryBuilder")}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
            title={t("query.close")}
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Base table + options */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Table2 className="w-4 h-4 text-muted-foreground" />
              {t("query.fromTable")}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={baseTable}
                onChange={(e) => handleBaseTableChange(e.target.value)}
                disabled={loadingTables}
                className="bg-secondary text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary min-w-[200px] disabled:opacity-50"
              >
                <option value="">
                  {loadingTables ? t("query.loadingTables") : t("query.selectTable")}
                </option>
                {tables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={distinct}
                  onChange={(e) => setDistinct(e.target.checked)}
                  className="accent-primary"
                />
                DISTINCT
              </label>

              <label className="flex items-center gap-2 text-sm">
                LIMIT
                <input
                  type="number"
                  min={0}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  placeholder="none"
                  className="w-24 px-2 py-1.5 bg-secondary rounded-lg border border-input focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </label>
            </div>
            {tablesError && <p className="text-xs text-destructive">{tablesError}</p>}
          </section>

          {baseTable && (
            <>
              {/* SELECT columns */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t("query.columns")}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      onClick={selectAllColumns}
                      className="px-2 py-1 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                    >
                      {t("query.all")}
                    </button>
                    <button
                      onClick={clearColumns}
                      className="px-2 py-1 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                    >
                      {t("query.none")}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-44 overflow-y-auto rounded-lg border border-border p-2">
                  {baseColumns.length === 0 ? (
                    <span className="text-xs text-muted-foreground col-span-full px-1 py-1">
                      {t("query.loadingColumns")}
                    </span>
                  ) : (
                    baseColumns.map((col) => (
                      <label
                        key={col.name}
                        className="flex items-center gap-2 text-sm px-1 py-1 rounded-md hover:bg-secondary cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={selectedColumns.includes(col.name)}
                          onChange={() => toggleColumn(col.name)}
                          className="accent-primary"
                        />
                        <span className="truncate" title={col.name}>
                          {col.name}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                {selectedColumns.length === 0 && baseColumns.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("query.noColumnsSelected")}{" "}
                    <code className="font-mono">*</code>.
                  </p>
                )}
              </section>

              {/* JOINs */}
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Link2 className="w-4 h-4 text-muted-foreground" />
                  {t("query.joins")}
                </div>

                {joins.length > 0 && (
                  <div className="space-y-2">
                    {joins.map((j, i) => (
                      <div
                        key={`${j.rightTable}-${i}`}
                        className="flex items-center gap-2 text-sm rounded-lg border border-border px-2 py-1.5"
                      >
                        <select
                          value={j.kind}
                          onChange={(e) => updateJoinKind(i, e.target.value as JoinKind)}
                          className="bg-secondary text-xs rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          {JOIN_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k} JOIN
                            </option>
                          ))}
                        </select>
                        <span className="font-mono text-xs truncate">
                          {j.rightTable} ON {j.leftTable}.{j.leftColumn} = {j.rightTable}.
                          {j.rightColumn}
                        </span>
                        <button
                          onClick={() => removeJoin(i)}
                          className="ml-auto p-1 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                          title={t("query.removeJoin")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {usableSuggestions.length > 0 ? (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      {t("query.suggestedFromForeignKeys")}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {usableSuggestions.map((s, i) => (
                        <button
                          key={`${s.leftTable}.${s.leftColumn}-${s.rightTable}.${s.rightColumn}-${i}`}
                          onClick={() => addJoinFromSuggestion(s)}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border hover:bg-secondary transition-colors font-mono"
                          title={t("query.addJoin")}
                        >
                          <Plus className="w-3 h-3 text-muted-foreground" />
                          {s.leftTable}.{s.leftColumn} → {s.rightTable}.{s.rightColumn}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("query.noForeignKeyJoins")}
                  </p>
                )}
              </section>

              {/* WHERE */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Filter className="w-4 h-4 text-muted-foreground" />
                    {t("query.filters")}
                  </div>
                  <button
                    onClick={addFilter}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t("query.addFilter")}
                  </button>
                </div>
                {filters.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("query.noFilters")}</p>
                ) : (
                  <div className="space-y-2">
                    {filters.map((f, i) => {
                      const needsValue = !VALUELESS_OPERATORS.has(f.operator);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          {i > 0 && (
                            <select
                              value={f.combinator ?? "AND"}
                              onChange={(e) =>
                                updateFilter(i, {
                                  combinator: e.target.value as "AND" | "OR",
                                })
                              }
                              className="bg-secondary text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                              <option value="AND">AND</option>
                              <option value="OR">OR</option>
                            </select>
                          )}
                          <select
                            value={`${f.table}\t${f.column}`}
                            onChange={(e) => {
                              const [table, column] = e.target.value.split("\t");
                              updateFilter(i, { table, column });
                            }}
                            className="bg-secondary text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary min-w-[160px]"
                          >
                            <option value={`${f.table}\t`}>{t("query.columnPlaceholder")}</option>
                            {columnOptions.map((o) => (
                              <option
                                key={`${o.table}.${o.column}`}
                                value={`${o.table}\t${o.column}`}
                              >
                                {o.table}.{o.column}
                              </option>
                            ))}
                          </select>
                          <select
                            value={f.operator}
                            onChange={(e) =>
                              updateFilter(i, { operator: e.target.value as FilterOperator })
                            }
                            className="bg-secondary text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            {OPERATOR_ORDER.map((op) => (
                              <option key={op} value={op}>
                                {OPERATOR_LABELS[op]}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={f.value}
                            disabled={!needsValue}
                            onChange={(e) => updateFilter(i, { value: e.target.value })}
                            placeholder={needsValue ? t("query.value") : "—"}
                            className="flex-1 px-2 py-1.5 bg-secondary rounded-md border border-input focus:outline-none focus:ring-2 focus:ring-primary text-xs disabled:opacity-50"
                          />
                          <button
                            onClick={() => removeFilter(i)}
                            className="p-1 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                            title={t("query.removeFilter")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* ORDER BY */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ArrowDownUp className="w-4 h-4 text-muted-foreground" />
                    {t("query.orderBy")}
                  </div>
                  <button
                    onClick={addSort}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t("query.addSort")}
                  </button>
                </div>
                {sorts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("query.noSorting")}</p>
                ) : (
                  <div className="space-y-2">
                    {sorts.map((s, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={`${s.table}\t${s.column}`}
                          onChange={(e) => {
                            const [table, column] = e.target.value.split("\t");
                            updateSort(i, { table, column });
                          }}
                          className="bg-secondary text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary min-w-[160px]"
                        >
                          <option value={`${s.table}\t`}>{t("query.columnPlaceholder")}</option>
                          {columnOptions.map((opt) => (
                            <option
                              key={`${opt.table}.${opt.column}`}
                              value={`${opt.table}\t${opt.column}`}
                            >
                              {opt.table}.{opt.column}
                            </option>
                          ))}
                        </select>
                        <select
                          value={s.direction}
                          onChange={(e) =>
                            updateSort(i, { direction: e.target.value as "asc" | "desc" })
                          }
                          className="bg-secondary text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="asc">ASC</option>
                          <option value="desc">DESC</option>
                        </select>
                        <button
                          onClick={() => removeSort(i)}
                          className="ml-auto p-1 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
                          title={t("query.removeSort")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Live preview */}
              <section className="space-y-2">
                <span className="text-sm font-medium">{t("query.sqlPreview")}</span>
                <pre className="text-xs font-mono whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-3 max-h-40 overflow-y-auto">
                  {preview || t("query.buildQueryAbove")}
                </pre>
              </section>
            </>
          )}

          {!baseTable && !loadingTables && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <Wand2 className="w-8 h-8" />
              <p className="text-sm">{t("query.pickTableToStart")}</p>
            </div>
          )}

          {loadingTables && (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">{t("query.loadingTables")}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
          >
            {t("query.cancel")}
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Blocks className="w-4 h-4" />
            {t("query.useQuery")}
          </button>
        </div>
      </div>
    </div>
  );
}
