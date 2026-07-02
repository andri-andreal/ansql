import { getTables, getColumns, type SchemaColumn } from "./queryPanelCommands";
import { getUserSnippets } from "../hooks/useSnippets";

/**
 * Schema-aware SQL autocomplete for Monaco.
 *
 * Provides a per-(session+database) schema cache plus a `monaco.languages`
 * completion provider that suggests keywords/snippets, table names, and
 * column names. Column suggestions are context-aware: after `FROM`/`JOIN`/
 * `UPDATE`/`INTO` we prefer tables; after `alias.` (or `table.`) we suggest
 * that relation's columns by resolving simple aliases from the current
 * statement's FROM/JOIN clauses.
 *
 * `monaco` and editor model types are loosely typed (`any`) so this module does
 * not need a direct dependency on `monaco-editor`'s type exports — the caller
 * (QueryEditor) passes the live `monaco` namespace it received in `onMount`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Monaco = any;
type Disposable = { dispose: () => void };

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET",
  "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "TRUNCATE", "JOIN",
  "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN", "ON",
  "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET", "DISTINCT", "AS",
  "AND", "OR", "NOT", "NULL", "IS NULL", "IS NOT NULL", "IN", "LIKE",
  "BETWEEN", "EXISTS", "UNION", "UNION ALL", "CASE", "WHEN", "THEN", "ELSE",
  "END", "ASC", "DESC", "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE",
  "INDEX", "PRIMARY KEY", "FOREIGN KEY", "REFERENCES", "DEFAULT", "WITH",
];

interface SnippetDef {
  label: string;
  insertText: string;
  detail: string;
}

const SQL_SNIPPETS: SnippetDef[] = [
  {
    label: "SELECT …",
    insertText: "SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};",
    detail: "SELECT statement",
  },
  {
    label: "INSERT …",
    insertText:
      "INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});",
    detail: "INSERT statement",
  },
  {
    label: "UPDATE …",
    insertText:
      "UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};",
    detail: "UPDATE statement",
  },
  {
    label: "DELETE …",
    insertText: "DELETE FROM ${1:table}\nWHERE ${2:condition};",
    detail: "DELETE statement",
  },
  {
    label: "INNER JOIN …",
    insertText: "INNER JOIN ${1:table} ON ${2:a} = ${3:b}",
    detail: "INNER JOIN clause",
  },
  {
    label: "LEFT JOIN …",
    insertText: "LEFT JOIN ${1:table} ON ${2:a} = ${3:b}",
    detail: "LEFT JOIN clause",
  },
  {
    label: "CREATE TABLE …",
    insertText:
      "CREATE TABLE ${1:name} (\n  ${2:id} INT PRIMARY KEY,\n  ${3:column} ${4:type}\n);",
    detail: "CREATE TABLE statement",
  },
];

// --- Schema cache, keyed by `${sessionId}::${database}` -----------------------

interface CachedSchema {
  tables: string[];
  /** Lower-cased table name -> its columns. */
  columns: Map<string, SchemaColumn[]>;
}

const schemaCache = new Map<string, CachedSchema>();
const inflightTables = new Map<string, Promise<void>>();
const inflightColumns = new Map<string, Promise<void>>();

function cacheKey(sessionId: string, database: string): string {
  return `${sessionId}::${database}`;
}

/** Invalidate the cache for a session+database (call when schema changes). */
export function invalidateSchemaCache(sessionId: string, database: string): void {
  schemaCache.delete(cacheKey(sessionId, database));
}

/**
 * Kick off (once) loading the table list for a session+database. Subsequent
 * calls reuse the in-flight promise / cached result. Best-effort: failures are
 * swallowed so autocomplete degrades to keywords-only.
 */
export function primeSchema(sessionId: string, database: string): void {
  const key = cacheKey(sessionId, database);
  if (schemaCache.has(key) || inflightTables.has(key)) return;
  const p = (async () => {
    try {
      const tables = await getTables(sessionId, database);
      schemaCache.set(key, {
        tables: tables.map((t) => t.name),
        columns: new Map(),
      });
    } catch {
      // leave uncached; keywords still work
    } finally {
      inflightTables.delete(key);
    }
  })();
  inflightTables.set(key, p);
}

function getCachedTables(sessionId: string, database: string): string[] {
  return schemaCache.get(cacheKey(sessionId, database))?.tables ?? [];
}

