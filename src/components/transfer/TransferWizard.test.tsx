// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import { installFakeBackend } from "../../test/fakeBackend";
import { makeConnection, makeTable } from "../../test/fixtures";
import type { Connection, SessionInfo } from "../../types";
import {
  TransferWizard,
  buildSourceQuery,
  loadProfiles,
  saveProfiles,
  type TableSel,
  type TransferProfile,
} from "./TransferWizard";

// ── pure helpers ──────────────────────────────────────────────────────────

function makeTableSel(over: Partial<TableSel> = {}): TableSel {
  return {
    source_table: "users",
    target_table: "users",
    target_schema: null,
    conflict: "drop",
    selected: true,
    mapping: [],
    columns: [],
    where: "",
    ...over,
  };
}

describe("buildSourceQuery", () => {
  it("returns null for an untouched table (no WHERE, identity/empty mapping)", () => {
    expect(buildSourceQuery("mysql", null, makeTableSel())).toBeNull();
  });

  it("emits a WHERE clause when a filter is set", () => {
    const sql = buildSourceQuery("mysql", null, makeTableSel({ where: "id > 5" }));
    expect(sql).toBe("SELECT * FROM `users` WHERE id > 5");
  });

  it("aliases renamed columns and drops empty-target columns", () => {
    const sql = buildSourceQuery(
      "mysql",
      null,
      makeTableSel({
        mapping: [
          { source: "id", target: "id" },
          { source: "email", target: "mail" },
          { source: "secret", target: "" },
        ],
      }),
    );
    expect(sql).toBe("SELECT `id`, `email` AS `mail` FROM `users`");
  });

  it("qualifies the source table with the schema when provided (postgres)", () => {
    const sql = buildSourceQuery("postgres", "public", makeTableSel({ where: "a=1" }));
    expect(sql).toBe('SELECT * FROM "public"."users" WHERE a=1');
  });
});

describe("transfer profiles persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips profiles through localStorage", () => {
    const profiles: TransferProfile[] = [
      { name: "nightly", target: null, tables: [], options: {} as never },
    ];
    saveProfiles(profiles);
    expect(loadProfiles()).toEqual(profiles);
  });

  it("returns [] when nothing is stored", () => {
    expect(loadProfiles()).toEqual([]);
  });
});

// ── wizard shell ──────────────────────────────────────────────────────────

const connections: Connection[] = [
  makeConnection({ id: "c1", name: "Prod DB", driver: "mysql" }),
  makeConnection({ id: "c2", name: "Staging DB", driver: "postgres" }),
];
const sessions: SessionInfo[] = [
  { id: "src", connection_id: "c1", database: "app", connected_at: "x" },
  { id: "tgt", connection_id: "c2", database: "staging", connected_at: "x" },
];

function renderWizard(over: Partial<React.ComponentProps<typeof TransferWizard>> = {}) {
  return renderWithProviders(
    <TransferWizard
      sourceSession={sessions[0]}
      sourceDatabase="app"
      sourceTables={[makeTable({ name: "users" }), makeTable({ name: "orders" })]}
      preselectedTables={["users"]}
      sessions={sessions}
      connections={connections}
      onClose={vi.fn()}
      {...over}
    />,
  );
}

describe("TransferWizard shell", () => {
  beforeEach(() => {
    localStorage.clear();
    installFakeBackend();
  });

  it("opens on the Target step with all step labels in the sidebar", () => {
    renderWizard();
    expect(screen.getByText("Data Transfer")).toBeInTheDocument();
    expect(screen.getByText("Target connection")).toBeInTheDocument();
    // Sidebar step buttons.
    for (const label of ["Target", "Tables", "Objects", "Options", "Preview", "Run"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("locks Preview and Run until a target + selected tables exist", () => {
    renderWizard();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("navigates from Target to Tables via Next and shows the source tables", async () => {
    const { user } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Tables to transfer")).toBeInTheDocument();
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("saves a profile, listing it in the sidebar", async () => {
    const { user } = renderWizard();
    await user.type(screen.getByPlaceholderText("Profile name"), "nightly");
    await user.click(screen.getByRole("button", { name: "Save" }));
    // The saved profile appears as a clickable entry.
    expect(screen.getByTitle('Load "nightly"')).toBeInTheDocument();
    expect(loadProfiles().some((p) => p.name === "nightly")).toBe(true);
  });

  it("calls onClose when the Close button is pressed", async () => {
    const onClose = vi.fn();
    const { user } = renderWizard({ onClose });
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
