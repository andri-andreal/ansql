// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, within } from "../../test/render";
import { makeColumn } from "../../test/fixtures";
import { FormView } from "./FormView";

const columns = [
  makeColumn({ name: "id", full_type: "int", is_primary_key: true, nullable: false }),
  makeColumn({ name: "bio", full_type: "text", is_primary_key: false, nullable: true }),
];

function renderForm(over: Partial<React.ComponentProps<typeof FormView>> = {}) {
  const onNavigate = vi.fn();
  const onEdit = vi.fn();
  const result = renderWithProviders(
    <FormView
      columns={columns}
      values={{ id: 1, bio: "hello" }}
      rowLabel="Record 3 of 120"
      canPrev
      canNext
      onNavigate={onNavigate}
      onEdit={onEdit}
      {...over}
    />,
  );
  return { ...result, onNavigate, onEdit };
}

describe("FormView", () => {
  it("renders one labeled field per column with the row label and PK badge", () => {
    renderForm();
    expect(screen.getByText("Record 3 of 120")).toBeInTheDocument();
    // PK column shows the PK badge and NOT NULL marker.
    expect(screen.getByText("PK")).toBeInTheDocument();
    expect(screen.getByText("NOT NULL")).toBeInTheDocument();
    expect(screen.getByText("NULL")).toBeInTheDocument();
    // Single-line input for int, multi-line textarea for text.
    expect((screen.getByLabelText("id") as HTMLInputElement).value).toBe("1");
    const bio = screen.getByLabelText("bio");
    expect(bio.tagName).toBe("TEXTAREA");
    expect((bio as HTMLTextAreaElement).value).toBe("hello");
  });

  it("routes a typed edit through onEdit with the column name", async () => {
    const { user, onEdit } = renderForm();
    await user.type(screen.getByLabelText("bio"), "!");
    // The last onEdit call carries the bio column and the appended char.
    const calls = onEdit.mock.calls;
    const last = calls[calls.length - 1];
    expect(last[0]).toBe("bio");
    expect(last[1]).toBe("hello!");
  });

  it("fires onNavigate with the correct direction for each nav button", async () => {
    const { user, onNavigate } = renderForm();
    await user.click(screen.getByTitle("First record"));
    await user.click(screen.getByTitle("Previous record"));
    await user.click(screen.getByTitle("Next record"));
    await user.click(screen.getByTitle("Last record"));
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual([
      "first",
      "prev",
      "next",
      "last",
    ]);
  });

  it("disables nav buttons when canPrev/canNext are false", () => {
    renderForm({ canPrev: false, canNext: false });
    expect(screen.getByTitle("First record")).toBeDisabled();
    expect(screen.getByTitle("Previous record")).toBeDisabled();
    expect(screen.getByTitle("Next record")).toBeDisabled();
    expect(screen.getByTitle("Last record")).toBeDisabled();
  });

  it("emits null via the Set NULL button and shows the (NULL) state", () => {
    const { onEdit } = renderForm({ values: { id: null, bio: "hi" } });
    // id is null -> the input is empty, shows (NULL) placeholder text.
    expect((screen.getByLabelText("id") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("(NULL)")).toBeInTheDocument();
    // The Set NULL button on the bio row (which is non-null) should be enabled.
    const setNullButtons = screen.getAllByRole("button", { name: "Set NULL" });
    // bio field is non-null -> its Set NULL button is enabled.
    const bioRow = screen.getByLabelText("bio").closest("div");
    const bioSetNull = within(bioRow!.parentElement!).getByRole("button", {
      name: "Set NULL",
    });
    expect(bioSetNull).not.toBeDisabled();
    bioSetNull.click();
    expect(onEdit).toHaveBeenCalledWith("bio", null);
    expect(setNullButtons.length).toBe(2);
  });

  it("highlights dirty columns with the 'edited' marker", () => {
    renderForm({ dirtyColumns: new Set(["bio"]) });
    expect(screen.getByText("edited")).toBeInTheDocument();
  });
});
