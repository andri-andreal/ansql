// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { MongoBrowser } from "./MongoBrowser";
import type { MongoApi } from "./types";

function makeApi(overrides: Partial<MongoApi> = {}): MongoApi {
  return {
    listDatabases: vi.fn().mockResolvedValue([]),
    listCollections: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue({ docs: [], total: 0 }),
    insertOne: vi.fn().mockResolvedValue(undefined),
    replaceOne: vi.fn().mockResolvedValue(undefined),
    deleteOne: vi.fn().mockResolvedValue(undefined),
    command: vi.fn().mockResolvedValue({ ok: 1 }),
    ...overrides,
  };
}

/** Render and pick a database + collection, returning the api object. */
async function renderSelected(
  overrides: Partial<MongoApi> = {}
): Promise<{ api: MongoApi; user: ReturnType<typeof renderWithProviders>["user"] }> {
  const api = makeApi({
    listDatabases: vi.fn().mockResolvedValue(["appdb"]),
    listCollections: vi.fn().mockResolvedValue(["users"]),
    ...overrides,
  });
  const { user } = renderWithProviders(<MongoBrowser api={api} />);

  await screen.findByRole("option", { name: "appdb" });
  await user.selectOptions(screen.getByTitle("Select database"), "appdb");
  await user.click(await screen.findByText("users"));
  return { api, user };
}

describe("MongoBrowser", () => {
  it("loads databases on mount and lists them as options", async () => {
    const listDatabases = vi.fn().mockResolvedValue(["appdb", "logs"]);
    renderWithProviders(<MongoBrowser api={makeApi({ listDatabases })} />);

    await waitFor(() => expect(listDatabases).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("option", { name: "appdb" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "logs" })).toBeInTheDocument();
  });

  it("loads collections for the selected database and lists them", async () => {
    const listCollections = vi.fn().mockResolvedValue(["users", "orders"]);
    const api = makeApi({
      listDatabases: vi.fn().mockResolvedValue(["appdb"]),
      listCollections,
    });
    const { user } = renderWithProviders(<MongoBrowser api={api} />);

    await screen.findByRole("option", { name: "appdb" });
    await user.selectOptions(screen.getByTitle("Select database"), "appdb");

    await waitFor(() => expect(listCollections).toHaveBeenCalledWith("appdb"));
    expect(await screen.findByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("runs find with db, coll, filter, limit and skip, then renders documents", async () => {
    const find = vi.fn().mockResolvedValue({
      docs: [{ _id: "abc", name: "Ada" }],
      total: 1,
    });
    const { user } = await renderSelected({ find });

    const filterBox = screen.getByPlaceholderText(/a JSON filter/i);
    await user.clear(filterBox);
    await user.type(filterBox, '{{"name":"Ada"}');

    await user.click(screen.getByRole("button", { name: /find/i }));

    await waitFor(() =>
      expect(find).toHaveBeenCalledWith("appdb", "users", '{"name":"Ada"}', 20, 0)
    );
    expect(await screen.findByText(/_id: abc/)).toBeInTheDocument();
    expect(screen.getByText(/"name": "Ada"/)).toBeInTheDocument();
    expect(screen.getByText("1–1 of 1")).toBeInTheDocument();
  });

  it("inserts a new document via insertOne with the editor JSON", async () => {
    const insertOne = vi.fn().mockResolvedValue(undefined);
    const find = vi.fn().mockResolvedValue({ docs: [], total: 0 });
    const { user } = await renderSelected({ insertOne, find });

    await user.click(screen.getByRole("button", { name: /insert/i }));

    // The overlay's editor textarea is the last textbox in the tree.
    await screen.findByText("Insert document");
    const textboxes = screen.getAllByRole("textbox");
    const editorBox = textboxes[textboxes.length - 1];
    await user.clear(editorBox);
    await user.type(editorBox, '{{"name":"Bob"}');

    // Two "Insert" buttons exist (toolbar + overlay footer); the footer's is the second.
    const insertButtons = screen.getAllByRole("button", { name: /^insert$/i });
    await user.click(insertButtons[insertButtons.length - 1]);

    await waitFor(() =>
      expect(insertOne).toHaveBeenCalledWith("appdb", "users", '{"name":"Bob"}')
    );
  });

  it("edits an existing document and replaces it via replaceOne filtered by _id", async () => {
    const find = vi
      .fn()
      .mockResolvedValue({ docs: [{ _id: "abc", name: "Ada" }], total: 1 });
    const replaceOne = vi.fn().mockResolvedValue(undefined);
    const { user } = await renderSelected({ find, replaceOne });

    await user.click(screen.getByRole("button", { name: /find/i }));
    await screen.findByText(/_id: abc/);

    await user.click(screen.getByRole("button", { name: /^edit$/i }));

    // Replace button confirms we are in edit mode.
    const replaceBtn = await screen.findByRole("button", { name: /^replace$/i });
    await user.click(replaceBtn);

    await waitFor(() =>
      expect(replaceOne).toHaveBeenCalledWith(
        "appdb",
        "users",
        '{"_id":"abc"}',
        expect.any(String)
      )
    );
    // The replaced JSON should be the edited document text.
    const [, , , docJson] = replaceOne.mock.calls[0];
    expect(JSON.parse(docJson as string)).toEqual({ _id: "abc", name: "Ada" });
  });

  it("deletes a document via deleteOne filtered by its _id", async () => {
    const find = vi
      .fn()
      .mockResolvedValue({ docs: [{ _id: "abc", name: "Ada" }], total: 1 });
    const deleteOne = vi.fn().mockResolvedValue(undefined);
    const { user } = await renderSelected({ find, deleteOne });

    await user.click(screen.getByRole("button", { name: /find/i }));
    await screen.findByText(/_id: abc/);

    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(deleteOne).toHaveBeenCalledWith("appdb", "users", '{"_id":"abc"}')
    );
  });

  it("runs a raw runCommand with the db and JSON command, printing the reply", async () => {
    const command = vi.fn().mockResolvedValue({ ok: 1 });
    const { user } = await renderSelected({ command });

    await user.click(screen.getByRole("button", { name: /console/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^run$/i })).toBeEnabled()
    );
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("appdb", '{ "ping": 1 }')
    );
    expect(await screen.findByText(/"ok": 1/)).toBeInTheDocument();
  });

  it("shows an invalid-JSON warning for a malformed filter and keeps Find disabled", async () => {
    const find = vi.fn();
    const { user } = await renderSelected({ find });

    const filterBox = screen.getByPlaceholderText(/a JSON filter/i);
    await user.clear(filterBox);
    await user.type(filterBox, "{{not json");

    expect(await screen.findByText(/Invalid JSON:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /find/i })).toBeDisabled();
    expect(find).not.toHaveBeenCalled();
  });

  it("surfaces a find error", async () => {
    const find = vi.fn().mockRejectedValue(new Error("query failed"));
    const { user } = await renderSelected({ find });

    await user.click(screen.getByRole("button", { name: /find/i }));

    expect(await screen.findByText("query failed")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <MongoBrowser api={makeApi()} onClose={onClose} />
    );
    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
