import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CalendarCommandRunner = (
  executable: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

const runGog: CalendarCommandRunner = async (executable, args, options) => {
  const result = await execFileAsync(executable, args, options);
  return { stdout: result.stdout };
};

export type TestCalendarEvent = {
  eventId: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  allDay: boolean;
  contentTrust: "untrusted_external_content";
};

export type ListTestEventsResult =
  | { status: "success"; data: { events: TestCalendarEvent[] } }
  | {
      status: "failed_safe";
      error: {
        code:
          | "CALENDAR_NOT_CONFIGURED"
          | "CALENDAR_ACCOUNT_NOT_ALLOWED"
          | "CALENDAR_RANGE_INVALID"
          | "CALENDAR_PROVIDER_UNAVAILABLE"
          | "CALENDAR_PROVIDER_RESPONSE_INVALID";
        message: string;
        retryable: boolean;
      };
    };

function failure(
  code: Extract<
    ListTestEventsResult,
    { status: "failed_safe" }
  >["error"]["code"],
  message: string,
  retryable: boolean,
): ListTestEventsResult {
  return { status: "failed_safe", error: { code, message, retryable } };
}

function validRfc3339(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      value,
    ) && Number.isFinite(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(value: unknown): TestCalendarEvent | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) {
    return undefined;
  }
  const summary = typeof value.summary === "string" ? value.summary : "";
  if (summary.length > 500) return undefined;
  const description =
    typeof value.description === "string" ? value.description : undefined;
  if (description && description.length > 4000) return undefined;
  const startValue = value.start;
  const endValue = value.end;
  if (!isRecord(startValue) || !isRecord(endValue)) return undefined;

  if (
    typeof startValue.dateTime === "string" &&
    typeof endValue.dateTime === "string" &&
    validRfc3339(startValue.dateTime) &&
    validRfc3339(endValue.dateTime) &&
    Date.parse(endValue.dateTime) > Date.parse(startValue.dateTime)
  ) {
    return {
      eventId: value.id,
      summary,
      ...(description ? { description } : {}),
      start: startValue.dateTime,
      end: endValue.dateTime,
      allDay: false,
      contentTrust: "untrusted_external_content",
    };
  }

  if (
    typeof startValue.date === "string" &&
    typeof endValue.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(startValue.date) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endValue.date) &&
    startValue.date < endValue.date
  ) {
    return {
      eventId: value.id,
      summary,
      ...(description ? { description } : {}),
      start: startValue.date,
      end: endValue.date,
      allDay: true,
      contentTrust: "untrusted_external_content",
    };
  }
  return undefined;
}

export async function listTestCalendarEvents(
  input: { from: string; to: string; timeZone: string; maxResults: number },
  options: {
    configuredAccount?: string;
    configuredCalendarId?: string;
    runner?: CalendarCommandRunner;
  } = {},
): Promise<ListTestEventsResult> {
  const account = options.configuredAccount?.trim();
  const calendarId = options.configuredCalendarId?.trim();
  if (!account || !calendarId) {
    return failure(
      "CALENDAR_NOT_CONFIGURED",
      "A dedicated test Google account and calendar ID must be configured.",
      false,
    );
  }
  if (
    !/^[^\s@]+@gmail\.com$/i.test(account) ||
    calendarId.toLowerCase() === "primary" ||
    !/^[A-Za-z0-9._@-]{3,256}$/.test(calendarId)
  ) {
    return failure(
      "CALENDAR_ACCOUNT_NOT_ALLOWED",
      "Only the configured dedicated test account and named test calendar are allowed.",
      false,
    );
  }
  let timezoneValid = true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone });
  } catch {
    timezoneValid = false;
  }
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  if (
    !validRfc3339(input.from) ||
    !validRfc3339(input.to) ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from ||
    to - from > 31 * 24 * 60 * 60 * 1000 ||
    !timezoneValid ||
    !Number.isInteger(input.maxResults) ||
    input.maxResults < 1 ||
    input.maxResults > 50
  ) {
    return failure(
      "CALENDAR_RANGE_INVALID",
      "The calendar range, timezone, or result limit is invalid.",
      false,
    );
  }

  const args = [
    "--account",
    account,
    "--enable-commands-exact",
    "calendar.events",
    "--readonly",
    "--no-input",
    "--json",
    "calendar",
    "events",
    calendarId,
    `--from=${input.from}`,
    `--to=${input.to}`,
    `--max=${input.maxResults}`,
    `--timezone=${input.timeZone}`,
    "--fields=items(id,summary,description,status,transparency,start,end),nextPageToken",
  ];
  try {
    const { stdout } = await (options.runner ?? runGog)("gog", args, {
      timeout: 15_000,
      maxBuffer: 1_048_576,
    });
    const parsed: unknown = JSON.parse(stdout);
    if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
      return failure(
        "CALENDAR_PROVIDER_RESPONSE_INVALID",
        "The calendar provider returned an unsupported response.",
        false,
      );
    }
    if (parsed.events.length > input.maxResults) {
      return failure(
        "CALENDAR_PROVIDER_RESPONSE_INVALID",
        "The calendar provider returned more events than requested.",
        false,
      );
    }
    const events = parsed.events.map(parseEvent);
    if (events.some((event) => event === undefined)) {
      return failure(
        "CALENDAR_PROVIDER_RESPONSE_INVALID",
        "The calendar provider returned an unsupported event.",
        false,
      );
    }
    return {
      status: "success",
      data: { events: events as TestCalendarEvent[] },
    };
  } catch {
    return failure(
      "CALENDAR_PROVIDER_UNAVAILABLE",
      "The dedicated test calendar could not be queried safely.",
      true,
    );
  }
}
