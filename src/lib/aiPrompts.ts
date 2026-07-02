import type { AiMessage } from "./aiProviders";

/**
 * Prompt templates for the "Ask AI" actions and a compact schema summariser.
 *
 * Each action produces a system + user message pair. The system message frames
 * Claude (or whichever provider is configured) as an expert SQL assistant for
 * the active dialect and, when available, includes a compact schema summary so
 * the model can reason about real tables/columns. The user message is shaped per
 * action: explain in plan-language, suggest an optimized rewrite with rationale,
 * convert to a target dialect, or fix using the reported error.
 */

export type AskAiAction = "explain" | "optimize" | "convert" | "fix";

export interface AskAiContext {
  dialect?: string;
  error?: string;
  schema?: string;
  targetDialect?: string;
}

function dialectLabel(dialect?: string): string {
  return dialect && dialect.trim() ? dialect.trim() : "SQL";
}

function buildSystemMessage(action: AskAiAction, ctx?: AskAiContext): AiMessage {
  const dialect = dialectLabel(ctx?.dialect);
  const lines: string[] = [
    `You are an expert ${dialect} database engineer and SQL assistant.`,
    "Be precise, practical, and concise. When you output SQL, wrap it in a ```sql fenced code block so it can be copied into an editor.",
  ];

  if (action === "explain") {
    lines.push(
      "Explain queries in clear plan-language: describe what the query does step by step, what it returns, and call out anything noteworthy (joins, filters, aggregation, potential full scans).",
    );
  } else if (action === "optimize") {
    lines.push(
      "When optimizing, return an improved rewrite and explain the rationale for each change (indexes, join order, sargability, avoiding SELECT *). Preserve the query's semantics.",
    );
  } else if (action === "convert") {
    lines.push(
      "When converting between dialects, faithfully preserve semantics and adapt dialect-specific syntax, functions, types, and quoting.",
    );
  } else if (action === "fix") {
    lines.push(
      "When fixing a query, use the provided error message to find the root cause, return the corrected SQL, and briefly explain what was wrong and how you fixed it.",
    );
  }

  if (ctx?.schema && ctx.schema.trim()) {
    lines.push("", "Database schema (table(col type, ...)):", ctx.schema.trim());
  }

  return { role: "system", content: lines.join("\n") };
}

function buildUserMessage(action: AskAiAction, sql: string, ctx?: AskAiContext): AiMessage {
  const dialect = dialectLabel(ctx?.dialect);
  const trimmedSql = sql.trim();
  const sqlBlock = "```sql\n" + trimmedSql + "\n```";
  const parts: string[] = [];

  if (action === "explain") {
    parts.push(`Explain what this ${dialect} query does in plan-language:`);
  } else if (action === "optimize") {
    parts.push(`Optimize this ${dialect} query and explain your rationale:`);
  } else if (action === "convert") {
    const target = dialectLabel(ctx?.targetDialect);
    parts.push(`Convert this ${dialect} query to ${target}:`);
  } else if (action === "fix") {
    parts.push(`Fix this ${dialect} query.`);
    if (ctx?.error && ctx.error.trim()) {
      parts.push(`It failed with the following error:\n${ctx.error.trim()}`);
    }
  }

  parts.push(sqlBlock);
  return { role: "user", content: parts.join("\n\n") };
}

export function buildAskAiMessages(
  action: AskAiAction,
  sql: string,
  ctx?: AskAiContext,
): AiMessage[] {
  return [buildSystemMessage(action, ctx), buildUserMessage(action, sql, ctx)];
}

export interface SummaryTable {
  name: string;
  columns?: { name: string; type?: string }[];
}

/**
 * Produce compact one-line-per-table schema text, e.g.
 *   users(id int, name text, ...)
 * capped at `maxTables` lines with a trailing note when truncated.
 */
export function buildSchemaSummary(tables: SummaryTable[], maxTables = 40): string {
  if (!tables || tables.length === 0) return "";

  const shown = tables.slice(0, Math.max(0, maxTables));
  const lines = shown.map((t) => {
    const cols = (t.columns ?? [])
      .map((c) => (c.type && c.type.trim() ? `${c.name} ${c.type.trim()}` : c.name))
      .join(", ");
    return `${t.name}(${cols})`;
  });

  if (tables.length > shown.length) {
    lines.push(`… and ${tables.length - shown.length} more tables`);
  }

  return lines.join("\n");
}
