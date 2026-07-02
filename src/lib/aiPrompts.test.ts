import { describe, it, expect } from "vitest";
import { buildAskAiMessages, buildSchemaSummary, type AskAiAction } from "./aiPrompts";

const SQL = "SELECT id, name FROM users WHERE id = 1";

describe("buildAskAiMessages", () => {
  const actions: AskAiAction[] = ["explain", "optimize", "convert", "fix"];

  it.each(actions)("returns a system+user pair for %s", (action) => {
    const msgs = buildAskAiMessages(action, SQL, { dialect: "postgres", targetDialect: "mysql", error: "boom" });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    // the SQL is embedded in the user message inside a fenced block
    expect(msgs[1].content).toContain(SQL);
    expect(msgs[1].content).toContain("```sql");
  });

  it("frames the system message for the given dialect", () => {
    const [system] = buildAskAiMessages("explain", SQL, { dialect: "sqlite" });
    expect(system.content.toLowerCase()).toContain("sqlite");
    expect(system.content.toLowerCase()).toContain("plan-language");
  });

  it("defaults dialect to SQL when none provided", () => {
    const [system] = buildAskAiMessages("explain", SQL);
    expect(system.content).toContain("SQL");
  });

  it("convert references the target dialect in the user message", () => {
    const [, user] = buildAskAiMessages("convert", SQL, { dialect: "postgres", targetDialect: "mysql" });
    expect(user.content.toLowerCase()).toContain("mysql");
  });

  it("fix includes the error text", () => {
    const [, user] = buildAskAiMessages("fix", SQL, { dialect: "postgres", error: "syntax error near WHERE" });
    expect(user.content).toContain("syntax error near WHERE");
  });

  it("includes schema in the system message when provided", () => {
    const schema = "users(id int, name text)";
    const [system] = buildAskAiMessages("optimize", SQL, { dialect: "postgres", schema });
    expect(system.content).toContain(schema);
  });
});

describe("buildSchemaSummary", () => {
  it("produces compact table(col type, ...) lines", () => {
    const out = buildSchemaSummary([
      { name: "users", columns: [{ name: "id", type: "int" }, { name: "name", type: "text" }] },
    ]);
    expect(out).toBe("users(id int, name text)");
  });

  it("omits the type when absent", () => {
    const out = buildSchemaSummary([{ name: "t", columns: [{ name: "a" }] }]);
    expect(out).toBe("t(a)");
  });

  it("handles tables with no columns", () => {
    expect(buildSchemaSummary([{ name: "empty" }])).toBe("empty()");
  });

  it("returns empty string for no tables", () => {
    expect(buildSchemaSummary([])).toBe("");
  });

  it("caps at maxTables and notes truncation", () => {
    const tables = Array.from({ length: 5 }, (_, i) => ({ name: `t${i}` }));
    const out = buildSchemaSummary(tables, 2);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3); // 2 tables + 1 truncation note
    expect(lines[0]).toBe("t0()");
    expect(lines[1]).toBe("t1()");
    expect(lines[2]).toContain("3 more tables");
  });

  it("does not add a truncation note when under the cap", () => {
    const out = buildSchemaSummary([{ name: "a" }, { name: "b" }], 40);
    expect(out).not.toContain("more tables");
  });
});
