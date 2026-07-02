import { useEffect, useState } from "react";
import type { Connection, SessionInfo } from "../../../types";
import type { TargetSel } from "../TransferWizard";
import { databaseCommands } from "../../../lib/tauri-commands";
import { useTranslation } from "../../../i18n";

const SQL_FILE_VALUE = "__sql_file__";

export function TargetStep({
  sessions,
  connections,
  sourceSessionId,
  value,
  onChange,
}: {
  sessions: SessionInfo[];
  connections: Connection[];
  /** The transfer source's session — excluded from the target list. */
  sourceSessionId: string;
  value: TargetSel | null;
  onChange: (v: TargetSel) => void;
}) {
  const { t } = useTranslation();
  const connName = (s: SessionInfo) =>
    connections.find((c) => c.id === s.connection_id)?.name ?? "Unknown connection";

  // The engine rejects source === target, so the source session is never a valid
  // target — keep it out of the list entirely.
  const targets = sessions.filter((s) => s.id !== sourceSessionId);

  const isFile = value?.kind === "sql-file";

  // Databases available on the chosen target session (for the database dropdown).
  const [databases, setDatabases] = useState<string[]>([]);
  useEffect(() => {
    if (isFile || !value?.sessionId) {
      setDatabases([]);
      return;
    }
    let ignore = false;
    databaseCommands
      .getDatabases(value.sessionId)
      .then((dbs) => {
        if (!ignore) setDatabases(dbs);
      })
      .catch(() => {
        if (!ignore) setDatabases([]);
      });
    return () => {
      ignore = true;
    };
  }, [value?.sessionId, isFile]);

  const selectValue = isFile ? SQL_FILE_VALUE : value?.sessionId ?? "";

  const handleSelect = (raw: string) => {
    if (raw === SQL_FILE_VALUE) {
      onChange({ kind: "sql-file", sessionId: "", database: "", schema: null });
      return;
    }
    onChange({
      kind: "session",
      sessionId: raw,
      database: sessions.find((s) => s.id === raw)?.database ?? "",
      schema: null,
    });
  };

  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">{t("io.targetConnection")}</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("io.targetConnectionHint")}
      </p>
      <select
        className="w-full rounded-lg border border-input bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
        value={selectValue}
        onChange={(e) => handleSelect(e.target.value)}
      >
        <option value="">{t("io.selectATarget")}</option>
        <option value={SQL_FILE_VALUE}>{t("io.fileSqlScript")}</option>
        {targets.length > 0 && (
          <optgroup label={t("io.sessions")}>
            {targets.map((s) => (
              <option key={s.id} value={s.id}>
                {connName(s)} / {s.database ?? t("io.noDbShort")}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {targets.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("io.noOtherSession")}
        </p>
      )}

      {isFile && (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("io.fileTargetHint")}
        </p>
      )}

      {value && !isFile && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium">
            {t("io.targetDatabase")}
            <select
              className="mt-1 w-full rounded-lg border border-input bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              value={value.database}
              onChange={(e) => onChange({ ...value, database: e.target.value })}
            >
              {/* Keep the current value selectable while the list loads / if absent. */}
              {value.database && !databases.includes(value.database) && (
                <option value={value.database}>{value.database}</option>
              )}
              {!value.database && <option value="">{t("io.selectADatabase")}</option>}
              {databases.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {t("io.targetSchema")}{" "}
            <span className="font-normal text-muted-foreground">
              {t("io.postgresqlOtherwiseBlank")}
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-input bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              value={value.schema ?? ""}
              onChange={(e) =>
                onChange({ ...value, schema: e.target.value || null })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
