// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import { renderWithProviders, screen } from "@/test/render";
import { ERD_NODE_TYPES, estimateNodeSize, type TableNodeData, type ErdColumn } from "./TableNode";

const TableNode = ERD_NODE_TYPES.tableNode as React.ComponentType<{
  id: string;
  data: TableNodeData;
}>;

function col(over: Partial<ErdColumn> = {}): ErdColumn {
  return { name: "id", type: "int", pk: false, fk: false, nullable: false, ...over };
}

function renderNode(data: Partial<TableNodeData> = {}) {
  const full: TableNodeData = {
    table: "users",
    schema: null,
    columns: [],
    color: null,
    ...data,
  };
  return renderWithProviders(
    <ReactFlowProvider>
      <TableNode id="users" data={full} />
    </ReactFlowProvider>,
  );
}

describe("TableNode", () => {
  it("renders the bare table name when no schema is given", () => {
    renderNode({ table: "users", schema: null });
    expect(screen.getByText("users")).toBeInTheDocument();
  });

  it("qualifies the title with the schema when present", () => {
    renderNode({ table: "orders", schema: "public" });
    expect(screen.getByText("public.orders")).toBeInTheDocument();
  });

  it("lists each column name and its type", () => {
    renderNode({
      columns: [col({ name: "id", type: "int" }), col({ name: "email", type: "varchar" })],
    });
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("int")).toBeInTheDocument();
    expect(screen.getByText("varchar")).toBeInTheDocument();
  });

  it("marks primary-key columns with a key marker and foreign-key columns with a link marker", () => {
    renderNode({
      columns: [
        col({ name: "id", pk: true }),
        col({ name: "owner_id", fk: true }),
      ],
    });
    expect(screen.getByLabelText("Primary key")).toBeInTheDocument();
    expect(screen.getByLabelText("Foreign key")).toBeInTheDocument();
  });

  it("appends a nullable marker to nullable column types only", () => {
    renderNode({
      columns: [
        col({ name: "id", type: "int", nullable: false }),
        col({ name: "bio", type: "text", nullable: true }),
      ],
    });
    expect(screen.getByText("int")).toBeInTheDocument();
    expect(screen.getByText("text?")).toBeInTheDocument();
  });

  it("shows an empty-columns hint when there are no columns", () => {
    renderNode({ columns: [] });
    expect(screen.getByText("no columns")).toBeInTheDocument();
  });

  it("estimateNodeSize grows with column count and clamps at one row minimum", () => {
    const zero = estimateNodeSize(0);
    const one = estimateNodeSize(1);
    const five = estimateNodeSize(5);
    expect(zero.height).toBe(one.height); // clamped to >= 1 row
    expect(five.height).toBeGreaterThan(one.height);
    expect(one.width).toBe(five.width); // width is fixed
  });
});
