// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../test/render";
import type { TableOptions } from "../../types";
import { OptionsEditor } from "./OptionsEditor";

const EMPTY: TableOptions = {
  engine: null,
  charset: null,
  collation: null,
  comment: null,
  autoIncrement: null,
  rowFormat: null,
};

describe("OptionsEditor", () => {
  it("renders a SQLite notice and no controls", () => {
    renderWithProviders(
      <OptionsEditor options={EMPTY} onChange={() => {}} dialect="sqlite" />,
    );
    expect(screen.getByText("No table options for SQLite")).toBeInTheDocument();
    expect(screen.queryByLabelText("Storage engine")).not.toBeInTheDocument();
  });

  it("shows only the comment field for Postgres (no MySQL engine fields)", () => {
    renderWithProviders(
      <OptionsEditor options={EMPTY} onChange={() => {}} dialect="postgres" />,
    );
    expect(screen.getByLabelText("Table comment")).toBeInTheDocument();
    expect(screen.queryByLabelText("Storage engine")).not.toBeInTheDocument();
  });

  it("exposes the MySQL engine/charset/collation/row-format fields", () => {
    renderWithProviders(
      <OptionsEditor options={EMPTY} onChange={() => {}} dialect="mysql" />,
    );
    expect(screen.getByLabelText("Storage engine")).toBeInTheDocument();
    expect(screen.getByLabelText("Row format")).toBeInTheDocument();
    expect(screen.getByLabelText("Default character set")).toBeInTheDocument();
    expect(screen.getByLabelText("Collation")).toBeInTheDocument();
    expect(screen.getByLabelText("AUTO_INCREMENT start value")).toBeInTheDocument();
    expect(screen.getByLabelText("Table comment")).toBeInTheDocument();
  });

  it("patches the engine when a MySQL engine is selected", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <OptionsEditor options={EMPTY} onChange={onChange} dialect="mysql" />,
    );

    await user.selectOptions(screen.getByLabelText("Storage engine"), "InnoDB");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "InnoDB" }),
    );
  });

  it("parses AUTO_INCREMENT to a number and resets to null when cleared", async () => {
    const onChange = vi.fn();
    const { user, rerender } = renderWithProviders(
      <OptionsEditor options={EMPTY} onChange={onChange} dialect="mysql" />,
    );

    const ai = screen.getByLabelText("AUTO_INCREMENT start value");
    await user.type(ai, "5");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoIncrement: 5 }),
    );

    onChange.mockClear();
    rerender(
      <OptionsEditor
        options={{ ...EMPTY, autoIncrement: 5 }}
        onChange={onChange}
        dialect="mysql"
      />,
    );
    await user.clear(screen.getByLabelText("AUTO_INCREMENT start value"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ autoIncrement: null }),
    );
  });

  it("writes the comment text and nulls it when emptied", async () => {
    const onChange = vi.fn();
    const { user, rerender } = renderWithProviders(
      <OptionsEditor options={EMPTY} onChange={onChange} dialect="postgres" />,
    );

    // Controlled textarea: each keystroke patches from the (stale) empty
    // options, so type a single char and assert that patch fired.
    await user.type(screen.getByLabelText("Table comment"), "x");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ comment: "x" }),
    );

    // An empty value nulls the comment.
    onChange.mockClear();
    rerender(
      <OptionsEditor
        options={{ ...EMPTY, comment: "x" }}
        onChange={onChange}
        dialect="postgres"
      />,
    );
    await user.clear(screen.getByLabelText("Table comment"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ comment: null }),
    );
  });
});
