import { Temporal } from "@js-temporal/polyfill";
import type { TestCalendarEvent } from "../integrations/gogcli-calendar.js";

/** Half-open intervals: adjacent meetings do not conflict. All-day ends are exclusive. */
export function dailyCalendar(
  events: TestCalendarEvent[],
  input: { date: string; timeZone: string; durationMinutes: number },
) {
  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 1 ||
    input.durationMinutes > 480
  ) {
    throw new Error("Invalid meeting duration");
  }
  const date = Temporal.PlainDate.from(input.date, { overflow: "reject" });
  const at = (day: Temporal.PlainDate, hour: number) =>
    day.toZonedDateTime({ timeZone: input.timeZone, plainTime: { hour } })
      .epochMilliseconds;
  const dayStart = at(date, 0);
  const dayEnd = at(date.add({ days: 1 }), 0);
  const seen = new Set<string>();
  const intervals = events
    .map((event) => {
      if (!event.eventId || seen.has(event.eventId))
        throw new Error("Duplicate or missing event identity");
      seen.add(event.eventId);
      const start = event.allDay
        ? at(Temporal.PlainDate.from(event.start, { overflow: "reject" }), 0)
        : Temporal.Instant.from(event.start).epochMilliseconds;
      const end = event.allDay
        ? at(Temporal.PlainDate.from(event.end, { overflow: "reject" }), 0)
        : Temporal.Instant.from(event.end).epochMilliseconds;
      if (end <= start) throw new Error("Invalid calendar interval");
      return { eventId: event.eventId, start, end };
    })
    .filter((event) => event.start < dayEnd && event.end > dayStart)
    .sort((a, b) => a.start - b.start || a.eventId.localeCompare(b.eventId));
  const iso = (value: number) =>
    Temporal.Instant.fromEpochMilliseconds(value).toString();
  const conflicts: { eventIds: string[]; start: string; end: string }[] = [];
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const start = Math.max(intervals[i].start, intervals[j].start, dayStart);
      const end = Math.min(intervals[i].end, intervals[j].end, dayEnd);
      if (start < end)
        conflicts.push({
          eventIds: [intervals[i].eventId, intervals[j].eventId],
          start: iso(start),
          end: iso(end),
        });
    }
  }
  // Synthetic profile's explicit working window; no claim about other calendars.
  const workStart = at(date, 9);
  const workEnd = at(date, 17);
  let cursor = workStart;
  const gaps: { start: string; end: string }[] = [];
  for (const event of intervals) {
    const start = Math.max(workStart, event.start);
    const end = Math.min(workEnd, event.end);
    if (end <= workStart || start >= workEnd) continue;
    if (start > cursor) gaps.push({ start: iso(cursor), end: iso(start) });
    cursor = Math.max(cursor, end);
  }
  if (cursor < workEnd) gaps.push({ start: iso(cursor), end: iso(workEnd) });
  const duration = input.durationMinutes * 60_000;
  const suggestedSlots = gaps
    .filter((gap) => Date.parse(gap.end) - Date.parse(gap.start) >= duration)
    .map((gap) => ({
      start: gap.start,
      end: iso(Date.parse(gap.start) + duration),
    }));
  return {
    date: date.toString(),
    timeZone: input.timeZone,
    dayStart: iso(dayStart),
    dayEnd: iso(dayEnd),
    eventIds: intervals.map((event) => event.eventId),
    conflicts,
    gaps,
    suggestedSlots,
    scope: "dedicated_test_calendar_only" as const,
  };
}
