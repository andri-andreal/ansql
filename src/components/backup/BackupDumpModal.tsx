import { useMemo, useState } from "react";
import { Loader2, X, Save, Clipboard, Check } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  ColumnDefinition,
  Dialect,
  ForeignKeyInfo,
  IndexInfo,
  QueryResult,
} from "../../types";
import {
  buildCreateTableDump,
  buildDropTableDump,
  buildInsertDump,
  dumpHeader,
} from "../../lib/dumpBuilder";
import { quoteIdent } from "../../lib/mutationBuilder";
import { useTranslation } from "../../i18n";

export interface BackupDumpModalProps {
  sessionId: string;
  database: string;
  schema?: string | null;
  dialect: Dialect;
  /** Base table names to choose from. */
  tables: string[];
  getColumns: (
    s: string,
    db: string,
    t: string,
    schema?: string
  ) => Promise<ColumnDefinition[]>;
  getIndexes: (
    s: string,
    db: string,
    t: string,
    schema?: string
  ) => Promise<IndexInfo[]>;
  getForeignKeys: (
    s: string,
    db: string,
    t: string,
    schema?: string
  ) => Promise<ForeignKeyInfo[]>;
  /** Runs a SELECT to fetch row data (structure-and-data mode only). */
  executeQuery: (sessionId: string, sql: string) => Promise<QueryResult>;
  onClose: () => void;
}

type DumpMode = "structure" | "structure-data";

/** Build the fully-qualified, quoted target for a SELECT. */
function qualifiedTarget(
  dialect: Dialect,
  schema: string | null | undefined,
  table: string
): string {
  const t = quoteIdent(dialect, table);
  // SQLite has no schemas; MySQL uses the database, not a schema, so a plain
  // schema qualifier isn't meaningful there either.
  if (schema && dialect === "postgres") {
    return `${quoteIdent(dialect, schema)}.${t}`;
  }
  return t;
}

/** Project a QueryResult onto plain row objects keyed by column name. */
function toRowObjects(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of result.columns) obj[col.name] = row[col.name];
    return obj;
  });
}

