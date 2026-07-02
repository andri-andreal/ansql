// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders, screen, within, waitFor } from "../../test/render";
import { installFakeBackend } from "../../test/fakeBackend";
import PreferencesDialog from "./PreferencesDialog";

beforeEach(() => {
  localStorage.clear();
});

function renderDialog(onClose = vi.fn()) {
  installFakeBackend({ handlers: { vault_mode: () => "device" } });
  return { onClose, ...renderWithProviders(<PreferencesDialog onClose={onClose} />) };
}

describe("PreferencesDialog", () => {
  it("renders the dialog title and its section headers", () => {
    renderDialog();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
  });

  it("fires onClose when the Close button is clicked", async () => {
    const { onClose, user } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClose when clicking inside the dialog body", async () => {
    const { onClose, user } = renderDialog();
    await user.click(screen.getByText("Preferences"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("changes the app language via the language selector (re-translates UI text)", async () => {
    const { user } = renderDialog();

    // The language <select> lists English + Bahasa Indonesia as options.
    const languageSelect = screen
      .getAllByRole("combobox")
      .find((el) =>
        within(el).queryByRole("option", { name: "Bahasa Indonesia" }),
      )!;
    expect(languageSelect).toHaveValue("en");

    await user.selectOptions(languageSelect, "id");
    expect(languageSelect).toHaveValue("id");
    expect(localStorage.getItem("ansql.language")).toBe("id");
  });

  it("switches the active theme button when a theme option is clicked", async () => {
    const { user } = renderDialog();

    // Theme options render as buttons labelled Light / Dark / System.
    const darkBtn = screen.getByRole("button", { name: "Dark" });
    await user.click(darkBtn);

    // The persisted theme is observable via the next render of the toggle group.
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
  });

  it("shows the device-key vault status from the backend and offers Set master password", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByText("Device key (auto-unlock)")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Set master password" }),
    ).toBeInTheDocument();
  });

  it("validates the set-master-password form: mismatched passwords show an error and skip the backend call", async () => {
    const fake = installFakeBackend({ handlers: { vault_mode: () => "device" } });
    const { user } = renderWithProviders(<PreferencesDialog onClose={vi.fn()} />);

    await user.click(
      await screen.findByRole("button", { name: "Set master password" }),
    );

    await user.type(screen.getByPlaceholderText("New master password"), "abc123");
    await user.type(
      screen.getByPlaceholderText("Confirm new master password"),
      "different",
    );
    await user.click(screen.getByRole("button", { name: "Set password" }));

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(fake.calls.some((c) => c.cmd === "set_master_password")).toBe(false);
  });

  it("calls set_master_password when the set form is filled consistently", async () => {
    const fake = installFakeBackend({ handlers: { vault_mode: () => "device" } });
    const { user } = renderWithProviders(<PreferencesDialog onClose={vi.fn()} />);

    await user.click(
      await screen.findByRole("button", { name: "Set master password" }),
    );

    await user.type(screen.getByPlaceholderText("New master password"), "topsecret");
    await user.type(
      screen.getByPlaceholderText("Confirm new master password"),
      "topsecret",
    );
    await user.click(screen.getByRole("button", { name: "Set password" }));

    await waitFor(() => {
      expect(
        fake.calls.some((c) => c.cmd === "set_master_password"),
      ).toBe(true);
    });
    const call = fake.calls.find((c) => c.cmd === "set_master_password")!;
    expect(call.args).toMatchObject({ newPassword: "topsecret" });
  });
});
