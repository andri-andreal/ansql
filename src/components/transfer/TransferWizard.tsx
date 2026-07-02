import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  ColumnMap,
  ColumnMeta,
  ConflictMode,
  Connection,
  DatabaseDriver,
  Dialect,
  ErrorPolicy,
  SessionInfo,
  TableInfo,
  TransferJob,
  TransferOptions,
} from "../../types";
import { quoteIdent } from "../../lib/mutationBuilder";
import { buildInsertSql } from "../../lib/exportFormats";
import { queryCommands, databaseCommands } from "../../lib/tauri-commands";
import { getTriggers } from "../../lib/introspectionQueries";
import {
  getRoutineDefinitionQuery,
  listRoutinesQuery,
  type RoutineKind,
} from "../../lib/routineBuilder";
import {
  buildViewCopy,
  dependencyOrder,
  normalizeCreateDdl,
  type ObjectCopyResult,
  type TransferObjectKind,
  type TransferObjectRef,
} from "../../lib/objectTransfer";
import { TargetStep } from "./steps/TargetStep";
import { TablesStep } from "./steps/TablesStep";
import { ObjectsStep, type TransferObjectSel } from "./steps/ObjectsStep";
import { OptionsStep } from "./steps/OptionsStep";
import { PreviewStep } from "./steps/PreviewStep";
import { RunStep } from "./steps/RunStep";
import { useTranslation } from "../../i18n";

export interface TransferWizardProps {
  sourceSession: SessionInfo;
  sourceDatabase: string;
  sourceTables: TableInfo[];
  preselectedTables: string[];
  sessions: SessionInfo[];
  connections: Connection[];
  onClose: () => void;
}

const STEPS = ["Target", "Tables", "Objects", "Options", "Preview", "Run"] as const;
type StepName = (typeof STEPS)[number];

/** i18n key for each step's display label. */
const STEP_LABEL_KEY: Record<StepName, string> = {
  Target: "io.stepTarget",
  Tables: "io.stepTables",
  Objects: "io.stepObjects",
  Options: "io.stepOptions",
  Preview: "io.stepPreview",
  Run: "io.stepRun",
};

/** A live target session, or a generated .sql script written to disk. */
export type TargetKind = "session" | "sql-file";

export interface TargetSel {
  kind: TargetKind;
  sessionId: string;
  database: string;
  schema: string | null;
}

export interface TableSel {
  source_table: string;
  target_table: string;
  target_schema: string | null;
  conflict: ConflictMode;
  selected: boolean;
  /**
   * Optional source-column→target-column remap. Empty until the user opens the
   * per-table editor (which lazy-loads source columns). A mapping entry with an
   * empty `target` drops that source column from the transfer.
   */
  mapping: ColumnMap[];
  /** Source columns, lazy-loaded the first time the per-table editor is opened. */
  columns: ColumnMeta[];
  /** Raw SQL WHERE clause (without the WHERE keyword) scoping the source rows. */
  where: string;
}

/** A persisted transfer profile (localStorage "ansql.transferProfiles"). */
export interface TransferProfile {
  name: string;
  target: TargetSel | null;
  tables: TableSel[];
  options: TransferOptions;
}

const PROFILES_KEY = "ansql.transferProfiles";

export function loadProfiles(): TransferProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TransferProfile[]) : [];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: TransferProfile[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    /* localStorage may be unavailable / full — non-fatal. */
  }
}

const dialectOf = (driver: DatabaseDriver | undefined): Dialect =>
  driver === "postgres" ? "postgres" : driver === "sqlite" ? "sqlite" : "mysql";

/**
 * Build the `source_query` for a table when the user remapped/dropped columns
 * or set a WHERE filter. Returns null when neither applies (so the engine uses
 * its default full-table copy).
 *
 * Only mapped source columns are selected, aliased to their target name so the
 * engine's column matching lines up with the (possibly renamed) targets.
 */
