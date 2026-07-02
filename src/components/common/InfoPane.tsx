import { useEffect, useState, type ReactNode } from "react";
import {
  Info,
  X,
  Columns3,
  KeyRound,
  ListTree,
  Link2,
  RefreshCw,
} from "lucide-react";
import type {
  ColumnDefinition,
  IndexInfo,
  ForeignKeyInfo,
} from "../../types";

export interface InfoPaneTarget {
  kind: "table" | "view" | "routine" | "trigger" | "other";
  sessionId: string;
  database: string;
  schema?: string | null;
  name: string;
}

export interface InfoPaneProps {
  target: InfoPaneTarget | null;
  getColumns: (
    s: string,
    db: string,
    t: string,
    schema?: string,
  ) => Promise<ColumnDefinition[]>;
  getIndexes: (
    s: string,
    db: string,
    t: string,
    schema?: string,
  ) => Promise<IndexInfo[]>;
  getForeignKeys: (
    s: string,
    db: string,
    t: string,
    schema?: string,
  ) => Promise<ForeignKeyInfo[]>;
  onClose: () => void;
}

const KIND_LABELS: Record<InfoPaneTarget["kind"], string> = {
  table: "Table",
  view: "View",
  routine: "Routine",
  trigger: "Trigger",
  other: "Object",
};

/** Object metadata that supports column/index/FK introspection. */
function isInspectable(kind: InfoPaneTarget["kind"]): boolean {
  return kind === "table" || kind === "view";
}

/**
 * A dockable right-side information pane. For a selected table or view it
 * fetches and lists columns (name/type/null/pk), indexes, and foreign keys in
 * compact sections. Other object kinds show a placeholder. Styled to match the
 * existing side panels (HistoryPanel / CellViewerPanel).
 */
export function InfoPane({
  target,
  getColumns,
  getIndexes,
  getForeignKeys,
  onClose,
}: InfoPaneProps) {
  const [columns, setColumns] = useState<ColumnDefinition[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const key = target
    ? `${target.sessionId}|${target.database}|${target.schema ?? ""}|${target.name}|${target.kind}`
    : null;

  useEffect(() => {
    if (!target || !isInspectable(target.kind)) {
      setColumns([]);
      setIndexes([]);
      setForeignKeys([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const { sessionId, database, name, schema } = target;
    const sch = schema ?? undefined;
    setLoading(true);
    setError(null);
    Promise.all([
      getColumns(sessionId, database, name, sch),
      getIndexes(sessionId, database, name, sch).catch(() => [] as IndexInfo[]),
      getForeignKeys(sessionId, database, name, sch).catch(
        () => [] as ForeignKeyInfo[],
      ),
    ])
      .then(([cols, idx, fks]) => {
        if (cancelled) return;
        setColumns(cols);
        setIndexes(idx);
        setForeignKeys(fks);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setColumns([]);
        setIndexes([]);
        setForeignKeys([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadKey]);

  return (
    <div className="h-full flex flex-col bg-background border-l border-border w-80">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Info className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" title={target?.name}>
              {target ? target.name : "Information"}
            </p>
            {target && (
              <p className="text-[10px] text-muted-foreground">
                {KIND_LABELS[target.kind]}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {target && isInspectable(target.kind) && (
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="p-1.5 hover:bg-secondary rounded transition-colors"
              title="Refresh"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-muted-foreground ${loading ? "animate-spin" : ""}`}
              />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-secondary rounded transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {!target ? (
          <div className="p-4 text-xs text-muted-foreground">
            Select an object to view its details.
          </div>
        ) : !isInspectable(target.kind) ? (
          <div className="p-4 text-xs text-muted-foreground">
            No detailed information available for this {KIND_LABELS[target.kind].toLowerCase()}.
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-destructive break-words">{error}</div>
        ) : loading ? (
          <div className="p-4 text-xs text-muted-foreground">Loading…</div>
        ) : (
          <div className="divide-y divide-border">
            {/* Columns */}
            <Section
              icon={<Columns3 className="w-3.5 h-3.5 text-muted-foreground" />}
              title="Columns"
              count={columns.length}
            >
              {columns.length === 0 ? (
                <Empty>No columns.</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {columns.map((c) => (
                    <li key={c.name} className="flex items-start gap-2">
                      {c.is_primary_key ? (
                        <KeyRound
                          className="w-3 h-3 flex-shrink-0 mt-0.5 text-amber-500"
                          aria-label="Primary key"
                        />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xs font-mono text-foreground truncate">
                            {c.name}
                          </span>
                          {!c.nullable && (
                            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/80">
                              not null
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-mono text-muted-foreground truncate">
                          {c.full_type || c.data_type}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Indexes */}
            <Section
              icon={<ListTree className="w-3.5 h-3.5 text-muted-foreground" />}
              title="Indexes"
              count={indexes.length}
            >
              {indexes.length === 0 ? (
                <Empty>No indexes.</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {indexes.map((ix) => (
                    <li key={ix.name} className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-mono text-foreground truncate">
                          {ix.name}
                        </span>
                        {ix.is_primary ? (
                          <span className="text-[9px] uppercase tracking-wide text-amber-500">
                            primary
                          </span>
                        ) : ix.is_unique ? (
                          <span className="text-[9px] uppercase tracking-wide text-muted-foreground/80">
                            unique
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">
                        ({ix.columns.join(", ")})
                        {ix.type ? ` · ${ix.type}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Foreign keys */}
            <Section
              icon={<Link2 className="w-3.5 h-3.5 text-muted-foreground" />}
              title="Foreign Keys"
              count={foreignKeys.length}
            >
              {foreignKeys.length === 0 ? (
                <Empty>No foreign keys.</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {foreignKeys.map((fk) => (
                    <li key={fk.name} className="min-w-0">
                      <p className="text-xs font-mono text-foreground truncate">
                        {fk.name}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground break-words">
                        ({fk.columns.join(", ")}) → {fk.referenced_table}(
                        {fk.referenced_columns.join(", ")})
                      </p>
                      {(fk.on_delete || fk.on_update) && (
                        <p className="text-[10px] text-muted-foreground/80">
                          {fk.on_delete ? `ON DELETE ${fk.on_delete}` : ""}
                          {fk.on_delete && fk.on_update ? " · " : ""}
                          {fk.on_update ? `ON UPDATE ${fk.on_update}` : ""}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

/** Collapsible-style labelled section with a count badge. */
function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-medium text-foreground">{title}</span>
        <span className="text-[10px] text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[10px] text-muted-foreground italic">{children}</p>;
}

export default InfoPane;
