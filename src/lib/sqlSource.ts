/**
 * Single-table SELECT detector for the editable query-results grid.
 *
 * Given a raw SELECT statement, decide whether its result set maps back to a
 * single, unambiguous base table that we can safely edit in place. When it
 * does, return the table (with optional schema) plus the trailing WHERE clause
 * text so the editable grid can re-load `SELECT * FROM <table> [WHERE ...]` and
 * commit row mutations against it.
 *
 * The bar for "editable" is intentionally HIGH — false negatives (a query we
 * could have edited but didn't) merely fall back to a read-only grid, while
 * false positives (editing rows that don't correspond 1:1 to a base table)
 * corrupt data. So this is conservative: anything that complicates the row ⇒
 * base-row mapping (joins, multiple FROM tables, GROUP BY, HAVING, set
 * operations, DISTINCT, aggregate-only projections, a subquery in FROM) is
 * rejected outright.
 *
 * Pure module — no React, no Tauri.
 */

/** The editable base source recovered from a simple single-table SELECT. */
export interface SqlSource {
  /** Schema/owner qualifier, when the FROM table was schema-qualified. */
  schema?: string | null;
  /** Bare (unquoted) table name. */
  table: string;
  /**
   * The trailing WHERE clause text, WITHOUT the leading `WHERE`, captured up to
   * the first GROUP BY / ORDER BY / LIMIT / OFFSET or end of statement. `null`
   * when the query has no WHERE.
   */
  whereSql?: string | null;
}

/**
 * Strip SQL comments while preserving string/identifier literals verbatim.
 *
 * Removes `-- line` comments (to end of line) and block comments, but never
 * looks for comment markers inside single-quoted strings, double-quoted
 * identifiers or backtick identifiers (where the marker is just data). Replaces
 * each comment with a single space so adjacent tokens stay separated.
 */
export function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      out += " ";
      continue;
    }
    if (two === "/*") {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? sql.length : close + 2;
      out += " ";
      continue;
    }

    // Quoted span: copy verbatim, honouring doubled-quote escapes.
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            out += sql[i + 1];
            i += 2; // escaped quote
            continue;
          }
          i++; // past the closing quote
          break;
        }
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * Find the offset of the first top-level (paren-depth 0) match of `re` in
 * `sql`, skipping over quoted spans. `re` must be a global, sticky-safe regex;
 * we test it at each candidate position. Returns -1 when not found.
 */
export function indexOfTopLevel(sql: string, re: RegExp): number {
  let depth = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      if (depth > 0) depth--;
      i++;
      continue;
    }

    if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(sql);
      if (m && m.index === i) return i;
    }
    i++;
  }
  return -1;
}

/** True if any top-level (paren-depth 0) occurrence of `re` exists in `sql`. */
function hasTopLevel(sql: string, re: RegExp): boolean {
  return indexOfTopLevel(sql, re) !== -1;
}

