// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "../../test/render";
import { makeQueryResult } from "../../test/fixtures";
import { ExecuteSqlFileModal } from "./ExecuteSqlFileModal";

function makeProps(
  overrides: Partial<React.ComponentProps<typeof ExecuteSqlFileModal>> = {},
) {
  const executeQuery = vi.fn().mockResolvedValue(makeQueryResult());
  const commitChanges = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  return {
    sessionId: "sess-1",
    executeQuery,
    commitChanges,
    onClose,
    ...overrides,
  };
}

describe("ExecuteSqlFileModal", () => {
  it("uses the default title and reflects a custom one", () => {
    const props = makeProps();
    const { unmount } = renderWithProviders(<ExecuteSqlFileModal {...props} />);
    expect(screen.getByText("Execute SQL File")).toBeInTheDocument();
    unmount();
    renderWithProviders(<ExecuteSqlFileModal {...props} title="Restore" />);
    expect(screen.getByText("Restore")).toBeInTheDocument();
  });

  it("keeps the statement count in sync with the pasted SQL and gates Run", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<ExecuteSqlFileModal {...props} />);

    expect(screen.getByText("0 statement(s)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();

    await user.type(
      screen.getByPlaceholderText("…or paste SQL here"),
      "SELECT 1; SELECT 2;",
    );
    expect(screen.getByText("2 statement(s)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("commits the whole batch in one transaction by default", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<ExecuteSqlFileModal {...props} />);

    await user.type(
      screen.getByPlaceholderText("…or paste SQL here"),
      "INSERT INTO a VALUES (1); INSERT INTO a VALUES (2);",
    );
    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() =>
      expect(
        screen.getByText("Committed 2 statement(s) in one transaction."),
      ).toBeInTheDocument(),
    );
    expect(props.commitChanges).toHaveBeenCalledTimes(1);
    const [sid, stmts] = vi.mocked(props.commitChanges).mock.calls[0];
    expect(sid).toBe("sess-1");
    expect(stmts).toHaveLength(2);
    expect(props.executeQuery).not.toHaveBeenCalled();
    expect(screen.getByText(/2 succeeded · 0 failed/)).toBeInTheDocument();
  });

  it("shows a rolled-back summary when the transaction commit fails", async () => {
    const props = makeProps();
    props.commitChanges = vi.fn().mockRejectedValue(new Error("constraint"));
    const { user } = renderWithProviders(<ExecuteSqlFileModal {...props} />);

    await user.type(
      screen.getByPlaceholderText("…or paste SQL here"),
      "BAD SQL;",
    );
    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() =>
      expect(screen.getByText(/Transaction rolled back/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/constraint/)).toBeInTheDocument();
  });

  it("runs sequentially and streams a per-statement ok log when transaction-wrap is off", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<ExecuteSqlFileModal {...props} />);

    // Turn off "Wrap in a single transaction" to enable sequential mode.
    await user.click(
      screen.getByRole("checkbox", { name: /Wrap in a single transaction/ }),
    );
    await user.type(
      screen.getByPlaceholderText("…or paste SQL here"),
      "SELECT 1; SELECT 2;",
    );
    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() =>
      expect(screen.getByText(/2 succeeded · 0 failed/)).toBeInTheDocument(),
    );
    expect(props.executeQuery).toHaveBeenCalledTimes(2);
    expect(props.commitChanges).not.toHaveBeenCalled();
  });

  it("stops on the first error in sequential mode when continue-on-error is off", async () => {
    const props = makeProps();
    props.executeQuery = vi
      .fn()
      .mockResolvedValueOnce(makeQueryResult())
      .mockRejectedValueOnce(new Error("syntax error"));
    const { user } = renderWithProviders(<ExecuteSqlFileModal {...props} />);

    await user.click(
      screen.getByRole("checkbox", { name: /Wrap in a single transaction/ }),
    );
    await user.type(
      screen.getByPlaceholderText("…or paste SQL here"),
      "SELECT 1; BOOM; SELECT 3;",
    );
    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() =>
      expect(
        screen.getByText("Stopped (continue on error is off)."),
      ).toBeInTheDocument(),
    );
    // Stopped after the 2nd statement; the 3rd never ran.
    expect(props.executeQuery).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/1 succeeded · 1 failed/)).toBeInTheDocument();
  });

  it("closes via the footer Close button", async () => {
    const props = makeProps();
    const { user } = renderWithProviders(<ExecuteSqlFileModal {...props} />);
    // Header X + footer button both label "Close"; click the footer one.
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    await user.click(closeButtons[closeButtons.length - 1]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
