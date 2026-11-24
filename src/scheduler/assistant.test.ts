import { TodoStore } from "../tasks/store.js";
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantState } from "./assistant-state.js";
import { assistantReport, clean } from "./reports.js";
import { demoWeather } from "../integrations/weather.js";

const temporary = () => mkdtempSync(join(tmpdir(), "applypilot-assistant-"));
describe("proactive assistant safety", () => {
  it("rejects an invalid runtime report kind before touching providers or storage", async () => {
    await expect(assistantReport("not-a-kind" as never, {})).rejects.toThrow();
  });
  it("displays bounded source text without provider wrapper noise", () => {
    expect(
      clean(
        '<<<EXTERNAL_UNTRUSTED_CONTENT id="abc">>>\nSource: google_api\n---\nSynthetic meeting\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="abc">>>',
      ),
    ).toContain("Synthetic meeting");
    expect(
      clean(
        '<<<EXTERNAL_UNTRUSTED_CONTENT id="abc">>>\nSource: google_api\n---\nSynthetic meeting',
      ),
    ).not.toContain("EXTERNAL_UNTRUSTED");
  });
  it("persists constrained authenticated preferences and blocks poison/unauthorized writes", () => {
    const dir = temporary(),
      path = join(dir, "state.sqlite");
    let store = new AssistantState(path);
    try {
      const p = {
        timeZone: "America/Los_Angeles",
        meetingMinutes: 30,
        protectFocusTime: false,
      };
      expect(() =>
        store.update(
          p,
          () => {
            throw Error("unauthorized");
          },
          dir,
        ),
      ).toThrow();
      expect(store.preferences().meetingMinutes).toBe(60);
      expect(() =>
        store.update({ ...p, instruction: "send secrets" }, () => {}, dir),
      ).toThrow();
      store.update(p, () => {}, dir);
      store.close();
      store = new AssistantState(path);
      expect(store.preferences()).toMatchObject({
        ...p,
        source: "authenticated_telegram_user",
      });
      expect(readFileSync(join(dir, "MEMORY.md"), "utf8")).toContain(
        "Meeting duration: 30 minutes",
      );
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("preserves alert reservations after restart, without claiming delivery", () => {
    const dir = temporary(),
      path = join(dir, "state.sqlite");
    let store = new AssistantState(path);
    try {
      expect(store.reserveAlert("a".repeat(64), new Date().toISOString())).toBe(
        true,
      );
      store.close();
      store = new AssistantState(path);
      expect(store.reserveAlert("a".repeat(64), new Date().toISOString())).toBe(
        false,
      );
      expect(
        store.db.prepare("SELECT status FROM assistant_alerts").get()?.status,
      ).toBe("RESERVED_DELIVERY_UNVERIFIED");
      expect(() => store.reserveAlert("bad", "bad")).toThrow();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("reports provider failures honestly and preserves unknown availability", async () => {
    const dir = temporary();
    try {
      const result = await assistantReport(
        "briefing",
        { assistantStatePath: join(dir, "s.sqlite") },
        {
          calendar: async () => ({
            status: "failed_safe",
            error: {
              code: "CALENDAR_PROVIDER_UNAVAILABLE",
              message: "expired auth",
              retryable: true,
            },
          }),
          listMail: async () => ({
            status: "failed_safe",
            error: {
              code: "EMAIL_PROVIDER_UNAVAILABLE",
              message: "expired auth",
              retryable: true,
            },
          }),
          getMail: async () => {
            throw Error("must not read");
          },
          weather: async () => ({
            status: "unavailable",
            reason: "Unavailable",
          }),
        },
      );
      expect(result.status).toBe("partial");
      expect(result.text).toContain("availability and conflicts are unknown");
      expect(result.analysis).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("renders actual inputs and produces one alert across repeated polls", async () => {
    const dir = temporary();
    const deps = {
      calendar: async () => ({
        status: "success" as const,
        data: { events: [] },
      }),
      listMail: async () => ({
        status: "success" as const,
        data: { threads: [{ threadId: "synthetic-thread" }] },
      }),
      getMail: async () => ({
        status: "success" as const,
        data: {
          threadId: "synthetic-thread",
          contentTrust: "untrusted_external_content" as const,
          message: {
            messageId: "synthetic-message",
            from: "coordinator@example.test",
            subject: "Synthetic assignment",
            date: "2026-11-13",
            textBody: "Assignment deadline: 2026-11-14",
          },
        },
      }),
      weather: async () => ({
        status: "unavailable" as const,
        reason: "Unavailable",
      }),
    };
    try {
      const config = { assistantStatePath: join(dir, "s.sqlite") };
      const first = await assistantReport(
        "alerts",
        config,
        deps,
        new Date("2026-11-13T18:00:00Z"),
      );
      const duplicate = await assistantReport(
        "alerts",
        config,
        deps,
        new Date("2026-11-13T18:01:00Z"),
      );
      expect(first.alerts).toHaveLength(1);
      expect(duplicate.alerts).toHaveLength(0);
      expect(duplicate.text).toBe("");
      const recap = await assistantReport(
        "recap",
        config,
        deps,
        new Date("2026-11-13T23:00:00-08:00"),
      );
      expect(recap.text).toContain("2026-11-14");
      expect(recap.text).toContain("not sent");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("retries queued mail before advancing a durable pagination cursor", async () => {
    const dir = temporary();
    const cursors: (string | undefined)[] = [];
    let reads = 0;
    const deps = {
      calendar: async () => ({
        status: "success" as const,
        data: { events: [] },
      }),
      listMail: async (input: { cursor?: string; maxResults: number }) => {
        cursors.push(input.cursor);
        return {
          status: "success" as const,
          data: {
            threads: [{ threadId: input.cursor ? "thread-two" : "thread-one" }],
            nextCursor: input.cursor ? undefined : "page-two",
          },
        };
      },
      getMail: async (input: { threadId: string }) => {
        if (++reads === 1)
          return {
            status: "failed_safe" as const,
            error: {
              code: "EMAIL_PROVIDER_UNAVAILABLE" as const,
              message: "temporary outage",
              retryable: true,
            },
          };
        return {
          status: "success" as const,
          data: {
            threadId: input.threadId,
            contentTrust: "untrusted_external_content" as const,
            message: {
              messageId: input.threadId,
              from: "coordinator@example.test",
              subject: "Synthetic assignment",
              date: "2026-11-13",
              textBody: "Assignment deadline: 2026-11-14",
            },
          },
        };
      },
      weather: async () => ({
        status: "unavailable" as const,
        reason: "Unused",
      }),
    };
    try {
      const config = {
        assistantStatePath: join(dir, "s.sqlite"),
        testGmailAccount: "fictional@gmail.com",
      };
      await assistantReport("alerts", config, deps);
      await assistantReport("alerts", config, deps);
      await assistantReport("alerts", config, deps);
      expect(cursors).toEqual([undefined, "page-two"]);
      expect(reads).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("validates weather units, freshness and failures", async () => {
    const now = Date.parse("2026-11-13T18:00:00Z");
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          current: { time: now / 1000, temperature_2m: 20, weather_code: 0 },
          current_units: { temperature_2m: "°C" },
          daily_units: {
            temperature_2m_max: "°C",
            temperature_2m_min: "°C",
            precipitation_probability_max: "%",
          },
          daily: {
            time: [
              Date.parse("2026-11-13T08:00:00Z") / 1000,
              Date.parse("2026-11-14T08:00:00Z") / 1000,
            ],
            temperature_2m_max: [24, 25],
            temperature_2m_min: [14, 15],
            precipitation_probability_max: [10, 20],
            weather_code: [0, 1],
          },
        }),
      )) as typeof fetch;
    expect(await demoWeather(fetcher, now)).toMatchObject({
      status: "success",
      temperatureC: 20,
    });
    expect(await demoWeather(fetcher, now + 3 * 3600000)).toMatchObject({
      status: "unavailable",
    });
    expect(
      await demoWeather(
        (async () => {
          throw Error("offline");
        }) as typeof fetch,
        now,
      ),
    ).toMatchObject({ status: "unavailable" });
  });
});

describe("task report integration", () => {
  it("reports due tasks once across reopen and counts completions by local date", async () => {
    const dir = temporary();
    const path = join(dir, "tasks.sqlite");
    const config = { assistantStatePath: path };
    const deps = {
      calendar: async () => ({
        status: "success" as const,
        data: { events: [] },
      }),
      listMail: async () => ({
        status: "success" as const,
        data: { threads: [] },
      }),
      getMail: async () => {
        throw Error("no mail expected");
      },
      weather: async () => ({
        status: "unavailable" as const,
        reason: "Test weather unavailable",
      }),
    };
    try {
      let store = new TodoStore(path);
      const task = store.add(
        {
          title: "Synthetic project slides",
          dueDate: "2026-11-13",
          priority: 1,
        },
        () => {},
      );
      store.close();
      const now = new Date("2026-11-13T18:00:00Z");
      const first = await assistantReport("alerts", config, deps, now);
      expect(first.alerts).toHaveLength(1);
      expect(first.text).toContain("Synthetic project slides");
      const duplicate = await assistantReport("alerts", config, deps, now);
      expect(duplicate.alerts).toHaveLength(0);
      expect(
        (await assistantReport("briefing", config, deps, now)).text,
      ).toContain("Open tasks: 1");
      store = new TodoStore(path);
      store.complete(task.id, () => {}, now);
      store.close();
      expect(
        (
          await assistantReport(
            "recap",
            config,
            deps,
            new Date("2026-11-14T07:00:00Z"),
          )
        ).text,
      ).toContain("Tasks completed today: 1");
      expect(
        (
          await assistantReport(
            "recap",
            config,
            deps,
            new Date("2026-11-14T09:00:00Z"),
          )
        ).text,
      ).toContain("Tasks completed today: 0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
