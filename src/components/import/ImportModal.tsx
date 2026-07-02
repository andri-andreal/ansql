import { useEffect, useMemo, useState } from "react";
import { Loader2, X, FileUp, ChevronDown, ChevronRight } from "lucide-react";
import type {
  ColumnMap,
  ColumnMeta,
  ConflictMode,
  Connection,
  Dialect,
  MutationColumn,
  SessionInfo,
  TransferReport,
} from "../../types";
import { databaseCommands } from "../../lib/tauri-commands";
import { toRowTransfer } from "../../lib/fileImport";
import type { ImportParseOptions } from "../../lib/fileImport";
import { quoteIdent } from "../../lib/mutationBuilder";
import { useImport } from "../../hooks/useImport";
import type { ParsedImport } from "../../hooks/useImport";
import { ColumnMapping, autoMap } from "../transfer/ColumnMapping";
import { useTranslation } from "../../i18n";

/**
 * The import conflict modes the modal offers. Extends the backend
 * `ConflictMode` with a frontend-only "upsert" path that runs parameterized
 * INSERT … ON CONFLICT/DUPLICATE-KEY via `commitChanges` (not the transfer
 * engine).
 */
type ImportConflictMode = ConflictMode | "upsert";

interface ImportModalProps {
  /** Pre-selected target session id (the connection node/table the action came from). */
  targetSession: string;
  /** Pre-selected target database. */
  targetDatabase: string;
  /** Existing target table (mode: "existing"). */
  targetTable?: string;
  /** Pre-selected target schema, if any. */
  targetSchema?: string;
  /** "existing" → append/truncate into a table; "new" → create_if_missing. */
  mode: "existing" | "new";
  sessions: SessionInfo[];
  connections: Connection[];
  onClose: () => void;
}

const PREVIEW_ROWS = 10;

const dialectOf = (driver: string): Dialect =>
  driver === "postgres" ? "postgres" : driver === "sqlite" ? "sqlite" : "mysql";

