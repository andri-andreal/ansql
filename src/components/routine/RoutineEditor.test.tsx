// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor, within } from "../../test/render";
import { RoutineEditor } from "./RoutineEditor";

function baseProps() {
  return {
    mode: "create" as const,
    dialect: "postgres" as const,
    database: "appdb",
    schema: "public",
    kind: "function" as const,
    runQuery: vi.fn().mockResolvedValue(undefined),
    onApplied: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("RoutineEditor", () => {
  it("renders the create title and the kind toggle group", () => {
    renderWithProviders(<RoutineEditor {...baseProps()} />);
    expect(screen.getByText("New Function")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Routine kind" });
    expect(within(group).getByRole("button", { name: "function" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "procedure" })).toBeInTheDocument();
  });

  it("lets the user edit the routine name", async () => {
    const { user } = renderWithProviders(<RoutineEditor {...baseProps()} />);
    const name = screen.getByLabelText("Routine name");
    await user.type(name, "calc_total");
    expect(name).toHaveValue("calc_total");
  });

  it("shows the no-parameters hint and adds a parameter row", async () => {
    const { user } = renderWithProviders(<RoutineEditor {...baseProps()} />);
    expect(
      screen.getByText(/No parameters\. Add rows/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add parameter" }));

    expect(screen.getByLabelText("Parameter 1 mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Parameter 1 name")).toBeInTheDocument();
  });

  it("removes a parameter row", async () => {
    const { user } = renderWithProviders(<RoutineEditor {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    expect(screen.getByLabelText("Parameter 1 name")).toBeInTheDocument();

    // The per-row remove button has no accessible name; grab the row's last button.
    const row = screen.getByLabelText("Parameter 1 name").closest("div")!;
    const buttons = within(row).getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);

    expect(screen.queryByLabelText("Parameter 1 name")).not.toBeInTheDocument();
    expect(screen.getByText(/No parameters\. Add rows/)).toBeInTheDocument();
  });

  it("applies the verbatim body via runQuery and closes", async () => {
    const props = baseProps();
    const { user } = renderWithProviders(<RoutineEditor {...props} />);

    // Body is seeded from the template (non-empty), so Save is enabled.
    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeEnabled();
    await user.click(save);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: /Create function/i })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(props.runQuery).toHaveBeenCalledTimes(1));
    const sql = props.runQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/);
    await waitFor(() => expect(props.onApplied).toHaveBeenCalled());
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("cancel fires onClose without running anything", async () => {
    const props = baseProps();
    const { user } = renderWithProviders(<RoutineEditor {...props} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.runQuery).not.toHaveBeenCalled();
  });

  it("switching kind to procedure updates the title", async () => {
    const { user } = renderWithProviders(<RoutineEditor {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: "procedure" }));
    expect(screen.getByText("New Procedure")).toBeInTheDocument();
  });

  it("offers an Execute action in edit mode", () => {
    renderWithProviders(
      <RoutineEditor
        {...baseProps()}
        mode="edit"
        routineName="calc_total"
        initialBody="CREATE OR REPLACE FUNCTION calc_total() ..."
      />,
    );
    expect(screen.getByRole("button", { name: /Execute/ })).toBeInTheDocument();
    expect(screen.getByText("Edit Function: calc_total")).toBeInTheDocument();
  });
});
