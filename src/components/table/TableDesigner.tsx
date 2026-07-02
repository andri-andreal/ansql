/**
 * TableDesigner — host pane that ties the table designer together.
 *
 * Supports both "create" (new table) and "alter" (modify existing) modes.
 * All DDL is built in-browser via ddlBuilder / alterBuilder; the parent
 * provides the actual DB apply function via `onApply`.
 *
 * No Tauri imports — fully presentational + state.
 */

import { useEffect, useMemo, useState } from "react";
import { Columns, List, Link2, Code, Zap, Loader2, AlertTriangle, X, CheckCircle, Pencil, Trash2, Plus, ShieldCheck, Sliders, KeyRound } from "lucide-react";

import type {
  ColumnDefinition,
  DesignerCheck,
  DesignerColumn,
  DesignerForeignKey,
  DesignerIndex,
  DesignerUnique,
  Dialect,
  ForeignKeyInfo,
  IndexInfo,
  Statement,
  TableOptions,
} from "../../types";
import type { TriggerInfo } from "../../lib/introspectionQueries";
import { buildDropTrigger } from "../../lib/triggerBuilder";

import { buildCreateTable } from "../../lib/ddlBuilder";
import {
  rawTypeToCatalog,
  diffColumns,
  diffIndexes,
  diffChecks,
  diffUniques,
  diffTableOptions,
  buildAlter,
  supportedOnSqlite,
} from "../../lib/alterBuilder";
import {
  diffForeignKeys,
  buildForeignKeyStatements,
  fkEditingSupported,
} from "../../lib/fkBuilder";

import { ColumnEditorGrid } from "./ColumnEditorGrid";
import { IndexEditor } from "./IndexEditor";
import { ForeignKeyEditor } from "./ForeignKeyEditor";
import { ChecksEditor } from "./ChecksEditor";
import { OptionsEditor } from "./OptionsEditor";
import { UniquesEditor } from "./UniquesEditor";
import { SqlPreviewPane } from "./SqlPreviewPane";
import { useTranslation } from "../../i18n";
import { useDialogs } from "../ui";

// ---------------------------------------------------------------------------
// Module-level ID counter — deterministic, no Date.now / Math.random
// ---------------------------------------------------------------------------

let _seq = 0;
function nextId(prefix: "dc" | "di" | "fk"): string {
  return `${prefix}-${++_seq}`;
}

// ---------------------------------------------------------------------------
// Helpers: convert introspected types → DesignerColumn / DesignerIndex
// ---------------------------------------------------------------------------

function columnDefToDesigner(dialect: Dialect, col: ColumnDefinition): DesignerColumn {
  // Prefer the sized/declared type (e.g. varchar(500), numeric(18,4)) so lengths
  // and precision load into the designer instead of being truncated to defaults.
  const catalog = rawTypeToCatalog(dialect, col.full_type ?? col.data_type);
  return {
    id: nextId("dc"),
    name: col.name,
    type: catalog.type,
    length: catalog.length,
    precision: catalog.precision,
    scale: catalog.scale,
    nullable: col.nullable,
    defaultValue: col.default_value ?? null,
    isPrimaryKey: col.is_primary_key,
    isAutoIncrement: col.is_auto_increment,
    comment: col.comment ?? null,
  };
}

function indexInfoToDesigner(idx: IndexInfo): DesignerIndex {
  return {
    id: nextId("di"),
    name: idx.name,
    unique: idx.is_unique,
    columns: [...idx.columns],
  };
}

function foreignKeyInfoToDesigner(fk: ForeignKeyInfo): DesignerForeignKey {
  return {
    id: nextId("fk"),
    name: fk.name,
    columns: [...fk.columns],
    referencedTable: fk.referenced_table,
    referencedColumns: [...fk.referenced_columns],
    onDelete: fk.on_delete ?? "",
    onUpdate: fk.on_update ?? "",
  };
}

function cloneForeignKey(fk: DesignerForeignKey): DesignerForeignKey {
  return {
    ...fk,
    columns: [...fk.columns],
    referencedColumns: [...fk.referencedColumns],
  };
}

