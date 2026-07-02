// @vitest-environment jsdom
//
// Smoke test for the UI test harness itself: proves the Tauri IPC seam works
// end-to-end, so feature tests can rely on `installFakeBackend` + tauri-commands.

import { describe, it, expect } from "vitest";
import { installFakeBackend } from "./fakeBackend";
import { makeTable } from "./fixtures";
import { databaseCommands } from "../lib/tauri-commands";

describe("UI test harness", () => {
  it("routes a tauri-commands call through the mocked IPC", async () => {
    const fake = installFakeBackend();
    fake.on("get_tables", () => [makeTable({ name: "accounts" })]);

    const tables = await databaseCommands.getTables("sess-1", "shop");

    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe("accounts");
  });

  it("records the command name and args for assertions", async () => {
    const fake = installFakeBackend();
    fake.on("get_tables", () => []);

    await databaseCommands.getTables("sess-9", "analytics", "public");

    const call = fake.calls.find((c) => c.cmd === "get_tables");
    expect(call).toBeDefined();
    expect(call?.args).toMatchObject({
      sessionId: "sess-9",
      database: "analytics",
      schema: "public",
    });
  });

  it("returns an inert value for unmocked commands instead of throwing", async () => {
    installFakeBackend();
    // get_databases has no stub here; should resolve (to undefined), not reject.
    await expect(databaseCommands.getDatabases("sess-1")).resolves.toBeUndefined();
  });
});
