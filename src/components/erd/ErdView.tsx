/**
 * ErdView — interactive entity-relationship diagram canvas.
 *
 * Renders the tables of a database as draggable cards with foreign-key edges,
 * laid out automatically (dagre) by the useErd hook. Beyond pan/zoom/minimap and
 * double-click-to-open, it supports:
 *  - editable FKs: drag between tables to add a foreign key, delete an edge to
 *    drop one (ALTER via the injected executeQuery, then reload);
 *  - per-table accent colors, hand-arranged positions, and a layout reset — all
 *    persisted per diagram via useErdLayout;
 *  - PNG / SVG image export of the canvas;
 *  - reverse-from-DB table selection (which tables to diagram);
 *  - forward-engineer: export the rendered model as a runnable SQL script.
 *
 * No Tauri imports for introspection — those are injected via the
 * getTables / getColumns / getIndexes / getForeignKeys / executeQuery props.
 * The forward-engineer save dialog is the one place that touches Tauri plugins.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  Network,
  Image,
  FileCode2,
  LayoutGrid,
  ListChecks,
  Palette,
} from "lucide-react";

import "@xyflow/react/dist/style.css";

import { ERD_NODE_TYPES, type TableNodeData } from "./TableNode";
import { ErdFkDialog } from "./ErdFkDialog";
import { TableSelectionDialog } from "./TableSelectionDialog";
import { useErd, type UseErdArgs } from "../../hooks/useErd";
import { useErdLayout } from "../../hooks/useErdLayout";
import { exportElementPng, exportElementSvg } from "../../lib/erdExport";
import { buildModelScript } from "../../lib/erdScript";
import { buildForeignKeyStatements, type FkOp } from "../../lib/fkBuilder";
import type { Dialect, DesignerForeignKey, IndexInfo } from "../../types";
import { useDialogs } from "../ui";
import { useTranslation } from "../../i18n";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ErdViewProps {
  sessionId: string;
  database: string;
  schema?: string | null;
  dialect: Dialect;
  getTables: UseErdArgs["getTables"];
  getColumns: UseErdArgs["getColumns"];
  getForeignKeys: UseErdArgs["getForeignKeys"];
  /** Batched columns+FKs fetcher — lets the diagram skip the per-table N+1. */
  getSchemaGraph?: UseErdArgs["getSchemaGraph"];
  /** Fetch indexes for a table — used by the forward-engineer SQL export. */
  getIndexes: (
    sessionId: string,
    database: string,
    table: string,
    schema?: string,
  ) => Promise<IndexInfo[]>;
  /** Run an ALTER/DROP statement (FK add/drop). */
  executeQuery: (sql: string) => Promise<unknown>;
  /** Double-click a table node → ask the parent to open it. */
  onOpenTable?: (table: string, schema?: string | null) => void;
}

// Small palette offered by the per-node color menu.
const NODE_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

// ---------------------------------------------------------------------------
// Inner canvas (must live inside ReactFlowProvider to use flow hooks)
// ---------------------------------------------------------------------------

