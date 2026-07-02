// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import type { DesignerUnique } from "../../types";
import { UniquesEditor } from "./UniquesEditor";

const COLS = ["id", "email", "tenant_id"];

function makeUnique(over: Partial<DesignerUnique> = {}): DesignerUnique {
  return { id: "u1", name: "uq_email", columns: ["email"], ...over };
}

describe("UniquesEditor", () => {
  it("shows the empty state when there are no uniques", () => {
    renderWithProviders(
      <UniquesEditor uniques={[]} availableColumns={COLS} onChange={() => {}} />,
    );
    expect(screen.getByText("No unique constraints")).toBeInTheDocument();
  });

  it("adds a unique with the default name and no columns", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <UniquesEditor uniques={[]} availableColumns={COLS} onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: "+ Add unique" }));

    const next = onChange.mock.calls[0][0] as DesignerUnique[];
    expect(next[0]).toMatchObject({ name: "uq_new", columns: [] });
  });

  it("toggles a column on via its chip", async () => {
    const onChange = vi.fn();
    const uq = makeUnique({ columns: ["email"] });
    const { user } = renderWithProviders(
      <UniquesEditor uniques={[uq]} availableColumns={COLS} onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: "tenant_id" }));

    const next = onChange.mock.calls[0][0] as DesignerUnique[];
    expect(next[0].columns).toEqual(["email", "tenant_id"]);
  });

  it("toggles a column off when it is already selected", async () => {
    const onChange = vi.fn();
    const uq = makeUnique({ columns: ["email", "tenant_id"] });
    const { user } = renderWithProviders(
      <UniquesEditor uniques={[uq]} availableColumns={COLS} onChange={onChange} />,
    );

    await user.click(screen.getByRole("button", { name: "email" }));

    const next = onChange.mock.calls[0][0] as DesignerUnique[];
    expect(next[0].columns).toEqual(["tenant_id"]);
  });

  it("marks selected column chips as pressed and lists the summary", () => {
    renderWithProviders(
      <UniquesEditor
        uniques={[makeUnique({ columns: ["email", "id"] })]}
        availableColumns={COLS}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "email" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "tenant_id" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("email, id")).toBeInTheDocument();
  });

  it("falls back to a no-columns message when none are available", () => {
    renderWithProviders(
      <UniquesEditor
        uniques={[makeUnique({ columns: [] })]}
        availableColumns={[]}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByText("No columns available — add columns first."),
    ).toBeInTheDocument();
  });
});
