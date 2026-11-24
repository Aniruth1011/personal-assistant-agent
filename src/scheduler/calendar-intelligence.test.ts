import { describe, expect, it } from "vitest";
import { dailyCalendar } from "./calendar-intelligence.js";
import type { TestCalendarEvent } from "../integrations/gogcli-calendar.js";
const input = {
  date: "2026-11-13",
  timeZone: "America/Los_Angeles",
  durationMinutes: 60,
};
const event = (
  eventId: string,
  start: string,
  end: string,
  allDay = false,
): TestCalendarEvent => ({
  eventId,
  start,
  end,
  allDay,
  summary: "Untrusted title",
  contentTrust: "untrusted_external_content",
});
describe("deterministic calendar intelligence", () => {
  it("finds exact overlap and feasible gaps without mutating input", () => {
    const events = [
      event("a", "2026-11-13T23:00:00Z", "2026-11-14T00:00:00Z"),
      event("b", "2026-11-13T23:30:00Z", "2026-11-14T00:30:00Z"),
    ];
    const before = JSON.stringify(events);
    const result = dailyCalendar(events, input);
    expect(result.conflicts).toEqual([
      {
        eventIds: ["a", "b"],
        start: "2026-11-13T23:30:00Z",
        end: "2026-11-14T00:00:00Z",
      },
    ]);
    expect(result.gaps).toEqual([
      { start: "2026-11-13T17:00:00Z", end: "2026-11-13T23:00:00Z" },
      { start: "2026-11-14T00:30:00Z", end: "2026-11-14T01:00:00Z" },
    ]);
    expect(result.suggestedSlots).toEqual([
      { start: "2026-11-13T17:00:00Z", end: "2026-11-13T18:00:00Z" },
    ]);
    expect(JSON.stringify(events)).toBe(before);
  });
  it("does not treat adjacent meetings as conflicting", () => {
    expect(
      dailyCalendar(
        [
          event("a", "2026-11-13T17:00:00Z", "2026-11-13T18:00:00Z"),
          event("b", "2026-11-13T18:00:00Z", "2026-11-13T19:00:00Z"),
        ],
        input,
      ).conflicts,
    ).toEqual([]);
  });
  it("uses exclusive all-day end and blocks availability conservatively", () => {
    const events = [event("all", "2026-11-13", "2026-11-14", true)];
    expect(dailyCalendar(events, input).gaps).toEqual([]);
    expect(
      dailyCalendar(events, { ...input, date: "2026-11-14" }).eventIds,
    ).toEqual([]);
  });
  it.each([
    ["2026-03-08", 23],
    ["2026-11-01", 25],
  ])("uses actual DST day length %s", (date, hours) => {
    const result = dailyCalendar([], { ...input, date: String(date) });
    expect(
      (Date.parse(result.dayEnd) - Date.parse(result.dayStart)) / 3_600_000,
    ).toBe(hours);
  });
  it("rejects invalid dates, timezone, duration, duplicate identity and reverse intervals", () => {
    expect(() => dailyCalendar([], { ...input, date: "2026-02-30" })).toThrow();
    expect(() =>
      dailyCalendar([], { ...input, timeZone: "invalid" }),
    ).toThrow();
    expect(() => dailyCalendar([], { ...input, durationMinutes: 0 })).toThrow();
    const a = event("a", "2026-11-13", "2026-11-14", true);
    expect(() => dailyCalendar([a, a], input)).toThrow();
    expect(() =>
      dailyCalendar([{ ...a, start: a.end, end: a.start }], input),
    ).toThrow();
  });
});
