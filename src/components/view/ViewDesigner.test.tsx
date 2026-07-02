// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor, within } from "../../test/render";
import { ViewDesigner } from "./ViewDesigner";

function baseProps() {
  return {
    mode: "create" as const,
    dialect: "postgres" as const,
    database: "appdb",
    schema: "public",
    onApply: vi.fn().mockResolvedValue(undefined),
    onApplied: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("ViewDesigner", () => {
  it("renders the create title and an editable view name", async () => {
    const { user } = renderWithProviders(<ViewDesigner {...baseProps()} />);
    expect(screen.getByText("New View")).toBeInTheDocument();
    const name = screen.getByLabelText("View name");
    await user.type(name, "active_users");
    expect(name).toHaveValue("active_users");
  });

  it("keeps Save disabled while the body is empty", () => {
    renderWithProviders(<ViewDesigner {...baseProps()} />);
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
  });

  it("offers the materialized toggle on Postgres but not MySQL", () => {
    const { rerender } = renderWithProviders(<ViewDesigner {...baseProps()} />);
    expect(screen.getByText("Materialized")).toBeInTheDocument();

    rerender(<ViewDesigner {...baseProps()} dialect="mysql" database="appdb" />);
    expect(screen.queryByText("Materialized")).not.toBeInTheDocument();
  });

  it("cancel fires onClose without applying", async () => {
    const props = baseProps();
    const { user } = renderWithProviders(<ViewDesigner {...props} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("in edit mode it applies CREATE OR REPLACE statements built from the seed body", async () => {
    const props = baseProps();
    const { user } = renderWithProviders(
      <ViewDesigner
        {...props}
        mode="edit"
        viewName="active_users"
        initialBody="SELECT * FROM users WHERE active"
      />,
    );

    expect(screen.getByText("Edit View: active_users")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeEnabled();
    await user.click(save);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/SELECT \* FROM users/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Update" }));

    await waitFor(() => expect(props.onApply).toHaveBeenCalledTimes(1));
    const statements = props.onApply.mock.calls[0][0] as { sql: string }[];
    expect(statements.some((s) => /CREATE OR REPLACE VIEW/i.test(s.sql))).toBe(true);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("disables Preview when no executeQuery is supplied", () => {
    renderWithProviders(
      <ViewDesigner
        {...baseProps()}
        mode="edit"
        viewName="v"
        initialBody="SELECT 1"
      />,
    );
    expect(screen.getByRole("button", { name: /Preview/ })).toBeDisabled();
  });
});
