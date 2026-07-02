// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within } from "../../test/render";
import type { DesignerCheck } from "../../types";
import { ChecksEditor } from "./ChecksEditor";

function makeCheck(over: Partial<DesignerCheck> = {}): DesignerCheck {
  return { id: "c1", name: "chk_age", expression: "age > 0", ...over };
}

describe("ChecksEditor", () => {
  it("shows the empty-state message when there are no checks", () => {
    renderWithProviders(
      <ChecksEditor checks={[]} onChange={() => {}} dialect="postgres" />,
    );
    expect(screen.getByText("No check constraints")).toBeInTheDocument();
  });

  it("adds a new check with a default name and empty expression", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ChecksEditor checks={[]} onChange={onChange} dialect="postgres" />,
    );

    await user.click(screen.getByRole("button", { name: "+ Add check" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as DesignerCheck[];
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ name: "chk_new", expression: "" });
  });

  it("renders existing rows and edits the expression", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ChecksEditor checks={[makeCheck()]} onChange={onChange} dialect="postgres" />,
    );

    const nameInput = screen.getByLabelText("Check constraint name");
    expect(nameInput).toHaveValue("chk_age");

    const exprInput = screen.getByLabelText("Check expression");
    await user.type(exprInput, "!");

    // Controlled input -> onChange called with the patched expression.
    const calls = onChange.mock.calls;
    const last = calls[calls.length - 1][0] as DesignerCheck[];
    expect(last[0].expression).toBe("age > 0!");
  });

  it("removes a row by id", async () => {
    const onChange = vi.fn();
    const checks = [makeCheck({ id: "a" }), makeCheck({ id: "b", name: "chk_b" })];
    const { user } = renderWithProviders(
      <ChecksEditor checks={checks} onChange={onChange} dialect="postgres" />,
    );

    const removeButtons = screen.getAllByRole("button", {
      name: "Remove check constraint",
    });
    await user.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledWith([checks[1]]);
  });

  it("renders a name input per check row", () => {
    renderWithProviders(
      <ChecksEditor
        checks={[makeCheck({ id: "a" }), makeCheck({ id: "b", name: "chk_b" })]}
        onChange={() => {}}
        dialect="mysql"
      />,
    );
    const names = screen.getAllByLabelText("Check constraint name");
    expect(names).toHaveLength(2);
    expect(within(names[1].parentElement!).getByDisplayValue("chk_b")).toBeInTheDocument();
  });
});
