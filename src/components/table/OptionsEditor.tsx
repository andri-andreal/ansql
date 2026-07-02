/**
 * OptionsEditor — controlled form for table-level options (engine, charset,
 * collation, row format, AUTO_INCREMENT, comment).
 *
 * Fully presentational: state lives in the parent via `options` + `onChange`.
 * Engine / charset / collation / row format / AUTO_INCREMENT are MySQL-only.
 * Table comment applies to MySQL + Postgres. SQLite has no table options.
 */

import { useTranslation } from "../../i18n";
import type { Dialect, TableOptions } from "../../types";

// ---------------------------------------------------------------------------
// Static option lists
// ---------------------------------------------------------------------------

const ENGINES = ["InnoDB", "MyISAM", "MEMORY"];
const ROW_FORMATS = ["DEFAULT", "DYNAMIC", "COMPACT", "REDUNDANT", "COMPRESSED"];

const FIELD_LABEL = "text-xs font-medium text-muted-foreground";
const FIELD_INPUT =
  "w-full rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary";

export interface OptionsEditorProps {
  options: TableOptions;
  onChange: (o: TableOptions) => void;
  dialect: Dialect;
}

export function OptionsEditor({ options, onChange, dialect }: OptionsEditorProps) {
  const { t } = useTranslation();
  const isMysql = dialect === "mysql";
  const isSqlite = dialect === "sqlite";
  // Comment is supported on MySQL + Postgres, not SQLite.
  const commentSupported = !isSqlite;

  const patch = (p: Partial<TableOptions>) => onChange({ ...options, ...p });

  const handleAutoIncrement = (raw: string) => {
    if (raw === "") {
      patch({ autoIncrement: null });
      return;
    }
    const parsed = parseInt(raw, 10);
    patch({ autoIncrement: isNaN(parsed) ? null : parsed });
  };

  if (isSqlite) {
    return (
      <p className="text-xs text-muted-foreground">{t("table.noTableOptionsSqlite")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isMysql && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Engine */}
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>{t("table.engine")}</span>
            <select
              value={options.engine ?? ""}
              onChange={(e) =>
                patch({ engine: e.target.value === "" ? null : e.target.value })
              }
              className={FIELD_INPUT}
              aria-label="Storage engine"
            >
              <option value="">{t("table.default")}</option>
              {ENGINES.map((eng) => (
                <option key={eng} value={eng}>
                  {eng}
                </option>
              ))}
            </select>
          </label>

          {/* Row format */}
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>{t("table.rowFormat")}</span>
            <select
              value={options.rowFormat ?? ""}
              onChange={(e) =>
                patch({ rowFormat: e.target.value === "" ? null : e.target.value })
              }
              className={FIELD_INPUT}
              aria-label="Row format"
            >
              <option value="">{t("table.default")}</option>
              {ROW_FORMATS.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {fmt}
                </option>
              ))}
            </select>
          </label>

          {/* Default charset */}
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>{t("table.defaultCharset")}</span>
            <input
              type="text"
              value={options.charset ?? ""}
              onChange={(e) =>
                patch({ charset: e.target.value === "" ? null : e.target.value })
              }
              placeholder="utf8mb4"
              className={FIELD_INPUT}
              aria-label="Default character set"
              spellCheck={false}
            />
          </label>

          {/* Collation */}
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>{t("table.collation")}</span>
            <input
              type="text"
              value={options.collation ?? ""}
              onChange={(e) =>
                patch({ collation: e.target.value === "" ? null : e.target.value })
              }
              placeholder="utf8mb4_unicode_ci"
              className={FIELD_INPUT}
              aria-label="Collation"
              spellCheck={false}
            />
          </label>

          {/* AUTO_INCREMENT start */}
          <label className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>{t("table.autoIncrementStart")}</span>
            <input
              type="number"
              min={1}
              value={options.autoIncrement ?? ""}
              onChange={(e) => handleAutoIncrement(e.target.value)}
              placeholder="1"
              className={FIELD_INPUT}
              aria-label="AUTO_INCREMENT start value"
            />
          </label>
        </div>
      )}

      {/* Table comment (MySQL + Postgres) */}
      {commentSupported && (
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>{t("table.tableComment")}</span>
          <textarea
            value={options.comment ?? ""}
            onChange={(e) =>
              patch({ comment: e.target.value === "" ? null : e.target.value })
            }
            placeholder={t("table.describeTablePlaceholder")}
            rows={3}
            className={`${FIELD_INPUT} resize-y`}
            aria-label="Table comment"
          />
        </label>
      )}
    </div>
  );
}
