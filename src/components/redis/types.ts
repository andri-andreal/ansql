/**
 * Redis key-browser contract.
 *
 * The {@link RedisKeyBrowser} component is written purely against {@link RedisApi};
 * the integration layer backs this interface with the `redis_*` Tauri commands
 * (keyed by a redis session id). Keep this file free of Tauri / SQL coupling so
 * the browser stays a standalone, testable workspace view.
 */

/** A single key returned by SCAN, with its server-side type and TTL. */
export interface RedisKeyInfo {
  key: string;
  type: string;
  /** Seconds until expiry. `-1` = no expiry, `-2` = key is missing. */
  ttl: number;
}

/** A type-tagged Redis value, mirroring the backend `redis_get` reply. */
export type RedisValue =
  | { type: "string"; value: string }
  | { type: "hash"; entries: [string, string][] }
  | { type: "list"; items: string[] }
  | { type: "set"; members: string[] }
  | { type: "zset"; entries: [string, number][] }
  | { type: "none" };

/** Everything the key browser needs from the host integration. */
export interface RedisApi {
  scan: (
    db: number,
    pattern: string,
    cursor: string,
    count: number
  ) => Promise<{ keys: RedisKeyInfo[]; cursor: string }>;
  get: (db: number, key: string) => Promise<RedisValue>;
  set: (db: number, key: string, value: RedisValue) => Promise<void>;
  del: (db: number, key: string) => Promise<void>;
  expire: (db: number, key: string, ttlSeconds: number) => Promise<void>;
  /** Run a raw command (`args` = argv) and return the (stringifiable) reply. */
  command: (db: number, args: string[]) => Promise<unknown>;
}
