// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

import { renderWithProviders, screen, within, waitFor } from "@/test/render";
import { SequenceDesigner, type SequenceDesignerProps } from "./SequenceDesigner";

function baseProps(overrides: Partial<SequenceDesignerProps> = {}): SequenceDesignerProps {
  return {
    mode: "create",
    sessionId: "s1",
    database: "shop",
    executeQuery: vi.fn().mockResolvedValue(undefined),
    onApplied: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

/** The live preview pane is the only <pre> in the body before the modal opens. */
function previewSql(): string {
  const pres = document.querySelectorAll("pre");
  return pres[0]?.textContent ?? "";
}

describe("SequenceDesigner", () => {
  it("renders the create title and disables Save until a name is typed", async () => {
    const { user } = renderWithProviders(<SequenceDesigner {...baseProps()} />);

    expect(screen.getByText("New Sequence")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeDisabled();
    // The empty-name warning is surfaced in the preview pane.
    expect(screen.getByText("Sequence name is empty.")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Sequence name" }), "order_id_seq");
    await waitFor(() => expect(save).toBeEnabled());
  });

  it("builds CREATE SEQUENCE DDL with default increment/cache and NO CYCLE", async () => {
    const { user } = renderWithProviders(<SequenceDesigner {...baseProps()} />);

    await user.type(screen.getByRole("textbox", { name: "Sequence name" }), "order_id_seq");

    await waitFor(() => {
      const sql = previewSql();
      expect(sql).toContain("CREATE SEQUENCE IF NOT EXISTS");
      expect(sql).toContain('"order_id_seq"');
      expect(sql).toContain("INCREMENT BY 1");
      expect(sql).toContain("CACHE 1");
      expect(sql).toContain("NO CYCLE");
    });
  });

  it("reflects edited optional fields (min/max/start) and the Cycle toggle in the DDL", async () => {
    const { user } = renderWithProviders(<SequenceDesigner {...baseProps()} />);

    await user.type(screen.getByRole("textbox", { name: "Sequence name" }), "ticket_seq");

    // Optional numeric fields are number inputs labelled via their <label> text.
    const startInput = screen.getByPlaceholderText("(default)");
    const minInput = screen.getByPlaceholderText("NO MINVALUE");
    const maxInput = screen.getByPlaceholderText("NO MAXVALUE");

    await user.type(startInput, "100");
    await user.type(minInput, "10");
    await user.type(maxInput, "9999");
    await user.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      const sql = previewSql();
      expect(sql).toContain("MINVALUE 10");
      expect(sql).toContain("MAXVALUE 9999");
      expect(sql).toContain("START WITH 100");
      expect(sql).toContain("CYCLE");
      expect(sql).not.toContain("NO CYCLE");
    });
  });

  it("runs every built statement through executeQuery and fires onApplied + onClose on confirm", async () => {
    const executeQuery = vi.fn().mockResolvedValue(undefined);
    const onApplied = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <SequenceDesigner {...baseProps({ executeQuery, onApplied, onClose })} />,
    );

    await user.type(screen.getByRole("textbox", { name: "Sequence name" }), "order_id_seq");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Create sequence/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Create/ }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(executeQuery.mock.calls[0][0]).toContain("CREATE SEQUENCE IF NOT EXISTS");
  });

  it("surfaces the error and keeps the designer open when executeQuery throws", async () => {
    const executeQuery = vi.fn().mockRejectedValue(new Error("permission denied"));
    const onApplied = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <SequenceDesigner {...baseProps({ executeQuery, onApplied, onClose })} />,
    );

    await user.type(screen.getByRole("textbox", { name: "Sequence name" }), "order_id_seq");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /Create/ }));

    await waitFor(() =>
      expect(screen.getAllByText("permission denied").length).toBeGreaterThan(0),
    );
    expect(onApplied).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses ALTER SEQUENCE DDL in edit mode and seeds the existing name", async () => {
    const { user } = renderWithProviders(
      <SequenceDesigner
        {...baseProps({ mode: "edit", existing: { name: "legacy_seq" } })}
      />,
    );

    // In edit mode the name is fixed (shown, not an input) so Save is enabled.
    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeEnabled();

    await user.click(save);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Update sequence/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ALTER SEQUENCE/)).toBeInTheDocument();
    expect(within(dialog).getByText(/"legacy_seq"/)).toBeInTheDocument();
  });
});
