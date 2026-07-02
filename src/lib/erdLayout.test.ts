import { describe, it, expect } from "vitest";
import {
  layoutErd,
  type ErdLayoutNode,
  type ErdLayoutEdge,
} from "./erdLayout";

const node = (id: string, width = 200, height = 120): ErdLayoutNode => ({
  id,
  width,
  height,
});

describe("layoutErd", () => {
  it("returns an empty map for no nodes", () => {
    expect(layoutErd([], [])).toEqual({});
  });

  it("places every input id in the output", () => {
    const nodes = [node("users"), node("posts"), node("comments")];
    const edges: ErdLayoutEdge[] = [
      { source: "posts", target: "users" },
      { source: "comments", target: "posts" },
    ];
    const pos = layoutErd(nodes, edges);
    expect(Object.keys(pos).sort()).toEqual(["comments", "posts", "users"]);
    for (const p of Object.values(pos)) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("produces distinct positions for distinct nodes", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges: ErdLayoutEdge[] = [
      { source: "b", target: "a" },
      { source: "c", target: "a" },
    ];
    const pos = layoutErd(nodes, edges);
    const keys = Object.keys(pos);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const p = pos[keys[i]];
        const q = pos[keys[j]];
        expect(p.x !== q.x || p.y !== q.y).toBe(true);
      }
    }
  });

  it("separates nodes by at least node/rank gaps (non-overlapping-ish)", () => {
    const nodes = [node("a", 200, 100), node("b", 200, 100)];
    const edges: ErdLayoutEdge[] = [{ source: "a", target: "b" }];
    const pos = layoutErd(nodes, edges, {
      direction: "LR",
      rankSep: 150,
      nodeSep: 50,
    });
    // In LR layout, ranks flow along x; connected nodes sit in different ranks
    // and must not overlap horizontally.
    const dx = Math.abs(pos.a.x - pos.b.x);
    expect(dx).toBeGreaterThanOrEqual(200);
  });

  it("converts center coords to top-left (positions are >= 0)", () => {
    const nodes = [node("solo", 240, 140)];
    const pos = layoutErd(nodes, []);
    // A single node sits near the origin; top-left should be roughly 0, never
    // negative for a margin-free graph.
    expect(pos.solo.x).toBeGreaterThanOrEqual(0);
    expect(pos.solo.y).toBeGreaterThanOrEqual(0);
  });

  it("honors TB direction (ranks flow along y)", () => {
    const nodes = [node("parent", 200, 100), node("child", 200, 100)];
    const edges: ErdLayoutEdge[] = [{ source: "parent", target: "child" }];
    const pos = layoutErd(nodes, edges, { direction: "TB", rankSep: 120 });
    const dy = Math.abs(pos.parent.y - pos.child.y);
    expect(dy).toBeGreaterThanOrEqual(100);
  });

  it("ignores edges referencing unknown nodes", () => {
    const nodes = [node("known")];
    const edges: ErdLayoutEdge[] = [
      { source: "known", target: "missing" },
      { source: "missing", target: "known" },
    ];
    const pos = layoutErd(nodes, edges);
    expect(Object.keys(pos)).toEqual(["known"]);
  });
});