export function buildSourceQuery(
  dialect: Dialect,
  sourceSchema: string | null,
  table: TableSel
): string | null {
  const where = table.where.trim();
  // A mapping only matters when it actually drops a column (empty target) or
  // renames one (source != target). A pure identity mapping — including the
  // empty "editor never opened" case — means "copy every column as-is", so the
  // engine's default full-table copy is used.
  const activeMapping = table.mapping.some(
    (m) => m.target.trim() === "" || m.source !== m.target
  );
  if (!where && !activeMapping) return null;

  const qualifiedSource = sourceSchema
    ? `${quoteIdent(dialect, sourceSchema)}.${quoteIdent(dialect, table.source_table)}`
    : quoteIdent(dialect, table.source_table);

  let selectList: string;
  if (activeMapping) {
    const cols = table.mapping
      .filter((m) => m.target.trim() !== "")
      .map((m) =>
        m.source === m.target
          ? quoteIdent(dialect, m.source)
          : `${quoteIdent(dialect, m.source)} AS ${quoteIdent(dialect, m.target)}`
      );
    // Defend against a mapping that drops everything — fall back to "*".
    selectList = cols.length > 0 ? cols.join(", ") : "*";
  } else {
    selectList = "*";
  }

  const whereClause = where ? ` WHERE ${where}` : "";
  return `SELECT ${selectList} FROM ${qualifiedSource}${whereClause}`;
}