function blankColumn(): DesignerColumn {
  // Mirror ColumnEditorGrid.blankColumn so the create-mode first row matches
  // every subsequently added row (varchar(255)).
  return {
    id: nextId("dc"),
    name: "",
    type: "varchar",
    length: 255,
    precision: null,
    scale: null,
    nullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    isAutoIncrement: false,
    comment: null,
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TableDesignerProps {
  mode: "create" | "alter";
  dialect: Dialect;
  database: string;
  schema?: string | null;
  /** Required in "alter" mode. */
  tableName?: string;
  /** alter: from getColumns */
  originalColumns?: ColumnDefinition[];
  /** alter: from getIndexes */
  originalIndexes?: IndexInfo[];
  /** alter: from getForeignKeys */
  originalForeignKeys?: ForeignKeyInfo[];
  /** Referenced-table options for the FK editor. */
  listTables?: () => Promise<string[]>;
  /** Referenced columns for a chosen table in the FK editor. */
  getTableColumns?: (table: string) => Promise<string[]>;
  /**
   * Throws on failure. On postgres/sqlite the batch runs in a transaction and
   * rolls back; on MySQL each DDL statement auto-commits, so earlier ones stick.
   */
  onApply: (statements: Statement[]) => Promise<void>;
  /** Called after a successful apply, so the parent can refresh stale views. */
  onApplied?: () => void;
  onClose: () => void;
  // ---- Triggers tab (alter mode only) ----
  /** Lists this table's triggers (alter mode). When omitted, the Triggers tab is hidden. */
  listTriggers?: () => Promise<TriggerInfo[]>;
  /** Opens the standalone Trigger designer in create mode for this table. */
  onOpenTriggerDesigner?: () => void;
  /** Opens the standalone Trigger designer in edit mode for an existing trigger. */
  onEditTrigger?: (trigger: TriggerInfo) => void;
  /** Bumped by the parent after a trigger is created/edited/dropped to re-fetch the list. */
  triggerRefreshKey?: number;
}

// ---------------------------------------------------------------------------
// Tab IDs
// ---------------------------------------------------------------------------

type Tab =
  | "columns"
  | "indexes"
  | "uniques"
  | "checks"
  | "foreignKeys"
  | "options"
  | "triggers"
  | "preview";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TableDesigner({
  mode,
  dialect,
  database,
  schema,
  tableName,
  originalColumns = [],
  originalIndexes = [],
  originalForeignKeys = [],
  listTables,
  getTableColumns,
  onApply,
  onApplied,
  onClose,
  listTriggers,
  onOpenTriggerDesigner,
  onEditTrigger,
  triggerRefreshKey,
}: TableDesignerProps) {
  const { t } = useTranslation();
  const dialogs = useDialogs();
  // ---------- initial state ----------

  // Baseline columns for alter-mode diffing (stable deep copy, never mutated).
  const [baselineColumns] = useState<DesignerColumn[]>(() => {
    if (mode === "alter") {
      return originalColumns.map((c) => columnDefToDesigner(dialect, c));
    }
    return [];
  });

  // Baseline indexes for alter-mode diffing (exclude primary indexes).
  const [baselineIndexes] = useState<DesignerIndex[]>(() => {
    if (mode === "alter") {
      return originalIndexes
        .filter((idx) => !idx.is_primary)
        .map((idx) => indexInfoToDesigner(idx));
    }
    return [];
  });

  // Editable table name (create-only; read-only label in alter).
  const [name, setName] = useState<string>(mode === "create" ? "" : (tableName ?? ""));

  // Editable columns — cloned from baseline in alter; one blank in create.
  const [columns, setColumns] = useState<DesignerColumn[]>(() => {
    if (mode === "alter") {
      return baselineColumns.map((c) => ({ ...c }));
    }
    return [blankColumn()];
  });

  // Editable indexes — cloned from baseline in alter; empty in create.
  const [indexes, setIndexes] = useState<DesignerIndex[]>(() => {
    if (mode === "alter") {
      return baselineIndexes.map((idx) => ({ ...idx, columns: [...idx.columns] }));
    }
    return [];
  });

  // Whether the dialect supports add/drop FK via ALTER (false for SQLite).
  const fkSupported = fkEditingSupported(dialect);

  // Baseline foreign keys for alter-mode diffing (stable deep copy, never mutated).
  const [baselineForeignKeys] = useState<DesignerForeignKey[]>(() => {
    if (mode === "alter") {
      return originalForeignKeys.map((fk) => foreignKeyInfoToDesigner(fk));
    }
    return [];
  });

  // Editable foreign keys — deep-cloned from baseline in alter; empty in create.
  const [foreignKeys, setForeignKeys] = useState<DesignerForeignKey[]>(() =>
    baselineForeignKeys.map(cloneForeignKey),
  );

  // Editable CHECK / named-UNIQUE constraints + table options.
  //
  // These have no reverse-introspection yet, so in alter mode they start empty
  // (best-effort): the user adds new constraints/options, and the alter diff
  // treats the empty baseline as "nothing existed" → only ADDs are emitted.
  // Full round-trip of existing checks/uniques/options is a follow-up.
  const [checks, setChecks] = useState<DesignerCheck[]>([]);
  const [uniques, setUniques] = useState<DesignerUnique[]>([]);
  const [tableOptions, setTableOptions] = useState<TableOptions>({});

  // ---------- UI state ----------

  const [activeTab, setActiveTab] = useState<Tab>("columns");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // ---------- triggers (alter mode only) ----------
  // The Triggers tab is a LIGHT list that delegates create/edit to the standalone
  // TriggerDesigner. Drops are built here and run through the shared `onApply` path.
  const triggersEnabled = mode === "alter" && !!listTriggers;
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [loadingTriggers, setLoadingTriggers] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [droppingTrigger, setDroppingTrigger] = useState<string | null>(null);

  useEffect(() => {
    if (!triggersEnabled || !listTriggers) return;
    let cancelled = false;
    setLoadingTriggers(true);
    setTriggerError(null);
    listTriggers()
      .then((rows) => {
        if (!cancelled) setTriggers(rows);
      })
      .catch((e) => {
        if (!cancelled) setTriggerError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingTriggers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [triggersEnabled, listTriggers, triggerRefreshKey]);

  const handleDropTrigger = async (trigger: TriggerInfo) => {
    if (!(await dialogs.confirm({ title: t("table.dropTriggerConfirm", { name: trigger.name }), danger: true }))) return;
    setDroppingTrigger(trigger.name);
    setTriggerError(null);
    try {
      const stmts = buildDropTrigger(
        dialect,
        trigger.name,
        trigger.table,
        dialect === "mysql" ? database : (schema ?? trigger.schema ?? null),
      );
      await onApply(stmts);
      // Remove locally; do NOT call onApplied (which would close the designer).
      setTriggers((prev) => prev.filter((t) => t.name !== trigger.name));
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : String(e));
    } finally {
      setDroppingTrigger(null);
    }
  };

  // ---------- live preview (useMemo) ----------

  const { statements, warnings, sqliteBlocked } = useMemo<{
    statements: Statement[];
    warnings: string[];
    sqliteBlocked: boolean;
  }>(() => {
    // MySQL has no schemas: qualify with the browsed database so the DDL lands
    // there, not in the session's default DB. Postgres/SQLite use schema.
    const qualifier = dialect === "mysql" ? database : (schema ?? null);

    if (mode === "create") {
      const tableNameForSql = name.trim() || "new_table";
      const stmts = buildCreateTable(
        dialect,
        qualifier,
        tableNameForSql,
        columns,
        indexes,
        checks,
        uniques,
        tableOptions,
      );
      // Append FK constraints (ALTER TABLE ... ADD CONSTRAINT) after the CREATE.
      // No-op on SQLite (buildForeignKeyStatements returns []).
      if (fkSupported && foreignKeys.length > 0) {
        const fkOps = diffForeignKeys([], foreignKeys);
        stmts.push(
          ...buildForeignKeyStatements(dialect, qualifier, tableNameForSql, fkOps),
        );
      }
      const warns: string[] = [];
      if (!name.trim()) {
        warns.push(t("table.warnTableNameEmpty"));
      }
      if (columns.length === 0) {
        warns.push(t("table.warnNoColumnsDefined"));
      }
      return { statements: stmts, warnings: warns, sqliteBlocked: false };
    }

    // alter mode
    const colOps = diffColumns(baselineColumns, columns);
    const idxOps = diffIndexes(baselineIndexes, indexes);
    // Checks/uniques/options have no introspected baseline yet (see state init),
    // so these diff against empty → only the user's new additions are emitted.
    const checkOps = diffChecks([], checks);
    const uniqueOps = diffUniques([], uniques);
    const optionOps = diffTableOptions(undefined, tableOptions);
    const ops = [...colOps, ...idxOps, ...uniqueOps, ...checkOps, ...optionOps];

    // FK diff (alter). Empty when the dialect can't edit FKs (SQLite).
    const fkOps = fkSupported ? diffForeignKeys(baselineForeignKeys, foreignKeys) : [];

    // Rename is emitted truly last, so keep it out of the alter `ops` here and
    // append the rename statement after FK statements below.
    const renamed = name.trim() && name.trim() !== tableName ? name.trim() : null;

    if (ops.length === 0 && fkOps.length === 0 && !renamed) {
      return { statements: [], warnings: [], sqliteBlocked: false };
    }

    // SQLite: validate the (non-FK) ops + rename. FK editing is disabled for
    // SQLite so fkOps is always empty here.
    const renameOp = renamed ? [{ kind: "renameTable" as const, to: renamed }] : [];
    if (dialect === "sqlite") {
      const { ok, blocked } = supportedOnSqlite([...ops, ...renameOp]);
      if (!ok) {
        return { statements: [], warnings: blocked, sqliteBlocked: true };
      }
    }

    // Determine hasPk: does the original table have a PK column?
    const hasPk = originalColumns.some((c) => c.is_primary_key);

    // Column/index statements first.
    const stmts =
      ops.length > 0
        ? buildAlter(dialect, qualifier, tableName ?? "", ops, { hasPk })
        : [];

    // Foreign-key statements next (drop+add), before the rename.
    stmts.push(...buildForeignKeyStatements(dialect, qualifier, tableName ?? "", fkOps));

    // Rename truly last (so FK statements above still reference the old name).
    if (renameOp.length > 0) {
      stmts.push(...buildAlter(dialect, qualifier, tableName ?? "", renameOp, { hasPk }));
    }

    return { statements: stmts, warnings: [], sqliteBlocked: false };
  }, [
    mode,
    dialect,
    schema,
    database,
    name,
    columns,
    indexes,
    foreignKeys,
    checks,
    uniques,
    tableOptions,
    fkSupported,
    baselineColumns,
    baselineIndexes,
    baselineForeignKeys,
    tableName,
    originalColumns,
    t,
  ]);

  // ---------- derived ----------

  const canApply =
    statements.length > 0 && !sqliteBlocked && !applying;

  const availableColumns = columns.map((c) => c.name).filter(Boolean);

  // ---------- apply flow ----------

  const handleSaveClick = () => {
    if (!canApply) return;
    setApplyError(null);
    if (mode === "create") {
      // For create mode, apply directly without extra confirm step.
      void runApply();
    } else {
      setConfirmOpen(true);
    }
  };

  const runApply = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      await onApply(statements);
      onApplied?.();
      onClose();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
      setConfirmOpen(false);
    } finally {
      setApplying(false);
    }
  };

  const handleConfirmApply = () => {
    void runApply();
  };

  const handleCloseConfirm = () => {
    if (!applying) setConfirmOpen(false);
  };

  // ---------- title ----------

  const title = mode === "create" ? t("table.newTable") : t("table.designTitle", { table: tableName ?? "" });

  // ---------- tabs ----------

  const tabs: { id: Tab; label: string; Icon: typeof Columns }[] = [
    { id: "columns", label: t("table.columns"), Icon: Columns },
    { id: "indexes", label: t("table.indexes"), Icon: List },
    { id: "uniques", label: t("table.uniques"), Icon: KeyRound },
    { id: "checks", label: t("table.checks"), Icon: ShieldCheck },
    // FK tab only when the dialect supports add/drop FK via ALTER (not SQLite).
    ...(fkSupported
      ? [{ id: "foreignKeys" as const, label: t("table.foreignKeys"), Icon: Link2 }]
      : []),
    { id: "options", label: t("table.options"), Icon: Sliders },
    // Triggers tab only in alter mode (a yet-to-be-created table has none).
    ...(triggersEnabled
      ? [{ id: "triggers" as const, label: t("table.triggers"), Icon: Zap }]
      : []),
    { id: "preview", label: t("table.sqlPreview"), Icon: Code },
  ];

  // ---------- render ----------

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h2 className="shrink-0 text-base font-semibold text-foreground">{title}</h2>

          {/* Table name input — create mode or alter mode (editable for rename) */}
          {(mode === "create" || mode === "alter") && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "create" ? t("table.tableNamePlaceholder") : tableName}
              aria-label="Table name"
              className="min-w-0 max-w-xs rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Inline apply error (outside modal so it persists) */}
          {applyError && mode === "create" && (
            <span className="max-w-xs truncate text-xs text-destructive" title={applyError}>
              {applyError}
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            {t("table.cancel")}
          </button>

          <button
            type="button"
            onClick={handleSaveClick}
            disabled={!canApply}
            className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            {applying ? t("table.applying") : t("table.save")}
          </button>
        </div>
      </div>

      {/* ── SQLite blocked banner (alter mode) ── */}
      {sqliteBlocked && warnings.length > 0 && (
        <div className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("table.sqliteRebuildWarning")}</span>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex border-b border-border px-4">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === id
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {activeTab === id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "columns" && (
          <ColumnEditorGrid
            columns={columns}
            onChange={setColumns}
            dialect={dialect}
          />
        )}

        {activeTab === "indexes" && (
          <IndexEditor
            indexes={indexes}
            availableColumns={availableColumns}
            onChange={setIndexes}
            dialect={dialect}
          />
        )}

        {activeTab === "uniques" && (
          <UniquesEditor
            uniques={uniques}
            availableColumns={availableColumns}
            onChange={setUniques}
          />
        )}

        {activeTab === "checks" && (
          <ChecksEditor checks={checks} onChange={setChecks} dialect={dialect} />
        )}

        {activeTab === "foreignKeys" &&
          (fkSupported ? (
            <ForeignKeyEditor
              foreignKeys={foreignKeys}
              localColumns={availableColumns}
              listTables={listTables ?? (() => Promise.resolve([]))}
              getTableColumns={getTableColumns ?? (() => Promise.resolve([]))}
              onChange={setForeignKeys}
              dialect={dialect}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("table.fkNotSupportedSqlite")}
            </p>
          ))}

        {activeTab === "options" && (
          <OptionsEditor
            options={tableOptions}
            onChange={setTableOptions}
            dialect={dialect}
          />
        )}

        {activeTab === "triggers" && triggersEnabled && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {t("table.triggersOn")}{" "}
                <span className="font-mono text-foreground">{tableName}</span>.{" "}
                {t("table.triggersEditHint")}
              </p>
              {onOpenTriggerDesigner && (
                <button
                  type="button"
                  onClick={onOpenTriggerDesigner}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("table.newTrigger")}
                </button>
              )}
            </div>

            {triggerError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="break-all">{triggerError}</span>
              </div>
            )}

            {loadingTriggers ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("table.loadingTriggers")}
              </div>
            ) : triggers.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                {t("table.noTriggersOnTable")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {triggers.map((trg) => (
                  <li
                    key={trg.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Zap className="h-4 w-4 shrink-0 text-yellow-500" />
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm text-foreground">{trg.name}</div>
                        {(trg.timing || trg.event) && (
                          <div className="truncate text-xs text-muted-foreground">
                            {[trg.timing, trg.event].filter(Boolean).join(" ")}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {onEditTrigger && (
                        <button
                          type="button"
                          onClick={() => onEditTrigger(trg)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                          title={t("table.editTrigger")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t("table.edit")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDropTrigger(trg)}
                        disabled={droppingTrigger === trg.name}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        title={t("table.dropTrigger")}
                      >
                        {droppingTrigger === trg.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        {t("table.drop")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === "preview" && (
          <SqlPreviewPane
            statements={statements}
            warnings={warnings.length > 0 ? warnings : undefined}
          />
        )}
      </div>

      {/* ── Alter confirmation modal ── */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={handleCloseConfirm}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="flex w-[32rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Code className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-title" className="text-base font-semibold leading-tight">
                  {statements.length === 1
                    ? t("table.applyStatementsTitleOne", { table: tableName ?? "" })
                    : t("table.applyStatementsTitleMany", {
                        count: statements.length,
                        table: tableName ?? "",
                      })}
                </h2>
                {dialect === "mysql" ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("table.applyMysqlPrefix")}{" "}
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
                      {database}
                    </span>{" "}
                    {t("table.applyMysqlSuffix")}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("table.applyTxnPrefix")}{" "}
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
                      {database}
                    </span>
                    {t("table.applyTxnSuffix")}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleCloseConfirm}
                disabled={applying}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title={t("table.cancel")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* SQL preview */}
            <div className="max-h-64 overflow-auto p-5">
              <pre className="rounded border border-border bg-secondary/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
                {statements.map((s) => s.sql).join("\n\n")}
              </pre>
            </div>

            {/* Error */}
            {applyError && (
              <div className="mx-5 mb-2 overflow-hidden rounded-lg border border-destructive/40">
                <div className="flex items-center gap-1.5 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {dialect === "mysql"
                    ? t("table.applyFailedMysql")
                    : t("table.applyFailedTxn")}
                </div>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {applyError}
                </pre>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border bg-secondary/30 px-5 py-3">
              <button
                type="button"
                onClick={handleCloseConfirm}
                disabled={applying}
                className="rounded-lg px-3.5 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
              >
                {t("table.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmApply}
                disabled={applying}
                className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                {applying ? t("table.applying") : t("table.apply")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
