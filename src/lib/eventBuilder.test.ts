import { describe, it, expect } from "vitest";
import {
  type EventSpec,
  eventTemplate,
  buildCreateEvent,
  buildAlterEvent,
  buildDropEvent,
  listEventsQuery,
} from "./eventBuilder";

// A baseline recurring spec other tests tweak via spread.
const everySpec: EventSpec = {
  name: "nightly_purge",
  scheduleKind: "every",
  everyValue: 1,
  everyUnit: "DAY",
  enabled: true,
  preserve: false,
  comment: null,
  body: "DELETE FROM logs WHERE created < NOW() - INTERVAL 30 DAY",
};

// A baseline one-shot spec.
const atSpec: EventSpec = {
  name: "one_shot",
  scheduleKind: "at",
  at: "2026-06-15 12:00:00",
  enabled: true,
  preserve: true,
  comment: null,
  body: "INSERT INTO marker VALUES (1)",
};

// ---------------------------------------------------------------------------
// eventTemplate
// ---------------------------------------------------------------------------
describe("eventTemplate", () => {
  it("returns a BEGIN…END starter body with a placeholder", () => {
    const t = eventTemplate();
    expect(t).toContain("BEGIN");
    expect(t).toContain("END");
    expect(t).toContain("-- event body");
  });
});

// ---------------------------------------------------------------------------
// buildCreateEvent
// ---------------------------------------------------------------------------
describe("buildCreateEvent", () => {
  it("creates a recurring event with EVERY, IF NOT EXISTS and a quoted name", () => {
    const [stmt] = buildCreateEvent(everySpec);
    expect(stmt.params).toEqual([]);
    expect(stmt.sql).toContain("CREATE EVENT IF NOT EXISTS `nightly_purge`");
    expect(stmt.sql).toContain("ON SCHEDULE EVERY 1 DAY");
    expect(stmt.sql).toContain("ON COMPLETION NOT PRESERVE");
    expect(stmt.sql).toContain("ENABLE");
    expect(stmt.sql).toContain(
      "DO DELETE FROM logs WHERE created < NOW() - INTERVAL 30 DAY",
    );
  });

  it("creates a one-shot event with AT and a quoted timestamp literal", () => {
    const [stmt] = buildCreateEvent(atSpec);
    expect(stmt.sql).toContain("ON SCHEDULE AT '2026-06-15 12:00:00'");
    expect(stmt.sql).toContain("ON COMPLETION PRESERVE");
    expect(stmt.sql).toContain("DO INSERT INTO marker VALUES (1)");
  });

  it("emits DISABLE when not enabled", () => {
    const [stmt] = buildCreateEvent({ ...everySpec, enabled: false });
    expect(stmt.sql).toContain("DISABLE");
    expect(stmt.sql).not.toMatch(/\bENABLE\b/);
  });

  it("includes a quoted COMMENT when present", () => {
    const [stmt] = buildCreateEvent({ ...everySpec, comment: "runs nightly" });
    expect(stmt.sql).toContain("COMMENT 'runs nightly'");
  });

  it("escapes single quotes in the COMMENT", () => {
    const [stmt] = buildCreateEvent({ ...everySpec, comment: "o'brien's job" });
    expect(stmt.sql).toContain("COMMENT 'o''brien''s job'");
  });

  it("omits COMMENT when null or empty", () => {
    expect(buildCreateEvent({ ...everySpec, comment: null })[0].sql).not.toContain(
      "COMMENT",
    );
    expect(buildCreateEvent({ ...everySpec, comment: "" })[0].sql).not.toContain(
      "COMMENT",
    );
  });

  it("defaults ON COMPLETION to NOT PRESERVE when preserve is undefined", () => {
    const spec = { ...everySpec };
    delete spec.preserve;
    expect(buildCreateEvent(spec)[0].sql).toContain("ON COMPLETION NOT PRESERVE");
  });

  it("escapes backticks in the event name", () => {
    const [stmt] = buildCreateEvent({ ...everySpec, name: "we`ird" });
    expect(stmt.sql).toContain("CREATE EVENT IF NOT EXISTS `we``ird`");
  });

  it("returns no statements on sqlserver (no scheduled events)", () => {
    expect(buildCreateEvent(everySpec, "sqlserver")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildAlterEvent
// ---------------------------------------------------------------------------
describe("buildAlterEvent", () => {
  it("alters an event re-stating schedule, completion, status and body", () => {
    const [stmt] = buildAlterEvent(everySpec);
    expect(stmt.params).toEqual([]);
    expect(stmt.sql).toContain("ALTER EVENT `nightly_purge`");
    expect(stmt.sql).not.toContain("IF NOT EXISTS");
    expect(stmt.sql).toContain("ON SCHEDULE EVERY 1 DAY");
    expect(stmt.sql).toContain("ON COMPLETION NOT PRESERVE");
    expect(stmt.sql).toContain("ENABLE");
    expect(stmt.sql).toContain("DO DELETE FROM logs");
  });

  it("alters a one-shot event with an AT schedule", () => {
    const [stmt] = buildAlterEvent(atSpec);
    expect(stmt.sql).toContain("ALTER EVENT `one_shot`");
    expect(stmt.sql).toContain("ON SCHEDULE AT '2026-06-15 12:00:00'");
  });

  it("returns no statements on sqlserver", () => {
    expect(buildAlterEvent(everySpec, "sqlserver")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildDropEvent
// ---------------------------------------------------------------------------
describe("buildDropEvent", () => {
  it("drops an event with IF EXISTS and a quoted name", () => {
    const [stmt] = buildDropEvent("nightly_purge");
    expect(stmt).toEqual({
      sql: "DROP EVENT IF EXISTS `nightly_purge`",
      params: [],
    });
  });

  it("escapes backticks in the dropped event name", () => {
    expect(buildDropEvent("we`ird")[0].sql).toBe(
      "DROP EVENT IF EXISTS `we``ird`",
    );
  });

  it("returns no statements on sqlserver", () => {
    expect(buildDropEvent("nightly_purge", "sqlserver")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listEventsQuery
// ---------------------------------------------------------------------------
describe("listEventsQuery", () => {
  it("selects from information_schema.EVENTS filtered by the database", () => {
    const sql = listEventsQuery("shop");
    expect(sql).toContain("information_schema.EVENTS");
    expect(sql).toContain("EVENT_NAME AS name");
    expect(sql).toContain("EVENT_DEFINITION AS definition");
    expect(sql).toContain("EVENT_SCHEMA = 'shop'");
  });

  it("escapes single quotes in the database name", () => {
    expect(listEventsQuery("o'brien")).toContain("EVENT_SCHEMA = 'o''brien'");
  });

  it("returns '' on sqlserver (no scheduled events)", () => {
    expect(listEventsQuery("shop", "sqlserver")).toBe("");
  });
});
