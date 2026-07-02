// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { makeQueryResult } from "../../test/fixtures";
import { DashboardView } from "./DashboardView";
import type { DashboardSessionOption } from "./WidgetEditor";

const SESSIONS: DashboardSessionOption[] = [
  { id: "s1", label: "Session One", databases: ["app"], dialect: "postgres" },
];

function renderView(props: Partial<React.ComponentProps<typeof DashboardView>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const executeQuery =
    props.executeQuery ?? vi.fn().mockResolvedValue(makeQueryResult());
  const result = renderWithProviders(
    <DashboardView
      sessions={SESSIONS}
      executeQuery={executeQuery}
      onClose={onClose}
      {...props}
    />
  );
  return { ...result, onClose, executeQuery };
}

describe("DashboardView", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the empty state when there are no dashboards", () => {
    renderView();
    expect(screen.getByText("No dashboards yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create a dashboard to start adding chart widgets.")
    ).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const { user } = renderView({ onClose });
    await user.click(screen.getByRole("button", { name: "Close dashboards" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Drive the useDialogs() prompt: clear the prefilled input, type a name, and
  // confirm via the default "OK" button rendered by DialogProvider.
  async function answerPrompt(
    user: ReturnType<typeof renderView>["user"],
    name: string,
  ) {
    const input = await screen.findByRole("textbox");
    await user.clear(input);
    await user.type(input, name);
    await user.click(screen.getByRole("button", { name: "OK" }));
  }

  it("creates a dashboard via the name prompt and shows its no-widgets state", async () => {
    const { user } = renderView();

    await user.click(screen.getByRole("button", { name: "New dashboard" }));
    await answerPrompt(user, "Sales");

    await waitFor(() => {
      expect(screen.getByText('"Sales" has no widgets')).toBeInTheDocument();
    });
    expect(
      screen.getByText("Add a widget to visualize a query as a chart.")
    ).toBeInTheDocument();
  });

  it("does not create a dashboard when the prompt is cancelled", async () => {
    const { user } = renderView();
    await user.click(screen.getByRole("button", { name: "New dashboard" }));
    await screen.findByRole("textbox");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("No dashboards yet")).toBeInTheDocument();
  });

  it("opens the widget editor when 'Add widget' is clicked on an active dashboard", async () => {
    const { user } = renderView();

    await user.click(screen.getByRole("button", { name: "New dashboard" }));
    await answerPrompt(user, "Sales");
    await waitFor(() => {
      expect(screen.getByText('"Sales" has no widgets')).toBeInTheDocument();
    });

    // The empty-state CTA is labelled "Add widget".
    await user.click(screen.getAllByRole("button", { name: "Add widget" })[0]);

    expect(screen.getByText("New Widget")).toBeInTheDocument();
    expect(screen.getByText("Chart type")).toBeInTheDocument();
  });
});
