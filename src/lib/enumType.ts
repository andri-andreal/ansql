/**
 * Parses a MySQL ENUM / SET column's `full_type` into its member values.
 *
 * MySQL surfaces these as e.g. `enum('a','b','c')` or `set('x','y')` in the
 * column's full type. Values are single-quoted and MySQL escapes embedded
 * quotes by doubling them (`''`) — this parser handles that, plus backslash
 * escapes (`\'`) for good measure.
 *
 * Returns `null` for any non-enum/set type (case-insensitive prefix match).
 */
export interface ParsedEnumType {
  kind: "enum" | "set";
  values: string[];
}

export function parseEnumType(
  fullType: string | null | undefined
): ParsedEnumType | null {
  if (!fullType) return null;
  const trimmed = fullType.trim();

  const lower = trimmed.toLowerCase();
  let kind: "enum" | "set";
  if (lower.startsWith("enum")) kind = "enum";
  else if (lower.startsWith("set")) kind = "set";
  else return null;

  const open = trimmed.indexOf("(");
  const close = trimmed.lastIndexOf(")");
  if (open === -1 || close === -1 || close < open) return null;

  const body = trimmed.slice(open + 1, close);
  const values = parseQuotedList(body);
  return { kind, values };
}

/**
 * Splits a comma-separated list of single-quoted MySQL string literals into
 * their decoded values. Handles `''` and `\'` escapes inside a literal.
 */
function parseQuotedList(body: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = body.length;

  while (i < n) {
    // Skip whitespace / separators between literals.
    while (i < n && body[i] !== "'") i++;
    if (i >= n) break;
    i++; // consume opening quote

    let value = "";
    while (i < n) {
      const ch = body[i];
      if (ch === "\\" && i + 1 < n) {
        // Backslash escape — keep the next char literally.
        value += body[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'") {
        if (body[i + 1] === "'") {
          // Doubled quote → a literal single quote.
          value += "'";
          i += 2;
          continue;
        }
        i++; // closing quote
        break;
      }
      value += ch;
      i++;
    }
    out.push(value);
  }

  return out;
}
