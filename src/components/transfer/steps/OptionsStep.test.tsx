// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "../../../test/render";
import type { TransferOptions } from "../../../types";
import { OptionsStep } from "./OptionsStep";

const baseOptions: TransferOptions = {
  copy_structure: true,
  copy_data: true,
  copy_indexes: true,
  copy_fks: true,
  batch_size: 500,
  error_policy: "table_atomic_continue",
};

describe("OptionsStep", () => {
  it("renders the copy toggles and current batch size", () => {
    renderWithProviders(<OptionsStep value={baseOptions} onChange={vi.fn()} />);
    expect(screen.getByText("Copy structure")).toBeInTheDocument();
    expect(screen.getByText("Copy data")).toBeInTheDocument();
    expect(screen.getByText("Copy indexes")).toBeInTheDocument();
    expect(screen.getByText("Copy fks")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(500);
  });

  it("toggles copy_data off when its checkbox is unchecked", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <OptionsStep value={baseOptions} onChange={onChange} />,
    );
    await user.click(screen.getByLabelText("Copy data"));
    expect(onChange).toHaveBeenCalledWith({ ...baseOptions, copy_data: false });
  });

  it("changes the error policy via the select", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <OptionsStep value={baseOptions} onChange={onChange} />,
    );
    await user.selectOptions(
      screen.getByRole("combobox"),
      "Stop on first error",
    );
    expect(onChange).toHaveBeenCalledWith({
      ...baseOptions,
      error_policy: "stop_on_error",
    });
  });

  it("falls back to 500 when the batch size is cleared to empty", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <OptionsStep value={baseOptions} onChange={onChange} />,
    );
    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    // Empty string → Number("") is 0 → `|| 500` → Math.max(1, 500) = 500.
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.batch_size).toBe(500);
  });
});