/** Load + cache columns for a table (best-effort, deduped). */
function ensureColumns(
  sessionId: string,
  database: string,
  table: string
): SchemaColumn[] {
  const key = cacheKey(sessionId, database);
  const entry = schemaCache.get(key);
  const lower = table.toLowerCase();
  if (entry?.columns.has(lower)) return entry.columns.get(lower)!;

  const colKey = `${key}::${lower}`;
  if (!inflightColumns.has(colKey)) {
    const p = (async () => {
      try {
        const cols = await getColumns(sessionId, database, table);
        const target = schemaCache.get(key);
        if (target) target.columns.set(lower, cols);
      } catch {
        // ignore — no column suggestions for this relation
      } finally {
        inflightColumns.delete(colKey);
      }
    })();
    inflightColumns.set(colKey, p);
  }
  return entry?.columns.get(lower) ?? [];
}

// --- Statement / context parsing ---------------------------------------------

/** Extract the current statement (text between surrounding `;`) around offset. */
function currentStatement(fullText: string, offset: number): string {
  const before = fullText.lastIndexOf(";", offset - 1);
  let after = fullText.indexOf(";", offset);
  if (after === -1) after = fullText.length;
  return fullText.slice(before + 1, after);
}

/**
 * Map aliases -> table names within a statement by scanning FROM/JOIN/UPDATE/INTO
 * targets. Handles `table alias`, `table AS alias`, and bare `table`.
 */
function buildAliasMap(statement: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /\b(?:from|join|update|into)\s+([a-zA-Z_][\w$]*)(?:\s+(?:as\s+)?([a-zA-Z_][\w$]*))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(statement)) !== null) {
    const table = m[1];
    const alias = m[2];
    // self-reference: the table name itself qualifies its own columns
    map.set(table.toLowerCase(), table);
    if (alias && !isKeyword(alias)) {
      map.set(alias.toLowerCase(), table);
    }
  }
  return map;
}

const KEYWORD_SET = new Set(
  ["on", "where", "set", "values", "as", "group", "order", "having",
    "limit", "inner", "left", "right", "full", "cross", "join", "and", "or",
    "select"].map((k) => k)
);
function isKeyword(word: string): boolean {
  return KEYWORD_SET.has(word.toLowerCase());
}

/** True when the text immediately before the cursor expects a table name. */
function expectsTable(textBeforeCursor: string): boolean {
  return /\b(from|join|update|into)\s+[\w$]*$/i.test(textBeforeCursor);
}

/**
 * If the cursor sits right after `<ident>.` return the identifier (alias/table),
 * else null.
 */
function qualifierBeforeCursor(textBeforeCursor: string): string | null {
  const m = /([a-zA-Z_][\w$]*)\.\s*[\w$]*$/.exec(textBeforeCursor);
  return m ? m[1] : null;
}

// --- Provider registration ----------------------------------------------------

interface SchemaContext {
  sessionId: string | null;
  database: string | null;
}

/**
 * Per-editor context registry.
 *
 * Monaco registers completion providers at the LANGUAGE level, and aggregates
 * suggestions from EVERY registered provider. The global tabbed workspace keeps
 * all query editors mounted at once, so naively registering one provider per
 * editor produced N duplicate "sql" providers (and N× duplicate suggestions).
 *
 * Instead we register a SINGLE shared provider for the language (the first time
 * any editor mounts) and route per-editor schema context through this registry.
 * The provider resolves the context for the model it is invoked against; if a
 * specific model has no registered context (edge case), it falls back to the
 * most-recently registered one so suggestions still work.
 */
const contextRegistry = new Set<() => SchemaContext>();
let lastRegisteredContext: (() => SchemaContext) | null = null;
let sharedProvider: Disposable | null = null;

function resolveContext(): SchemaContext {
  // Only one editor is focused at a time, and Monaco invokes the provider for
  // that editor's model. We can't map model -> context without the model id, so
  // use the most-recently-registered (typically the active) editor's context.
  const get = lastRegisteredContext;
  return get ? get() : { sessionId: null, database: null };
}

/**
 * Register the SQL completion provider for an editor. The first caller installs
 * a single language-level provider; later callers only add their context to the
 * registry (no extra Monaco provider). The provider reads the live session +
 * database from the active context on each invocation, so the editor can change
 * connection/database without re-registering. Returns a disposable that removes
 * this editor's context (and tears down the shared provider when the last
 * editor unmounts).
 */
