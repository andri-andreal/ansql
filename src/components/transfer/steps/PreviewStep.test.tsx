// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { installFakeBackend } from "@/test/fakeBackend";
import { PreviewStep } from "./PreviewStep";
import type { TransferJob, TransferOptions } from "@/types";

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

function render() {
  return renderWithProviders(
    <PreviewStep
      sourceSession="src-1"
      targetSession="tgt-1"
      jobs={[job]}
      options={options}
    />
  );
}

describe("PreviewStep", () => {
  it("renders the preview title", () => {
    installFakeBackend();
    render();
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });

  it("calls preview_transfer with the session/job/options and renders DDL + sample insert", async () => {
    const fake = installFakeBackend();
    fake.on("preview_transfer", () => [
      {
        table: "users",
        ddl: "CREATE TABLE users (id INT);",
        sample_insert: "INSERT INTO users VALUES (1);",
      },
    ]);
    render();

    await waitFor(() =>
      expect(screen.getByText(/CREATE TABLE users/)).toBeInTheDocument()
    );
    expect(screen.getByText(/INSERT INTO users/)).toBeInTheDocument();
    // table name heading
    expect(screen.getAllByText("users").length).toBeGreaterThan(0);

    const call = fake.calls.find((c) => c.cmd === "preview_transfer");
    expect(call).toBeTruthy();
    expect(call!.args.sourceSession).toBe("src-1");
    expect(call!.args.targetSession).toBe("tgt-1");
    expect(Array.isArray(call!.args.jobs)).toBe(true);
  });

  it("renders one preview block per returned table", async () => {
    const fake = installFakeBackend();
    fake.on("preview_transfer", () => [
      { table: "users", ddl: "CREATE TABLE users (id INT);", sample_insert: "INSERT a" },
      { table: "orders", ddl: "CREATE TABLE orders (id INT);", sample_insert: "INSERT b" },
    ]);
    render();

    await waitFor(() =>
      expect(screen.getByText(/CREATE TABLE users/)).toBeInTheDocument()
    );
    expect(screen.getByText(/CREATE TABLE orders/)).toBeInTheDocument();
  });

  it("shows the loading indicator before previews resolve", () => {
    const fake = installFakeBackend();
    // Never-resolving handler so loading state persists.
    fake.on("preview_transfer", () => new Promise(() => {}));
    render();
    expect(screen.getByText("Generating…")).toBeInTheDocument();
  });
});
