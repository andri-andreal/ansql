// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, within, waitFor } from "../../test/render";
import { installFakeBackend } from "../../test/fakeBackend";
import { makeConnection } from "../../test/fixtures";
import ConnectionForm from "./ConnectionForm";

// ConnectionForm mounts useGroups(), which calls the `get_groups` command via
// tauri-commands. Install a fake backend so that IPC resolves cleanly.
function setup(props: Partial<React.ComponentProps<typeof ConnectionForm>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  const onTest = vi.fn().mockResolvedValue(true);
  const result = renderWithProviders(
    <ConnectionForm onSave={onSave} onCancel={onCancel} onTest={onTest} {...props} />,
  );
  return { onSave, onCancel, onTest, ...result };
}

/**
 * New connections open on Step 1 (the driver picker). Each engine is a <button>
 * whose accessible name is the label ("MySQL", ...) plus a kind word. Clicking
 * it advances to Step 2 (the details form). Edit-mode tests skip this and land
 * on Step 2 directly.
 */
async function pickDriver(
  user: ReturnType<typeof setup>["user"],
  label = "MySQL",
) {
  await user.click(screen.getByRole("button", { name: new RegExp(label) }));
}

describe("ConnectionForm", () => {
  beforeEach(() => {
    installFakeBackend({ handlers: { get_groups: () => [] } });
  });

  // --- Step transitions (new in the two-step flow) ------------------------

  it("opens new connections on the driver picker (step 1), with no detail fields yet", () => {
    setup();
    expect(screen.getByText("Choose a database type")).toBeInTheDocument();
    // The six engine cards are present...
    for (const label of ["MySQL", "PostgreSQL", "SQLite", "SQL Server", "Redis", "MongoDB"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
    // ...but the detail fields and footer actions are not in the DOM yet.
    expect(screen.queryByPlaceholderText("My Database")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Connection" })).not.toBeInTheDocument();
  });

  it("picking a driver card reveals the details form, and Change returns to the grid", async () => {
    const { user } = setup();
    await pickDriver(user, "PostgreSQL");

    // Step 2: details form is now mounted.
    await waitFor(() =>
      expect(screen.getByPlaceholderText("My Database")).toBeInTheDocument(),
    );
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Connection")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Connection" })).toBeInTheDocument();
    // The selected-driver bar exposes a "Change" button.
    const change = screen.getByRole("button", { name: "Change" });

    await user.click(change);
    // Back on step 1.
    await waitFor(() =>
      expect(screen.getByText("Choose a database type")).toBeInTheDocument(),
    );
    expect(screen.queryByPlaceholderText("My Database")).not.toBeInTheDocument();
  });

  it("opens edits directly on step 2 with no Change button", () => {
    setup({ connection: makeConnection({ name: "Prod" }) });
    // No driver picker.
    expect(screen.queryByText("Choose a database type")).not.toBeInTheDocument();
    // Details form is shown immediately.
    expect(screen.getByDisplayValue("Prod")).toBeInTheDocument();
    // The "Change" button is hidden when editing.
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  });

  // --- Header / submit button --------------------------------------------

  it("shows the New Connection header and Create button when creating", async () => {
    const { user } = setup();
    expect(screen.getByText("New Connection")).toBeInTheDocument();
    await pickDriver(user);
    expect(
      await screen.findByRole("button", { name: "Create Connection" }),
    ).toBeInTheDocument();
  });

  it("shows the Edit header and Save button when editing an existing connection", () => {
    setup({ connection: makeConnection({ name: "Prod" }) });
    expect(screen.getByText("Edit Connection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Prod")).toBeInTheDocument();
  });

  // --- Default ports per driver ------------------------------------------

  it("applies the MySQL default host/port when MySQL is picked", async () => {
    const { user } = setup();
    await pickDriver(user, "MySQL");
    await waitFor(() => expect(screen.getByDisplayValue("3306")).toBeInTheDocument());
    expect(screen.getByDisplayValue("3306")).toHaveValue(3306);
    expect(screen.getByDisplayValue("localhost")).toBeInTheDocument();
  });

  it("uses the per-driver default port when the driver is picked", async () => {
    // Each pick lands on a fresh step 2; the port effect sets the default.
    {
      const { user, unmount } = setup();
      await pickDriver(user, "PostgreSQL");
      await waitFor(() => expect(screen.getByDisplayValue("5432")).toBeInTheDocument());
      unmount();
    }
    {
      const { user, unmount } = setup();
      await pickDriver(user, "MongoDB");
      await waitFor(() => expect(screen.getByDisplayValue("27017")).toBeInTheDocument());
      unmount();
    }
    {
      const { user } = setup();
      await pickDriver(user, "Redis");
      await waitFor(() => expect(screen.getByDisplayValue("6379")).toBeInTheDocument());
    }
  });

  // --- Field gating -------------------------------------------------------

  it("hides host/port/database/username fields for SQLite, showing the file path field instead", async () => {
    const { user } = setup();
    await pickDriver(user, "SQLite");

    await waitFor(() => expect(screen.getByText("Database File Path")).toBeInTheDocument());
    expect(screen.queryByText("Host")).not.toBeInTheDocument();
    expect(screen.queryByText("Username")).not.toBeInTheDocument();
    expect(screen.queryByText("Password")).not.toBeInTheDocument();
    // SSL/SSH transport sections are hidden for SQLite too.
    expect(screen.queryByText("SSL / TLS")).not.toBeInTheDocument();
    expect(screen.queryByText("SSH Tunnel")).not.toBeInTheDocument();
  });

  it("gates Redis fields: no username and no database, but keeps host/port/password", async () => {
    const { user } = setup();
    await pickDriver(user, "Redis");

    await waitFor(() => expect(screen.getByDisplayValue("6379")).toBeInTheDocument());
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.queryByText("Username")).not.toBeInTheDocument();
    expect(screen.queryByText("Database Name")).not.toBeInTheDocument();
  });

  it("keeps host/port/user/password for MongoDB and marks the auth database optional", async () => {
    const { user } = setup();
    await pickDriver(user, "MongoDB");

    await waitFor(() => expect(screen.getByDisplayValue("27017")).toBeInTheDocument());
    expect(screen.getByText("Database Name")).toBeInTheDocument();
    expect(screen.getByText("(optional)")).toBeInTheDocument();
    expect(screen.getByText("Username")).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
  });

  // --- onSave / onTest payload shapes ------------------------------------

  it("calls onSave with the entered host/port/user payload for a postgres connection", async () => {
    const { user, onSave } = setup();

    await pickDriver(user, "PostgreSQL");
    await waitFor(() => expect(screen.getByDisplayValue("5432")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("My Database"), "My PG");
    await user.clear(screen.getByPlaceholderText("localhost"));
    await user.type(screen.getByPlaceholderText("localhost"), "db.example.com");
    await user.type(screen.getByPlaceholderText("root"), "admin");
    await user.type(screen.getByPlaceholderText("my_database"), "appdb");
    await user.type(screen.getByPlaceholderText("••••••••"), "s3cret");

    await user.click(screen.getByRole("button", { name: "Create Connection" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [payload, secrets] = onSave.mock.calls[0];
    expect(payload).toMatchObject({
      name: "My PG",
      driver: "postgres",
      host: "db.example.com",
      port: 5432,
      database: "appdb",
      username: "admin",
    });
    // No SSL/SSH configured -> options serialized as "{}".
    expect(payload.options).toBe("{}");
    expect(secrets).toMatchObject({ password: "s3cret" });
  });

  it("omits host/port/database/username from the payload for SQLite and sends no secrets", async () => {
    const { user, onSave } = setup();

    await pickDriver(user, "SQLite");
    await waitFor(() => expect(screen.getByText("Database File Path")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("My Database"), "Local file");
    await user.type(screen.getByPlaceholderText("/path/to/database.db"), "/tmp/app.db");

    await user.click(screen.getByRole("button", { name: "Create Connection" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [payload, secrets] = onSave.mock.calls[0];
    expect(payload).toMatchObject({ name: "Local file", driver: "sqlite", database: "/tmp/app.db" });
    expect(payload.host).toBeUndefined();
    expect(payload.port).toBeUndefined();
    expect(payload.username).toBeUndefined();
    expect(payload.options).toBeUndefined();
    expect(secrets).toBeUndefined();
  });

  it("excludes database and username from the Redis payload", async () => {
    const { user, onSave } = setup();

    await pickDriver(user, "Redis");
    await waitFor(() => expect(screen.getByDisplayValue("6379")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("My Database"), "Cache");
    await user.type(screen.getByPlaceholderText("••••••••"), "redispw");

    await user.click(screen.getByRole("button", { name: "Create Connection" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [payload, secrets] = onSave.mock.calls[0];
    expect(payload).toMatchObject({ name: "Cache", driver: "redis" });
    expect(payload.database).toBeUndefined();
    expect(payload.username).toBeUndefined();
    expect(secrets).toMatchObject({ password: "redispw" });
  });

  it("serializes a selected SSL mode into the options payload", async () => {
    const { user, onSave } = setup();

    await pickDriver(user, "MySQL");
    await waitFor(() => expect(screen.getByPlaceholderText("My Database")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("My Database"), "SSL DB");
    // Expand SSL section and pick a mode. The SSL Mode <select> is the one that
    // offers a "Require" option.
    await user.click(screen.getByRole("button", { name: /SSL \/ TLS/ }));
    const select = await waitFor(
      () =>
        screen
          .getAllByRole("combobox")
          .find((s) => within(s).queryByText("Require")) as HTMLSelectElement,
    );
    await user.selectOptions(select, "require");

    await user.click(screen.getByRole("button", { name: "Create Connection" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [payload] = onSave.mock.calls[0];
    expect(JSON.parse(payload.options)).toMatchObject({ ssl: { mode: "require" } });
  });

  it("includes the SSH tunnel block in the payload when enabled", async () => {
    const { user, onSave } = setup();

    await pickDriver(user, "MySQL");
    await waitFor(() => expect(screen.getByPlaceholderText("My Database")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("My Database"), "Tunneled");
    await user.click(screen.getByRole("button", { name: /SSH Tunnel/ }));
    await user.click(screen.getByLabelText("Use SSH tunnel"));

    await waitFor(() => expect(screen.getByPlaceholderText("bastion.example.com")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("bastion.example.com"), "jump.example.com");
    await user.type(screen.getByPlaceholderText("ec2-user"), "deploy");

    await user.click(screen.getByRole("button", { name: "Create Connection" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [payload, secrets] = onSave.mock.calls[0];
    const opts = JSON.parse(payload.options);
    expect(opts.ssh).toMatchObject({
      enabled: true,
      host: "jump.example.com",
      user: "deploy",
      auth: "password",
    });
    void secrets;
  });

  // --- Cancel / validation / test result ---------------------------------

  it("fires onCancel from the Cancel button", async () => {
    const { user, onCancel } = setup();
    await pickDriver(user, "MySQL");
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables Test and Submit until a name is provided", async () => {
    const { user } = setup();
    await pickDriver(user, "MySQL");
    await waitFor(() => expect(screen.getByPlaceholderText("My Database")).toBeInTheDocument());

    const submit = screen.getByRole("button", { name: "Create Connection" });
    const test = screen.getByRole("button", { name: "Test Connection" });
    expect(submit).toBeDisabled();
    expect(test).toBeDisabled();

    await user.type(screen.getByPlaceholderText("My Database"), "Named");
    expect(submit).toBeEnabled();
    expect(test).toBeEnabled();
  });

  it("calls onTest and reports success", async () => {
    const { user, onTest } = setup();
    await pickDriver(user, "MySQL");
    await waitFor(() => expect(screen.getByPlaceholderText("My Database")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("My Database"), "Probe");
    await user.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() => expect(onTest).toHaveBeenCalledTimes(1));
    expect(onTest.mock.calls[0][0]).toMatchObject({ name: "Probe", driver: "mysql" });
    await waitFor(() => expect(screen.getByText("Connection successful!")).toBeInTheDocument());
  });

  it("reports failure when onTest resolves false", async () => {
    const onTest = vi.fn().mockResolvedValue(false);
    const { user } = setup({ onTest });
    await pickDriver(user, "MySQL");
    await waitFor(() => expect(screen.getByPlaceholderText("My Database")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("My Database"), "Probe");
    await user.click(screen.getByRole("button", { name: "Test Connection" }));

    await waitFor(() =>
      expect(
        screen.getByText("Connection failed. Please check your settings."),
      ).toBeInTheDocument(),
    );
  });
});
