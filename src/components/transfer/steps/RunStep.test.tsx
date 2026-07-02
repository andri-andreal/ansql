// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { installFakeBackend } from "@/test/fakeBackend";
import { RunStep } from "./RunStep";
import type { TransferJob, TransferOptions, TransferReport } from "@/types";
import type { ObjectCopyResult } from "@/lib/objectTransfer";

const job: TransferJob = {
  source_table: "users",
  source_schema: null,
  target_db: "app",
  target_schema: null,
  target_table: "users",
  conflict: "skip",
  source_query: null,
};

const options: TransferOptions = {
  copy_structure: true,
  copy_data: true,
  copy_indexes: true,
  copy_fks: true,
  batch_size: 500,
  error_policy: "stop_on_error",
};

function report(): TransferReport {
  return {
    tables: [
      { table: "users", status: "success", rows_copied: 42, skipped: 0, error: null },
    ],
    warnings: [],
  };
}

describe("RunStep", () => {
  it("renders the title, start button, and a queued progress row per job", () => {
    installFakeBackend();
    renderWithProviders(
      <RunStep sourceSession="s" targetSession="t" jobs={[job]} options={options} />
    );
    expect(screen.getByText("Run transfer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start transfer" })).toBeInTheDocument();
    // job listed, queued before any run
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
  });

  it("runs the transfer and renders the result list from the report", async () => {
    const fake = installFakeBackend();
    fake.on("run_transfer", () => report());
    const { user } = renderWithProviders(
      <RunStep sourceSession="s" targetSession="t" jobs={[job]} options={options} />
    );

    await user.click(screen.getByRole("button", { name: "Start transfer" }));

    await waitFor(() => expect(screen.getByText("Result")).toBeInTheDocument());
    expect(screen.getByText(/users — 42 rows/)).toBeInTheDocument();

    const call = fake.calls.find((c) => c.cmd === "run_transfer");
    expect(call).toBeTruthy();
    expect(call!.args.sourceSession).toBe("s");
    expect(call!.args.targetSession).toBe("t");
  });

  it("renders warnings from the report", async () => {
    const fake = installFakeBackend();
    fake.on("run_transfer", () => ({
      tables: [{ table: "users", status: "success", rows_copied: 1, skipped: 0, error: null }],
      warnings: ["Truncated target before copy"],
    }));
    const { user } = renderWithProviders(
      <RunStep sourceSession="s" targetSession="t" jobs={[job]} options={options} />
    );

    await user.click(screen.getByRole("button", { name: "Start transfer" }));
    await waitFor(() =>
      expect(screen.getByText(/Truncated target before copy/)).toBeInTheDocument()
    );
  });

  it("invokes onAfterRun and renders the objects result when objectCount > 0", async () => {
    const fake = installFakeBackend();
    fake.on("run_transfer", () => report());
    const objResults: ObjectCopyResult[] = [
      { object: "v_active", kind: "view", status: "success", error: null },
    ];
    const onAfterRun = vi.fn().mockResolvedValue(objResults);

    const { user } = renderWithProviders(
      <RunStep
        sourceSession="s"
        targetSession="t"
        jobs={[job]}
        options={options}
        onAfterRun={onAfterRun}
        objectCount={1}
      />
    );

    await user.click(screen.getByRole("button", { name: "Start transfer" }));

    await waitFor(() => expect(screen.getByText("Objects")).toBeInTheDocument());
    expect(vi.mocked(onAfterRun)).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/v_active/)).toBeInTheDocument();
    expect(screen.getByText(/\(view\)/)).toBeInTheDocument();
  });

  it("does NOT call onAfterRun when objectCount is 0", async () => {
    const fake = installFakeBackend();
    fake.on("run_transfer", () => report());
    const onAfterRun = vi.fn().mockResolvedValue([]);

    const { user } = renderWithProviders(
      <RunStep
        sourceSession="s"
        targetSession="t"
        jobs={[job]}
        options={options}
        onAfterRun={onAfterRun}
        objectCount={0}
      />
    );

    await user.click(screen.getByRole("button", { name: "Start transfer" }));
    await waitFor(() => expect(screen.getByText("Result")).toBeInTheDocument());
    expect(vi.mocked(onAfterRun)).not.toHaveBeenCalled();
    expect(screen.queryByText("Objects")).not.toBeInTheDocument();
  });
});
