import { memo } from "react";
import { Handle, Position, type NodeProps, type NodeTypes } from "@xyflow/react";
import { Key, Link2, Table2 } from "lucide-react";

export interface ErdColumn {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
  nullable: boolean;
}

export interface TableNodeData {
  table: string;
  schema?: string | null;
  columns: ErdColumn[];
  /** Optional accent color (CSS color string) tinting the node header. */
  color?: string | null;
  [key: string]: unknown;
}

const NODE_WIDTH = 240;
const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 22;
const BODY_PADDING = 8;

/** Stable size estimate used by layout so node positions match the rendered card. */
export function estimateNodeSize(columnCount: number): { width: number; height: number } {
  return {
    width: NODE_WIDTH,
    height: HEADER_HEIGHT + ROW_HEIGHT * Math.max(columnCount, 1) + BODY_PADDING,
  };
}

function TableNodeComponent({ data }: NodeProps) {
  const { table, schema, columns, color } = data as TableNodeData;
  const title = schema ? `${schema}.${table}` : table;

  return (
    <div
      className="bg-card border border-border rounded-md shadow-md overflow-hidden text-xs"
      style={{ width: NODE_WIDTH }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-primary !border-card"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-primary !border-card"
      />

      <div
        className="flex items-center gap-1.5 px-2.5 bg-secondary border-b border-border"
        style={
          color
            ? { height: HEADER_HEIGHT, backgroundColor: color }
            : { height: HEADER_HEIGHT }
        }
      >
        <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="font-bold text-foreground truncate" title={title}>
          {title}
        </span>
      </div>

      <div className="py-1">
        {columns.length === 0 ? (
          <div
            className="flex items-center px-2.5 text-muted-foreground/60 italic"
            style={{ height: ROW_HEIGHT }}
          >
            no columns
          </div>
        ) : (
          columns.map((col) => (
            <div
              key={col.name}
              className="flex items-center gap-1.5 px-2.5"
              style={{ height: ROW_HEIGHT }}
            >
              <span className="flex items-center gap-1 shrink-0">
                {col.pk && (
                  <Key className="w-3 h-3 text-amber-500" aria-label="Primary key" />
                )}
                {col.fk && (
                  <Link2 className="w-3 h-3 text-sky-500" aria-label="Foreign key" />
                )}
              </span>
              <span
                className={`truncate ${
                  col.pk ? "font-semibold text-foreground" : "text-foreground"
                }`}
                title={col.name}
              >
                {col.name}
              </span>
              <span
                className="ml-auto pl-2 text-[10px] font-mono text-muted-foreground/70 truncate shrink-0 max-w-[44%]"
                title={col.type}
              >
                {col.type}
                {col.nullable ? "?" : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const MemoTableNode = memo(TableNodeComponent);

export const ERD_NODE_TYPES: NodeTypes = {
  tableNode: MemoTableNode,
};
