/**
 * Pure builders for copying non-table database objects (views, routines,
 * triggers) from a source connection to a target connection in the Transfer
 * Wizard.
 *
 * Design rules:
 * - Pure functions only — no React, no Tauri calls.
 * - The table data/structure transfer is handled by the existing engine
 *   (`runTransfer`); these helpers only shape the SQL that recreates the
 *   *other* objects on the target via `executeQuery(targetSessionId, sql)`.
 * - View bodies are wrapped with `viewBuilder.buildCreateView`. Routine and
 *   trigger DDL is already a full `CREATE …` statement (fetched verbatim from
 *   the source via SHOW CREATE / pg_get_functiondef / get_triggers) and is run
 *   as-is on the target, after light normalization.
 */

import type { Dialect, Statement } from "../types";
import { buildCreateView } from "./viewBuilder";

/** The non-table object kinds the Transfer Wizard can copy. */
export type TransferObjectKind = "view" | "routine" | "trigger";

/** A reference to one source object selected for transfer. */
export interface TransferObjectRef {
  kind: TransferObjectKind;
  name: string;
  /** MySQL: source database; Postgres/SQLite: schema (or null → unqualified). */
  schema?: string | null;
  /** Only meaningful when `kind === "routine"`. */
  routineKind?: "function" | "procedure";
}

/** The outcome of copying a single object to the target. */
export interface ObjectCopyResult {
  object: string;
  kind: TransferObjectKind;
  status: "success" | "failed" | "skipped";
  error?: string | null;
}

/**
 * Build the statement(s) that (re)create a view on the target from its SELECT
 * body. Delegates to `viewBuilder.buildCreateView`, which emits a single
 * `CREATE OR REPLACE VIEW … AS <body>` on MySQL/Postgres and a
 * `DROP VIEW IF EXISTS` + `CREATE VIEW` pair on SQLite (no OR REPLACE there).
 *
 * `replace` defaults to true. When false on MySQL/Postgres the OR REPLACE is
 * dropped so an existing view on the target is left untouched (the CREATE will
 * error if it already exists, surfacing as a failed copy). SQLite always
 * drops-then-creates, so `replace` has no effect there.
 */
export function buildViewCopy(
  dialect: Dialect,
  schema: string | null | undefined,
  name: string,
  selectBody: string,
  replace = true,
): Statement[] {
  if (dialect === "sqlite") {
    // SQLite has no OR REPLACE for views; buildCreateView already DROPs first.
    return buildCreateView(dialect, schema, name, selectBody);
  }

  const stmts = buildCreateView(dialect, schema, name, selectBody);
  if (replace) return stmts;

  // Strip the `OR REPLACE` so an existing target view is not clobbered.
  return stmts.map((s) => ({
    ...s,
    sql: s.sql.replace(/^CREATE OR REPLACE VIEW /, "CREATE VIEW "),
  }));
}

/**
 * Matches a MySQL `DEFINER=user@host` clause as it appears in `SHOW CREATE`
 * output. The user/host are each either a backtick-quoted identifier or a bare
 * token, separated by `@`, with optional surrounding whitespace. We strip the
 * whole clause (including a single trailing space) so the recreated object does
 * not pin to a user that may not exist on the target server.
 */
const DEFINER_CLAUSE =
  /\s+DEFINER\s*=\s*(?:`(?:[^`]|``)*`|[^\s@]+)@(?:`(?:[^`]|``)*`|[^\s(]+)/i;

/**
 * Normalize a full `CREATE …` DDL string before running it verbatim on the
 * target.
 *
 * - Trims surrounding whitespace.
 * - Strips a MySQL `DEFINER=user@host` clause if present, so a cross-server
 *   recreate does not fail on a missing user. (Views, routines and triggers can
 *   all carry a DEFINER in `SHOW CREATE` output.)
 * - `dropFirst` is currently a no-op flag reserved for callers that want to
 *   signal a preceding DROP was emitted; the DDL itself is left otherwise
 *   untouched.
 */
export function normalizeCreateDdl(ddl: string, dropFirst = false): string {
  void dropFirst;
  let out = ddl.trim();
  out = out.replace(DEFINER_CLAUSE, "");
  return out;
}

/**
 * Order object refs so dependencies are created before their dependents:
 * views first, then routines, then triggers.
 *
 * Tables are copied by the existing transfer engine before any of these run, so
 * a view or trigger that references a table will find it already present.
 * Triggers come last because they attach to tables; routines sit in the middle
 * (a trigger body may call a routine). The original relative order within each
 * kind is preserved (stable).
 */
export function dependencyOrder(refs: TransferObjectRef[]): TransferObjectRef[] {
  const rank: Record<TransferObjectKind, number> = {
    view: 0,
    routine: 1,
    trigger: 2,
  };
  return refs
    .map((ref, i) => ({ ref, i }))
    .sort((a, b) => rank[a.ref.kind] - rank[b.ref.kind] || a.i - b.i)
    .map(({ ref }) => ref);
}
