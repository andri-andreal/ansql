import type { DatabaseDriver } from "../types";

/**
 * ANSQL ships in two editions (see EDITIONS.md): the open-source **Community**
 * core and the closed-source **Pro** edition built on top. This module is the
 * single frontend seam describing which engines and features the running build
 * exposes, so Pro-only surfaces can be gated in exactly one place.
 *
 * The edition is fixed at build time via the `VITE_ANSQL_EDITION` env var
 * (`"community"` | `"pro"`). It defaults to `"pro"` so local dev and tests
 * exercise every feature; the Community production build sets
 * `VITE_ANSQL_EDITION=community`.
 */
export type Edition = "community" | "pro";

export const EDITION: Edition =
  import.meta.env.VITE_ANSQL_EDITION === "community" ? "community" : "pro";

export const isPro: boolean = EDITION === "pro";

/** Engines that belong to ANSQL Pro: SQL Server plus the NoSQL engines. */
const PRO_DRIVERS: ReadonlySet<DatabaseDriver> = new Set<DatabaseDriver>([
  "sqlserver",
  "redis",
  "mongodb",
]);

/** Whether `driver` is a Pro-only engine, independent of the running edition. */
export function isProDriver(driver: DatabaseDriver): boolean {
  return PRO_DRIVERS.has(driver);
}

/** Whether `driver` is available to use in the running edition. */
export function isDriverAvailable(driver: DatabaseDriver): boolean {
  return isPro || !isProDriver(driver);
}

/** Pro-only product features (gated surfaces beyond engine support). */
export type ProFeature =
  | "ai"
  | "crossDbTransfer"
  | "dataSync"
  | "structureSync"
  | "serverMonitor"
  | "dashboards"
  | "scheduledBackup";

const PRO_FEATURES: ReadonlySet<ProFeature> = new Set<ProFeature>([
  "ai",
  "crossDbTransfer",
  "dataSync",
  "structureSync",
  "serverMonitor",
  "dashboards",
  "scheduledBackup",
]);

/** Whether a Pro feature is enabled in the running edition. */
export function isFeatureEnabled(feature: ProFeature): boolean {
  return isPro || !PRO_FEATURES.has(feature);
}
