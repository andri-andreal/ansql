import { describe, it, expect } from "vitest";
import {
  processListQuery,
  killQuery,
  statusQuery,
  variablesQuery,
} from "./serverMonitor";

describe("processListQuery", () => {
  it("mysql uses SHOW FULL PROCESSLIST", () => {
    expect(processListQuery("mysql")).toBe("SHOW FULL PROCESSLIST");
  });

  it("postgres selects from pg_stat_activity", () => {
    expect(processListQuery("postgres")).toBe(
      "SELECT pid, usename, state, query, query_start FROM pg_stat_activity",
    );
  });

  it("sqlserver reads sys.dm_exec_requests with the sql text", () => {
    expect(processListQuery("sqlserver")).toBe(
      "SELECT session_id, login_name, status, command, text " +
        "FROM sys.dm_exec_requests CROSS APPLY sys.dm_exec_sql_text(sql_handle)",
    );
  });

  it("sqlite returns an empty string (not supported)", () => {
    expect(processListQuery("sqlite")).toBe("");
  });
});

describe("killQuery", () => {
  it("mysql uses KILL <id> (numeric id)", () => {
    expect(killQuery("mysql", 42)).toBe("KILL 42");
  });

  it("mysql uses KILL <id> (string id)", () => {
    expect(killQuery("mysql", "42")).toBe("KILL 42");
  });

  it("postgres uses pg_terminate_backend(<id>)", () => {
    expect(killQuery("postgres", 1234)).toBe("SELECT pg_terminate_backend(1234)");
  });

  it("postgres accepts a string id", () => {
    expect(killQuery("postgres", "1234")).toBe(
      "SELECT pg_terminate_backend(1234)",
    );
  });

  it("sqlserver uses KILL <session_id>", () => {
    expect(killQuery("sqlserver", 53)).toBe("KILL 53");
  });

  it("sqlite returns an empty string (not supported)", () => {
    expect(killQuery("sqlite", 1)).toBe("");
  });
});

describe("statusQuery", () => {
  it("mysql uses SHOW STATUS", () => {
    expect(statusQuery("mysql")).toBe("SHOW STATUS");
  });

  it("postgres selects name, setting from pg_settings", () => {
    expect(statusQuery("postgres")).toBe("SELECT name, setting FROM pg_settings");
  });

  it("sqlserver reads sys.configurations", () => {
    expect(statusQuery("sqlserver")).toBe(
      "SELECT name, value_in_use FROM sys.configurations",
    );
  });

  it("sqlite returns an empty string (not supported)", () => {
    expect(statusQuery("sqlite")).toBe("");
  });
});

describe("variablesQuery", () => {
  it("mysql uses SHOW VARIABLES", () => {
    expect(variablesQuery("mysql")).toBe("SHOW VARIABLES");
  });

  it("postgres selects name, setting from pg_settings", () => {
    expect(variablesQuery("postgres")).toBe(
      "SELECT name, setting FROM pg_settings",
    );
  });

  it("sqlserver reads sys.configurations", () => {
    expect(variablesQuery("sqlserver")).toBe(
      "SELECT name, value_in_use FROM sys.configurations",
    );
  });

  it("sqlite returns an empty string (not supported)", () => {
    expect(variablesQuery("sqlite")).toBe("");
  });
});
