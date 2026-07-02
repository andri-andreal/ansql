/**
 * Single-table UPDATE / DELETE detector for the Time Machine's Tier-2
 * snapshot-before-execute undo of raw SQL typed in the query editor.
 *
 * Like {@link ./sqlSource} (its SELECT counterpart), the bar is intentionally
 * HIGH: we only recognise a statement when we can map it to exactly one base
 * table and reconstruct a `SELECT * FROM <table> [WHERE ...]` that captures the
 * rows it will touch. Anything ambiguous (aliases, multi-table UPDATE…FROM,
 * DELETE…USING/JOIN, CTEs, subquery targets) is rejected so we never record a
 * misleading "undo" — the caller simply skips journaling for that statement.
 *
 * Pure module — no React, no Tauri.
 */

import { indexOfTopLevel, stripComments, unquoteIdent } from "./sqlSource";

export interface DmlSource {
  verb: "update" | "delete";
  schema: string | null;
  table: string;
  /** WHERE text without the leading `WHERE` (null when the statement has none). */
  whereSql: string | null;
}

const QUOTED = `"(?:[^"]|"")*"|\`(?:[^\`]|\`\`)*\`|\\[[^\\]]*\\]`;
const BARE = `[A-Za-z_][A-Za-z0-9_$]*`;
const IDENT = `(?:${QUOTED}|${BARE})`;
// [schema.]table at the start of a region.
const TABLE_RE = new RegExp(`^\\s*(?:(${IDENT})\\s*\\.\\s*)?(${IDENT})`, "i");

function hasTopLevel(sql: string, re: RegExp): boolean {
  return indexOfTopLevel(sql, re) !== -1;
}

/** Capture the top-level WHERE text from a region (sans leading `WHERE`). */
function captureWhere(region: string): string | null {
  const widx = indexOfTopLevel(region, /\bwhere\b/iy);
  if (widx === -1) return null;
  const afterWhere = region.slice(widx + "where".length);
  const endIdx = indexOfTopLevel(afterWhere, /\b(order\s+by|limit|offset|returning)\b/iy);
  const clause = (endIdx === -1 ? afterWhere : afterWhere.slice(0, endIdx)).trim();
  return clause === "" ? null : clause;
}

/**
 * Detect a simple single-table UPDATE or DELETE and return its base table +
 * WHERE. Returns null for anything not provably safe to snapshot-and-restore.
 */
export function detectSingleTableDml(sql: string): DmlSource | null {
  const cleaned = stripComments(sql).trim().replace(/;\s*$/, "").trim();
  if (cleaned === "") return null;

  let verb: "update" | "delete";
  let rest: string;

  if (/^delete\s+/i.test(cleaned)) {
    verb = "delete";
    // DELETE [TOP (n)] FROM <table> [WHERE ...]
    const m = /^delete\s+(?:top\s*\([^)]*\)\s*)?from\s+/i.exec(cleaned);
    if (!m) return null;
    rest = cleaned.slice(m[0].length);
  } else if (/^update\s+/i.test(cleaned)) {
    verb = "update";
    // UPDATE [TOP (n)] <table> SET ...
    const m = /^update\s+(?:top\s*\([^)]*\)\s*)?/i.exec(cleaned)!;
    rest = cleaned.slice(m[0].length);
  } else {
    return null;
  }

  const tm = TABLE_RE.exec(rest);
  if (!tm) return null;
  const schema = tm[1] != null ? unquoteIdent(tm[1]) : null;
  const table = unquoteIdent(tm[2]);
  if (table === "") return null;
  const region = rest.slice(tm[0].length);

  if (verb === "update") {
    // Must be `<table> SET ...` (no alias), and single-table (no FROM/JOIN).
    if (!/^\s+set\b/i.test(region)) return null;
    if (hasTopLevel(region, /\b(from|join)\b/iy)) return null;
  } else {
    // DELETE: after the table, only an optional WHERE may follow (no alias,
    // no USING/JOIN multi-table delete).
    const head = region.trim();
    if (head !== "" && !/^where\b/i.test(head)) return null;
  }

  return { verb, schema, table, whereSql: captureWhere(region) };
}
