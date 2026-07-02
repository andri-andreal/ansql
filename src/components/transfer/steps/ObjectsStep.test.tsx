// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../../test/render";
import { ObjectsStep, type TransferObjectSel } from "./ObjectsStep";

const views: TransferObjectSel[] = [
  { kind: "view", name: "active_users", schema: null, selected: false },
];
const routines: TransferObjectSel[] = [
  {
    kind: "routine",
    name: "sp_recount",
    schema: "public",
    routineKind: "procedure",
    selected: false,
  },
];

describe("ObjectsStep", () => {
  it("shows a loading hint while loading", () => {
    renderWithProviders(
      <ObjectsStep
        views={[]}
        routines={[]}
        triggers={[]}
        onChange={vi.fn()}
        loading
      />,
    );
    expect(screen.getByText("Loading objects…")).toBeInTheDocument();
  });

  it("renders sections with selected/total counts", () => {
    renderWithProviders(
      <ObjectsStep
        views={views}
        routines={routines}
        triggers={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Views")).toBeInTheDocument();
    expect(screen.getByText("Functions & Procedures")).toBeInTheDocument();
    // Routine label includes its schema-qualified name + kind.
    expect(screen.getByText("public.sp_recount (procedure)")).toBeInTheDocument();
    // Empty triggers section shows "None".
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("selecting a view checkbox emits the updated view list", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ObjectsStep
        views={views}
        routines={routines}
        triggers={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText("active_users"));
    expect(onChange).toHaveBeenCalledWith("view", [
      { ...views[0], selected: true },
    ]);
  });

  it("Select all flips every item in a section to selected", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <ObjectsStep
        views={views}
        routines={[]}
        triggers={[]}
        onChange={onChange}
      />,
    );
    // The Views section header has the per-section Select all button.
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(onChange).toHaveBeenCalledWith("view", [
      { ...views[0], selected: true },
    ]);
  });
});
