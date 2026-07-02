// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { VaultGate } from "./VaultGate";
import type { AppState } from "@/hooks/useAppState";

// VaultGate only reads a handful of fields off AppState; cast a partial mock.
function makeApp(over: Partial<AppState> = {}): AppState {
  return {
    vaultGateChecked: true,
    vaultLocked: false,
    handleVaultUnlock: vi.fn().mockResolvedValue(undefined),
    handleVaultReset: vi.fn(),
    unlockError: null,
    unlockBusy: false,
    ...over,
  } as unknown as AppState;
}

describe("VaultGate", () => {
  it("renders a blank aria-hidden placeholder until the gate check resolves", () => {
    const { container } = renderWithProviders(
      <VaultGate app={makeApp({ vaultGateChecked: false })} />
    );
    const placeholder = container.querySelector('[aria-hidden="true"]');
    expect(placeholder).toBeInTheDocument();
    // Unlock dialog must NOT be shown yet.
    expect(screen.queryByText("Vault is locked")).not.toBeInTheDocument();
  });

  it("renders the unlock dialog when checked and locked", () => {
    renderWithProviders(
      <VaultGate app={makeApp({ vaultGateChecked: true, vaultLocked: true })} />
    );
    expect(screen.getByText("Vault is locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("renders nothing once the vault is unlocked", () => {
    const { container } = renderWithProviders(
      <VaultGate app={makeApp({ vaultGateChecked: true, vaultLocked: false })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("wires unlock-dialog props (error shown, reset wired) when locked", async () => {
    const handleVaultReset = vi.fn();
    const { user } = renderWithProviders(
      <VaultGate
        app={makeApp({
          vaultGateChecked: true,
          vaultLocked: true,
          unlockError: "Wrong password",
          handleVaultReset,
        })}
      />
    );
    expect(screen.getByText("Wrong password")).toBeInTheDocument();
    await user.click(screen.getByText("Forgot password? Reset vault"));
    expect(handleVaultReset).toHaveBeenCalledTimes(1);
  });
});
