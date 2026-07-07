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

import { indexOfTopLevel, splitTopLevel, stripComments, unquoteIdent } from "./sqlSource";

export interface DmlSource {
  verb: "update" | "delete";
  schema: string | null;
  table: string;
  /** WHERE text without the leading `WHERE` (null when the statement has none). */
  whereSql: string | null;
  /**
   * UPDATE only: the raw SET clause text (without the leading `SET`), trimmed
   * at the top-level WHERE / ORDER BY / LIMIT / OFFSET / RETURNING. Always
   * null for DELETE.
   */
  setSql: string | null;
  /**
   * True when a top-level ORDER BY / LIMIT / OFFSET tail follows the statement
   * body — the statement may touch fewer rows than its WHERE matches
   * (MySQL/SQLite `UPDATE/DELETE ... LIMIT n`). A WHERE-based snapshot then
   * over-captures, so preview and DELETE-undo must skip these.
   */
  hasLimitTail: boolean;
}

/** One parsed `column = expr` assignment from an UPDATE's SET clause. */
export interface SetAssignment {
  /** Unquoted assignment target column. */
  column: string;
  /** Raw right-hand-side expression text, verbatim (trimmed). */
  exprSql: string;
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
 * True when a top-level ORDER BY / LIMIT / OFFSET follows anywhere in the
 * region (RETURNING doesn't restrict rows, so it doesn't count).
 */
function hasLimitTail(region: string): boolean {
  return hasTopLevel(region, /\b(order\s+by|limit|offset)\b/iy);
}

/**
 * Capture the SET clause text of an UPDATE region (`<ws>SET ... [WHERE ...]`),
 * without the leading `SET`, trimmed at the top-level WHERE / ORDER BY /
 * LIMIT / OFFSET / RETURNING. Returns null when empty (malformed statement).
 */
function captureSet(region: string): string | null {
  const sidx = indexOfTopLevel(region, /\bset\b/iy);
  if (sidx === -1) return null;
  const afterSet = region.slice(sidx + "set".length);
  const endIdx = indexOfTopLevel(afterSet, /\b(where|order\s+by|limit|offset|returning)\b/iy);
  const clause = (endIdx === -1 ? afterSet : afterSet.slice(0, endIdx)).trim();
  return clause === "" ? null : clause;
}

// Anchored `ident =` (but not `==`) — the assignment target of one SET segment.
const ASSIGN_RE = new RegExp(`^\\s*(${IDENT})\\s*=(?!=)`, "i");

/**
 * Parse a SET clause (`col = expr, col2 = expr2, ...`) into individual
 * assignments. Returns null when any segment is not a plain single-column
 * assignment we can safely project into a preview SELECT: the multi-column
 * row form `(a, b) = (...)`, an empty or `DEFAULT` right-hand side, a
 * duplicate target, or anything that doesn't start with `ident =`.
 * Later `=` inside the RHS (CASE, subqueries, comparisons) stays verbatim.
 */
export function parseSetAssignments(setSql: string): SetAssignment[] | null {
  const out: SetAssignment[] = [];
  const seen = new Set<string>();
  for (const segment of splitTopLevel(setSql, /,/y)) {
    const part = segment.trim();
    if (part === "" || part.startsWith("(")) return null;
    const m = ASSIGN_RE.exec(part);
    if (!m) return null;
    const column = unquoteIdent(m[1]);
    if (column === "") return null;
    const lower = column.toLowerCase();
    if (seen.has(lower)) return null;
    seen.add(lower);
    const exprSql = part.slice(m[0].length).trim();
    if (exprSql === "" || /^default$/i.test(exprSql)) return null;
    out.push({ column, exprSql });
  }
  return out.length > 0 ? out : null;
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

  let setSql: string | null = null;
  if (verb === "update") {
    // Must be `<table> SET ...` (no alias), and single-table (no FROM/JOIN).
    if (!/^\s+set\b/i.test(region)) return null;
    if (hasTopLevel(region, /\b(from|join)\b/iy)) return null;
    setSql = captureSet(region);
    if (setSql === null) return null;
  } else {
    // DELETE: after the table, only an optional WHERE may follow (no alias,
    // no USING/JOIN multi-table delete).
    const head = region.trim();
    if (head !== "" && !/^where\b/i.test(head)) return null;
  }

  return {
    verb,
    schema,
    table,
    whereSql: captureWhere(region),
    setSql,
    hasLimitTail: hasLimitTail(region),
  };
}
