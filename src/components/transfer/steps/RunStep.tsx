import { useState } from "react";
import { useTransfer } from "../../../hooks/useTransfer";
import type { TransferJob, TransferOptions } from "../../../types";
import type { ObjectCopyResult } from "../../../lib/objectTransfer";
import { useTranslation } from "../../../i18n";

export function RunStep({
  sourceSession,
  targetSession,
  jobs,
  options,
  onAfterRun,
  objectCount = 0,
}: {
  sourceSession: string;
  targetSession: string;
  jobs: TransferJob[];
  options: TransferOptions;
  /**
   * Runs after the table transfer completes successfully, to recreate the
   * selected non-table objects (views/routines/triggers) on the target.
   * Returns a per-object result list. Optional — omitted for targets that
   * can't recreate objects.
   */
  onAfterRun?: () => Promise<ObjectCopyResult[]>;
  /** How many non-table objects are selected (drives the result section). */
  objectCount?: number;
}) {
  const { t } = useTranslation();
  const { run, progress, report, running, error } = useTransfer();

  // The object-copy pass runs after the table transfer resolves. We track its
  // own progress/results separately from the table report.
  const [copyingObjects, setCopyingObjects] = useState(false);
  const [objectResults, setObjectResults] = useState<ObjectCopyResult[] | null>(
    null
  );

  const handleRun = async () => {
    setObjectResults(null);
    const result = await run(sourceSession, targetSession, jobs, options);
    // Only proceed to objects if the table transfer didn't hard-fail and the
    // caller wired a copy pass with objects selected.
    if (result && onAfterRun && objectCount > 0) {
      setCopyingObjects(true);
      try {
        setObjectResults(await onAfterRun());
      } finally {
        setCopyingObjects(false);
      }
    }
  };

  const busy = running || copyingObjects;

  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">{t("io.runTransfer")}</h3>
      <button
        disabled={busy}
        onClick={handleRun}
        className="mb-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 transition-colors"
      >
        {running
          ? t("io.transferring")
          : copyingObjects
            ? t("io.copyingObjects")
            : t("io.startTransfer")}
      </button>

      <div className="space-y-2">
        {jobs.map((j) => {
          const p = progress[j.target_table];
          // A finished table (present in the report) is 100% even for
          // structure-only transfers where no row-progress was ever emitted.
          const finished = report?.tables.find((t) => t.table === j.target_table);
          const pct =
            finished && finished.status !== "failed"
              ? 100
              : p && p.rows_total > 0
                ? Math.round((p.rows_done / p.rows_total) * 100)
                : 0;
          return (
            <div key={j.target_table} className="text-sm">
              <div className="flex justify-between mb-1">
                <span>{j.target_table}</span>
                <span className="text-muted-foreground">
                  {p
                    ? `${p.rows_done}/${p.rows_total} (${p.phase})`
                    : t("io.queued")}
                </span>
              </div>
              <div className="h-2 rounded-full bg-secondary">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {report && (
        <div className="mt-4 text-sm">
          <h4 className="font-medium mb-1">{t("io.result")}</h4>
          <ul className="space-y-1">
            {report.tables.map((tbl) => (
              <li key={tbl.table}>
                {tbl.status === "success"
                  ? "✅"
                  : tbl.status === "skipped"
                    ? "⏭️"
                    : "❌"}{" "}
                {tbl.table} — {tbl.rows_copied} rows
                {tbl.skipped > 0 ? t("io.rowsSkipped", { count: tbl.skipped }) : ""}
                {tbl.error ? ` (${tbl.error})` : ""}
              </li>
            ))}
          </ul>
          {report.warnings.length > 0 && (
            <div className="mt-2 text-amber-500">
              {report.warnings.map((w, i) => (
                <div key={i}>⚠️ {w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {report && objectCount > 0 && (
        <div className="mt-4 text-sm">
          <h4 className="font-medium mb-1">{t("io.objects")}</h4>
          {copyingObjects && !objectResults && (
            <p className="text-muted-foreground">{t("io.recreatingObjectsOnTarget")}</p>
          )}
          {objectResults && objectResults.length > 0 && (
            <ul className="space-y-1">
              {objectResults.map((o) => (
                <li key={`${o.kind}:${o.object}`}>
                  {o.status === "success"
                    ? "✅"
                    : o.status === "skipped"
                      ? "⏭️"
                      : "❌"}{" "}
                  {o.object} <span className="text-muted-foreground">({o.kind})</span>
                  {o.error ? ` — ${o.error}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
