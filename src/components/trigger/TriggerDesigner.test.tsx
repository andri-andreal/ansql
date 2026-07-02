// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor, within } from "../../test/render";
import { TriggerDesigner } from "./TriggerDesigner";

function baseProps() {
  return {
    mode: "create" as const,
    database: "appdb",
    dialect: "mysql" as const,
    table: "orders",
    tables: [{ name: "orders" }, { name: "users" }],
    executeQuery: vi.fn().mockResolvedValue(undefined),
    onApplied: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("TriggerDesigner", () => {
  it("renders the create title and an editable name input", async () => {
    const { user } = renderWithProviders(<TriggerDesigner {...baseProps()} />);

    expect(screen.getByText("New Trigger")).toBeInTheDocument();
    const name = screen.getByLabelText("Trigger name");
    await user.type(name, "trg_audit");
    expect(name).toHaveValue("trg_audit");
  });

  it("seeds the table from props and offers the table picker options", () => {
    renderWithProviders(<TriggerDesigner {...baseProps()} />);
    const tableSelect = screen.getByRole("combobox", { name: "Table" });
    // The table picker holds the provided tables and is seeded to "orders".
    expect(screen.getByRole("option", { name: "users" })).toBeInTheDocument();
    expect(tableSelect).toHaveValue("orders");
  });

  it("treats events as single-choice (radios) on MySQL", () => {
    renderWithProviders(<TriggerDesigner {...baseProps()} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    // INSERT is the default selected event.
    const insert = radios[0] as HTMLInputElement;
    expect(insert.checked).toBe(true);
  });

  it("keeps Save disabled until name is provided, then applies the built SQL", async () => {
    const props = baseProps();
    const { user } = renderWithProviders(<TriggerDesigner {...props} />);

    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Trigger name"), "trg_audit");
    expect(save).toBeEnabled();

    await user.click(save);

    // Confirmation modal appears with the CREATE TRIGGER preview.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: /Create trigger/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/CREATE TRIGGER/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(props.executeQuery).toHaveBeenCalledTimes(1));
    const sql = props.executeQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/CREATE TRIGGER/i);
    expect(sql).toContain("trg_audit");
    expect(sql).toContain("orders");
    await waitFor(() => expect(props.onApplied).toHaveBeenCalled());
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("surfaces an apply error and keeps the designer open", async () => {
    const props = baseProps();
    props.executeQuery = vi.fn().mockRejectedValue(new Error("boom"));
    const { user } = renderWithProviders(<TriggerDesigner {...props} />);

    await user.type(screen.getByLabelText("Trigger name"), "trg_x");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getAllByText("boom").length).toBeGreaterThan(0));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("cancel fires onClose without applying", async () => {
    const props = baseProps();
    const { user } = renderWithProviders(<TriggerDesigner {...props} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.executeQuery).not.toHaveBeenCalled();
  });

  it("offers a WHEN condition field on Postgres but not MySQL", () => {
    const { rerender } = renderWithProviders(
      <TriggerDesigner {...baseProps()} />,
    );
    expect(screen.queryByPlaceholderText("NEW.status <> OLD.status")).not.toBeInTheDocument();

    rerender(<TriggerDesigner {...baseProps()} dialect="postgres" />);
    expect(screen.getByPlaceholderText("NEW.status <> OLD.status")).toBeInTheDocument();
  });
});
