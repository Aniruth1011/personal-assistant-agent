import { describe, expect, it, vi } from "vitest";
import { listTestCalendarEvents } from "./gogcli-calendar.js";

const baseInput = {
  from: "2026-11-12T00:00:00-08:00",
  to: "2026-11-13T00:00:00-08:00",
  timeZone: "America/Los_Angeles",
  maxResults: 10,
};

const baseOptions = {
  configuredAccount: "applypilot-test@gmail.com",
  configuredCalendarId: "synthetic-calendar@group.calendar.google.com",
};

describe("dedicated Google Calendar read adapter", () => {
  it("lists bounded timed and all-day events using a read-only exact command", async () => {
    const calls: Array<{ executable: string; args: string[] }> = [];
    const runner = vi.fn(async (executable: string, args: string[]) => {
      calls.push({ executable, args });
      return {
        stdout: JSON.stringify({
          events: [
            {
              id: "meeting-event-1",
              summary: "Synthetic meeting",
              start: { dateTime: "2026-11-12T10:00:00-08:00" },
              end: { dateTime: "2026-11-12T10:45:00-08:00" },
            },
            {
              id: "all-day-event-1",
              summary: "Synthetic all-day note",
              start: { date: "2026-11-12" },
              end: { date: "2026-11-13" },
            },
          ],
        }),
      };
    });
    const result = await listTestCalendarEvents(baseInput, {
      ...baseOptions,
      runner,
    });

    expect(result).toMatchObject({
      status: "success",
      data: {
        events: [
          {
            eventId: "meeting-event-1",
            summary: "Synthetic meeting",
            start: "2026-11-12T10:00:00-08:00",
            end: "2026-11-12T10:45:00-08:00",
            allDay: false,
            contentTrust: "untrusted_external_content",
          },
          {
            eventId: "all-day-event-1",
            allDay: true,
            contentTrust: "untrusted_external_content",
          },
        ],
      },
    });
    expect(calls[0]?.executable).toBe("gog");
    expect(calls[0]?.args).toContain("--readonly");
    expect(calls[0]?.args).toContain("calendar.events");
    expect(calls[0]?.args).toContain(
      "--fields=items(id,summary,description,status,transparency,start,end),nextPageToken",
    );
    expect(calls[0]?.args).toContain(baseOptions.configuredCalendarId);
    expect(
      calls[0]?.args.indexOf(
        "--fields=items(id,summary,description,status,transparency,start,end),nextPageToken",
      ),
    ).toBeGreaterThan(
      calls[0]?.args.indexOf(baseOptions.configuredCalendarId) ?? -1,
    );
    expect(calls[0]?.args).not.toContain("calendar.create");
    expect(calls[0]?.args).not.toContain("calendar.update");
  });

  it("rejects primary calendar, invalid range, and unsafe provider output before returning events", async () => {
    const runner = vi.fn(async () => ({ stdout: '{"events":[]}' }));
    const noTestCalendar = await listTestCalendarEvents(baseInput, {
      ...baseOptions,
      configuredCalendarId: "primary",
      runner,
    });
    const invalidRange = await listTestCalendarEvents(
      { ...baseInput, from: "2026-11-12T00:00:00" },
      { ...baseOptions, runner },
    );
    expect(noTestCalendar).toMatchObject({
      status: "failed_safe",
      error: { code: "CALENDAR_ACCOUNT_NOT_ALLOWED", retryable: false },
    });
    expect(invalidRange).toMatchObject({
      status: "failed_safe",
      error: { code: "CALENDAR_RANGE_INVALID", retryable: false },
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("fails safely on provider outage and malformed event data", async () => {
    const outage = await listTestCalendarEvents(baseInput, {
      ...baseOptions,
      runner: async () => {
        throw new Error("synthetic calendar outage");
      },
    });
    const malformed = await listTestCalendarEvents(baseInput, {
      ...baseOptions,
      runner: async () => ({
        stdout: JSON.stringify({
          events: [
            {
              id: "broken",
              summary: "Bad interval",
              start: { dateTime: "2026-11-12T10:00:00-08:00" },
              end: { dateTime: "2026-11-12T09:00:00-08:00" },
            },
          ],
        }),
      }),
    });
    expect(outage).toMatchObject({
      status: "failed_safe",
      error: { code: "CALENDAR_PROVIDER_UNAVAILABLE", retryable: true },
    });
    expect(malformed).toMatchObject({
      status: "failed_safe",
      error: {
        code: "CALENDAR_PROVIDER_RESPONSE_INVALID",
        retryable: false,
      },
    });
  });
});
