/**
 * Pure EXPLAIN-prefix builder.
 *
 * Design rules:
 * - Pure function only — no React, no Tauri calls.
 * - The input SQL is the user's statement; it is inserted verbatim (NOT
 *   parameterized or escaped).
 * - A single trailing `;` is stripped before prefixing so the resulting buffer
 *   is one clean statement.
 * - If the statement already starts with `EXPLAIN` (case-insensitive) it is
 *   returned untouched (minus the trailing `;`) — we never double-prefix.
 *
 * Per-dialect prefixes:
 * - postgres: json => `EXPLAIN (FORMAT JSON) <sql>`, text => `EXPLAIN <sql>`.
 * - mysql:    json => `EXPLAIN FORMAT=JSON <sql>`,   text => `EXPLAIN <sql>`.
 * - sqlite:   always `EXPLAIN QUERY PLAN <sql>`. SQLite has no JSON output for
 *   EXPLAIN, so the `json` format falls back to the QUERY PLAN form.
 * - sqlserver: SQL Server has no inline `EXPLAIN`; an estimated plan needs
 *   `SET SHOWPLAN_XML ON` as its own batch (out of scope here). The statement is
 *   returned unchanged so the panel just runs it and shows its normal rows.
 */

import type { Dialect } from "../types";

/** Strip a single trailing `;` (and surrounding whitespace) from `sql`. */
function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, "").trim();
}

/**
 * Build an EXPLAIN form of `sql` for the given `dialect` and `format`.
 *
 * See the module doc for the exact per-dialect prefixes. The trailing `;` is
 * stripped, and a statement that already begins with `EXPLAIN` is returned
 * as-is (no double-prefixing).
 */
export function buildExplain(sql: string, dialect: Dialect, format: "text" | "json"): string {
  const trimmed = stripTrailingSemicolon(sql);

  // Already an EXPLAIN statement — don't double-prefix.
  if (/^explain\b/i.test(trimmed)) {
    return trimmed;
  }

  switch (dialect) {
    case "postgres":
      return format === "json" ? `EXPLAIN (FORMAT JSON) ${trimmed}` : `EXPLAIN ${trimmed}`;
    case "mysql":
      return format === "json" ? `EXPLAIN FORMAT=JSON ${trimmed}` : `EXPLAIN ${trimmed}`;
    case "sqlite":
      // SQLite has no JSON EXPLAIN format; fall back to the QUERY PLAN form.
      return `EXPLAIN QUERY PLAN ${trimmed}`;
    case "sqlserver":
      // No inline EXPLAIN in T-SQL; return the statement unchanged (no plan).
      return trimmed;
  }
}
