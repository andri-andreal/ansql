// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { makeQueryResult } from "../../test/fixtures";
import { WidgetEditor, type DashboardSessionOption } from "./WidgetEditor";

const SESSIONS: DashboardSessionOption[] = [
  { id: "s1", label: "Session One", databases: ["app", "analytics"], dialect: "postgres" },
  { id: "s2", label: "Session Two", databases: [], dialect: "mysql" },
];

function renderEditor(
  props: Partial<React.ComponentProps<typeof WidgetEditor>> = {}
) {
  const onSave = props.onSave ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  const executeQuery =
    props.executeQuery ?? vi.fn().mockResolvedValue(makeQueryResult());
  const result = renderWithProviders(
    <WidgetEditor
      sessions={SESSIONS}
      executeQuery={executeQuery}
      onSave={onSave}
      onCancel={onCancel}
      {...props}
    />
  );
  return { ...result, onSave, onCancel, executeQuery };
}

describe("WidgetEditor", () => {
  it("shows the 'New Widget' title and a disabled Save until required fields are set", () => {
    renderEditor();
    expect(screen.getByText("New Widget")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the 'Edit Widget' title and seeds fields when editing an existing widget", () => {
    renderEditor({
      initial: {
        id: "w1",
        title: "Signups",
        sessionId: "s1",
        query: "SELECT day, signups FROM t",
        chart: { type: "line", xColumn: "day", yColumns: ["signups"] },
        size: "lg",
      },
    });
    expect(screen.getByText("Edit Widget")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Signups")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("SELECT day, signups FROM t")
    ).toBeInTheDocument();
    // Seeded chart spec means the X/Y pickers render before re-running.
    expect(screen.getByText("X column")).toBeInTheDocument();
  });

  it("runs the query via executeQuery and reveals the X/Y column pickers", async () => {
    const executeQuery = vi.fn().mockResolvedValue(
      makeQueryResult({
        columns: [
          { name: "day", data_type: "date", nullable: false },
          { name: "signups", data_type: "int", nullable: false },
        ],
        rows: [{ day: "2026-01-01", signups: 5 }],
      })
    );
    const { user } = renderEditor({ executeQuery });

    // Before running, the picker prompt is shown.
    expect(
      screen.getByText("Run the query to load columns, then choose X and Y axes.")
    ).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText(/SELECT created_at/),
      "SELECT 1"
    );
    await user.click(screen.getByRole("button", { name: "Run to load columns" }));

    await waitFor(() => {
      expect(screen.getByText("X column")).toBeInTheDocument();
    });
    expect(executeQuery).toHaveBeenCalledWith("s1", "SELECT 1");
    // X defaults to first column; the second column is offered as a Y series.
    expect(screen.getByRole("button", { name: "signups" })).toBeInTheDocument();
  });

  it("surfaces a run error message when executeQuery rejects", async () => {
    const executeQuery = vi.fn().mockRejectedValue(new Error("boom"));
    const { user } = renderEditor({ executeQuery });

    await user.type(screen.getByPlaceholderText(/SELECT created_at/), "SELECT 1");
    await user.click(screen.getByRole("button", { name: "Run to load columns" }));

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeInTheDocument();
    });
  });

  it("builds the onSave payload from the chosen chart type, columns and size", async () => {
    const onSave = vi.fn();
    const executeQuery = vi.fn().mockResolvedValue(
      makeQueryResult({
        columns: [
          { name: "day", data_type: "date", nullable: false },
          { name: "signups", data_type: "int", nullable: false },
        ],
        rows: [{ day: "2026-01-01", signups: 5 }],
      })
    );
    const { user } = renderEditor({ onSave, executeQuery });

    await user.type(screen.getByPlaceholderText(/Signups per day/), "My chart");
    await user.type(screen.getByPlaceholderText(/SELECT created_at/), "SELECT 1");
    await user.click(screen.getByRole("button", { name: "Run to load columns" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "signups" })).toBeInTheDocument();
    });

    // Pick the "Line" chart type and Medium size.
    await user.click(screen.getByRole("button", { name: "Line" }));
    await user.selectOptions(
      screen.getByDisplayValue("Medium"),
      "lg"
    );

    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).not.toBeDisabled();
    await user.click(saveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      title: "My chart",
      sessionId: "s1",
      database: undefined,
      query: "SELECT 1",
      chart: { type: "line", xColumn: "day", yColumns: ["signups"] },
      size: "lg",
    });
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const { user } = renderEditor({ onCancel });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("toggling a Y series off blocks saving (Y columns required)", async () => {
    const onSave = vi.fn();
    const executeQuery = vi.fn().mockResolvedValue(
      makeQueryResult({
        columns: [
          { name: "day", data_type: "date", nullable: false },
          { name: "signups", data_type: "int", nullable: false },
        ],
        rows: [{ day: "x", signups: 5 }],
      })
    );
    const { user } = renderEditor({ onSave, executeQuery });

    await user.type(screen.getByPlaceholderText(/Signups per day/), "T");
    await user.type(screen.getByPlaceholderText(/SELECT created_at/), "SELECT 1");
    await user.click(screen.getByRole("button", { name: "Run to load columns" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "signups" })).toBeInTheDocument();
    });

    // Save enabled with the default Y selection, then toggle it off.
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: "signups" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
