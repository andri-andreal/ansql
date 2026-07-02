// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

import { renderWithProviders, screen, within, waitFor } from "@/test/render";
import { EventDesigner, type EventDesignerProps } from "./EventDesigner";

function baseProps(overrides: Partial<EventDesignerProps> = {}): EventDesignerProps {
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

/** The live preview pane is the first <pre> rendered (the modal pre comes later). */
function previewSql(): string {
  const pres = document.querySelectorAll("pre");
  return pres[0]?.textContent ?? "";
}

describe("EventDesigner", () => {
  it("renders the create title and keeps Save disabled until a name is provided", async () => {
    const { user } = renderWithProviders(<EventDesigner {...baseProps()} />);

    expect(screen.getByText("New Event")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeDisabled();
    expect(screen.getByText("Event name is empty.")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Event name" }), "nightly_cleanup");
    await waitFor(() => expect(save).toBeEnabled());
  });

  it("builds CREATE EVENT … EVERY n UNIT DDL from the recurring schedule fields", async () => {
    const { user } = renderWithProviders(<EventDesigner {...baseProps()} />);

    await user.type(screen.getByRole("textbox", { name: "Event name" }), "nightly_cleanup");

    // Default schedule is EVERY 1 DAY; change to EVERY 2 HOUR.
    const everyValue = screen.getByRole("spinbutton");
    await user.clear(everyValue);
    await user.type(everyValue, "2");

    // Second combobox is the interval unit (first is the schedule kind).
    await user.selectOptions(screen.getAllByRole("combobox")[1], "HOUR");

    await waitFor(() => {
      const sql = previewSql();
      expect(sql).toContain("CREATE EVENT IF NOT EXISTS");
      expect(sql).toContain("`nightly_cleanup`");
      expect(sql).toContain("ON SCHEDULE EVERY 2 HOUR");
      expect(sql).toContain("ENABLE");
      // The body template seeds the DO clause.
      expect(sql).toContain("DO");
    });
  });

  it("switches to AT scheduling and requires the timestamp before Save enables", async () => {
    const { user } = renderWithProviders(<EventDesigner {...baseProps()} />);

    await user.type(screen.getByRole("textbox", { name: "Event name" }), "one_shot");

    // Schedule kind select is the first combobox.
    await user.selectOptions(screen.getAllByRole("combobox")[0], "at");

    const save = screen.getByRole("button", { name: /Save/ });
    // AT timestamp is empty → save blocked, warning shown.
    expect(save).toBeDisabled();
    expect(
      screen.getByText(/Provide the AT timestamp/),
    ).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("2026-07-01 00:00:00"),
      "2026-07-01 00:00:00",
    );

    await waitFor(() => expect(save).toBeEnabled());
    await waitFor(() =>
      expect(previewSql()).toContain("ON SCHEDULE AT '2026-07-01 00:00:00'"),
    );
  });

  it("emits DISABLE and a COMMENT clause when toggled/filled", async () => {
    const { user } = renderWithProviders(<EventDesigner {...baseProps()} />);

    await user.type(screen.getByRole("textbox", { name: "Event name" }), "nightly_cleanup");

    // Untick Enabled.
    await user.click(screen.getByRole("checkbox"));
    await user.type(screen.getByPlaceholderText("What this event does…"), "runs nightly");

    await waitFor(() => {
      const sql = previewSql();
      expect(sql).toContain("DISABLE");
      expect(sql).not.toContain("ENABLE");
      expect(sql).toContain("COMMENT 'runs nightly'");
    });
  });

  it("runs the built statement through executeQuery and calls onApplied + onClose", async () => {
    const executeQuery = vi.fn().mockResolvedValue(undefined);
    const onApplied = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <EventDesigner {...baseProps({ executeQuery, onApplied, onClose })} />,
    );

    await user.type(screen.getByRole("textbox", { name: "Event name" }), "nightly_cleanup");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Create event/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Create/ }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(executeQuery.mock.calls[0][0]).toContain("CREATE EVENT IF NOT EXISTS");
  });

  it("uses ALTER EVENT DDL in edit mode and shows the existing name", async () => {
    const { user } = renderWithProviders(
      <EventDesigner {...baseProps({ mode: "edit", existing: { name: "legacy_evt" } })} />,
    );

    expect(screen.getByText("Edit Event: legacy_evt")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toBeEnabled();
    await user.click(save);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Update event/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ALTER EVENT/)).toBeInTheDocument();
    expect(within(dialog).getByText(/`legacy_evt`/)).toBeInTheDocument();
  });
});