/** Strip one layer of surrounding "..." / `...` / [...] quotes from an ident. */
export function unquoteIdent(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "`" && last === "`")) {
      // Collapse doubled inner quotes (escape form) back to a single char.
      return s.slice(1, -1).replace(new RegExp(first + first, "g"), first);
    }
    if (first === "[" && last === "]") {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** Reject keywords that, anywhere top-level, make a SELECT non-editable. */
const REJECT_TOP_LEVEL: RegExp[] = [
  /\bjoin\b/iy,
  /\bgroup\s+by\b/iy,
  /\bhaving\b/iy,
  /\bunion\b/iy,
  /\bintersect\b/iy,
  /\bexcept\b/iy,
];

/**
 * Aggregate function names that, when they make up the projection, mean the
 * row set is summarised (not 1:1 with base rows) and so is not editable. We
 * only inspect the SELECT list for these; an aggregate inside a WHERE/HAVING is
 * already covered by other rules.
 */
const AGGREGATE_RE = /^(count|sum|avg|min|max|group_concat|array_agg|string_agg)\s*\(/i;

/**
 * True when the SELECT-list `projection` is exactly one aggregate call,
 * optionally aliased (`count(*)`, `max(x) AS m`, `sum(amount) total`). Such a
 * projection produces a single summary row that does not map back to base
 * rows, so the result is not editable.
 *
 * A leading aggregate followed by a top-level comma (more columns) does NOT
 * count — those extra columns make this not aggregate-*only*, so we don't
 * reject here (other rules — GROUP BY etc. — already cover real aggregations).
 */
function isAggregateOnlyProjection(projection: string): boolean {
  const m = AGGREGATE_RE.exec(projection);
  if (!m) return false;

  // Walk past the aggregate's balanced parentheses.
  let depth = 0;
  let i = m[0].length - 1; // index of the opening "("
  for (; i < projection.length; i++) {
    if (projection[i] === "(") depth++;
    else if (projection[i] === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  if (depth !== 0) return false; // unbalanced — bail out, treat as non-aggregate

  // Only an optional `[AS] alias` may follow; a comma means more columns.
  const rest = projection.slice(i).trim();
  if (rest === "") return true;
  return /^(?:as\s+)?[A-Za-z_][A-Za-z0-9_$]*$/i.test(rest);
}

/**
 * The matchers that carve a single-table FROM clause:
 *   FROM [schema.]table [[AS] alias]
 * Each of schema/table may be a quoted ("...", `...`, [...]) or bare ident.
 * A bare ident is letters/digits/underscore/`$` (not starting with a digit).
 */
const QUOTED = `"(?:[^"]|"")*"|\`(?:[^\`]|\`\`)*\`|\\[[^\\]]*\\]`;
const BARE = `[A-Za-z_][A-Za-z0-9_$]*`;
const IDENT = `(?:${QUOTED}|${BARE})`;
const FROM_RE = new RegExp(
  `^\\s*(?:(${IDENT})\\s*\\.\\s*)?(${IDENT})` + // [schema.]table
    `(?:\\s+(?:as\\s+)?(?:${IDENT}))?` + // optional [AS] alias
    `\\s*$`,
  "i",
);

/** Keywords that terminate the FROM table-reference region (a WHERE-or-tail). */
const TAIL_RE = /\b(where|group\s+by|order\s+by|limit|offset|window|for\b)/iy;

/** Keywords that end the WHERE text (everything before them belongs to WHERE). */
const WHERE_END_RE = /\b(group\s+by|order\s+by|limit|offset|window|for\b)/iy;

/**
 * Detect whether `sql` is a simple single-table SELECT and, if so, return its
 * editable base source. Returns `null` for anything not provably safe to edit.
 *
 * Accepted: plain `SELECT ...`, optionally schema-qualified / quoted table,
 * optional alias, optional WHERE (captured as `whereSql`), and trailing
 * ORDER BY / LIMIT / OFFSET (ignored — only WHERE is captured).
 *
 * Rejected: non-SELECT; JOIN; comma-separated multiple FROM tables; GROUP BY;
 * HAVING; UNION / INTERSECT / EXCEPT; SELECT DISTINCT; an aggregate-only
 * projection; a subquery (parenthesised SELECT) in FROM; or anything we can't
 * confidently parse.
 */
export function detectSingleTableSelect(sql: string): SqlSource | null {
  const cleaned = stripComments(sql).trim();
  if (cleaned === "") return null;

  // Drop a single trailing `;` so it never leaks into the WHERE tail.
  const body = cleaned.replace(/;\s*$/, "").trim();

  // Must be a bare SELECT (not WITH / INSERT / etc.).
  if (!/^select\b/i.test(body)) return null;

  // SELECT DISTINCT [ON ...] is not a 1:1 row mapping.
  if (/^select\s+distinct\b/i.test(body)) return null;

  // Locate the top-level FROM that starts the table reference.
  const fromIdx = indexOfTopLevel(body, /\bfrom\b/iy);
  if (fromIdx === -1) return null;

  // The projection is everything between SELECT and FROM. Reject when it is a
  // single aggregate call (e.g. `SELECT count(*) FROM t`, `SELECT max(x) m`) —
  // such a result is one summary row, not editable base rows.
  const projection = body.slice("select".length, fromIdx).trim();
  if (isAggregateOnlyProjection(projection)) return null;

  // Everything after FROM: a table reference, then an optional tail.
  const afterFrom = body.slice(fromIdx + "from".length);

  // Reject any top-level disqualifying keyword anywhere in the statement.
  for (const re of REJECT_TOP_LEVEL) {
    if (hasTopLevel(body, re)) return null;
  }

  // Split the FROM region into the table-reference part and the tail (the
  // first of WHERE / GROUP BY / ORDER BY / LIMIT / OFFSET / WINDOW / FOR).
  const tailIdx = indexOfTopLevel(afterFrom, TAIL_RE);
  const tableRef = (tailIdx === -1 ? afterFrom : afterFrom.slice(0, tailIdx)).trim();
  const tail = tailIdx === -1 ? "" : afterFrom.slice(tailIdx);

  // A subquery in FROM begins with `(`. Not editable.
  if (tableRef.startsWith("(")) return null;

  // Comma at top level in the table reference => multiple FROM tables (an
  // implicit cross join). Not editable.
  if (hasTopLevel(tableRef, /,/y)) return null;

  // The table reference must match exactly: [schema.]table [[AS] alias].
  const m = FROM_RE.exec(tableRef);
  if (!m) return null;

  const schemaRaw = m[1];
  const tableRaw = m[2];
  const table = unquoteIdent(tableRaw);
  if (table === "") return null;
  const schema = schemaRaw != null ? unquoteIdent(schemaRaw) : null;

  return { schema, table, whereSql: captureWhere(tail) };
}

/**
 * From a FROM-tail that may begin with `WHERE ...`, return the WHERE text
 * (sans leading `WHERE`) up to the first GROUP BY / ORDER BY / LIMIT / OFFSET /
 * WINDOW / FOR. Returns `null` when the tail has no WHERE or an empty WHERE.
 */
function captureWhere(tail: string): string | null {
  if (!/^\s*where\b/i.test(tail)) return null;
  const afterWhere = tail.replace(/^\s*where\b/i, "");
  const endIdx = indexOfTopLevel(afterWhere, WHERE_END_RE);
  const clause = (endIdx === -1 ? afterWhere : afterWhere.slice(0, endIdx)).trim();
  return clause === "" ? null : clause;
}
