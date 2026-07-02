// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/render";
import { RedisKeyBrowser } from "./RedisKeyBrowser";
import type { RedisApi, RedisKeyInfo, RedisValue } from "./types";

function makeApi(overrides: Partial<RedisApi> = {}): RedisApi {
  return {
    scan: vi.fn().mockResolvedValue({ keys: [], cursor: "0" }),
    get: vi.fn().mockResolvedValue({ type: "none" } as RedisValue),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    expire: vi.fn().mockResolvedValue(undefined),
    command: vi.fn().mockResolvedValue("PONG"),
    ...overrides,
  };
}

const stringKey: RedisKeyInfo = { key: "user:1", type: "string", ttl: -1 };
const hashKey: RedisKeyInfo = { key: "session:1", type: "hash", ttl: 120 };

describe("RedisKeyBrowser", () => {
  it("scans with the selected db, pattern, cursor and count, then renders keys", async () => {
    const scan = vi
      .fn()
      .mockResolvedValue({ keys: [stringKey, hashKey], cursor: "0" });
    const api = makeApi({ scan });
    const { user } = renderWithProviders(<RedisKeyBrowser api={api} />);

    const patternInput = screen.getByPlaceholderText("key pattern, e.g. user:*");
    await user.clear(patternInput);
    await user.type(patternInput, "user:*");

    await user.click(screen.getByRole("button", { name: /scan/i }));

    await waitFor(() => expect(scan).toHaveBeenCalled());
    expect(scan).toHaveBeenCalledWith(0, "user:*", "0", 200);

    expect(await screen.findByText("user:1")).toBeInTheDocument();
    expect(screen.getByText("session:1")).toBeInTheDocument();
  });

  it("loads a key's value via get when a key is selected and shows it in the editor", async () => {
    const scan = vi.fn().mockResolvedValue({ keys: [stringKey], cursor: "0" });
    const get = vi
      .fn()
      .mockResolvedValue({ type: "string", value: "hello world" } as RedisValue);
    const api = makeApi({ scan, get });
    const { user } = renderWithProviders(<RedisKeyBrowser api={api} />);

    await user.click(screen.getByRole("button", { name: /scan/i }));
    await user.click(await screen.findByText("user:1"));

    await waitFor(() => expect(get).toHaveBeenCalledWith(0, "user:1"));
    const textarea = await screen.findByDisplayValue("hello world");
    expect(textarea).toBeInTheDocument();
  });

  it("edits a string value and saves it via set, then reloads via get", async () => {
    const scan = vi.fn().mockResolvedValue({ keys: [stringKey], cursor: "0" });
    const get = vi
      .fn()
      .mockResolvedValue({ type: "string", value: "old" } as RedisValue);
    const set = vi.fn().mockResolvedValue(undefined);
    const api = makeApi({ scan, get, set });
    const { user } = renderWithProviders(<RedisKeyBrowser api={api} />);

    await user.click(screen.getByRole("button", { name: /scan/i }));
    await user.click(await screen.findByText("user:1"));

    const textarea = await screen.findByDisplayValue("old");
    await user.clear(textarea);
    await user.type(textarea, "new");

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(0, "user:1", {
        type: "string",
        value: "new",
      })
    );
  });

  it("deletes the selected key via del and removes it from the list", async () => {
    const scan = vi.fn().mockResolvedValue({ keys: [stringKey], cursor: "0" });
    const get = vi
      .fn()
      .mockResolvedValue({ type: "string", value: "x" } as RedisValue);
    const del = vi.fn().mockResolvedValue(undefined);
    const api = makeApi({ scan, get, del });
    const { user } = renderWithProviders(<RedisKeyBrowser api={api} />);

    await user.click(screen.getByRole("button", { name: /scan/i }));
    await user.click(await screen.findByText("user:1"));
    await screen.findByDisplayValue("x");

    await user.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(del).toHaveBeenCalledWith(0, "user:1"));
    await waitFor(() =>
      expect(screen.queryByText("user:1")).not.toBeInTheDocument()
    );
  });

  it("sets a TTL via expire using the entered seconds", async () => {
    const scan = vi.fn().mockResolvedValue({ keys: [stringKey], cursor: "0" });
    const get = vi
      .fn()
      .mockResolvedValue({ type: "string", value: "x" } as RedisValue);
    const expire = vi.fn().mockResolvedValue(undefined);
    const api = makeApi({ scan, get, expire });
    const { user } = renderWithProviders(<RedisKeyBrowser api={api} />);

    await user.click(screen.getByRole("button", { name: /scan/i }));
    await user.click(await screen.findByText("user:1"));
    await screen.findByDisplayValue("x");

    const ttlInput = screen.getByPlaceholderText("seconds");
    await user.clear(ttlInput);
    await user.type(ttlInput, "300");
    await user.click(screen.getByRole("button", { name: /set ttl/i }));

    await waitFor(() => expect(expire).toHaveBeenCalledWith(0, "user:1", 300));
  });

  it("runs a raw command via command(db, argv) and prints the reply", async () => {
    const command = vi.fn().mockResolvedValue("PONG");
    const api = makeApi({ command });
    const { user } = renderWithProviders(<RedisKeyBrowser api={api} />);

    await user.click(screen.getByRole("button", { name: /console/i }));

    const input = screen.getByPlaceholderText("raw command");
    await user.type(input, 'SET k "hello world"');
    await user.click(screen.getByRole("button", { name: /^run$/i }));

    await waitFor(() =>
      expect(command).toHaveBeenCalledWith(0, ["SET", "k", "hello world"])
    );
    expect(await screen.findByText("PONG")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <RedisKeyBrowser api={makeApi()} onClose={onClose} />
    );
    await user.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an empty-state message when a scan returns no keys", async () => {
    const api = makeApi({ scan: vi.fn().mockResolvedValue({ keys: [], cursor: "0" }) });
    const { user } = renderWithProviders(<RedisKeyBrowser api={api} />);

    await user.click(screen.getByRole("button", { name: /scan/i }));

    expect(await screen.findByText("No keys")).toBeInTheDocument();
  });

  it("surfaces a scan error", async () => {
    const api = makeApi({ scan: vi.fn().mockRejectedValue(new Error("boom")) });
    const { user } = renderWithProviders(<RedisKeyBrowser api={api} />);

    await user.click(screen.getByRole("button", { name: /scan/i }));

    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
