// Fake Tauri backend for UI tests.
//
// All of the app's backend access funnels through `invoke()` (directly or via
// src/lib/tauri-commands.ts), and Tauri routes plugin/event calls through the
// same IPC. So a single `mockIPC` handler is the one seam needed to drive the
// whole frontend without a Rust process.
//
// Usage in a `*.test.tsx` (jsdom):
//   const fake = installFakeBackend({ connections: [makeConnection()] });
//   fake.on("get_tables", () => [makeTable()]);   // per-command stubs
//   ...render and assert...
//   expect(fake.calls.some((c) => c.cmd === "get_tables")).toBe(true);
//
// `clearMocks()` (in src/test/setup.ts afterEach) tears the IPC mock down
// between tests, so each test installs its own fresh backend.

import { mockIPC } from "@tauri-apps/api/mocks";
import type { Connection } from "../types";

export type CommandHandler = (args: Record<string, unknown>) => unknown;

export interface FakeBackend {
  /** Mutable seed state a few default handlers read from. */
  state: { connections: Connection[]; groups: unknown[] };
  /** Every IPC call made, in order — assert on cmd/args. */
  calls: Array<{ cmd: string; args: Record<string, unknown> }>;
  /** Register/override a handler for a single command name. */
  on(cmd: string, handler: CommandHandler): FakeBackend;
}

export interface FakeBackendSeed {
  connections?: Connection[];
  groups?: unknown[];
  /** Initial per-command handlers (equivalent to calling `.on` for each). */
  handlers?: Record<string, CommandHandler>;
}

/**
 * Install a fake backend over the Tauri IPC for the current test. Unhandled
 * commands resolve to `undefined` (so an unmocked call never throws); Tauri
 * plugin/event calls resolve to inert values.
 */
export function installFakeBackend(seed: FakeBackendSeed = {}): FakeBackend {
  const state = { connections: seed.connections ?? [], groups: seed.groups ?? [] };
  const calls: FakeBackend["calls"] = [];
  const handlers: Record<string, CommandHandler> = {
    get_connections: () => state.connections,
    get_connection_groups: () => state.groups,
    get_vault_status: () => ({ mode: "device", initialized: true, unlocked: true }),
    ...(seed.handlers ?? {}),
  };

  mockIPC((cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args: a });
    if (cmd in handlers) return handlers[cmd](a);
    // Tauri plugin/event passthroughs so unmocked UI bits stay inert.
    if (cmd === "plugin:event|listen" || cmd === "plugin:event|unlisten") return 0;
    if (cmd.startsWith("plugin:dialog")) return null;
    if (cmd.startsWith("plugin:fs")) return null;
    return undefined;
  });

  const api: FakeBackend = {
    state,
    calls,
    on(cmd, handler) {
      handlers[cmd] = handler;
      return api;
    },
  };
  return api;
}