export function registerSqlCompletion(
  monaco: Monaco,
  getContext: () => SchemaContext
): Disposable {
  contextRegistry.add(getContext);
  lastRegisteredContext = getContext;

  if (!sharedProvider) {
    sharedProvider = installSharedProvider(monaco);
  }

  return {
    dispose() {
      contextRegistry.delete(getContext);
      if (lastRegisteredContext === getContext) {
        // Point the active context at any remaining editor.
        const remaining = Array.from(contextRegistry);
        lastRegisteredContext = remaining.length
          ? remaining[remaining.length - 1]
          : null;
      }
      // Tear down the shared provider once no editors remain.
      if (contextRegistry.size === 0 && sharedProvider) {
        sharedProvider.dispose();
        sharedProvider = null;
      }
    },
  };
}

function installSharedProvider(monaco: Monaco): Disposable {
  return monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " "],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideCompletionItems(model: any, position: any) {
      const { sessionId, database } = resolveContext();

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const offset = model.getOffsetAt(position);
      const fullText = model.getValue();
      const textBeforeCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const statement = currentStatement(fullText, offset);
      const Kind = monaco.languages.CompletionItemKind;
      const InsertRule =
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

      const suggestions: unknown[] = [];

      const schemaReady = !!sessionId && !!database;
      if (schemaReady) primeSchema(sessionId!, database!);

      // 1) `alias.` / `table.` -> that relation's columns
      const qualifier = qualifierBeforeCursor(textBeforeCursor);
      if (qualifier && schemaReady) {
        const aliasMap = buildAliasMap(statement);
        const table = aliasMap.get(qualifier.toLowerCase()) ?? qualifier;
        const cols = ensureColumns(sessionId!, database!, table);
        for (const c of cols) {
          suggestions.push({
            label: c.name,
            kind: Kind.Field,
            insertText: c.name,
            detail: `${c.full_type ?? c.data_type}${c.is_primary_key ? " · PK" : ""} (${table})`,
            range,
            sortText: `0_${c.name}`,
          });
        }
        // After a qualifier we only want that relation's columns.
        return { suggestions };
      }

      // 2) Table-expecting context -> tables first
      const wantsTable = expectsTable(textBeforeCursor);
      if (schemaReady) {
        for (const t of getCachedTables(sessionId!, database!)) {
          suggestions.push({
            label: t,
            kind: Kind.Struct,
            insertText: t,
            detail: "table",
            range,
            sortText: `${wantsTable ? "0" : "2"}_${t}`,
          });
        }

        // 3) Bare column suggestions from tables referenced in this statement
        if (!wantsTable) {
          const aliasMap = buildAliasMap(statement);
          const seen = new Set<string>();
          for (const table of new Set(aliasMap.values())) {
            for (const c of ensureColumns(sessionId!, database!, table)) {
              if (seen.has(c.name.toLowerCase())) continue;
              seen.add(c.name.toLowerCase());
              suggestions.push({
                label: c.name,
                kind: Kind.Field,
                insertText: c.name,
                detail: `${c.full_type ?? c.data_type} (${table})`,
                range,
                sortText: `1_${c.name}`,
              });
            }
          }
        }
      }

      // 4) Keywords (always) — deprioritized when a table is expected
      for (const kw of SQL_KEYWORDS) {
        suggestions.push({
          label: kw,
          kind: Kind.Keyword,
          insertText: kw,
          range,
          sortText: `${wantsTable ? "3" : "4"}_${kw}`,
        });
      }

      // 5) Snippets (built-in)
      const snippetLabels = new Set<string>();
      for (const s of SQL_SNIPPETS) {
        snippetLabels.add(s.label);
        suggestions.push({
          label: s.label,
          kind: Kind.Snippet,
          insertText: s.insertText,
          insertTextRules: InsertRule,
          detail: s.detail,
          range,
          sortText: `5_${s.label}`,
        });
      }

      // 6) Snippets (user library) — skip empty bodies / duplicate labels.
      for (const s of getUserSnippets()) {
        if (!s.body.trim() || snippetLabels.has(s.name)) continue;
        snippetLabels.add(s.name);
        suggestions.push({
          label: s.name,
          kind: Kind.Snippet,
          insertText: s.body,
          insertTextRules: InsertRule,
          detail: "user snippet",
          documentation: s.description,
          range,
          sortText: `6_${s.name}`,
        });
      }

      return { suggestions };
    },
  });
}
