// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/test/render";
import { Dropdown, DropdownItem } from "./Dropdown";

describe("Dropdown", () => {
  it("is closed initially and opens the menu on trigger click", async () => {
    const { user } = renderWithProviders(
      <Dropdown trigger={<button type="button">Open</button>}>
        <DropdownItem>Item A</DropdownItem>
      </Dropdown>,
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Item A" })).toBeInTheDocument();
  });

  it("reflects open state via aria-expanded on the trigger", async () => {
    const { user } = renderWithProviders(
      <Dropdown trigger={<button type="button">Menu</button>}>
        <DropdownItem>X</DropdownItem>
      </Dropdown>,
    );
    const trigger = screen.getByRole("button", { name: "Menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape", async () => {
    const { user } = renderWithProviders(
      <Dropdown trigger={<button type="button">Menu</button>}>
        <DropdownItem>X</DropdownItem>
      </Dropdown>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("passes a close callback to a render-prop child", async () => {
    const { user } = renderWithProviders(
      <Dropdown trigger={<button type="button">Menu</button>}>
        {(close) => (
          <DropdownItem onClick={close}>Close me</DropdownItem>
        )}
      </Dropdown>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Close me" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("still calls the trigger's own onClick when opening", async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <Dropdown trigger={<button type="button" onClick={onClick}>Menu</button>}>
        <DropdownItem>X</DropdownItem>
      </Dropdown>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("DropdownItem", () => {
  it("fires onClick when enabled", async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <DropdownItem onClick={onClick}>Run</DropdownItem>,
    );
    await user.click(screen.getByRole("menuitem", { name: "Run" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled and does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <DropdownItem onClick={onClick} disabled>
        Run
      </DropdownItem>,
    );
    const item = screen.getByRole("menuitem", { name: "Run" });
    expect(item).toBeDisabled();
    await user.click(item);
    expect(onClick).not.toHaveBeenCalled();
  });
});
