/**
 * Named SQL parameter helpers for the query editor's [$name] placeholders.
 *
 * A placeholder is written as `[$name]` where `name` is one or more
 * ASCII letters, digits or underscores. These helpers either extract the
 * ordered list of distinct names, or rewrite the buffer into a
 * dialect-appropriate parameterized statement (with a collected params
 * array), or perform a literal string substitution for the "Raw mode" toggle.
 *
 * String/comment awareness note: detecting placeholders that live inside
 * string literals or comments is a NICE-TO-HAVE. We deliberately use a single
 * regex over the whole buffer for simplicity — a `[$name]` token inside a
 * string or `-- comment` WILL be treated as a placeholder. This keeps the
 * helpers pure and predictable; callers that need literal `[$...]` text inside
 * strings should avoid that token.
 */

import type { Dialect, ParamValue } from "../types";

/** Matches `[$name]` placeholders; capture group 1 is the bare name. */
const PARAM_RE = /\[\$([A-Za-z0-9_]+)\]/g;

/**
 * Return the ordered, de-duplicated list of names referenced by `[$name]`
 * placeholders in `sql`. Order follows first appearance in the buffer.
 */
export function extractParamNames(sql: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of sql.matchAll(PARAM_RE)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export interface AppliedParams {
  sql: string;
  params: ParamValue[];
}

/**
 * Rewrite each `[$name]` occurrence into a dialect placeholder and collect the
 * matching values into `params`.
 *
 * - mysql / sqlite: every occurrence becomes `?`, and the value is pushed once
 *   per occurrence (repeated names => repeated values).
 * - postgres: each DISTINCT name maps to a stable `$n` (1-based, assigned in
 *   first-appearance order); reusing a name reuses its `$n` and the value is
 *   pushed only ONCE into `params`. This keeps the params array aligned with
 *   the `$n` indices, which is what node-postgres / sqlx-postgres expect.
 *
 * Values default to "" when a referenced name is missing from `values`.
 */
export function applyParamsAsPlaceholders(
  sql: string,
  values: Record<string, string>,
  dialect: Dialect
): AppliedParams {
  const params: ParamValue[] = [];

  if (dialect === "postgres") {
    // Stable $n per distinct name, value pushed once.
    const indexByName = new Map<string, number>();
    const rewritten = sql.replace(PARAM_RE, (_full, name: string) => {
      let idx = indexByName.get(name);
      if (idx === undefined) {
        idx = indexByName.size + 1;
        indexByName.set(name, idx);
        params.push(values[name] ?? "");
      }
      return `$${idx}`;
    });
    return { sql: rewritten, params };
  }

  // mysql / sqlite: positional `?`, value pushed per occurrence.
  const rewritten = sql.replace(PARAM_RE, (_full, name: string) => {
    params.push(values[name] ?? "");
    return "?";
  });
  return { sql: rewritten, params };
}

/**
 * Literal string substitution: replace each `[$name]` with the raw user value
 * verbatim (no quoting or escaping). Used by the "Raw mode" toggle where the
 * caller takes responsibility for the resulting SQL. Missing values default
 * to "".
 */
export function applyParamsRaw(
  sql: string,
  values: Record<string, string>
): string {
  return sql.replace(PARAM_RE, (_full, name: string) => values[name] ?? "");
}
