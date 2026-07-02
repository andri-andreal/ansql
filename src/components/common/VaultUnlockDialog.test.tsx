// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import { VaultUnlockDialog } from "./VaultUnlockDialog";

function renderDialog(
  props: Partial<React.ComponentProps<typeof VaultUnlockDialog>> = {},
) {
  return renderWithProviders(
    <VaultUnlockDialog
      onUnlock={vi.fn().mockResolvedValue(undefined)}
      onReset={vi.fn()}
      {...props}
    />,
  );
}

describe("VaultUnlockDialog", () => {
  it("renders the locked title, the password label, and the unlock button", () => {
    renderDialog();
    expect(screen.getByText("Vault is locked")).toBeInTheDocument();
    expect(screen.getByText("Master password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("keeps Unlock disabled until a password is typed, then fires onUnlock with it", async () => {
    const onUnlock = vi.fn().mockResolvedValue(undefined);
    const { user } = renderDialog({ onUnlock });

    const unlockBtn = screen.getByRole("button", { name: "Unlock" });
    expect(unlockBtn).toBeDisabled();

    const input = screen.getByPlaceholderText("Enter master password");
    await user.type(input, "hunter2");
    expect(unlockBtn).not.toBeDisabled();

    await user.click(unlockBtn);
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(onUnlock).toHaveBeenCalledWith("hunter2");
  });

  it("submits on Enter inside the password field", async () => {
    const onUnlock = vi.fn().mockResolvedValue(undefined);
    const { user } = renderDialog({ onUnlock });

    const input = screen.getByPlaceholderText("Enter master password");
    await user.type(input, "secret{Enter}");

    expect(onUnlock).toHaveBeenCalledWith("secret");
  });

  it("does not call onUnlock when the password is empty and Enter is pressed", async () => {
    const onUnlock = vi.fn().mockResolvedValue(undefined);
    const { user } = renderDialog({ onUnlock });

    const input = screen.getByPlaceholderText("Enter master password");
    await user.type(input, "{Enter}");

    expect(onUnlock).not.toHaveBeenCalled();
  });

  it("shows the error message when an error prop is provided", () => {
    renderDialog({ error: "Incorrect master password." });
    expect(screen.getByText("Incorrect master password.")).toBeInTheDocument();
  });

  it("disables the input, the unlock button, and the reset link while busy, and shows the unlocking label", () => {
    renderDialog({ busy: true });

    expect(screen.getByPlaceholderText("Enter master password")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Unlocking/ })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Forgot password? Reset vault" }),
    ).toBeDisabled();
  });

  it("fires onReset when the reset link is clicked", async () => {
    const onReset = vi.fn();
    const { user } = renderDialog({ onReset });

    await user.click(
      screen.getByRole("button", { name: "Forgot password? Reset vault" }),
    );
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
