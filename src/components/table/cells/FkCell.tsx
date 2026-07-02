import { useEffect, useRef, useState } from "react";
import {
  GridCellKind,
  getMiddleCenterBias,
  type CustomCell,
  type CustomRenderer,
  type ProvideEditorComponent,
} from "@glideapps/glide-data-grid";
import { fetchFkOptions, type FkOption, type FkTarget } from "../../../lib/fkLookup";
import { useTranslation } from "../../../i18n";

/**
 * A foreign-key dropdown cell. Editing opens a searchable, debounced dropdown of
 * the referenced table's rows (value + optional human-readable label). Selecting
 * writes the referenced key into `value`; a NULL option is offered for nullable
 * columns. Lookups are cached per FK target via fetchFkOptions.
 */
export interface FkCellProps {
  readonly kind: "fk-cell";
  /** Current cell value as text ("" for null). */
  readonly value: string;
  /** Whether the column is nullable (controls the NULL option). */
  readonly nullable: boolean;
  /** Lookup context. */
  readonly sessionId: string;
  readonly database: string;
  readonly schema: string | null;
  readonly target: FkTarget;
  readonly labelColumn: string | null;
}
export type FkCell = CustomCell<FkCellProps>;

const NULL_DISPLAY = "(Null)";

// --- Preload registry -------------------------------------------------------
// Glide's `draw` callback fires on every visible row, every redraw, so we can't
// just kick off a fetch from there without deduplication. We keep a module-level
// Set of (target, labelColumn) tuples we've already started preloading for; the
// underlying `fetchFkOptions` has its own cache so once a preload resolves,
// reopening the editor in the same session is a cache hit (instant).
const preloadedKeys = new Set<string>();

function preloadKey(
  target: FkTarget,
  database: string,
  schema: string | null,
  labelColumn: string | null
): string {
  return [database, schema ?? "", target.referencedTable, target.valueColumn, labelColumn ?? ""].join("\x00");
}

/**
 * Fire-and-forget preload of the first page of FK options. Safe to call from
 * `draw` (canvas) — it doesn't touch React state and the Set guard prevents
 * duplicate work.
 */
function preloadFk(args: FkCellProps): void {
  const key = preloadKey(args.target, args.database, args.schema, args.labelColumn);
  if (preloadedKeys.has(key)) return;
  preloadedKeys.add(key);
  fetchFkOptions({
    sessionId: args.sessionId,
    database: args.database,
    schema: args.schema,
    target: args.target,
    labelColumn: args.labelColumn,
    limit: 50,
  }).catch(() => {
    // On failure, drop the marker so a future edit can retry. A failed preload
    // shouldn't disable the cell — the editor's own fetch will retry.
    preloadedKeys.delete(key);
  });
}

const FkEditor: ProvideEditorComponent<FkCell> = (p) => {
  const { t } = useTranslation();
  const data = p.value.data;
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<FkOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch: no debounce — we want options visible the moment the editor
  // opens. Subsequent searches (user typing) get a short debounce so we don't
  // fire one query per keystroke.
  useEffect(() => {
    let cancelled = false;
    const fetchOpts = async () => {
      setLoading(true);
      setError(null);
      try {
        const opts = await fetchFkOptions({
          sessionId: data.sessionId,
          database: data.database,
          schema: data.schema,
          target: data.target,
          labelColumn: data.labelColumn,
          search: search || undefined,
          limit: 50,
        });
        if (!cancelled) setOptions(opts);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (search) {
      // User is typing — small debounce keeps the SQL load light.
      const handle = setTimeout(fetchOpts, 150);
      return () => {
        cancelled = true;
        clearTimeout(handle);
      };
    }
    // Initial mount: fetch immediately. (The preloader from `draw` has likely
    // already populated the cache, so this is a cache hit and resolves in
    // microseconds.)
    void fetchOpts();
    return () => {
      cancelled = true;
    };
  }, [search, data.sessionId, data.database, data.schema, data.target, data.labelColumn]);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const select = (value: string) => {
    p.onChange({ ...p.value, data: { ...data, value } });
    // Commit the overlay selection.
    p.onFinishedEditing({ ...p.value, data: { ...data, value } } as FkCell);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: 280, maxHeight: 320 }}>
      <input
        ref={inputRef}
        type="text"
        placeholder={t("table.searchTable", { table: data.target.referencedTable })}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: 8,
          fontSize: 13,
          boxSizing: "border-box",
          border: "none",
          borderBottom: "1px solid var(--border, #3a3a3a)",
          outline: "none",
          background: "transparent",
          color: "inherit",
        }}
      />
      <div style={{ overflowY: "auto", flex: 1 }}>
        {data.nullable && (
          <button
            type="button"
            onClick={() => select("")}
            style={optionStyle(data.value === "")}
          >
            <span style={{ fontStyle: "italic", opacity: 0.6 }}>{NULL_DISPLAY}</span>
          </button>
        )}
        {loading && options.length === 0 && (
          <div style={infoStyle}>
            <span style={{ display: "inline-block", width: 10, height: 10, marginRight: 6, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "fk-spin 0.8s linear infinite", verticalAlign: "middle" }} />
            {t("table.loading")}
          </div>
        )}
        {error && <div style={{ ...infoStyle, color: "#ef4444" }}>{error}</div>}
        {!loading && !error && options.length === 0 && (
          <div style={infoStyle}>{t("table.noMatches")}</div>
        )}
        {options.map((opt) => (
          <button
            type="button"
            key={opt.value}
            onClick={() => select(opt.value)}
            style={optionStyle(opt.value === data.value)}
            title={opt.label}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

const infoStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 12,
  opacity: 0.7,
  display: "flex",
  alignItems: "center",
};

function optionStyle(selected: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "6px 10px",
    fontSize: 13,
    border: "none",
    cursor: "pointer",
    background: selected ? "rgba(59,130,246,0.18)" : "transparent",
    color: "inherit",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

export const fkCellRenderer: CustomRenderer<FkCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is FkCell => (c.data as FkCellProps).kind === "fk-cell",
  draw: (args, cell) => {
    const { ctx, theme, rect } = args;
    // Kick off a preload on every draw (the Set guard deduplicates per target).
    // By the time the user actually opens the editor, the cache is warm and
    // the first render of options is instantaneous.
    preloadFk(cell.data);
    const text = cell.data.value === "" ? NULL_DISPLAY : cell.data.value;
    ctx.fillStyle = cell.data.value === "" ? theme.textLight : theme.textDark;
    ctx.fillText(
      text,
      rect.x + theme.cellHorizontalPadding,
      rect.y + rect.height / 2 + getMiddleCenterBias(ctx, theme)
    );
  },
  provideEditor: () => ({
    editor: FkEditor,
    disablePadding: true,
  }),
  onPaste: (v, d) => ({ ...d, value: v }),
};