export function ImportModal({
  targetSession,
  targetDatabase,
  targetTable: initialTable,
  targetSchema: initialSchema,
  mode,
  sessions,
  connections,
  onClose,
}: ImportModalProps) {
  const { t } = useTranslation();
  const { pickFile, parseFile, runImport, runUpsert } = useImport();

  // ---- File state ----------------------------------------------------------
  const [filePath, setFilePath] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [sheet, setSheet] = useState<string | undefined>(undefined);
  const [hasHeader, setHasHeader] = useState(true);
  const [parsing, setParsing] = useState(false);

  // ---- Advanced parse options (CSV/XML delimited text) ---------------------
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [delimiter, setDelimiter] = useState("");
  const [quoteChar, setQuoteChar] = useState("");
  const [encoding, setEncoding] = useState("utf-8");
  const [skipRows, setSkipRows] = useState(0);

  // ---- Target state --------------------------------------------------------
  const [targetSessionId, setTargetSessionId] = useState(targetSession);
  const [targetDb, setTargetDb] = useState(targetDatabase);
  const [targetTable, setTargetTable] = useState(initialTable ?? "");
  const [targetSchema, setTargetSchema] = useState(initialSchema ?? "");

  const [databases, setDatabases] = useState<string[]>([]);
  const [targetColumns, setTargetColumns] = useState<string[]>([]);
  // Full target column metadata (types, PK, auto-increment), used by the upsert
  // path to build correctly-typed parameterized statements.
  const [targetColumnMeta, setTargetColumnMeta] = useState<MutationColumn[]>([]);
  // True when the target-columns probe *errored* (vs. a genuinely-absent table,
  // which resolves to an empty array). Distinguishing the two prevents flipping
  // an existing table into "create" mode on a transient introspection failure.
  const [introspectionFailed, setIntrospectionFailed] = useState(false);

  // ---- Options -------------------------------------------------------------
  const [conflict, setConflict] = useState<ImportConflictMode>("append");
  const [createIfMissing, setCreateIfMissing] = useState(mode === "new");
  const [batchSize, setBatchSize] = useState(500);
  // Conflict-key target columns for the upsert path.
  const [keyColumns, setKeyColumns] = useState<string[]>([]);

  // ---- Mapping -------------------------------------------------------------
  const sourceColumns: ColumnMeta[] = useMemo(
    () =>
      (parsed?.columns ?? []).map((name) => ({
        name,
        data_type: "",
        nullable: true,
      })),
    [parsed]
  );
  const [mapping, setMapping] = useState<ColumnMap[]>([]);
  // Per-target-column type override (target name → SQL type) used when creating
  // a new table; empty types fall back to backend inference.
  const [typeOverrides, setTypeOverrides] = useState<Record<string, string>>({});

  // ---- Run state -----------------------------------------------------------
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<TransferReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load databases for the chosen target session.
  useEffect(() => {
    if (!targetSessionId) return;
    let ignore = false;
    databaseCommands
      .getDatabases(targetSessionId)
      .then((dbs) => { if (!ignore) setDatabases(dbs); })
      .catch(() => { if (!ignore) setDatabases([]); });
    return () => { ignore = true; };
  }, [targetSessionId]);

  // Load target table columns (drives mapping + existence-based mode).
  useEffect(() => {
    if (!targetSessionId || !targetDb || !targetTable) {
      setTargetColumns([]);
      setTargetColumnMeta([]);
      setIntrospectionFailed(false);
      return;
    }
    let ignore = false;
    databaseCommands
      .getColumns(targetSessionId, targetDb, targetTable, targetSchema.trim() || undefined)
      .then((cols) => {
        if (!ignore) {
          setTargetColumns(cols.map((c) => c.name));
          setTargetColumnMeta(
            cols.map((c) => ({
              name: c.name,
              data_type: c.full_type ?? c.data_type,
              is_primary_key: c.is_primary_key,
              is_auto_increment: c.is_auto_increment,
            }))
          );
          setIntrospectionFailed(false);
        }
      })
      .catch(() => {
        // A fetch *error* is not the same as a genuinely-absent table. Flag it so
        // an "existing" import doesn't get silently flipped into create mode.
        if (!ignore) {
          setTargetColumns([]);
          setTargetColumnMeta([]);
          setIntrospectionFailed(true);
        }
      });
    return () => { ignore = true; };
  }, [targetSessionId, targetDb, targetTable, targetSchema]);

  const targetExists = targetColumns.length > 0;
  // Block create-new-table fallback when an "existing" import couldn't read the
  // target table's columns (introspection errored, not table-missing).
  const introspectionBlocked = mode === "existing" && introspectionFailed;

  // Re-auto-map whenever the source columns or known target columns change.
  useEffect(() => {
    setMapping(autoMap(sourceColumns, targetExists ? targetColumns : []));
  }, [sourceColumns, targetColumns, targetExists]);

  // Seed conflict-key columns from the target's primary key whenever the target
  // table changes. The user can override; upsert needs at least one key column.
  useEffect(() => {
    setKeyColumns(targetColumnMeta.filter((c) => c.is_primary_key).map((c) => c.name));
  }, [targetColumnMeta]);

  // "Upsert" only applies to an existing table; if the target becomes new, drop
  // back to "append" so the run path stays valid.
  useEffect(() => {
    if (!targetExists && conflict === "upsert") setConflict("append");
  }, [targetExists, conflict]);

  // -------------------------------------------------------------------------
  /** Build the advanced parse options from the current UI state. */
  function buildParseOptions(nextHeader: boolean): ImportParseOptions {
    return {
      // Empty delimiter/quote → let papaparse auto-detect (don't force a value).
      ...(delimiter ? { delimiter } : {}),
      ...(quoteChar ? { quoteChar } : {}),
      encoding,
      skipRows,
      headerRow: nextHeader,
    };
  }

  async function reparse(
    path: string,
    nextSheet?: string,
    nextHeader?: boolean,
    parseOptions?: ImportParseOptions
  ) {
    const header = nextHeader ?? hasHeader;
    setParsing(true);
    setError(null);
    setReport(null);
    try {
      const result = await parseFile(path, {
        sheet: nextSheet,
        hasHeader: header,
        parseOptions: parseOptions ?? buildParseOptions(header),
      });
      setParsed(result);
      // First parse of an Excel file: default the sheet selection to the first sheet.
      if (result.format === "excel" && nextSheet === undefined && result.sheetNames?.length) {
        setSheet(result.sheetNames[0]);
      }
    } catch (e) {
      setParsed(null);
      setError(String(e));
    } finally {
      setParsing(false);
    }
  }

  async function handleChooseFile() {
    setError(null);
    try {
      const path = await pickFile();
      if (!path) return;
      setFilePath(path);
      setSheet(undefined);
      await reparse(path, undefined, hasHeader);
    } catch (e) {
      setError(String(e));
    }
  }

  function handleSheetChange(nextSheet: string) {
    setSheet(nextSheet);
    if (filePath) void reparse(filePath, nextSheet, hasHeader);
  }

  function handleHeaderToggle(next: boolean) {
    setHasHeader(next);
    if (filePath && parsed?.format !== "excel") void reparse(filePath, sheet, next);
  }

  /** Re-parse the current delimited/XML file with the advanced options applied. */
  function applyParseOptions() {
    if (filePath && parsed?.format !== "excel" && parsed?.format !== "json") {
      void reparse(filePath, sheet, hasHeader);
    }
  }

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : null;

  const targetDriver =
    connections.find(
      (c) => c.id === sessions.find((s) => s.id === targetSessionId)?.connection_id
    )?.driver ?? "mysql";

  const previewMapping = mapping.filter((m) => m.target !== "");
  const previewRows = useMemo(() => {
    if (!parsed) return [];
    const sourceIndex = new Map(parsed.columns.map((name, i) => [name, i]));
    return parsed.rows.slice(0, PREVIEW_ROWS).map((row) =>
      previewMapping.map((m) => {
        const idx = sourceIndex.get(m.source);
        return idx === undefined ? null : row[idx] ?? null;
      })
    );
  }, [parsed, previewMapping]);

  const dialect = dialectOf(targetDriver);
  const isUpsert = conflict === "upsert";

  /** Fully-qualified, pre-quoted target table name for the upsert path. */
  function qualifiedTarget(): string {
    const table = quoteIdent(dialect, targetTable.trim());
    const schema = targetSchema.trim();
    // mysql qualifies with the database; postgres/sqlite with the schema.
    if (dialect === "mysql") {
      return targetDb ? `${quoteIdent(dialect, targetDb)}.${table}` : table;
    }
    return schema ? `${quoteIdent(dialect, schema)}.${table}` : table;
  }

  // Upsert requires an existing target with at least one key column, and every
  // key column must be mapped (so the conflict-key value is supplied per row).
  const mappedTargets = useMemo(
    () => new Set(mapping.filter((m) => m.target !== "").map((m) => m.target)),
    [mapping]
  );
  const upsertReady =
    isUpsert &&
    targetExists &&
    keyColumns.length > 0 &&
    keyColumns.every((k) => mappedTargets.has(k));

  const canRun =
    !!parsed &&
    parsed.columns.length > 0 &&
    !!targetSessionId &&
    !!targetDb &&
    !!targetTable.trim() &&
    !running &&
    !parsing &&
    !introspectionBlocked &&
    mapping.some((m) => m.target) &&
    (!isUpsert || upsertReady);

  async function handleRun() {
    if (!parsed) return;
    setError(null);
    setRunning(true);
    setReport(null);
    try {
      if (isUpsert) {
        setReport(
          await runUpsert(targetSessionId, {
            dialect,
            qualifiedTable: qualifiedTarget(),
            sourceColumns: parsed.columns,
            sourceRows: parsed.rows,
            mapping,
            targetColumns: targetColumnMeta,
            keyColumns,
            batchSize,
          })
        );
      } else {
        // Apply per-column type overrides to the source columns whose target has
        // an explicit type (used by the backend when creating a new table).
        const targetType = (source: string): string => {
          const t = mapping.find((m) => m.source === source)?.target;
          return (t && typeOverrides[t]?.trim()) || "";
        };
        const transfer = toRowTransfer(parsed, mapping, {
          targetTable: targetTable.trim(),
          targetSchema: targetSchema.trim() || undefined,
          // In this branch isUpsert is false, so conflict is narrowed to a
          // backend ConflictMode (never the frontend-only "upsert").
          conflict,
          createIfMissing: !targetExists && createIfMissing,
          batchSize,
          sourceDialect: dialect,
        });
        if (!targetExists && createIfMissing) {
          transfer.columns = transfer.columns.map((c) => ({
            ...c,
            data_type: targetType(c.name) || c.data_type,
          }));
        }
        setReport(await runImport(targetSessionId, transfer));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[85vh] w-[680px] flex-col overflow-hidden rounded-lg bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-sm font-semibold">{t("io.importFromFile")}</h2>
          <button onClick={onClose} className="hover:opacity-70" title={t("io.close")} aria-label={t("io.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {/* 1. File picker */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <button
                onClick={handleChooseFile}
                disabled={parsing}
                className="flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-40"
              >
                <FileUp className="h-4 w-4" />
                {t("io.chooseFile")}
              </button>
              {parsing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {fileName && !parsing && (
                <span className="truncate text-sm text-muted-foreground" title={filePath ?? undefined}>
                  {fileName}
                  {parsed
                    ? t("io.colsRowsSummary", {
                        cols: parsed.columns.length,
                        rows: parsed.rows.length,
                      })
                    : ""}
                </span>
              )}
            </div>

            {/* Excel sheet picker */}
            {parsed?.format === "excel" && (parsed.sheetNames?.length ?? 0) > 0 && (
              <label className="flex items-center gap-2 text-xs">
                {t("io.sheet")}
                <select
                  value={sheet ?? ""}
                  onChange={(e) => handleSheetChange(e.target.value)}
                  className="rounded border border-border bg-background px-2 py-1 text-sm"
                >
                  {parsed.sheetNames!.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* CSV header toggle */}
            {parsed && parsed.format !== "excel" && parsed.format !== "json" && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={hasHeader}
                  onChange={(e) => handleHeaderToggle(e.target.checked)}
                />
                {t("io.firstRowIsHeader")}
              </label>
            )}

            {/* Advanced parse options (delimited text only) */}
            {parsed && parsed.format === "csv" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showAdvanced ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  {t("io.advancedParseOptions")}
                </button>
                {showAdvanced && (
                  <div className="space-y-2 rounded border border-border p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs">
                        {t("io.delimiter")}
                        <input
                          value={delimiter}
                          onChange={(e) => setDelimiter(e.target.value)}
                          placeholder={t("io.autoPlaceholder")}
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs">
                        {t("io.quoteChar")}
                        <input
                          value={quoteChar}
                          onChange={(e) => setQuoteChar(e.target.value)}
                          placeholder={'"'}
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs">
                        {t("io.encoding")}
                        <select
                          value={encoding}
                          onChange={(e) => setEncoding(e.target.value)}
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        >
                          <option value="utf-8">UTF-8</option>
                          <option value="utf-16le">UTF-16 LE</option>
                          <option value="latin1">Latin-1 (ISO-8859-1)</option>
                          <option value="windows-1252">Windows-1252</option>
                        </select>
                      </label>
                      <label className="text-xs">
                        {t("io.skipLeadingRows")}
                        <input
                          type="number"
                          min={0}
                          value={skipRows}
                          onChange={(e) => setSkipRows(Math.max(0, Number(e.target.value) || 0))}
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={applyParseOptions}
                      disabled={parsing}
                      className="rounded border border-border px-3 py-1 text-xs hover:bg-secondary disabled:opacity-40"
                    >
                      {t("io.applyReparse")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Target picker */}
          <div className="grid grid-cols-4 gap-2">
            <label className="text-xs">
              {t("io.connection")}
              <select
                value={targetSessionId}
                onChange={(e) => setTargetSessionId(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {sessions.map((s) => {
                  const name = connections.find((c) => c.id === s.connection_id)?.name ?? s.id;
                  return (
                    <option key={s.id} value={s.id}>
                      {name}
                      {s.database ? ` / ${s.database}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="text-xs">
              {t("io.database")}
              <select
                value={targetDb}
                onChange={(e) => setTargetDb(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {databases.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              {t("io.table")}
              <input
                value={targetTable}
                onChange={(e) => setTargetTable(e.target.value)}
                placeholder={t("io.tableNamePlaceholder")}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              {t("io.schema")}
              <input
                value={targetSchema}
                onChange={(e) => setTargetSchema(e.target.value)}
                placeholder={t("io.schemaDefaultPlaceholder")}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
          </div>

          {/* 5. Options (conflict / create / batch) */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-xs text-muted-foreground">
                {targetExists ? t("io.targetExists") : t("io.targetIsNew")}
              </span>
              {targetExists ? (
                <select
                  value={conflict}
                  onChange={(e) => setConflict(e.target.value as ImportConflictMode)}
                  className="rounded border border-border bg-background px-2 py-1 text-sm"
                >
                  <option value="append">{t("io.append")}</option>
                  <option value="truncate">{t("io.truncateInsert")}</option>
                  <option value="upsert">{t("io.upsertUpdateOnKey")}</option>
                </select>
              ) : (
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={createIfMissing}
                    onChange={(e) => setCreateIfMissing(e.target.checked)}
                  />
                  {t("io.createTableFromFile")}
                </label>
              )}
              <label className="flex items-center gap-1 text-xs">
                {t("io.batchSize")}
                <input
                  type="number"
                  min={1}
                  value={batchSize}
                  onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20 rounded border border-border bg-background px-2 py-1 text-sm"
                />
              </label>
            </div>

            {/* Upsert key-columns selector */}
            {isUpsert && targetExists && (
              <div className="space-y-1 rounded border border-border p-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("io.keyColumnsHint")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {targetColumns.map((col) => {
                    const checked = keyColumns.includes(col);
                    return (
                      <label key={col} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setKeyColumns((prev) =>
                              e.target.checked
                                ? [...prev, col]
                                : prev.filter((c) => c !== col)
                            )
                          }
                        />
                        {col}
                      </label>
                    );
                  })}
                </div>
                {keyColumns.length === 0 && (
                  <p className="text-xs text-destructive">
                    {t("io.selectAtLeastOneKeyColumn")}
                  </p>
                )}
                {keyColumns.length > 0 && !upsertReady && (
                  <p className="text-xs text-destructive">
                    {t("io.everyKeyColumnMustBeMapped")}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 3. Column mapping (type overrides offered only when creating a table) */}
          {sourceColumns.length > 0 && (
            <ColumnMapping
              sourceColumns={sourceColumns}
              targetColumns={targetExists ? targetColumns : []}
              mapping={mapping}
              onChange={setMapping}
              types={typeOverrides}
              onTypesChange={
                !targetExists && createIfMissing ? setTypeOverrides : undefined
              }
            />
          )}

          {/* 4. Preview */}
          {parsed && previewMapping.length > 0 && previewRows.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t("io.previewFirstRows", {
                  count: Math.min(PREVIEW_ROWS, parsed.rows.length),
                })}
              </p>
              <div className="max-h-48 overflow-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-secondary">
                    <tr>
                      {previewMapping.map((m) => (
                        <th key={m.source} className="border-b border-border px-2 py-1 text-left font-medium">
                          {m.target}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri} className="odd:bg-background even:bg-card">
                        {row.map((cell, ci) => (
                          <td key={ci} className="truncate border-b border-border px-2 py-1">
                            {cell == null ? (
                              <span className="text-muted-foreground italic">{t("io.null")}</span>
                            ) : (
                              String(cell)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {introspectionBlocked && (
            <p className="text-sm text-destructive">
              {t("io.couldNotReadTargetColumns")}
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* 6. Report */}
          {report && (
            <div className="rounded border border-border p-2 text-sm">
              {report.tables.map((t) => (
                <div key={t.table}>
                  {t.status === "success" ? "✅" : t.status === "skipped" ? "⏭️" : "❌"} {t.table}:{" "}
                  {t.rows_copied} rows{t.error ? ` — ${t.error}` : ""}
                </div>
              ))}
              {report.warnings.map((w, i) => (
                <div key={i} className="text-yellow-500">
                  ⚠️ {w}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-secondary">
            {t("io.close")}
          </button>
          <button
            onClick={handleRun}
            disabled={!canRun}
            className="flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("io.import")}
          </button>
        </div>
      </div>
    </div>
  );
}
