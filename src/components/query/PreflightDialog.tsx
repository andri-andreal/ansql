import { AlertTriangle, History } from "lucide-react";
import { Modal } from "../ui/Modal";
import { useTranslation } from "../../i18n";
import type { PreflightRowDiff } from "../../lib/preflightPreview";
import type { SetAssignment } from "../../lib/rawDmlSource";

/** Why a previewed statement won't get a Time Machine undo entry. */
export type PreflightIrreversibleReason = "no-pk" | "truncated" | "pk-assigned" | "empty";

export interface PreflightData {
  verb: "update" | "delete";
  /** Display name, e.g. "public.users" (unquoted, dot-joined). */
  table: string;
  /** The original statement, shown verbatim under the diff. */
  sql: string;
  hasWhere: boolean;
  /** Exact matched-row count; null when truncated AND the COUNT query failed. */
  totalRows: number | null;
  truncated: boolean;
  cap: number;
  /** Preview rows (at most `cap`). */
  rows: PreflightRowDiff[];
  /** Full table column order (drives the DELETE table). */
  columns: string[];
  /** Primary-key columns (row identity in the UPDATE table). */
  keyColumns: string[];
  /** UPDATE assignments (drive the diff columns); [] for DELETE. */
  assignments: SetAssignment[];
  /** null → an undo entry will be journaled; else the reason it won't be. */
  irreversible: PreflightIrreversibleReason | null;
}

interface PreflightDialogProps {
  /** null = closed. */
  data: PreflightData | null;
  onCommit: () => void;
  /** Also wired to Modal's close (Escape / backdrop / X = Cancel). */
  onCancel: () => void;
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string") {
    return v.length > 36 ? `'${v.slice(0, 36)}…'` : `'${v}'`;
  }
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 36 ? `${s.slice(0, 36)}…` : s;
  }
  return String(v);
}

const IRREVERSIBLE_KEY: Record<PreflightIrreversibleReason, string> = {
  "no-pk": "query.preflightIrreversibleNoPk",
  truncated: "query.preflightIrreversibleTruncated",
  "pk-assigned": "query.preflightIrreversiblePkAssigned",
  empty: "query.preflightIrreversibleEmpty",
};

/**
 * Pre-flight dry-run modal: shows the rows a raw UPDATE/DELETE is about to
 * touch (with predicted old → new values for UPDATE) and gates execution on
 * an explicit Commit. Pure presentation — the preview data is computed by
 * lib/preflightPreview.ts and the gate is driven by QueryDocument's
 * promise-resolver, exactly like the Tier-2 snapshot-cap confirm.
 */
export function PreflightDialog({ data, onCommit, onCancel }: PreflightDialogProps) {
  const { t } = useTranslation();
  if (!data) return null;

  const isUpdate = data.verb === "update";
  const headline =
    data.totalRows === null
      ? t("query.preflightHeadlineUnknown", { cap: String(data.cap), table: data.table })
      : t(isUpdate ? "query.preflightHeadlineUpdate" : "query.preflightHeadlineDelete", {
          count: String(data.totalRows),
          table: data.table,
        });

  // UPDATE shows identity + assigned columns; DELETE shows the full row.
  const assignedCols = data.assignments.map((a) => a.column);
  const diffCols = isUpdate
    ? [...data.keyColumns.filter((k) => !assignedCols.includes(k)), ...assignedCols]
    : data.columns;

  return (
    <Modal
      open
      onClose={onCancel}
      size="xl"
      title={t(isUpdate ? "query.preflightTitleUpdate" : "query.preflightTitleDelete", {
        table: data.table,
      })}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-sm text-foreground hover:bg-accent transition-colors"
          >
            {t("query.preflightCancel")}
          </button>
          <button
            type="button"
            onClick={onCommit}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            {t(isUpdate ? "query.preflightCommitUpdate" : "query.preflightCommitDelete")}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {!data.hasWhere && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t("query.preflightNoWhere", { table: data.table })}</span>
          </div>
        )}

        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>{headline}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={[
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
              data.irreversible === null
                ? "bg-green-500/15 text-green-600 dark:text-green-400"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
            ].join(" ")}
          >
            <History className="w-3 h-3" />
            {data.irreversible === null
              ? t("query.preflightReversible")
              : t(IRREVERSIBLE_KEY[data.irreversible], { cap: String(data.cap) })}
          </span>
          {data.truncated && (
            <span className="text-muted-foreground">
              {t("query.preflightTruncated", {
                cap: String(data.cap),
                total: data.totalRows === null ? "?" : String(data.totalRows),
              })}
            </span>
          )}
        </div>

        {isUpdate && (
          <p className="text-xs text-muted-foreground">{t("query.preflightPrediction")}</p>
        )}

        {data.rows.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr>
                  {diffCols.map((col) => (
                    <th
                      key={col}
                      className="px-2 py-1.5 text-left font-medium border-b border-border whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr
                    key={i}
                    className={
                      isUpdate ? "border-b border-border/50" : "border-b border-border/50 bg-red-500/5"
                    }
                  >
                    {diffCols.map((col) => {
                      const changed = isUpdate && row.changedColumns.includes(col);
                      const isAssigned = isUpdate && assignedCols.includes(col);
                      return (
                        <td key={col} className="px-2 py-1 font-mono whitespace-nowrap max-w-[280px] truncate">
                          {changed && row.after ? (
                            <>
                              <span className="text-muted-foreground line-through">
                                {formatVal(row.before[col])}
                              </span>
                              <span className="text-muted-foreground"> → </span>
                              <span className="font-medium text-foreground">
                                {formatVal(row.after[col])}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className={isUpdate ? "text-muted-foreground" : ""}>
                                {formatVal(row.before[col])}
                              </span>
                              {isAssigned && !changed && (
                                <span className="text-muted-foreground italic">
                                  {" "}
                                  {t("query.preflightNoChange")}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <div className="text-xs text-muted-foreground mb-1">{t("query.preflightSqlLabel")}</div>
          <pre className="rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
            {data.sql}
          </pre>
        </div>
      </div>
    </Modal>
  );
}
