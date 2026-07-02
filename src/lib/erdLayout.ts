import dagre from "@dagrejs/dagre";

export interface ErdLayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface ErdLayoutEdge {
  source: string;
  target: string;
}

export interface ErdLayoutOptions {
  direction?: "LR" | "TB";
  nodeSep?: number;
  rankSep?: number;
}

/**
 * Lays out ERD nodes using dagre. Returns a map of node id -> TOP-LEFT
 * position (dagre computes center coords, so we subtract half width/height).
 * Default direction is "LR".
 */
export function layoutErd(
  nodes: ErdLayoutNode[],
  edges: ErdLayoutEdge[],
  opts: ErdLayoutOptions = {}
): Record<string, { x: number; y: number }> {
  const { direction = "LR", nodeSep = 60, rankSep = 120 } = opts;

  const positions: Record<string, { x: number; y: number }> = {};
  if (nodes.length === 0) return positions;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: nodeSep, ranksep: rankSep });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }

  for (const edge of edges) {
    // Only connect edges between nodes we actually placed.
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  for (const node of nodes) {
    const laid = g.node(node.id);
    if (!laid) continue;
    const x = (laid.x ?? 0) - node.width / 2;
    const y = (laid.y ?? 0) - node.height / 2;
    positions[node.id] = { x, y };
  }

  return positions;
}
