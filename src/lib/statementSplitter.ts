/**
 * SQL statement splitter.
 *
 * Splits a raw SQL buffer into individual statements on `;` separators while
 * correctly ignoring separators that appear inside:
 *   - single-quoted strings   '...'   (with '' escape)
 *   - double-quoted strings   "..."   (with "" escape)
 *   - backtick identifiers    `...`   (with `` escape)
 *   - line comments           -- ... <eol>
 *   - block comments          slash-star ... star-slash
 *   - Postgres dollar-quoted bodies   $$ ... $$   and   $tag$ ... $tag$
 *
 * It also honours MySQL-style `DELIMITER` directives so a routine body whose
 * statements end in `;` but whose CREATE … END is terminated by a custom
 * delimiter (e.g. `//`) is kept as ONE statement.
 *
 * Pure module — no React, no Tauri.
 */

/** A single parsed statement and its span in the original buffer. */
export interface SqlStatement {
  /** The statement text, trimmed of surrounding whitespace. */
  text: string;
  /** Offset of the (untrimmed) statement start in the original buffer. */
  start: number;
  /** Offset just past the (untrimmed) statement end in the original buffer. */
  end: number;
}

/** True for an ASCII letter, digit or underscore (dollar-quote tag chars). */
function isTagChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

/**
 * If a dollar-quote tag opens at `sql[i]` (i.e. `sql[i] === '$'`), return the
 * full opening tag string (e.g. "$$" or "$body$"); otherwise return null.
 *
 * A tag is `$`, then zero or more tag chars, then a closing `$`.
 */
function dollarTagAt(sql: string, i: number): string | null {
  if (sql[i] !== "$") return null;
  let j = i + 1;
  while (j < sql.length && isTagChar(sql[j])) j++;
  if (sql[j] === "$") {
    return sql.slice(i, j + 1);
  }
  return null;
}

/** Whitespace-trim that also reports the offset shift of the leading trim. */
function trimWithStart(raw: string, rawStart: number): { text: string; start: number; end: number } {
  const lead = raw.length - raw.replace(/^\s+/, "").length;
  const text = raw.trim();
  const start = rawStart + lead;
  return { text, start, end: start + text.length };
}

/**
 * A statement is meaningful (worth keeping) if, after stripping comments and
 * whitespace, anything remains. This filters out empty / whitespace-only /
 * comment-only fragments.
 */
function hasContent(text: string): boolean {
  if (text.trim().length === 0) return false;
  // Strip line + block comments, then check for remaining non-whitespace.
  let i = 0;
  let out = "";
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "--") {
      const nl = text.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (two === "/*") {
      const close = text.indexOf("*/", i + 2);
      if (close === -1) break;
      i = close + 2;
      continue;
    }
    // Skip over quoted spans so a ';'-free comment marker inside a string is
    // not mistaken for a comment (and vice-versa). Quotes always have content.
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      return true;
    }
    out += ch;
    i++;
  }
  return out.trim().length > 0;
}

/**
 * Split `sql` into statements on `;` separators, ignoring separators inside
 * quotes, comments and dollar-quoted bodies, and respecting `DELIMITER`.
 */
export function splitStatements(sql: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  let delimiter = ";";
  let segStart = 0; // start of the current statement segment (raw offset)
  let i = 0;

  const pushSegment = (rawEnd: number) => {
    const raw = sql.slice(segStart, rawEnd);
    if (hasContent(raw)) {
      const { text, start, end } = trimWithStart(raw, segStart);
      out.push({ text, start, end });
    }
  };

  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);

    // Line comment.
    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }

    // Block comment.
    if (two === "/*") {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? sql.length : close + 2;
      continue;
    }

    // Quoted string / identifier — single, double or backtick, with doubled
    // quote escaping.
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2; // escaped quote
            continue;
          }
          i++; // closing quote
          break;
        }
        i++;
      }
      continue;
    }

    // Dollar-quoted body ($$ … $$ or $tag$ … $tag$).
    if (ch === "$") {
      const tag = dollarTagAt(sql, i);
      if (tag) {
        const bodyStart = i + tag.length;
        const close = sql.indexOf(tag, bodyStart);
        i = close === -1 ? sql.length : close + tag.length;
        continue;
      }
    }

    // DELIMITER directive (MySQL): `DELIMITER <token>` on a line of its own.
    // Only recognised at a statement boundary (start of a segment, modulo
    // leading whitespace) and case-insensitively.
    if ((ch === "d" || ch === "D") && atStatementStart(sql, segStart, i)) {
      const m = /^DELIMITER[ \t]+(\S+)[ \t]*(\r?\n|$)/i.exec(sql.slice(i));
      if (m) {
        // The DELIMITER line is a directive, not a statement: consume it and
        // advance both the cursor and the segment start past it.
        delimiter = m[1];
        i += m[0].length;
        segStart = i;
        continue;
      }
    }

    // Statement delimiter.
    if (sql.startsWith(delimiter, i)) {
      pushSegment(i);
      i += delimiter.length;
      segStart = i;
      continue;
    }

    i++;
  }

  // Trailing statement with no terminating delimiter.
  pushSegment(sql.length);

  return out;
}

/**
 * Is the cursor `i` at the start of the current statement segment, ignoring
 * only leading whitespace since `segStart`? Used to gate `DELIMITER`.
 */
function atStatementStart(sql: string, segStart: number, i: number): boolean {
  for (let k = segStart; k < i; k++) {
    if (!/\s/.test(sql[k])) return false;
  }
  return true;
}

/**
 * The statement whose `[start, end)` span contains `offset`. When `offset`
 * falls in the gap between two statements (e.g. on the separator or in
 * trailing whitespace/comments), returns the nearest preceding statement.
 * Returns null when there are no statements, or when `offset` precedes the
 * first statement.
 */
export function statementAtOffset(sql: string, offset: number): SqlStatement | null {
  const stmts = splitStatements(sql);
  if (stmts.length === 0) return null;

  let preceding: SqlStatement | null = null;
  for (const s of stmts) {
    if (offset >= s.start && offset < s.end) return s;
    if (s.start <= offset) preceding = s;
  }
  return preceding;
}