export function TransferWizard(props: TransferWizardProps) {
  const { t } = useTranslation();
  const sourceDriver = props.connections.find(
    (c) => c.id === props.sourceSession.connection_id
  )?.driver;
  const sourceDialect = dialectOf(sourceDriver);

  const [step, setStep] = useState<StepName>("Target");
  const [target, setTarget] = useState<TargetSel | null>(null);
  const [tables, setTables] = useState<TableSel[]>(
    props.sourceTables.map((t) => ({
      source_table: t.name,
      target_table: t.name,
      target_schema: null,
      conflict: "drop" as ConflictMode,
      selected: props.preselectedTables.includes(t.name),
      mapping: [],
      columns: [],
      where: "",
    }))
  );
  const [options, setOptions] = useState<TransferOptions>({
    copy_structure: true,
    copy_data: true,
    copy_indexes: true,
    copy_fks: true,
    batch_size: 500,
    error_policy: "table_atomic_continue" as ErrorPolicy,
  });

  // Non-table objects (views / routines / triggers) ------------------------
  const [views, setViews] = useState<TransferObjectSel[]>([]);
  const [routines, setRoutines] = useState<TransferObjectSel[]>([]);
  const [triggers, setTriggers] = useState<TransferObjectSel[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  // Track whether we've loaded once so re-entering the step doesn't re-fetch
  // (and clobber the user's selections).
  const objectsLoadedRef = useRef(false);

  const setObjectSel = useCallback(
    (kind: TransferObjectKind, next: TransferObjectSel[]) => {
      if (kind === "view") setViews(next);
      else if (kind === "routine") setRoutines(next);
      else setTriggers(next);
    },
    []
  );

  // Profiles ----------------------------------------------------------------
  const [profiles, setProfiles] = useState<TransferProfile[]>(() => loadProfiles());
  const [profileName, setProfileName] = useState("");
  const [fileSaveError, setFileSaveError] = useState<string | null>(null);

  const persistProfiles = useCallback((next: TransferProfile[]) => {
    setProfiles(next);
    saveProfiles(next);
  }, []);

  const handleSaveProfile = useCallback(() => {
    const name = profileName.trim();
    if (!name) return;
    const profile: TransferProfile = { name, target, tables, options };
    const next = [...profiles.filter((p) => p.name !== name), profile].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    persistProfiles(next);
    setProfileName("");
  }, [profileName, target, tables, options, profiles, persistProfiles]);

  const handleLoadProfile = useCallback(
    (name: string) => {
      const profile = profiles.find((p) => p.name === name);
      if (!profile) return;
      setTarget(profile.target);
      // Reconcile loaded tables against the current source tables: keep only
      // entries that still exist, defaulting any missing new fields.
      const byName = new Map(profile.tables.map((t) => [t.source_table, t]));
      setTables(
        props.sourceTables.map((st) => {
          const saved = byName.get(st.name);
          if (!saved) {
            return {
              source_table: st.name,
              target_table: st.name,
              target_schema: null,
              conflict: "drop" as ConflictMode,
              selected: false,
              mapping: [],
              columns: [],
              where: "",
            };
          }
          return {
            ...saved,
            // `columns` is runtime-only metadata; re-load lazily on demand.
            columns: [],
          };
        })
      );
      setOptions(profile.options);
    },
    [profiles, props.sourceTables]
  );

  const handleDeleteProfile = useCallback(
    (name: string) => {
      persistProfiles(profiles.filter((p) => p.name !== name));
    },
    [profiles, persistProfiles]
  );

  // -------------------------------------------------------------------------

  const selectedTables = tables.filter((t) => t.selected);
  const canPreviewOrRun = !!target && selectedTables.length > 0;
  const isFileTarget = target?.kind === "sql-file";

  const jobs: TransferJob[] = useMemo(
    () =>
      selectedTables.map((t) => ({
        source_table: t.source_table,
        source_schema: null,
        target_db: target?.database ?? "",
        target_schema: t.target_schema ?? target?.schema ?? null,
        target_table: t.target_table,
        conflict: t.conflict,
        source_query: buildSourceQuery(sourceDialect, null, t),
      })),
    [selectedTables, target?.database, target?.schema, sourceDialect]
  );

  // The target session's dialect drives how recreate-DDL is shaped (view
  // CREATE syntax, and whether routines/triggers are even applicable — SQLite
  // has neither). For a .sql-file target there is no live target to recreate
  // objects on, so the Objects step is data-only-table territory.
  const targetDriver = target?.sessionId
    ? props.connections.find(
        (c) =>
          c.id ===
          props.sessions.find((s) => s.id === target.sessionId)?.connection_id
      )?.driver
    : undefined;
  const targetDialect = dialectOf(targetDriver);

  /**
   * Lazy-load the source database's non-table objects the first time the user
   * opens the Objects step: views (from the already-introspected sourceTables),
   * routines (information_schema / pg_proc via listRoutinesQuery), and triggers
   * (get_triggers). Selections persist across step navigation; we only fetch
   * once.
   */
  const loadObjects = useCallback(async () => {
    if (objectsLoadedRef.current) return;
    objectsLoadedRef.current = true;
    setObjectsLoading(true);
    try {
      const sid = props.sourceSession.id;
      const db = props.sourceDatabase;

      // Views — already present in sourceTables, flagged via table_type.
      const viewSel: TransferObjectSel[] = props.sourceTables
        .filter((t) => (t.table_type ?? "").toLowerCase().includes("view"))
        .map((t) => ({
          kind: "view",
          name: t.name,
          schema: t.schema ?? null,
          selected: false,
        }));
      setViews(viewSel);

      // Routines — only MySQL/Postgres have stored routines.
      let routineSel: TransferObjectSel[] = [];
      const routineSchema = sourceDialect === "mysql" ? db : null;
      const routineQuery = listRoutinesQuery(sourceDialect, db, routineSchema);
      if (routineQuery) {
        const res = await queryCommands.executeQuery(sid, routineQuery);
        routineSel = res.rows.map((row) => {
          const name = String(row.name ?? "");
          const type = String(row.type ?? "").toLowerCase();
          const routineKind: RoutineKind =
            type === "procedure" ? "procedure" : "function";
          return {
            kind: "routine",
            name,
            schema: routineSchema,
            routineKind,
            selected: false,
          };
        });
      }
      setRoutines(routineSel);

      // Triggers — get_triggers across the whole database.
      let triggerSel: TransferObjectSel[] = [];
      try {
        const trigs = await getTriggers(sid, db);
        triggerSel = trigs.map((t) => ({
          kind: "trigger",
          name: t.name,
          schema: t.schema ?? null,
          selected: false,
        }));
      } catch {
        // Some drivers/databases may not support trigger introspection; treat
        // as "no triggers" rather than failing the whole step.
        triggerSel = [];
      }
      setTriggers(triggerSel);
    } catch {
      // A hard failure (e.g. routine listing query rejected) leaves whatever we
      // managed to set; allow a retry by clearing the loaded flag.
      objectsLoadedRef.current = false;
    } finally {
      setObjectsLoading(false);
    }
  }, [
    props.sourceSession.id,
    props.sourceDatabase,
    props.sourceTables,
    sourceDialect,
  ]);

  useEffect(() => {
    if (step === "Objects") void loadObjects();
  }, [step, loadObjects]);

  /**
   * Extract the full CREATE statement from a getRoutineDefinitionQuery result.
   * MySQL `SHOW CREATE …` returns a `Create Function`/`Create Procedure`
   * column; Postgres `pg_get_functiondef` returns a single aliased value. Fall
   * back to the longest string value so column-name casing differences don't
   * break extraction. (Mirrors the same logic in App.tsx's routine editor.)
   */
  const extractRoutineDefinition = useCallback(
    (result: { rows: Record<string, unknown>[] }, kind: RoutineKind): string => {
      const row = result.rows[0];
      if (!row) return "";
      const preferredKeys =
        kind === "procedure"
          ? ["Create Procedure", "definition", "pg_get_functiondef"]
          : ["Create Function", "definition", "pg_get_functiondef"];
      for (const key of preferredKeys) {
        const v = row[key];
        if (typeof v === "string" && v.trim() !== "") return v;
      }
      let best = "";
      for (const v of Object.values(row)) {
        if (typeof v === "string" && v.length > best.length) best = v;
      }
      return best;
    },
    []
  );

  /**
   * After the table transfer completes, recreate the selected non-table objects
   * on the target — views first, then routines, then triggers (dependencyOrder).
   * Each object is wrapped in its own try/catch so one failure (e.g. a missing
   * referenced table, or an overloaded-routine ambiguity) doesn't abort the
   * rest. Returns a per-object result list for the Run step to display.
   *
   * No-op (returns []) when nothing is selected or the target isn't a live
   * session (a .sql-file target can't have objects recreated on it).
   */
  const copyObjects = useCallback(async (): Promise<ObjectCopyResult[]> => {
    if (!target || target.kind !== "session") return [];

    const selectedViews = views.filter((v) => v.selected);
    const selectedRoutines = routines.filter((r) => r.selected);
    const selectedTriggers = triggers.filter((t) => t.selected);

    const refs: TransferObjectRef[] = dependencyOrder([
      ...selectedViews.map(
        (v): TransferObjectRef => ({ kind: "view", name: v.name, schema: v.schema })
      ),
      ...selectedRoutines.map(
        (r): TransferObjectRef => ({
          kind: "routine",
          name: r.name,
          schema: r.schema,
          routineKind: r.routineKind,
        })
      ),
      ...selectedTriggers.map(
        (t): TransferObjectRef => ({ kind: "trigger", name: t.name, schema: t.schema })
      ),
    ]);
    if (refs.length === 0) return [];

    const sid = props.sourceSession.id;
    const tid = target.sessionId;
    const sourceDb = props.sourceDatabase;
    const targetSchema = target.schema ?? null;
    const results: ObjectCopyResult[] = [];

    // Trigger CREATE text is read from a single get_triggers call (it returns
    // every trigger's .statement). Fetch once and index by name; if it fails,
    // each selected trigger surfaces its own "could not read" error below.
    let triggerByName: Map<string, string> | null = null;
    if (selectedTriggers.length > 0) {
      try {
        const trigs = await getTriggers(sid, sourceDb);
        triggerByName = new Map(trigs.map((t) => [t.name, t.statement]));
      } catch {
        triggerByName = new Map();
      }
    }

    for (const ref of refs) {
      const label = ref.schema ? `${ref.schema}.${ref.name}` : ref.name;
      try {
        if (ref.kind === "view") {
          const body = await databaseCommands.getViewDefinition(
            sid,
            sourceDb,
            ref.name,
            ref.schema ?? undefined
          );
          if (!body || !body.trim()) {
            throw new Error("empty view definition");
          }
          const stmts = buildViewCopy(targetDialect, targetSchema, ref.name, body);
          for (const stmt of stmts) {
            await queryCommands.executeQuery(tid, stmt.sql);
          }
        } else if (ref.kind === "routine") {
          // MySQL qualifies SHOW CREATE with the source database; Postgres with
          // the schema.
          const qualifier = sourceDialect === "mysql" ? sourceDb : ref.schema;
          const kind: RoutineKind = ref.routineKind ?? "function";
          const defQuery = getRoutineDefinitionQuery(
            sourceDialect,
            qualifier,
            ref.name,
            kind
          );
          if (!defQuery) throw new Error("routines unsupported on this dialect");
          const res = await queryCommands.executeQuery(sid, defQuery);
          const ddl = normalizeCreateDdl(extractRoutineDefinition(res, kind));
          if (!ddl) throw new Error("could not read routine definition");
          await queryCommands.executeQuery(tid, ddl);
        } else {
          // trigger
          const statement = triggerByName?.get(ref.name);
          if (!statement || !statement.trim()) {
            throw new Error("could not read trigger definition");
          }
          const ddl = normalizeCreateDdl(statement);
          await queryCommands.executeQuery(tid, ddl);
        }
        results.push({ object: label, kind: ref.kind, status: "success", error: null });
      } catch (e) {
        results.push({
          object: label,
          kind: ref.kind,
          status: "failed",
          error: String(e),
        });
      }
    }

    return results;
  }, [
    target,
    views,
    routines,
    triggers,
    props.sourceSession.id,
    props.sourceDatabase,
    sourceDialect,
    targetDialect,
    extractRoutineDefinition,
  ]);

  /**
   * Generate a .sql script for the selected tables (data only, via the source
   * queries) and write it to disk through the export save() path. Used when the
   * target is "File (.sql script)" instead of a live session.
   */
  const exportScript = useCallback(async () => {
    setFileSaveError(null);
    try {
      const blocks: string[] = [
        `-- ANSQL transfer script from ${props.sourceDatabase} (${sourceDialect})`,
      ];

      for (const t of selectedTables) {
        const query =
          buildSourceQuery(sourceDialect, null, t) ??
          `SELECT * FROM ${quoteIdent(sourceDialect, t.source_table)}`;
        const result = await queryCommands.executeQuery(props.sourceSession.id, query);
        const columns = result.columns.map((c) => c.name);
        const rows = result.rows.map((row) => {
          const obj: Record<string, unknown> = {};
          for (const c of columns) obj[c] = row[c];
          return obj;
        });
        const insertSql = buildInsertSql(t.target_table, columns, rows, sourceDialect);
        blocks.push(`-- ${t.target_table} (${rows.length} rows)\n${insertSql}`.trimEnd());
      }

      const filePath = await save({
        title: "Export transfer script",
        defaultPath: `${props.sourceDatabase || "transfer"}.sql`,
        filters: [{ name: "SQL Files", extensions: ["sql"] }],
      });
      if (!filePath) return;

      await writeTextFile(filePath, blocks.join("\n\n") + "\n");
    } catch (e) {
      setFileSaveError(String(e));
    }
  }, [selectedTables, sourceDialect, props.sourceDatabase, props.sourceSession.id]);

  const stepLocked = (name: StepName) =>
    (name === "Preview" || name === "Run") && !canPreviewOrRun;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[80vh] w-[900px] overflow-hidden rounded-lg bg-card shadow-xl">
        {/* Step sidebar */}
        <div className="w-48 shrink-0 border-r border-border p-4">
          <h2 className="mb-4 text-sm font-semibold">{t("io.dataTransfer")}</h2>
          <ul className="space-y-1">
            {STEPS.map((s) => (
              <li key={s}>
                <button
                  disabled={stepLocked(s)}
                  onClick={() => setStep(s)}
                  className={`w-full rounded px-2 py-1.5 text-left text-sm transition-colors ${
                    step === s
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-secondary"
                  } ${stepLocked(s) ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  {t(STEP_LABEL_KEY[s])}
                </button>
              </li>
            ))}
          </ul>

          {/* Profiles */}
          <div className="mt-6 space-y-2 border-t border-border pt-4">
            <span className="text-xs font-medium text-muted-foreground">{t("io.profiles")}</span>
            <div className="flex gap-1">
              <input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder={t("io.profileNamePlaceholder")}
                className="min-w-0 flex-1 rounded border border-input bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              />
              <button
                onClick={handleSaveProfile}
                disabled={!profileName.trim()}
                className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-40 transition-colors"
              >
                {t("io.save")}
              </button>
            </div>
            {profiles.length > 0 && (
              <ul className="space-y-1">
                {profiles.map((p) => (
                  <li key={p.name} className="flex items-center gap-1 text-xs">
                    <button
                      onClick={() => handleLoadProfile(p.name)}
                      className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left hover:bg-secondary transition-colors"
                      title={t("io.loadProfile", { name: p.name })}
                    >
                      {p.name}
                    </button>
                    <button
                      onClick={() => handleDeleteProfile(p.name)}
                      className="shrink-0 rounded px-1 text-muted-foreground hover:text-destructive transition-colors"
                      title={t("io.deleteProfile", { name: p.name })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Content panel */}
        <div className="flex flex-1 flex-col">
          <div className="flex-1 overflow-auto p-6">
            {step === "Target" && (
              <TargetStep
                sessions={props.sessions}
                connections={props.connections}
                sourceSessionId={props.sourceSession.id}
                value={target}
                onChange={setTarget}
              />
            )}
            {step === "Tables" && (
              <TablesStep
                tables={tables}
                onChange={setTables}
                sourceSessionId={props.sourceSession.id}
                sourceDatabase={props.sourceDatabase}
              />
            )}
            {step === "Objects" &&
              (isFileTarget ? (
                <div className="text-sm text-muted-foreground">
                  {t("io.objectsNeedLiveTarget")}
                </div>
              ) : (
                <ObjectsStep
                  views={views}
                  routines={routines}
                  triggers={triggers}
                  onChange={setObjectSel}
                  loading={objectsLoading}
                />
              ))}
            {step === "Options" && <OptionsStep value={options} onChange={setOptions} />}
            {step === "Preview" && canPreviewOrRun && target && !isFileTarget && (
              <PreviewStep
                sourceSession={props.sourceSession.id}
                targetSession={target.sessionId}
                jobs={jobs}
                options={options}
              />
            )}
            {step === "Preview" && canPreviewOrRun && isFileTarget && (
              <div className="text-sm text-muted-foreground">
                {t("io.scriptTargetPreviewNote")}
              </div>
            )}
            {step === "Run" && canPreviewOrRun && target && !isFileTarget && (
              <RunStep
                sourceSession={props.sourceSession.id}
                targetSession={target.sessionId}
                jobs={jobs}
                options={options}
                onAfterRun={copyObjects}
                objectCount={
                  views.filter((v) => v.selected).length +
                  routines.filter((r) => r.selected).length +
                  triggers.filter((t) => t.selected).length
                }
              />
            )}
            {step === "Run" && canPreviewOrRun && isFileTarget && (
              <div className="space-y-3">
                <h3 className="text-base font-semibold">{t("io.generateSqlScript")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("io.generateSqlScriptNote", { count: selectedTables.length })}
                </p>
                <button
                  onClick={exportScript}
                  className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors"
                >
                  {t("io.saveScript")}
                </button>
                {fileSaveError && (
                  <p className="text-sm text-destructive">{fileSaveError}</p>
                )}
              </div>
            )}
          </div>

          {/* Footer nav */}
          <div className="flex justify-between border-t border-border p-4">
            <button
              onClick={props.onClose}
              className="rounded px-3 py-1.5 text-sm hover:bg-secondary transition-colors"
            >
              {t("io.close")}
            </button>
            <div className="flex gap-2">
              {step !== "Target" && (
                <button
                  onClick={() => setStep(STEPS[STEPS.indexOf(step) - 1])}
                  className="rounded px-3 py-1.5 text-sm hover:bg-secondary transition-colors"
                >
                  {t("io.back")}
                </button>
              )}
              {step !== "Run" && (
                <button
                  onClick={() => setStep(STEPS[STEPS.indexOf(step) + 1])}
                  disabled={stepLocked(STEPS[STEPS.indexOf(step) + 1])}
                  className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40 transition-colors"
                >
                  {t("io.next")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
