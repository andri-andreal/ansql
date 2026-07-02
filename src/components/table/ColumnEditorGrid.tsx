/**
 * ColumnEditorGrid — controlled editable grid of DesignerColumn rows.
 *
 * Fully presentational: all state lives in the parent via the `columns` +
 * `onChange` props. No Tauri calls, no SQL generation.
 */

import { Fragment, useState } from "react";
import { Trash2, ChevronUp, ChevronDown, Settings2 } from "lucide-react";
import type { DesignerColumn, Dialect } from "../../types";
import { TYPE_CATALOG } from "../../lib/ddlBuilder";
import { useTranslation } from "../../i18n";

// ---------------------------------------------------------------------------
// Unique-id counter (module-level; deterministic, no Date.now / Math.random)
// ---------------------------------------------------------------------------

let seq = 0;
function nextId(): string {
  return `col-${++seq}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Types that support isAutoIncrement (integer family only). */
const AUTO_INCREMENT_TYPES = new Set(["int", "bigint", "smallint"]);

function isAutoIncrementable(type: string): boolean {
  return AUTO_INCREMENT_TYPES.has(type);
}

/** MySQL UNSIGNED / ZEROFILL apply to the integer / decimal / float families. */
const NUMERIC_TYPES = new Set(["int", "bigint", "smallint", "decimal", "real", "double"]);

function isNumeric(type: string): boolean {
  return NUMERIC_TYPES.has(type);
}

/** Types that accept ON UPDATE CURRENT_TIMESTAMP (MySQL). */
function isTimestampy(type: string): boolean {
  return type === "timestamp";
}

/** Build a blank DesignerColumn with sensible defaults. */
function blankColumn(): DesignerColumn {
  return {
    id: nextId(),
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

export interface ColumnEditorGridProps {
  columns: DesignerColumn[];
  onChange: (columns: DesignerColumn[]) => void;
  dialect: Dialect;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ColumnEditorGrid({ columns, onChange, dialect }: ColumnEditorGridProps) {
  const { t } = useTranslation();
  // SQLite has no column comments — disable the comment input there.
  const commentsDisabled = dialect === "sqlite";
  const isMysql = dialect === "mysql";

  // Rows whose "Advanced" attribute drawer is expanded (by column id).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // The Advanced drawer is only useful on MySQL (unsigned/charset/collation/
  // on-update) or for generated columns (all dialects). Gate the toggle button.
  const advancedAvailable = (col: DesignerColumn): boolean =>
    isMysql || col.generated != null;

  // ---------- mutation helpers ----------

  /** Replace the column matching `id` with the result of `updater`. */
  function updateColumn(id: string, updater: (col: DesignerColumn) => DesignerColumn) {
    onChange(columns.map((c) => (c.id === id ? updater(c) : c)));
  }

  /** Remove a column by id. */
  function removeColumn(id: string) {
    onChange(columns.filter((c) => c.id !== id));
  }

  /** Append a blank column. */
  function addColumn() {
    onChange([...columns, blankColumn()]);
  }

  /** Move the column at `index` one slot toward the start. */
  function moveUp(index: number) {
    if (index <= 0) return;
    const next = [...columns];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  /** Move the column at `index` one slot toward the end. */
  function moveDown(index: number) {
    if (index >= columns.length - 1) return;
    const next = [...columns];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  }

  // ---------- per-field change handlers ----------

  function handleName(id: string, value: string) {
    updateColumn(id, (c) => ({ ...c, name: value }));
  }

  function handleType(id: string, value: string) {
    const entry = TYPE_CATALOG.find((t) => t.key === value);
    const numeric = isNumeric(value);
    const timestampy = isTimestampy(value);
    updateColumn(id, (c) => ({
      ...c,
      type: value,
      // Clear size fields when the new type doesn't use them
      length: entry?.hasLength ? c.length : null,
      precision: entry?.hasPrecisionScale ? c.precision : null,
      scale: entry?.hasPrecisionScale ? c.scale : null,
      // Disable auto-increment when type can't support it
      isAutoIncrement: isAutoIncrementable(value) ? c.isAutoIncrement : false,
      // Clear UNSIGNED/ZEROFILL when the new type is non-numeric
      unsigned: numeric ? c.unsigned : null,
      zerofill: numeric ? c.zerofill : null,
      // Clear ON UPDATE CURRENT_TIMESTAMP when the new type isn't a timestamp
      onUpdateCurrentTimestamp: timestampy ? c.onUpdateCurrentTimestamp : null,
    }));
  }

  function handleLength(id: string, raw: string) {
    const parsed = raw === "" ? null : parseInt(raw, 10);
    updateColumn(id, (c) => ({ ...c, length: isNaN(parsed as number) ? null : parsed }));
  }

  function handlePrecision(id: string, raw: string) {
    const parsed = raw === "" ? null : parseInt(raw, 10);
    updateColumn(id, (c) => ({ ...c, precision: isNaN(parsed as number) ? null : parsed }));
  }

  function handleScale(id: string, raw: string) {
    const parsed = raw === "" ? null : parseInt(raw, 10);
    updateColumn(id, (c) => ({ ...c, scale: isNaN(parsed as number) ? null : parsed }));
  }

  function handleNullable(id: string, checked: boolean) {
    updateColumn(id, (c) => ({ ...c, nullable: checked }));
  }

  function handleDefault(id: string, value: string) {
    updateColumn(id, (c) => ({ ...c, defaultValue: value === "" ? null : value }));
  }

  function handlePK(id: string, checked: boolean) {
    updateColumn(id, (c) => ({ ...c, isPrimaryKey: checked }));
  }

  function handleAI(id: string, checked: boolean) {
    updateColumn(id, (c) => ({ ...c, isAutoIncrement: checked }));
  }

  function handleComment(id: string, value: string) {
    updateColumn(id, (c) => ({ ...c, comment: value === "" ? null : value }));
  }

  // ---------- extended-attribute handlers ----------

  function handleUnsigned(id: string, checked: boolean) {
    // Clearing UNSIGNED also clears ZEROFILL (ZEROFILL implies UNSIGNED).
    updateColumn(id, (c) => ({
      ...c,
      unsigned: checked,
      zerofill: checked ? c.zerofill : false,
    }));
  }

  function handleOnUpdateTs(id: string, checked: boolean) {
    updateColumn(id, (c) => ({ ...c, onUpdateCurrentTimestamp: checked }));
  }

  function handleCharset(id: string, value: string) {
    updateColumn(id, (c) => ({ ...c, charset: value === "" ? null : value }));
  }

  function handleCollation(id: string, value: string) {
    updateColumn(id, (c) => ({ ...c, collation: value === "" ? null : value }));
  }

  function handleGeneratedExpression(id: string, value: string) {
    updateColumn(id, (c) => {
      if (value === "") {
        // Clearing the expression removes the generated definition entirely.
        return { ...c, generated: null };
      }
      const stored = c.generated?.stored ?? false;
      return {
        ...c,
        generated: { expression: value, stored },
        // A generated column can't carry DEFAULT or AUTO_INCREMENT.
        defaultValue: null,
        isAutoIncrement: false,
      };
    });
  }

  function handleGeneratedStored(id: string, stored: boolean) {
    updateColumn(id, (c) => {
      if (c.generated == null) return c;
      return { ...c, generated: { ...c.generated, stored } };
    });
  }

  // ---------- render ----------

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {/* Header */}
          <thead className="sticky top-0 bg-secondary/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("table.colName")}</th>
              <th className="px-3 py-2 font-medium">{t("table.colType")}</th>
              <th className="px-3 py-2 font-medium">{t("table.colLengthPrecision")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("table.colNull")}</th>
              <th className="px-3 py-2 font-medium">{t("table.colDefault")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("table.colPK")}</th>
              <th className="px-3 py-2 text-center font-medium">{t("table.colAI")}</th>
              <th className="px-3 py-2 font-medium">{t("table.colComment")}</th>
              <th className="px-2 py-2" aria-label="Row actions" />
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {columns.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  {t("table.noColumnsYet")}
                </td>
              </tr>
            ) : (
              columns.map((col, index) => {
                const typeEntry = TYPE_CATALOG.find((t) => t.key === col.type);
                const canAI = isAutoIncrementable(col.type);
                const isGenerated = col.generated != null;
                const numeric = isNumeric(col.type);
                const timestampy = isTimestampy(col.type);
                const isExpanded = expanded.has(col.id);
                const showAdvanced = advancedAvailable(col);

                return (
                  <Fragment key={col.id}>
                    <tr
                      className="border-b border-border/50 hover:bg-accent/40"
                    >
                      {/* Name */}
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={col.name}
                          onChange={(e) => handleName(col.id, e.target.value)}
                          placeholder={t("table.columnNamePlaceholder")}
                          aria-label="Column name"
                          className="w-32 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </td>

                      {/* Type */}
                      <td className="px-2 py-1">
                        <select
                          value={col.type}
                          onChange={(e) => handleType(col.id, e.target.value)}
                          aria-label="Column type"
                          className="w-44 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          {TYPE_CATALOG.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Length / Precision+Scale */}
                      <td className="px-2 py-1">
                        {typeEntry?.hasLength ? (
                          <input
                            type="number"
                            min={1}
                            value={col.length ?? ""}
                            onChange={(e) => handleLength(col.id, e.target.value)}
                            placeholder="255"
                            aria-label="Length"
                            title={t("table.lengthTitle")}
                            className="w-20 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        ) : typeEntry?.hasPrecisionScale ? (
                          <span className="flex items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              value={col.precision ?? ""}
                              onChange={(e) => handlePrecision(col.id, e.target.value)}
                              placeholder="P"
                              aria-label="Precision"
                              title={t("table.precisionTitle")}
                              className="w-14 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <span className="text-muted-foreground">,</span>
                            <input
                              type="number"
                              min={0}
                              value={col.scale ?? ""}
                              onChange={(e) => handleScale(col.id, e.target.value)}
                              placeholder="S"
                              aria-label="Scale"
                              title={t("table.scaleTitle")}
                              className="w-14 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </span>
                        ) : (
                          <span className="px-2 text-muted-foreground" aria-hidden>
                            —
                          </span>
                        )}
                      </td>

                      {/* Nullable */}
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={col.nullable}
                          onChange={(e) => handleNullable(col.id, e.target.checked)}
                          aria-label="Nullable"
                          title={t("table.allowNull")}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>

                      {/* Default */}
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={col.defaultValue ?? ""}
                          onChange={(e) => handleDefault(col.id, e.target.value)}
                          disabled={isGenerated}
                          placeholder={isGenerated ? "—" : "NULL"}
                          aria-label="Default value"
                          title={
                            isGenerated
                              ? t("table.generatedNoDefault")
                              : t("table.defaultValueTitle")
                          }
                          className="w-28 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </td>

                      {/* PK */}
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={col.isPrimaryKey}
                          onChange={(e) => handlePK(col.id, e.target.checked)}
                          aria-label="Primary key"
                          title={t("table.primaryKey")}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>

                      {/* AI */}
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={col.isAutoIncrement && canAI && !isGenerated}
                          disabled={!canAI || isGenerated}
                          onChange={(e) => handleAI(col.id, e.target.checked)}
                          aria-label="Auto-increment"
                          title={
                            isGenerated
                              ? t("table.generatedNoAutoIncrement")
                              : canAI
                                ? t("table.autoIncrement")
                                : t("table.autoIncrementIntegerOnly")
                          }
                          className="h-4 w-4 accent-primary disabled:opacity-40"
                        />
                      </td>

                      {/* Comment */}
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={col.comment ?? ""}
                          onChange={(e) => handleComment(col.id, e.target.value)}
                          disabled={commentsDisabled}
                          placeholder={commentsDisabled ? "—" : t("table.commentPlaceholder")}
                          aria-label="Column comment"
                          title={
                            commentsDisabled
                              ? t("table.sqliteNoComments")
                              : t("table.columnCommentTitle")
                          }
                          className="w-40 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </td>

                      {/* Row actions: reorder + advanced + delete */}
                      <td className="px-2 py-1">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => moveUp(index)}
                            disabled={index === 0}
                            aria-label={`Move column ${col.name || col.id} up`}
                            title={t("table.moveUp")}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveDown(index)}
                            disabled={index === columns.length - 1}
                            aria-label={`Move column ${col.name || col.id} down`}
                            title={t("table.moveDown")}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                          {showAdvanced && (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(col.id)}
                              aria-label={`Toggle advanced options for ${col.name || col.id}`}
                              aria-expanded={isExpanded}
                              title={t("table.advancedOptions")}
                              className={`rounded p-1 hover:bg-accent ${
                                isExpanded
                                  ? "text-primary"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              <Settings2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeColumn(col.id)}
                            aria-label={`Remove column ${col.name || col.id}`}
                            title={t("table.removeColumn")}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Advanced drawer row (charset/collation/unsigned/on-update +
                        generated expression). Generated is offered on all dialects;
                        the MySQL-only attrs are gated below. */}
                    {showAdvanced && isExpanded && (
                      <tr className="border-b border-border/50 bg-secondary/20">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="flex flex-col gap-3">
                            {/* MySQL-only per-column attributes */}
                            {isMysql && (
                              <div className="flex flex-wrap items-center gap-4">
                                <label
                                  className={`flex items-center gap-1.5 text-xs ${
                                    numeric ? "text-muted-foreground" : "cursor-not-allowed opacity-40"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!col.unsigned}
                                    disabled={!numeric}
                                    onChange={(e) => handleUnsigned(col.id, e.target.checked)}
                                    className="h-4 w-4 accent-primary"
                                  />
                                  {t("table.unsigned")}
                                </label>

                                <label
                                  className={`flex items-center gap-1.5 text-xs ${
                                    timestampy ? "text-muted-foreground" : "cursor-not-allowed opacity-40"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!col.onUpdateCurrentTimestamp}
                                    disabled={!timestampy}
                                    onChange={(e) => handleOnUpdateTs(col.id, e.target.checked)}
                                    className="h-4 w-4 accent-primary"
                                  />
                                  ON UPDATE CURRENT_TIMESTAMP
                                </label>

                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  {t("table.charset")}
                                  <input
                                    type="text"
                                    value={col.charset ?? ""}
                                    onChange={(e) => handleCharset(col.id, e.target.value)}
                                    placeholder="utf8mb4"
                                    aria-label="Column character set"
                                    className="w-28 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                    spellCheck={false}
                                  />
                                </label>

                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  {t("table.collation")}
                                  <input
                                    type="text"
                                    value={col.collation ?? ""}
                                    onChange={(e) => handleCollation(col.id, e.target.value)}
                                    placeholder="utf8mb4_unicode_ci"
                                    aria-label="Column collation"
                                    className="w-44 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                    spellCheck={false}
                                  />
                                </label>
                              </div>
                            )}

                            {/* Generated column expression (all dialects) */}
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                                {t("table.generatedAs")}
                                <input
                                  type="text"
                                  value={col.generated?.expression ?? ""}
                                  onChange={(e) =>
                                    handleGeneratedExpression(col.id, e.target.value)
                                  }
                                  placeholder={t("table.generatedExprPlaceholder")}
                                  aria-label="Generated expression"
                                  title={t("table.generatedExprTitle")}
                                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                  spellCheck={false}
                                />
                              </label>
                              <label
                                className={`flex items-center gap-1.5 text-xs ${
                                  isGenerated ? "text-muted-foreground" : "cursor-not-allowed opacity-40"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={col.generated?.stored ?? false}
                                  disabled={!isGenerated}
                                  onChange={(e) => handleGeneratedStored(col.id, e.target.checked)}
                                  className="h-4 w-4 accent-primary"
                                />
                                {t("table.stored")}
                              </label>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: add column */}
      <div className="border-t border-border/50 px-2 py-2">
        <button
          type="button"
          onClick={addColumn}
          className="rounded px-3 py-1.5 text-sm text-primary hover:bg-accent"
        >
          {t("table.addColumn")}
        </button>
      </div>
    </div>
  );
}