function ErdCanvas({
  sessionId,
  database,
  schema,
  dialect,
  getTables,
  getColumns,
  getForeignKeys,
  getSchemaGraph,
  getIndexes,
  executeQuery,
  onOpenTable,
}: ErdViewProps) {
  const { t } = useTranslation();
  const dialogs = useDialogs();
  const diagramKey = `${sessionId}:${database}`;
  const { state: layout, setPosition, setColor, clear } = useErdLayout(diagramKey);

  // Reverse-from-DB selection (undefined = all tables).
  const [includeTables, setIncludeTables] = useState<string[] | undefined>(undefined);

  const {
    nodes: erdNodes,
    edges: erdEdges,
    loading,
    error,
    reload,
  } = useErd({
    sessionId,
    database,
    schema,
    getTables,
    getColumns,
    getForeignKeys,
    getSchemaGraph,
    includeTables,
  });

  // Seed local interactive state from the hook so nodes stay draggable, then
  // resync whenever the hook produces a fresh layout (reload / arg change).
  // Persisted positions/colors override the dagre auto-layout when present.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(erdEdges);

  // Keep the freshest layout in a ref so callbacks don't need it as a dep.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const cur = layoutRef.current;
    setNodes(
      erdNodes.map((n) => {
        const saved = cur.positions[n.id];
        const color = cur.colors[n.id];
        return {
          ...n,
          position: saved ?? n.position,
          data: { ...n.data, color: color ?? null },
        };
      }),
    );
  }, [erdNodes, setNodes]);

  useEffect(() => {
    setEdges(erdEdges);
  }, [erdEdges, setEdges]);

  // Re-apply persisted colors onto the live nodes when the color map changes
  // (e.g. the user picks a swatch) without rebuilding from the hook.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const color = layout.colors[n.id] ?? null;
        if ((n.data.color ?? null) === color) return n;
        return { ...n, data: { ...n.data, color } };
      }),
    );
  }, [layout.colors, setNodes]);

  const handleNodeDoubleClick = useCallback(
    (_evt: React.MouseEvent, node: Node<TableNodeData>) => {
      onOpenTable?.(node.data.table, node.data.schema);
    },
    [onOpenTable],
  );

  // Persist a node's position when the user finishes dragging it.
  const handleNodeDragStop = useCallback(
    (_evt: MouseEvent | TouchEvent, node: Node<TableNodeData>) => {
      setPosition(node.id, { x: node.position.x, y: node.position.y });
    },
    [setPosition],
  );

  // -------------------------------------------------------------------------
  // Foreign-key editing (drag to add, delete edge to drop)
  // -------------------------------------------------------------------------

  const [fkDialog, setFkDialog] = useState<{
    sourceTable: string;
    targetTable: string;
    sourceSchema?: string | null;
    targetSchema?: string | null;
    sourceColumns: { name: string }[];
    targetColumns: { name: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  const nodeById = useCallback(
    (id: string) => nodes.find((n) => n.id === id),
    [nodes],
  );

  // Drag from a source table to a target table → open the FK dialog seeded with
  // both tables' columns. xyflow source/target follow the Right(source)/Left(target)
  // handles: the source table owns the FK, the target is referenced.
  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      const src = nodeById(conn.source);
      const tgt = nodeById(conn.target);
      if (!src || !tgt) return;
      setFkDialog({
        sourceTable: src.data.table,
        targetTable: tgt.data.table,
        sourceSchema: src.data.schema,
        targetSchema: tgt.data.schema,
        sourceColumns: src.data.columns.map((c) => ({ name: c.name })),
        targetColumns: tgt.data.columns.map((c) => ({ name: c.name })),
      });
    },
    [nodeById],
  );

  const handleFkConfirm = useCallback(
    async (choice: {
      name: string;
      localColumn: string;
      refColumn: string;
      onDelete?: string;
      onUpdate?: string;
    }) => {
      const d = fkDialog;
      if (!d) return;
      setFkDialog(null);
      setOpError(null);
      const fk: DesignerForeignKey = {
        id: choice.name,
        name: choice.name,
        columns: [choice.localColumn],
        referencedTable: d.targetTable,
        referencedSchema: d.targetSchema ?? null,
        referencedColumns: [choice.refColumn],
        onDelete: choice.onDelete,
        onUpdate: choice.onUpdate,
      };
      const ops: FkOp[] = [{ kind: "addFk", fk }];
      const stmts = buildForeignKeyStatements(
        dialect,
        d.sourceSchema ?? null,
        d.sourceTable,
        ops,
      );
      if (stmts.length === 0) {
        setOpError(
          dialect === "sqlite"
            ? t("io.sqliteCannotAddFk")
            : t("io.noStatementsForFk"),
        );
        return;
      }
      setBusy(true);
      try {
        for (const s of stmts) await executeQuery(s.sql);
        reload();
      } catch (err) {
        setOpError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [fkDialog, dialect, executeQuery, reload, t],
  );

  // Delete an edge → confirm → DROP the underlying foreign key.
  const handleEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      if (deleted.length === 0) return;
      const names = deleted.map((e) => String(e.label ?? "")).filter(Boolean);
      const namesSuffix = names.length ? ` (${names.join(", ")})` : "";
      const ok = await dialogs.confirm({
        title:
          deleted.length === 1
            ? t("io.dropFkConfirmOne", { names: namesSuffix })
            : t("io.dropFkConfirmMany", {
                count: deleted.length,
                names: namesSuffix,
              }),
        danger: true,
      });
      if (!ok) {
        // Re-add the edges the user cancelled out of.
        setEdges((prev) => [...prev, ...deleted]);
        return;
      }
      setOpError(null);
      setBusy(true);
      try {
        for (const e of deleted) {
          const src = nodeById(e.source);
          const fkName = String(e.label ?? "");
          if (!fkName) continue;
          const ops: FkOp[] = [{ kind: "dropFk", name: fkName }];
          const stmts = buildForeignKeyStatements(
            dialect,
            (src?.data.schema ?? null) as string | null,
            src?.data.table ?? e.source,
            ops,
          );
          for (const s of stmts) await executeQuery(s.sql);
        }
        reload();
      } catch (err) {
        setOpError(err instanceof Error ? err.message : String(err));
        reload();
      } finally {
        setBusy(false);
      }
    },
    [nodeById, dialect, executeQuery, reload, setEdges, t, dialogs],
  );

  // -------------------------------------------------------------------------
  // Per-table color menu
  // -------------------------------------------------------------------------

  const [colorMenu, setColorMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  const handleNodeContextMenu = useCallback(
    (evt: React.MouseEvent, node: Node<TableNodeData>) => {
      evt.preventDefault();
      setColorMenu({ id: node.id, x: evt.clientX, y: evt.clientY });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Export (PNG / SVG)
  // -------------------------------------------------------------------------

  const flowWrapperRef = useRef<HTMLDivElement>(null);

  const flowEl = useCallback(
    () => flowWrapperRef.current?.querySelector<HTMLElement>(".react-flow") ?? null,
    [],
  );

  const handleExportPng = useCallback(async () => {
    const el = flowEl();
    if (el) await exportElementPng(el, `${database}-erd.png`);
  }, [flowEl, database]);

  const handleExportSvg = useCallback(async () => {
    const el = flowEl();
    if (el) await exportElementSvg(el, `${database}-erd.svg`);
  }, [flowEl, database]);

  // -------------------------------------------------------------------------
  // Reverse-from-DB table selection
  // -------------------------------------------------------------------------

  const [selectDialog, setSelectDialog] = useState<{
    tables: { name: string }[];
    selected: string[];
  } | null>(null);

  const openTableSelection = useCallback(async () => {
    setOpError(null);
    try {
      const all = await getTables(sessionId, database, schema ?? undefined);
      const base = all.filter((t) => t.table_type !== "view").map((t) => ({ name: t.name }));
      const current = includeTables ?? base.map((t) => t.name);
      setSelectDialog({ tables: base, selected: current });
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    }
  }, [getTables, sessionId, database, schema, includeTables]);

  // -------------------------------------------------------------------------
  // Forward-engineer (Export SQL)
  // -------------------------------------------------------------------------

  const handleExportSql = useCallback(async () => {
    setOpError(null);
    setBusy(true);
    try {
      // Build a dump input per rendered table from live introspection. Fast
      // path: one batched call for columns+indexes+FKs (avoids a per-table N+1
      // export); falls back to the per-table fan-out when unavailable/empty.
      const schemaArg = (schema ?? undefined) as string | undefined;
      const graph = getSchemaGraph
        ? await getSchemaGraph(
            sessionId,
            database,
            nodes.map((n) => n.data.table),
            schemaArg,
          )
        : [];

      let inputs;
      if (graph.length > 0) {
        const byName = new Map(graph.map((g) => [g.name, g]));
        inputs = nodes.map((n) => {
          const g = byName.get(n.data.table);
          return {
            schema: n.data.schema ?? null,
            table: n.data.table,
            columns: g?.columns ?? [],
            indexes: g?.indexes ?? [],
            foreignKeys: g?.foreign_keys ?? [],
          };
        });
      } else {
        inputs = await Promise.all(
          nodes.map(async (n) => {
            const tableSchema = (n.data.schema ?? schema ?? undefined) as string | undefined;
            const [columns, indexes, foreignKeys] = await Promise.all([
              getColumns(sessionId, database, n.data.table, tableSchema),
              getIndexes(sessionId, database, n.data.table, tableSchema),
              getForeignKeys(sessionId, database, n.data.table, tableSchema),
            ]);
            return {
              schema: n.data.schema ?? null,
              table: n.data.table,
              columns,
              indexes,
              foreignKeys,
            };
          }),
        );
      }

      const script = buildModelScript(dialect, inputs);
      const filePath = await save({
        title: "Export model SQL",
        defaultPath: `${database}-model.sql`,
        filters: [{ name: "SQL Files", extensions: ["sql"] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, script);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [nodes, schema, getColumns, getIndexes, getForeignKeys, getSchemaGraph, sessionId, database, dialect]);

  const handleResetLayout = useCallback(() => {
    clear();
    reload();
  }, [clear, reload]);

  const isEmpty = !loading && !error && nodes.length === 0;
  const fkUnsupported = dialect === "sqlite";

  const toolbarBtn =
    "pointer-events-auto flex items-center gap-1.5 rounded-lg border border-border bg-card/90 px-2.5 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="relative h-full w-full bg-background" ref={flowWrapperRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={fkUnsupported ? undefined : handleConnect}
        onEdgesDelete={fkUnsupported ? undefined : handleEdgesDelete}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={ERD_NODE_TYPES}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        fitView
        minZoom={0.1}
        panOnScroll
        nodesConnectable={!fkUnsupported}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} className="bg-background" />
        <MiniMap pannable zoomable className="!bg-card" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* Overlay toolbar — Reload + actions + counts. */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={reload}
          disabled={loading || busy}
          className={toolbarBtn}
          title={t("io.reloadDiagram")}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("io.reload")}
        </button>
        <button
          type="button"
          onClick={openTableSelection}
          disabled={loading || busy}
          className={toolbarBtn}
          title={t("io.chooseTablesToDiagram")}
        >
          <ListChecks className="h-4 w-4" />
          {t("io.selectTables")}
        </button>
        <button
          type="button"
          onClick={handleResetLayout}
          disabled={loading || busy}
          className={toolbarBtn}
          title={t("io.resetPositionsColors")}
        >
          <LayoutGrid className="h-4 w-4" />
          {t("io.resetLayout")}
        </button>
        <button
          type="button"
          onClick={handleExportPng}
          disabled={loading || busy || nodes.length === 0}
          className={toolbarBtn}
          title={t("io.exportAsPng")}
        >
          <Image className="h-4 w-4" />
          PNG
        </button>
        <button
          type="button"
          onClick={handleExportSvg}
          disabled={loading || busy || nodes.length === 0}
          className={toolbarBtn}
          title={t("io.exportAsSvg")}
        >
          <Image className="h-4 w-4" />
          SVG
        </button>
        <button
          type="button"
          onClick={handleExportSql}
          disabled={loading || busy || nodes.length === 0}
          className={toolbarBtn}
          title={t("io.forwardEngineerToSql")}
        >
          <FileCode2 className="h-4 w-4" />
          {t("io.exportSql")}
        </button>
        <span className="pointer-events-auto rounded-lg border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          {t("io.tablesRelationsCount", {
            tables: nodes.length,
            tableWord: nodes.length === 1 ? t("io.tableWord") : t("io.tablesWord"),
            relations: edges.length,
            relationWord:
              edges.length === 1 ? t("io.relationWord") : t("io.relationsWord"),
          })}
        </span>
      </div>

      {/* Op error toast (FK add/drop, export). */}
      {opError && (
        <div className="pointer-events-auto absolute right-3 top-3 z-30 flex max-w-sm items-start gap-2 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-xs text-foreground shadow-md">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span className="flex-1">{opError}</span>
          <button
            type="button"
            onClick={() => setOpError(null)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("io.dismiss")}
          >
            ×
          </button>
        </div>
      )}

      {/* Per-node color menu (right-click). */}
      {colorMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setColorMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setColorMenu(null);
            }}
          />
          <div
            className="fixed z-50 flex flex-col gap-2 rounded-lg border border-border bg-card p-2 shadow-xl"
            style={{ left: colorMenu.x, top: colorMenu.y }}
          >
            <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
              <Palette className="h-3.5 w-3.5" />
              {t("io.nodeColor")}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {NODE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setColor(colorMenu.id, c);
                    setColorMenu(null);
                  }}
                  className="h-6 w-6 rounded border border-border transition-transform hover:scale-110"
                  style={{ backgroundColor: c }}
                  aria-label={t("io.setColor", { color: c })}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setColor(colorMenu.id, "");
                setColorMenu(null);
              }}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
            >
              {t("io.clearColor")}
            </button>
          </div>
        </>
      )}

      {/* FK creation dialog. */}
      {fkDialog && (
        <ErdFkDialog
          sourceTable={fkDialog.sourceTable}
          targetTable={fkDialog.targetTable}
          sourceColumns={fkDialog.sourceColumns}
          targetColumns={fkDialog.targetColumns}
          onConfirm={handleFkConfirm}
          onCancel={() => setFkDialog(null)}
        />
      )}

      {/* Table selection dialog. */}
      {selectDialog && (
        <TableSelectionDialog
          tables={selectDialog.tables}
          selected={selectDialog.selected}
          onConfirm={(chosen) => {
            setSelectDialog(null);
            // All selected → undefined (render everything); else the allow-list.
            setIncludeTables(
              chosen.length === selectDialog.tables.length ? undefined : chosen,
            );
          }}
          onCancel={() => setSelectDialog(null)}
        />
      )}

      {/* Busy overlay for FK ops / export. */}
      {busy && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card/90 px-4 py-2.5 text-sm text-muted-foreground shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("io.working")}
          </div>
        </div>
      )}

      {/* Loading overlay. */}
      {loading && nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card/90 px-4 py-2.5 text-sm text-muted-foreground shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("io.buildingDiagram")}
          </div>
        </div>
      )}

      {/* Error overlay. */}
      {error && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="pointer-events-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-card px-6 py-5 text-center shadow-sm">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <div className="text-sm font-medium text-foreground">{t("io.failedToLoadDiagram")}</div>
            <div className="text-xs text-muted-foreground">{error}</div>
            <button
              type="button"
              onClick={reload}
              className="mt-1 flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              {t("io.retry")}
            </button>
          </div>
        </div>
      )}

      {/* Empty state. */}
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
            <Network className="h-8 w-8 opacity-60" />
            <div className="text-sm font-medium text-foreground">{t("io.noTablesToDiagram")}</div>
            <div className="text-xs">{t("io.noBaseTables")}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component — wraps the canvas in a ReactFlowProvider.
// ---------------------------------------------------------------------------

export function ErdView(props: ErdViewProps) {
  return (
    <ReactFlowProvider>
      <ErdCanvas {...props} />
    </ReactFlowProvider>
  );
}
