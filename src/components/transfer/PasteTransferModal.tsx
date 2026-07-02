import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import type {
  AnsqlClipboard,
  ColumnMap,
  ConflictMode,
  Connection,
  Dialect,
  RowTransfer,
  SessionInfo,
  TransferJob,
  TransferOptions,
  TransferReport,
} from "../../types";
import { databaseCommands, transferRows } from "../../lib/tauri-commands";
import { useTransfer } from "../../hooks/useTransfer";
import { ColumnMapping, autoMap } from "./ColumnMapping";
import type { PasteTarget } from "../../hooks/usePaste";
import { useTranslation } from "../../i18n";

interface PasteTransferModalProps {
  clip: AnsqlClipboard;
  target: PasteTarget | null;
  sessions: SessionInfo[];
  connections: Connection[];
  onClose: () => void;
}

const dialectOf = (driver: string): Dialect =>
  driver === "postgres" ? "postgres" : driver === "sqlite" ? "sqlite" : "mysql";

export function PasteTransferModal({
  clip,
  target,
  sessions,
  connections,
  onClose,
}: PasteTransferModalProps) {
  const { t } = useTranslation();
  // Target selection (pre-filled from the paste location when available).
  const presetSessionId =
    target && (target.kind === "grid" || target.kind === "node") ? target.sessionId : "";
  const [targetSessionId, setTargetSessionId] = useState(presetSessionId);
  const [targetDb, setTargetDb] = useState(
    target && (target.kind === "grid" || target.kind === "node") ? target.database : ""
  );
  const [targetTable, setTargetTable] = useState(
    target && "table" in target && target.table
      ? target.table
      : clip.kind === "table-ref"
        ? clip.tables[0]?.name ?? ""
        : clip.kind === "row-snapshot"
          ? clip.table ?? ""
          : ""
  );
  const [targetSchema, setTargetSchema] = useState<string>(clip.source.schema ?? "");

  const [databases, setDatabases] = useState<string[]>([]);
  const [targetColumns, setTargetColumns] = useState<string[]>([]);
  const [conflict, setConflict] = useState<ConflictMode>("append");
  const [createIfMissing, setCreateIfMissing] = useState(clip.kind !== "row-snapshot");
  const [copyStructure, setCopyStructure] = useState(true);
  const [copyData, setCopyData] = useState(true);
  const [copyIndexes, setCopyIndexes] = useState(clip.kind === "table-ref");
  const [copyFks, setCopyFks] = useState(clip.kind === "table-ref");

  const sourceColumns = useMemo(
    () =>
      clip.kind === "row-snapshot" || clip.kind === "query-ref"
        ? clip.columns
        : [],
    [clip]
  );
  const [mapping, setMapping] = useState<ColumnMap[]>(() => autoMap(sourceColumns, []));

  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<TransferReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);

  const { run: runTableTransfer, preview, error: transferError } = useTransfer();

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

  // Load target table columns (to drive mapping + existence-based mode).
  useEffect(() => {
    if (!targetSessionId || !targetDb || !targetTable) {
      setTargetColumns([]);
      return;
    }
    let ignore = false;
    databaseCommands
      .getColumns(targetSessionId, targetDb, targetTable)
      .then((cols) => { if (!ignore) setTargetColumns(cols.map((c) => c.name)); })
      .catch(() => {
        // An empty result (or a "table not found" error) is how we detect a target
        // table that doesn't exist yet → "create" mode. We intentionally treat both
        // the same; the UI shows "Target is new →" and row-snapshot's create_if_missing
        // defaults to off, so this never silently creates without user intent.
        if (!ignore) setTargetColumns([]);
      });
    return () => { ignore = true; };
  }, [targetSessionId, targetDb, targetTable]);

  // Re-auto-map whenever the known target columns change.
  useEffect(() => {
    if (sourceColumns.length) setMapping(autoMap(sourceColumns, targetColumns));
  }, [sourceColumns, targetColumns]);

  const targetExists = targetColumns.length > 0;
  const sourceDriver =
    connections.find((c) => c.id === clip.source.connectionId)?.driver ?? clip.source.dbType;

  const needsDistinctSession = clip.kind !== "row-snapshot"; // table/query reuse run_transfer
  const sourceSessionOpen = sessions.some((s) => s.id === clip.source.sessionId);
  const sessionConflict = needsDistinctSession && targetSessionId === clip.source.sessionId;
  const sourceClosed = needsDistinctSession && !sourceSessionOpen;

  const canRun =
    !!targetSessionId &&
    !!targetDb &&
    !!targetTable &&
    !running &&
    !sessionConflict &&
    !sourceClosed &&
    (clip.kind !== "row-snapshot" || mapping.some((m) => m.target));

  const buildOptions = (): TransferOptions => ({
    copy_structure: copyStructure,
    copy_data: copyData,
    copy_indexes: copyIndexes,
    copy_fks: copyFks,
    batch_size: 500,
    error_policy: "table_atomic_continue",
  });

  const buildJobs = (): TransferJob[] =>
    clip.kind === "table-ref"
      ? clip.tables.map((t) => ({
          source_table: t.name,
          source_schema: t.schema,
          target_db: targetDb,
          target_schema: targetSchema.trim() || null,
          target_table: clip.tables.length === 1 ? targetTable : t.name,
          conflict,
          source_query: null,
        }))
      : clip.kind === "query-ref"
        ? [
            {
              source_table: targetTable,
              source_schema: null,
              target_db: targetDb,
              target_schema: targetSchema.trim() || null,
              target_table: targetTable,
              conflict,
              source_query: clip.sql,
            },
          ]
        : [];

  async function handlePreview() {
    setError(null);
    setPreviewText(null);
    try {
      if (clip.kind === "row-snapshot") {
        setPreviewText(
          t("io.rowsWillBeInserted", { count: clip.rows.length, table: targetTable })
        );
        return;
      }
      const previews = await preview(clip.source.sessionId, targetSessionId, buildJobs(), buildOptions());
      setPreviewText(
        previews.map((p) => `-- ${p.table}\n${p.ddl}\n${p.sample_insert}`).join("\n\n")
      );
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRun() {
    setError(null);
    setPreviewText(null);
    setRunning(true);
    setReport(null);
    try {
      if (clip.kind === "row-snapshot") {
        const transfer: RowTransfer = {
          source_dialect: dialectOf(sourceDriver),
          target_schema: targetSchema.trim() || null,
          target_table: targetTable,
          columns: clip.columns.map((c) => ({
            name: c.name,
            data_type: c.data_type,
            nullable: c.nullable,
          })),
          rows: clip.rows,
          mapping: mapping.filter((m) => m.target),
          conflict,
          create_if_missing: !targetExists && createIfMissing,
          batch_size: 500,
        };
        setReport(await transferRows(targetSessionId, transfer));
      } else {
        const options = buildOptions();
        const jobs = buildJobs();
        const r = await runTableTransfer(clip.source.sessionId, targetSessionId, jobs, options);
        setReport(r);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  const summary =
    clip.kind === "table-ref"
      ? t("io.summaryTables", {
          count: clip.tables.length,
          database: clip.source.database,
        })
      : clip.kind === "query-ref"
        ? t("io.summaryQuery", {
            cols: clip.columns.length,
            database: clip.source.database,
          })
        : t("io.summaryRows", {
            count: clip.rows.length,
            source: clip.table ?? t("io.selection"),
          });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[85vh] w-[640px] flex-col overflow-hidden rounded-lg bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-sm font-semibold">{t("io.pasteToDatabase")}</h2>
          <button onClick={onClose} className="hover:opacity-70" title={t("io.close")} aria-label={t("io.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          <p className="text-sm text-muted-foreground">{t("io.sourceLabel", { summary })}</p>

          {/* Target picker */}
          <div className="grid grid-cols-4 gap-2">
            <label className="text-xs">
              {t("io.connection")}
              <select
                value={targetSessionId}
                onChange={(e) => { setTargetSessionId(e.target.value); setPreviewText(null); }}
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
                onChange={(e) => { setTargetDb(e.target.value); setPreviewText(null); }}
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
                onChange={(e) => { setTargetTable(e.target.value); setPreviewText(null); }}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              {t("io.schema")}
              <input
                value={targetSchema}
                onChange={(e) => { setTargetSchema(e.target.value); setPreviewText(null); }}
                placeholder={t("io.schemaDefaultPlaceholder")}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
          </div>

          {/* Mode */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-xs text-muted-foreground">
              {targetExists ? t("io.targetExists") : t("io.targetIsNew")}
            </span>
            {targetExists ? (
              <select
                value={conflict}
                onChange={(e) => setConflict(e.target.value as ConflictMode)}
                className="rounded border border-border bg-background px-2 py-1 text-sm"
              >
                <option value="append">{t("io.append")}</option>
                <option value="truncate">{t("io.truncateInsert")}</option>
                {clip.kind !== "row-snapshot" && <option value="drop">{t("io.dropRecreate")}</option>}
              </select>
            ) : clip.kind === "row-snapshot" ? (
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={createIfMissing}
                  onChange={(e) => setCreateIfMissing(e.target.checked)}
                />
                {t("io.createTableFromSnapshot")}
              </label>
            ) : (
              <span className="text-xs text-muted-foreground">{t("io.willCreateTable")}</span>
            )}
          </div>

          {/* What to copy (table/query only) */}
          {clip.kind !== "row-snapshot" && (
            <div className="flex flex-wrap gap-3 text-sm">
              <Toggle label={t("io.structure")} v={copyStructure} on={setCopyStructure} />
              <Toggle label={t("io.data")} v={copyData} on={setCopyData} />
              {clip.kind === "table-ref" && (
                <>
                  <Toggle label={t("io.indexes")} v={copyIndexes} on={setCopyIndexes} />
                  <Toggle label={t("io.foreignKeys")} v={copyFks} on={setCopyFks} />
                </>
              )}
            </div>
          )}

          {/* Column mapping (row/query) */}
          {sourceColumns.length > 0 && (
            <ColumnMapping
              sourceColumns={sourceColumns}
              targetColumns={targetExists ? targetColumns : []}
              mapping={mapping}
              onChange={setMapping}
            />
          )}

          {previewText && (
            <pre className="max-h-40 overflow-auto rounded border border-border bg-background p-2 text-xs">
              {previewText}
            </pre>
          )}

          {sessionConflict && (
            <p className="text-sm text-yellow-500">
              {t("io.sessionConflictWarning")}
            </p>
          )}
          {sourceClosed && (
            <p className="text-sm text-yellow-500">
              {t("io.sourceClosedWarning")}
            </p>
          )}

          {(error || transferError) && (
            <p className="text-sm text-destructive">{error ?? transferError}</p>
          )}
          {report && (
            <div className="rounded border border-border p-2 text-sm">
              {report.tables.map((tbl) => (
                <div key={tbl.table}>
                  {tbl.status === "success" ? "✅" : tbl.status === "skipped" ? "⏭️" : "❌"} {tbl.table}:{" "}
                  {tbl.rows_copied} rows{tbl.error ? ` — ${tbl.error}` : ""}
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
            onClick={handlePreview}
            disabled={!canRun}
            className="rounded px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-40"
          >
            {t("io.preview")}
          </button>
          <button
            onClick={handleRun}
            disabled={!canRun}
            className="flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("io.run")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, v, on }: { label: string; v: boolean; on: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-1">
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} />
      {label}
    </label>
  );
}
