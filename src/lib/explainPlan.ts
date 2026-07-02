/**
 * Pure EXPLAIN-plan parser.
 *
 * Turns the raw output of an `EXPLAIN`-style statement into a normalized tree of
 * {@link PlanNode}s that the Explain visualizer can render. No React, no Tauri
 * calls — just data in, data out.
 *
 * Supported shapes:
 * - postgres: `EXPLAIN (FORMAT JSON)` produces a single row whose only column
 *   holds a JSON array `[{ "Plan": { ...nested "Plans": [] ... } }]`. We accept
 *   either that raw JSON text/array or the already-unwrapped `Plan` object.
 * - mysql: `EXPLAIN FORMAT=JSON` produces a JSON object
 *   `{ "query_block": { ...nested table/nested_loop nodes... } }`. We accept the
 *   raw JSON text or the parsed object.
 * - sqlite / anything else / unparseable: we wrap the raw value as a single
 *   text node so the caller always gets a usable tree.
 *
 * Every branch is defensive: any parse/shape error falls back to a text node.
 */

import type { Dialect } from "../types";

/** One node in a normalized EXPLAIN plan tree. */
export interface PlanNode {
  /** Machine-ish node kind, e.g. `Seq Scan`, `nested_loop`, `text`. */
  nodeType: string;
  /** Human-readable one-line label for the node. */
  label: string;
  /** Estimated total cost (Postgres `Total Cost`, MySQL `cost_info`), if known. */
  cost?: number | null;
  /** Estimated/affected row count, if known. */
  rows?: number | null;
  /** Actual execution time in ms (Postgres ANALYZE `Actual Total Time`), if known. */
  actualMs?: number | null;
  /** Remaining raw fields, preserved for the detail panel. */
  detail?: Record<string, unknown>;
  /** Child nodes (sub-plans), in source order. */
  children: PlanNode[];
}

/** Coerce an unknown value to a finite number, else `null`. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wrap an arbitrary raw value as a single text {@link PlanNode}. */
function textNode(raw: unknown): PlanNode {
  let label: string;
  if (typeof raw === "string") {
    label = raw;
  } else {
    try {
      label = JSON.stringify(raw);
    } catch {
      label = String(raw);
    }
  }
  return { nodeType: "text", label, children: [] };
}

/**
 * Parse the raw `raw` of an `EXPLAIN` into normalized {@link PlanNode}s.
 *
 * `dialect` selects the shape parser. Anything that doesn't match (sqlite, an
 * unexpected shape, or a JSON parse failure) yields a single text node so the
 * return value is never empty.
 */
export function parseExplainJson(dialect: Dialect, raw: unknown): PlanNode[] {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (dialect === "postgres") {
      const nodes = parsePostgres(value);
      return nodes.length > 0 ? nodes : [textNode(raw)];
    }

    if (dialect === "mysql") {
      const nodes = parseMysql(value);
      return nodes.length > 0 ? nodes : [textNode(raw)];
    }

    // sqlite and everything else: no JSON plan, wrap as text.
    return [textNode(raw)];
  } catch {
    return [textNode(raw)];
  }
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

/**
 * Postgres `EXPLAIN (FORMAT JSON)`.
 *
 * The unwrapped value is an array `[{ "Plan": {...} }]`. We tolerate:
 * - the array form,
 * - a single `{ "Plan": {...} }` object,
 * - a bare plan object (already-unwrapped `Plan`).
 */
function parsePostgres(value: unknown): PlanNode[] {
  const roots = Array.isArray(value) ? value : [value];
  const nodes: PlanNode[] = [];

  for (const root of roots) {
    if (!isRecord(root)) continue;
    const plan = isRecord(root.Plan) ? root.Plan : root;
    if (isRecord(plan) && ("Node Type" in plan || "Plans" in plan)) {
      nodes.push(pgNode(plan));
    }
  }

  return nodes;
}

/** Reserved Postgres plan keys that map to dedicated {@link PlanNode} fields. */
const PG_RESERVED = new Set(["Node Type", "Total Cost", "Plan Rows", "Actual Total Time", "Plans"]);

/** Convert one Postgres plan object into a {@link PlanNode}. */
function pgNode(plan: Record<string, unknown>): PlanNode {
  const nodeType = typeof plan["Node Type"] === "string" ? (plan["Node Type"] as string) : "Plan";

  const childPlans = Array.isArray(plan.Plans) ? plan.Plans : [];
  const children: PlanNode[] = [];
  for (const child of childPlans) {
    if (isRecord(child)) children.push(pgNode(child));
  }

  const detail: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(plan)) {
    if (!PG_RESERVED.has(key)) detail[key] = val;
  }

  return {
    nodeType,
    label: pgLabel(nodeType, plan),
    cost: toNumber(plan["Total Cost"]),
    rows: toNumber(plan["Plan Rows"]),
    actualMs: toNumber(plan["Actual Total Time"]),
    detail: Object.keys(detail).length > 0 ? detail : undefined,
    children,
  };
}

