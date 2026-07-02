// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within, waitFor } from "@/test/render";
import { UserManager } from "./UserManager";

/**
 * Build a runQuery stub that routes by the SQL text. The component issues:
 *  - listUsersQuery  (SELECT ... FROM mysql.user ORDER BY user)
 *  - listRolesQuery  (SELECT ... account_locked ...)
 *  - listGrantsQuery (SHOW GRANTS FOR ...)
 *  - and the mutation statements (CREATE USER / DROP USER / GRANT ...).
 */
function makeRunQuery(opts: {
  users?: Record<string, unknown>[];
  roles?: Record<string, unknown>[];
  grants?: Record<string, unknown>[];
}) {
  return vi.fn(async (sql: string) => {
    if (/FROM mysql\.user/i.test(sql) && /account_locked/i.test(sql)) {
      return { rows: opts.roles ?? [] };
    }
    if (/FROM mysql\.user/i.test(sql)) {
      return { rows: opts.users ?? [] };
    }
    if (/SHOW GRANTS/i.test(sql)) {
      return { rows: opts.grants ?? [] };
    }
    return { rows: [] };
  });
}

describe("UserManager (mysql)", () => {
  it("lists users returned from runQuery", async () => {
    const runQuery = makeRunQuery({
      users: [
        { name: "alice", host: "%" },
        { name: "bob", host: "localhost" },
      ],
    });

    renderWithProviders(
      <UserManager dialect="mysql" runQuery={runQuery} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("2 users")).toBeInTheDocument();
  });

  it("shows the empty state when no users exist", async () => {
    const runQuery = makeRunQuery({ users: [] });

    renderWithProviders(
      <UserManager dialect="mysql" runQuery={runQuery} onClose={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText("No users found.")).toBeInTheDocument(),
    );
  });

  it("creates a user, issuing a CREATE USER statement with the typed name", async () => {
    const runQuery = makeRunQuery({ users: [] });

    const { user } = renderWithProviders(
      <UserManager dialect="mysql" runQuery={runQuery} onClose={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText("No users found.")).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText("New user name"), "charlie");
    await user.type(screen.getByLabelText("New user password"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const createCall = runQuery.mock.calls.find((c) =>
        /CREATE USER/i.test(c[0]),
      );
      expect(createCall).toBeTruthy();
      expect(createCall![0]).toMatch(/charlie/);
    });
  });

  it("selecting a user reveals the detail pane and password/grant controls", async () => {
    const runQuery = makeRunQuery({
      users: [{ name: "alice", host: "%" }],
      grants: [],
    });

    const { user } = renderWithProviders(
      <UserManager dialect="mysql" runQuery={runQuery} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());

    // Before selection, the hint shows.
    expect(
      screen.getByText(
        "Select a user to manage its password and privileges.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByText("alice"));

    await waitFor(() =>
      expect(screen.getByText("Set password")).toBeInTheDocument(),
    );
    expect(screen.getByText("Current grants")).toBeInTheDocument();
    expect(screen.getByText("No grants found.")).toBeInTheDocument();
  });

  it("dropping a selected user opens a confirm dialog and issues DROP USER", async () => {
    const runQuery = makeRunQuery({
      users: [{ name: "alice", host: "%" }],
    });

    const { user } = renderWithProviders(
      <UserManager dialect="mysql" runQuery={runQuery} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    await user.click(screen.getByText("alice"));

    await waitFor(() =>
      expect(screen.getByText("Set password")).toBeInTheDocument(),
    );

    // The "Drop" action button in the detail header arms the confirm dialog.
    await user.click(screen.getByRole("button", { name: "Drop" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Drop user/i)).toBeInTheDocument();

    // Confirm via the destructive Drop button inside the dialog.
    await user.click(within(dialog).getByRole("button", { name: "Drop" }));

    await waitFor(() => {
      const dropCall = runQuery.mock.calls.find((c) =>
        /DROP USER/i.test(c[0]),
      );
      expect(dropCall).toBeTruthy();
      expect(dropCall![0]).toMatch(/alice/);
    });
  });

  it("calls onClose when the close button is clicked", async () => {
    const runQuery = makeRunQuery({ users: [] });
    const onClose = vi.fn();

    const { user } = renderWithProviders(
      <UserManager dialect="mysql" runQuery={runQuery} onClose={onClose} />,
    );

    await waitFor(() =>
      expect(screen.getByText("No users found.")).toBeInTheDocument(),
    );

    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("UserManager (postgres)", () => {
  it("renders postgres header and lists roles as users", async () => {
    const runQuery = vi.fn(async (sql: string) => {
      if (/FROM pg_roles WHERE rolcanlogin = false/i.test(sql)) {
        return { rows: [{ name: "readonly" }] };
      }
      if (/FROM pg_roles/i.test(sql)) {
        return {
          rows: [
            { name: "postgres", can_login: true, is_super: true },
            { name: "appuser", can_login: true, is_super: false },
          ],
        };
      }
      return { rows: [] };
    });

    renderWithProviders(
      <UserManager dialect="postgres" runQuery={runQuery} onClose={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText("postgres")).toBeInTheDocument(),
    );
    expect(screen.getByText("appuser")).toBeInTheDocument();
    expect(screen.getByText(/PostgreSQL/)).toBeInTheDocument();
  });
});
