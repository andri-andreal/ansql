// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { installFakeBackend } from "../../test/fakeBackend";
import { makeConnection } from "../../test/fixtures";
import type {
  AnsqlClipboard,
  Connection,
  SessionInfo,
  SourceRef,
} from "../../types";
import type { PasteTarget } from "../../hooks/usePaste";
import { PasteTransferModal } from "./PasteTransferModal";

const connections: Connection[] = [
  makeConnection({ id: "c1", name: "Prod DB", driver: "mysql" }),
  makeConnection({ id: "c2", name: "Staging DB", driver: "postgres" }),
];
const sessions: SessionInfo[] = [
  { id: "src", connection_id: "c1", database: "app", connected_at: "x" },
  { id: "tgt", connection_id: "c2", database: "staging", connected_at: "x" },
];

const source: SourceRef = {
  sessionId: "src",
  connectionId: "c1",
  dbType: "mysql",
  database: "app",
  schema: null,
};

const tableClip: AnsqlClipboard = {
  kind: "table-ref",
  source,
  tables: [{ name: "users", schema: null }],
};

const rowClip: AnsqlClipboard = {
  kind: "row-snapshot",
  source,
  table: "users",
  columns: [
    { name: "id", data_type: "int", nullable: false },
    { name: "email", data_type: "varchar", nullable: false },
  ],
  rows: [
    [1, "a@x.com"],
    [2, "b@x.com"],
  ],
};

function renderModal(
  over: Partial<React.ComponentProps<typeof PasteTransferModal>> = {},
) {
  return renderWithProviders(
    <PasteTransferModal
      clip={tableClip}
      target={null}
      sessions={sessions}
      connections={connections}
      onClose={vi.fn()}
      {...over}
    />,
  );
}

describe("PasteTransferModal", () => {
  beforeEach(() => {
    const fake = installFakeBackend();
    fake.on("get_databases", () => ["app", "staging"]);
    fake.on("get_columns", () => []);
  });

  it("renders the paste dialog with a source summary", () => {
    renderModal();
    expect(screen.getByText("Paste to database")).toBeInTheDocument();
    // The source line describes the table-ref clip (1 table from app).
    expect(screen.getByText(/users|Source/i)).toBeInTheDocument();
  });

  it("calls onClose from the header close button", async () => {
    const onClose = vi.fn();
    const { user } = renderModal({ onClose });
    // Both the header X and the footer button are named "Close"; the header X is first.
    await user.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the copy toggles for a table-ref clip (structure/data/indexes/fks)", () => {
    renderModal();
    expect(screen.getByText("Structure")).toBeInTheDocument();
    expect(screen.getByText("Data")).toBeInTheDocument();
    expect(screen.getByText("Indexes")).toBeInTheDocument();
    expect(screen.getByText("Foreign keys")).toBeInTheDocument();
  });

  it("disables Run until a target session, db and table are chosen", () => {
    // No preset target → run/preview disabled.
    renderModal({ target: null, clip: tableClip });
    expect(screen.getByRole("button", { name: /^Run$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  });

  it("renders the column mapping for a row-snapshot clip", () => {
    renderModal({ clip: rowClip });
    expect(screen.getByText("Column mapping")).toBeInTheDocument();
    // Source columns from the snapshot appear.
    expect(screen.getByText(/email/)).toBeInTheDocument();
  });

  it("warns when the chosen target session equals the source for a table-ref transfer", async () => {
    const target: PasteTarget = {
      kind: "grid",
      sessionId: "src",
      database: "app",
      table: "users",
    };
    renderModal({ clip: tableClip, target });
    // Same source+target session → session-conflict warning rendered.
    await waitFor(() => {
      expect(
        screen.getByText(/need a separate target session/i),
      ).toBeInTheDocument();
    });
  });
});