/** Build a readable label like `Seq Scan on users` for a Postgres node. */
function pgLabel(nodeType: string, plan: Record<string, unknown>): string {
  const rel = typeof plan["Relation Name"] === "string" ? (plan["Relation Name"] as string) : null;
  const index = typeof plan["Index Name"] === "string" ? (plan["Index Name"] as string) : null;
  if (index) return `${nodeType} using ${index}`;
  if (rel) return `${nodeType} on ${rel}`;
  return nodeType;
}

// ---------------------------------------------------------------------------
// MySQL
// ---------------------------------------------------------------------------

/**
 * MySQL `EXPLAIN FORMAT=JSON`.
 *
 * The unwrapped value is `{ "query_block": {...} }`. We walk the query block,
 * descending through `nested_loop`, `table`, `ordering_operation`,
 * `grouping_operation`, etc. The mapping is best-effort: MySQL's shape is
 * irregular, so we recurse over known container keys and surface `table` nodes.
 */
function parseMysql(value: unknown): PlanNode[] {
  if (!isRecord(value)) return [];
  const block = isRecord(value.query_block) ? value.query_block : value;
  if (!isRecord(block)) return [];
  return [myBlockNode(block)];
}

/** MySQL keys that contain nested plan structure rather than scalar detail. */
const MY_CONTAINER_KEYS = [
  "nested_loop",
  "ordering_operation",
  "grouping_operation",
  "duplicates_removal",
  "table",
  "query_block",
  "materialized_from_subquery",
  "union_result",
];

/** Convert a MySQL `query_block` (or nested operation) into a {@link PlanNode}. */
function myBlockNode(block: Record<string, unknown>): PlanNode {
  const selectId = block.select_id;
  const label = selectId != null ? `query_block #${String(selectId)}` : "query_block";
  return {
    nodeType: "query_block",
    label,
    cost: myReadCost(block),
    rows: null,
    actualMs: null,
    detail: myScalarDetail(block),
    children: myChildren(block),
  };
}

/** Convert a MySQL `table` node into a {@link PlanNode}. */
function myTableNode(table: Record<string, unknown>): PlanNode {
  const name = typeof table.table_name === "string" ? (table.table_name as string) : "table";
  const access = typeof table.access_type === "string" ? (table.access_type as string) : null;
  return {
    nodeType: "table",
    label: access ? `${name} (${access})` : name,
    cost: myReadCost(table),
    rows: toNumber(table.rows_examined_per_scan ?? table.rows_produced_per_join ?? table.rows),
    actualMs: null,
    detail: myScalarDetail(table),
    children: myChildren(table),
  };
}

/** Pull `cost_info.query_cost` / `read_cost` / `prefix_cost` out of a node. */
function myReadCost(node: Record<string, unknown>): number | null {
  const ci = node.cost_info;
  if (!isRecord(ci)) return null;
  return toNumber(ci.query_cost ?? ci.prefix_cost ?? ci.read_cost);
}

/** Recurse into a MySQL node's container keys, producing child {@link PlanNode}s. */
function myChildren(node: Record<string, unknown>): PlanNode[] {
  const children: PlanNode[] = [];

  for (const key of MY_CONTAINER_KEYS) {
    const child = node[key];
    if (child === undefined) continue;

    const items = Array.isArray(child) ? child : [child];
    for (const item of items) {
      if (!isRecord(item)) continue;
      if (key === "table") {
        children.push(myTableNode(item));
      } else if (key === "query_block" || key === "materialized_from_subquery") {
        children.push(myBlockNode(item));
      } else {
        // Generic container (nested_loop, ordering_operation, ...): descend,
        // but if it itself has no recognized children, surface it as a node.
        const grand = myChildren(item);
        if (grand.length > 0) {
          children.push(...grand);
        } else {
          children.push({
            nodeType: key,
            label: key,
            cost: myReadCost(item),
            rows: null,
            actualMs: null,
            detail: myScalarDetail(item),
            children: [],
          });
        }
      }
    }
  }

  return children;
}

/** Collect a MySQL node's scalar (non-container) fields for the detail panel. */
function myScalarDetail(node: Record<string, unknown>): Record<string, unknown> | undefined {
  const detail: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(node)) {
    if (MY_CONTAINER_KEYS.includes(key)) continue;
    detail[key] = val;
  }
  return Object.keys(detail).length > 0 ? detail : undefined;
}

// ---------------------------------------------------------------------------
// Flatten
// ---------------------------------------------------------------------------

/**
 * Pre-order flatten of a plan tree into a flat list (root, then children
 * depth-first). Used for whole-tree passes such as max-cost coloring.
 */
export function flattenPlan(nodes: PlanNode[]): PlanNode[] {
  const out: PlanNode[] = [];
  const visit = (node: PlanNode): void => {
    out.push(node);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return out;
}
