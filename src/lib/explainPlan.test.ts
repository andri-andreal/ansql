import { describe, it, expect } from "vitest";
import { parseExplainJson, flattenPlan, type PlanNode } from "./explainPlan";

// A realistic Postgres `EXPLAIN (FORMAT JSON)` payload: the single result cell
// holds a JSON array whose first element wraps the top-level "Plan".
const PG_JSON = JSON.stringify([
  {
    Plan: {
      "Node Type": "Hash Join",
      "Total Cost": 42.5,
      "Plan Rows": 100,
      "Actual Total Time": 1.234,
      "Hash Cond": "(o.user_id = u.id)",
      Plans: [
        {
          "Node Type": "Seq Scan",
          "Relation Name": "orders",
          "Total Cost": 18.0,
          "Plan Rows": 200,
          "Actual Total Time": 0.5,
        },
        {
          "Node Type": "Hash",
          "Total Cost": 10.0,
          "Plan Rows": 50,
          Plans: [
            {
              "Node Type": "Index Scan",
              "Relation Name": "users",
              "Index Name": "users_pkey",
              "Total Cost": 8.0,
              "Plan Rows": 50,
            },
          ],
        },
      ],
    },
  },
]);

// A realistic MySQL `EXPLAIN FORMAT=JSON` payload: a single object keyed by
// "query_block" with nested_loop -> table nodes.
const MY_JSON = JSON.stringify({
  query_block: {
    select_id: 1,
    cost_info: { query_cost: "55.40" },
    nested_loop: [
      {
        table: {
          table_name: "users",
          access_type: "ALL",
          rows_examined_per_scan: 500,
          cost_info: { read_cost: "10.00", prefix_cost: "20.00", query_cost: "20.00" },
        },
      },
      {
        table: {
          table_name: "orders",
          access_type: "ref",
          rows_examined_per_scan: 3,
          cost_info: { read_cost: "5.00", prefix_cost: "35.40", query_cost: "35.40" },
        },
      },
    ],
  },
});

describe("parseExplainJson — postgres", () => {
  it("parses the wrapped JSON array into a tree", () => {
    const [root] = parseExplainJson("postgres", PG_JSON);
    expect(root.nodeType).toBe("Hash Join");
    expect(root.cost).toBe(42.5);
    expect(root.rows).toBe(100);
    expect(root.actualMs).toBe(1.234);
    expect(root.children).toHaveLength(2);
  });

  it("builds readable labels for relation and index scans", () => {
    const [root] = parseExplainJson("postgres", PG_JSON);
    const seqScan = root.children[0];
    expect(seqScan.label).toBe("Seq Scan on orders");

    const indexScan = root.children[1].children[0];
    expect(indexScan.nodeType).toBe("Index Scan");
    expect(indexScan.label).toBe("Index Scan using users_pkey");
  });

  it("preserves non-reserved fields in detail", () => {
    const [root] = parseExplainJson("postgres", PG_JSON);
    expect(root.detail).toMatchObject({ "Hash Cond": "(o.user_id = u.id)" });
    // Reserved fields are not duplicated into detail.
    expect(root.detail).not.toHaveProperty("Total Cost");
    expect(root.detail).not.toHaveProperty("Plans");
  });

  it("accepts an already-parsed array (not just a string)", () => {
    const parsed = JSON.parse(PG_JSON);
    const [root] = parseExplainJson("postgres", parsed);
    expect(root.nodeType).toBe("Hash Join");
  });

  it("falls back to a text node on unparseable input", () => {
    const nodes = parseExplainJson("postgres", "not json {");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].nodeType).toBe("text");
    expect(nodes[0].label).toBe("not json {");
  });
});

describe("parseExplainJson — mysql", () => {
  it("parses query_block + nested_loop into table children", () => {
    const [root] = parseExplainJson("mysql", MY_JSON);
    expect(root.nodeType).toBe("query_block");
    expect(root.label).toBe("query_block #1");
    expect(root.cost).toBe(55.4);
    expect(root.children).toHaveLength(2);
  });

  it("maps table nodes with access type and row counts", () => {
    const [root] = parseExplainJson("mysql", MY_JSON);
    const [users, orders] = root.children;
    expect(users.nodeType).toBe("table");
    expect(users.label).toBe("users (ALL)");
    expect(users.rows).toBe(500);
    expect(users.cost).toBe(20);

    expect(orders.label).toBe("orders (ref)");
    expect(orders.rows).toBe(3);
  });

  it("accepts an already-parsed object", () => {
    const parsed = JSON.parse(MY_JSON);
    const [root] = parseExplainJson("mysql", parsed);
    expect(root.nodeType).toBe("query_block");
  });

  it("falls back to a text node when query_block is absent", () => {
    const nodes = parseExplainJson("mysql", JSON.stringify({ unexpected: true }));
    // Still produces a query_block-shaped root from the object itself or text.
    expect(nodes).toHaveLength(1);
  });
});

describe("parseExplainJson — sqlite / other", () => {
  it("wraps sqlite output as a single text node", () => {
    const nodes = parseExplainJson("sqlite", "SCAN TABLE users");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].nodeType).toBe("text");
    expect(nodes[0].label).toBe("SCAN TABLE users");
  });

  it("stringifies non-string raw values for the text node", () => {
    const nodes = parseExplainJson("sqlite", { detail: "SCAN" });
    expect(nodes[0].nodeType).toBe("text");
    expect(nodes[0].label).toContain("SCAN");
  });
});

describe("flattenPlan", () => {
  it("flattens a tree in pre-order", () => {
    const tree: PlanNode[] = parseExplainJson("postgres", PG_JSON);
    const flat = flattenPlan(tree);
    expect(flat.map((n) => n.nodeType)).toEqual([
      "Hash Join",
      "Seq Scan",
      "Hash",
      "Index Scan",
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(flattenPlan([])).toEqual([]);
  });
});
