// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, within, waitFor } from "@/test/render";
import { installFakeBackend } from "@/test/fakeBackend";
import GroupManager from "./GroupManager";

function group(over: Record<string, unknown> = {}) {
  return {
    id: "g1",
    name: "TeamRed",
    description: "Red squad",
    color: "#ef4444",
    icon: "",
    parent_id: undefined,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    ...over,
  };
}

// The name <input> is the only text field carrying the "Production" placeholder.
function nameInput() {
  return screen.getByPlaceholderText("Production") as HTMLInputElement;
}

// Group names render in the list as <p> (and also as a parent-group <option>),
// so scope list assertions to the paragraph element.
function listItem(name: string) {
  return screen.getByText(name, { selector: "p" });
}

describe("GroupManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the existing groups list from the backend", async () => {
    installFakeBackend({
      handlers: {
        get_groups: () => [
          group({ id: "g1", name: "TeamRed", description: "Red squad" }),
          group({ id: "g2", name: "TeamBlue", description: undefined }),
        ],
      },
    });

    renderWithProviders(<GroupManager onClose={vi.fn()} />);

    await waitFor(() => {
      expect(listItem("TeamRed")).toBeInTheDocument();
    });
    expect(listItem("TeamBlue")).toBeInTheDocument();
    expect(screen.getByText("Red squad")).toBeInTheDocument();
  });

  it("shows the empty state when there are no groups", async () => {
    installFakeBackend({ handlers: { get_groups: () => [] } });

    renderWithProviders(<GroupManager onClose={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText("No groups yet. Create one to get started."),
      ).toBeInTheDocument();
    });
  });

  it("creates a new group and fires onChange with the typed name", async () => {
    const fake = installFakeBackend({
      handlers: {
        get_groups: () => [],
        create_group: (args) =>
          group({ id: "new", name: (args as { name: string }).name }),
      },
    });
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <GroupManager onClose={vi.fn()} onChange={onChange} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No groups yet. Create one to get started."),
      ).toBeInTheDocument();
    });

    await user.type(nameInput(), "Analytics");
    await user.click(screen.getByRole("button", { name: "Create Group" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());

    const created = fake.calls.find((c) => c.cmd === "create_group");
    expect(created).toBeTruthy();
    expect((created!.args as { name: string }).name).toBe("Analytics");
  });

  it("surfaces a backend error when creation fails", async () => {
    installFakeBackend({
      handlers: {
        get_groups: () => [],
        create_group: () => {
          throw new Error("duplicate group name");
        },
      },
    });

    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <GroupManager onClose={vi.fn()} onChange={onChange} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No groups yet. Create one to get started."),
      ).toBeInTheDocument();
    });

    await user.type(nameInput(), "Analytics");
    await user.click(screen.getByRole("button", { name: "Create Group" }));

    await waitFor(() => {
      expect(screen.getByText("duplicate group name")).toBeInTheDocument();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("enters edit mode and updates the selected group", async () => {
    const fake = installFakeBackend({
      handlers: {
        get_groups: () => [group({ id: "g1", name: "TeamRed" })],
        update_group: (args) =>
          group({ id: "g1", name: (args as { name: string }).name }),
      },
    });
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <GroupManager onClose={vi.fn()} onChange={onChange} />,
    );

    await waitFor(() => expect(listItem("TeamRed")).toBeInTheDocument());

    await user.click(listItem("TeamRed"));
    expect(screen.getByText("Edit Group")).toBeInTheDocument();

    const input = nameInput();
    expect(input.value).toBe("TeamRed");
    await user.clear(input);
    await user.type(input, "TeamCrimson");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = fake.calls.find((c) => c.cmd === "update_group");
    expect(updated).toBeTruthy();
    expect((updated!.args as { id: string }).id).toBe("g1");
    expect((updated!.args as { name: string }).name).toBe("TeamCrimson");
  });

  it("deletes a group after confirming and fires onChange", async () => {
    const fake = installFakeBackend({
      handlers: {
        get_groups: () => [group({ id: "g1", name: "TeamRed" })],
        delete_group: () => undefined,
      },
    });
    const onChange = vi.fn();

    const { user } = renderWithProviders(
      <GroupManager onClose={vi.fn()} onChange={onChange} />,
    );

    await waitFor(() => expect(listItem("TeamRed")).toBeInTheDocument());

    // First trash click arms the confirmation, then the check button confirms.
    await user.click(screen.getByTitle("Delete"));
    await user.click(screen.getByTitle("Confirm delete"));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const del = fake.calls.find((c) => c.cmd === "delete_group");
    expect(del).toBeTruthy();
    expect((del!.args as { id: string }).id).toBe("g1");
  });

  it("calls onClose when the header close button is clicked", async () => {
    installFakeBackend({ handlers: { get_groups: () => [] } });
    const onClose = vi.fn();

    const { user } = renderWithProviders(<GroupManager onClose={onClose} />);

    await waitFor(() => {
      expect(
        screen.getByText("No groups yet. Create one to get started."),
      ).toBeInTheDocument();
    });

    // The close button lives in the header alongside the title.
    const header = screen.getByText("Manage Groups").closest("div")!
      .parentElement!;
    const closeBtn = within(header).getAllByRole("button")[0];
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