export function BackupDumpModal({
  sessionId,
  database,
  schema,
  dialect,
  tables,
  getColumns,
  getIndexes,
  getForeignKeys,
  executeQuery,
  onClose,
}: BackupDumpModalProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(tables)
  );
  const [mode, setMode] = useState<DumpMode>("structure-data");
  const [dropFirst, setDropFirst] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const allSelected = selected.size === tables.length && tables.length > 0;
  const selectedTables = useMemo(
    () => tables.filter((t) => selected.has(t)),
    [tables, selected]
  );

  function toggleTable(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(tables));
  }

  function selectNone() {
    setSelected(new Set());
  }

  /**
   * Assemble the full dump string. Errors are collected per-table (so one bad
   * table doesn't abort the whole dump) and surfaced via `setErrors`.
   */
  async function buildDump(): Promise<string> {
    const schemaArg = schema ?? undefined;
    const withData = mode === "structure-data";
    const collectedErrors: string[] = [];
    const parts: string[] = [dumpHeader(dialect, database)];

    for (const table of selectedTables) {
      setProgress(t("io.dumpingTable", { table }));
      try {
        const [columns, indexes, foreignKeys] = await Promise.all([
          getColumns(sessionId, database, table, schemaArg),
          getIndexes(sessionId, database, table, schemaArg),
          getForeignKeys(sessionId, database, table, schemaArg),
        ]);

        const tableParts: string[] = [];
        if (dropFirst) {
          tableParts.push(buildDropTableDump(dialect, schema, table));
        }
        tableParts.push(
          buildCreateTableDump(dialect, {
            schema,
            table,
            columns,
            indexes,
            foreignKeys,
          })
        );

        if (withData) {
          const target = qualifiedTarget(dialect, schema, table);
          const result = await executeQuery(
            sessionId,
            `SELECT * FROM ${target}`
          );
          const cols = result.columns.map((c) => c.name);
          const insert = buildInsertDump(
            dialect,
            schema,
            table,
            cols,
            toRowObjects(result)
          );
          if (insert) tableParts.push(insert);
        }

        parts.push(`-- Table: ${table}\n${tableParts.join("\n")}`);
      } catch (e) {
        collectedErrors.push(`${table}: ${String(e)}`);
      }
    }

    setErrors(collectedErrors);
    return parts.join("\n\n") + "\n";
  }

  async function handleSaveToFile() {
    if (selectedTables.length === 0 || running) return;
    setRunning(true);
    setDone(null);
    setErrors([]);
    setProgress(null);
    try {
      const filePath = await save({
        title: "Save SQL dump",
        defaultPath: `${database}.sql`,
        filters: [{ name: "SQL Files", extensions: ["sql"] }],
      });
      if (!filePath) {
        setRunning(false);
        setProgress(null);
        return;
      }
      const dump = await buildDump();
      await writeTextFile(filePath, dump);
      setDone(t("io.savedTablesTo", { count: selectedTables.length, path: filePath }));
    } catch (e) {
      setErrors((prev) => [...prev, String(e)]);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function handleCopyToClipboard() {
    if (selectedTables.length === 0 || running) return;
    setRunning(true);
    setDone(null);
    setErrors([]);
    setProgress(null);
    try {
      const dump = await buildDump();
      await navigator.clipboard.writeText(dump);
      setDone(t("io.copiedDumpToClipboard", { count: selectedTables.length }));
    } catch (e) {
      setErrors((prev) => [...prev, String(e)]);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  const canRun = selectedTables.length > 0 && !running;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[85vh] w-[560px] flex-col overflow-hidden rounded-lg bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-sm font-semibold">
            {t("io.backupDumpTitle", { database })}
          </h2>
          <button
            onClick={onClose}
            className="hover:opacity-70"
            title={t("io.close")}
            aria-label={t("io.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {/* Table checklist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t("io.tablesCount", {
                  selected: selectedTables.length,
                  total: tables.length,
                })}
              </span>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={selectAll}
                  disabled={running}
                  className="hover:underline disabled:opacity-40"
                >
                  {t("io.selectAll")}
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  onClick={selectNone}
                  disabled={running}
                  className="hover:underline disabled:opacity-40"
                >
                  {t("io.none")}
                </button>
              </div>
            </div>
            <div className="max-h-56 overflow-auto rounded border border-border">
              {tables.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  {t("io.noTablesToDump")}
                </p>
              ) : (
                tables.map((t) => (
                  <label
                    key={t}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm odd:bg-background even:bg-card hover:bg-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(t)}
                      onChange={() => toggleTable(t)}
                      disabled={running}
                    />
                    {t}
                  </label>
                ))
              )}
            </div>
            {allSelected && tables.length > 0 && (
              <p className="text-xs text-muted-foreground">{t("io.allTablesSelected")}</p>
            )}
          </div>

          {/* Mode */}
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground">
              {t("io.contents")}
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="dump-mode"
                checked={mode === "structure"}
                onChange={() => setMode("structure")}
                disabled={running}
              />
              {t("io.structureOnly")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="dump-mode"
                checked={mode === "structure-data"}
                onChange={() => setMode("structure-data")}
                disabled={running}
              />
              {t("io.structureAndData")}
            </label>
          </fieldset>

          {/* DROP option */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dropFirst}
              onChange={(e) => setDropFirst(e.target.checked)}
              disabled={running}
            />
            {t("io.dropTableBeforeCreate")}
          </label>

          {/* Progress / status */}
          {running && progress && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {progress}
            </div>
          )}

          {done && !running && (
            <div className="flex items-start gap-2 rounded border border-border p-2 text-sm text-green-600 dark:text-green-400">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-all">{done}</span>
            </div>
          )}

          {errors.length > 0 && (
            <div className="space-y-1 rounded border border-destructive/40 p-2 text-sm text-destructive">
              <p className="font-medium">
                {t("io.errorsCount", { count: errors.length })}
              </p>
              {errors.map((err, i) => (
                <p key={i} className="break-all">
                  {err}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm hover:bg-secondary"
          >
            {t("io.close")}
          </button>
          <button
            onClick={handleCopyToClipboard}
            disabled={!canRun}
            className="flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-40"
          >
            <Clipboard className="h-4 w-4" />
            {t("io.copyToClipboard")}
          </button>
          <button
            onClick={handleSaveToFile}
            disabled={!canRun}
            className="flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("io.saveToSqlFile")}
          </button>
        </div>
      </div>
    </div>
  );
}
