import { Temporal } from "@js-temporal/polyfill";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GogCommandRunner = (
  executable: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

const runGog: GogCommandRunner = async (executable, args, options) => {
  const result = await execFileAsync(executable, args, options);
  return { stdout: result.stdout };
};

export type ListedEmailThread = {
  threadId: string;
};

export type ListTestEmailsResult =
  | {
      status: "success";
      data: { threads: ListedEmailThread[]; nextCursor?: string };
    }
  | {
      status: "failed_safe";
      error: {
        code:
          | "EMAIL_ACCOUNT_NOT_CONFIGURED"
          | "EMAIL_ACCOUNT_NOT_ALLOWED"
          | "EMAIL_PROVIDER_UNAVAILABLE"
          | "EMAIL_PROVIDER_RESPONSE_INVALID";
        message: string;
        retryable: boolean;
      };
    };

export type RetrievedTestEmail = {
  messageId: string;
  from: string;
  to?: string;
  subject: string;
  date: string;
  textBody: string;
};

export type GetTestEmailResult =
  | {
      status: "success";
      data: {
        threadId: string;
        message: RetrievedTestEmail;
        contentTrust: "untrusted_external_content";
      };
    }
  | {
      status: "failed_safe";
      error: {
        code:
          | "EMAIL_ACCOUNT_NOT_CONFIGURED"
          | "EMAIL_ACCOUNT_NOT_ALLOWED"
          | "EMAIL_THREAD_ID_INVALID"
          | "EMAIL_THREAD_NOT_FOUND"
          | "EMAIL_MESSAGE_TOO_LARGE"
          | "EMAIL_PROVIDER_UNAVAILABLE"
          | "EMAIL_PROVIDER_RESPONSE_INVALID";
        message: string;
        retryable: boolean;
      };
    };

type EmailProviderErrorCode =
  | "EMAIL_ACCOUNT_NOT_CONFIGURED"
  | "EMAIL_ACCOUNT_NOT_ALLOWED"
  | "EMAIL_PROVIDER_UNAVAILABLE"
  | "EMAIL_PROVIDER_RESPONSE_INVALID";

function failed(
  code: EmailProviderErrorCode,
  message: string,
  retryable: boolean,
): ListTestEmailsResult {
  return { status: "failed_safe", error: { code, message, retryable } };
}

export async function listTestEmailThreads(
  input: {
    cursor?: string;
    maxResults: number;
    briefing?: boolean;
    unreadOnly?: boolean;
    sender?: string;
    after?: string;
  },
  options: {
    configuredAccount?: string;
    runner?: GogCommandRunner;
  } = {},
): Promise<ListTestEmailsResult> {
  const account = options.configuredAccount?.trim();
  if (!account) {
    return failed(
      "EMAIL_ACCOUNT_NOT_CONFIGURED",
      "The dedicated synthetic Gmail account is not configured.",
      false,
    );
  }
  if (!/^[^\s@]+@gmail\.com$/i.test(account)) {
    return failed(
      "EMAIL_ACCOUNT_NOT_ALLOWED",
      "Only the configured dedicated Gmail test account can be queried.",
      false,
    );
  }
  if (
    !Number.isInteger(input.maxResults) ||
    input.maxResults < 1 ||
    input.maxResults > 10
  ) {
    return failed(
      "EMAIL_PROVIDER_RESPONSE_INVALID",
      "The requested page size is outside the supported range.",
      false,
    );
  }
  if (input.cursor && !/^[A-Za-z0-9_-]{1,2048}$/.test(input.cursor)) {
    return failed(
      "EMAIL_PROVIDER_RESPONSE_INVALID",
      "The Gmail pagination cursor is invalid.",
      false,
    );
  }

  if (
    (input.sender && !/^[a-z0-9_.+@-]{1,120}$/i.test(input.sender)) ||
    (input.after && !/^\d{4}-\d{2}-\d{2}$/.test(input.after))
  )
    return failed(
      "EMAIL_PROVIDER_RESPONSE_INVALID",
      "Invalid sender or date filter.",
      false,
    );
  const projectQuery = "newer_than:30d subject:synthetic";
  const filter = `${input.sender ? ` from:${input.sender}` : ""}${input.after ? ` after:${input.after.replaceAll("-", "/")}` : ""}`;
  const args = [
    "--account",
    account,
    "--enable-commands-exact",
    "gmail.search",
    "--gmail-no-send",
    "--readonly",
    "--no-input",
    "--json",
    "gmail",
    "search",
    input.unreadOnly
      ? "newer_than:30d subject:synthetic is:unread"
      : input.briefing
        ? "newer_than:30d subject:synthetic {is:unread is:starred is:important}"
        : projectQuery,
    "--max",
    String(input.maxResults),
    "--ids-only",
  ];
  const queryIndex = args.indexOf("search") + 1;
  args[queryIndex] += filter;
  if (input.cursor) args.push("--page", input.cursor);

  try {
    const { stdout } = await (options.runner ?? runGog)("gog", args, {
      timeout: 15_000,
      maxBuffer: 1_048_576,
    });
    const parsed: unknown = JSON.parse(stdout);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("threads" in parsed) ||
      !Array.isArray(parsed.threads)
    ) {
      return failed(
        "EMAIL_PROVIDER_RESPONSE_INVALID",
        "The Gmail provider returned an unsupported response.",
        false,
      );
    }
    const threads: ListedEmailThread[] = [];
    for (const thread of parsed.threads) {
      if (
        typeof thread !== "object" ||
        thread === null ||
        !("id" in thread) ||
        typeof thread.id !== "string" ||
        thread.id.length === 0
      ) {
        return failed(
          "EMAIL_PROVIDER_RESPONSE_INVALID",
          "The Gmail provider returned an unsupported thread identifier.",
          false,
        );
      }
      threads.push({ threadId: thread.id });
    }
    const nextCursor =
      "nextPageToken" in parsed && typeof parsed.nextPageToken === "string"
        ? parsed.nextPageToken
        : undefined;
    return {
      status: "success",
      data: { threads, ...(nextCursor ? { nextCursor } : {}) },
    };
  } catch {
    return failed(
      "EMAIL_PROVIDER_UNAVAILABLE",
      "The dedicated Gmail inbox could not be queried safely.",
      true,
    );
  }
}

export async function getTestEmailThread(
  input: {
    threadId: string;
    unreadOnly?: boolean;
    sender?: string;
    after?: string;
  },
  options: {
    configuredAccount?: string;
    runner?: GogCommandRunner;
  } = {},
): Promise<GetTestEmailResult> {
  const fail = (
    code: Extract<
      GetTestEmailResult,
      { status: "failed_safe" }
    >["error"]["code"],
    message: string,
    retryable: boolean,
  ): GetTestEmailResult => ({
    status: "failed_safe",
    error: { code, message, retryable },
  });
  const account = options.configuredAccount?.trim();
  if (!account) {
    return fail(
      "EMAIL_ACCOUNT_NOT_CONFIGURED",
      "The dedicated synthetic Gmail account is not configured.",
      false,
    );
  }
  if (!/^[^\s@]+@gmail\.com$/i.test(account)) {
    return fail(
      "EMAIL_ACCOUNT_NOT_ALLOWED",
      "Only the configured dedicated Gmail test account can be queried.",
      false,
    );
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.threadId)) {
    return fail(
      "EMAIL_THREAD_ID_INVALID",
      "The requested synthetic email thread ID is invalid.",
      false,
    );
  }

  const args = [
    "--account",
    account,
    "--enable-commands-exact",
    "gmail.thread.get",
    "--gmail-no-send",
    "--readonly",
    "--no-input",
    "--wrap-untrusted",
    "--json",
    "--results-only",
    "gmail",
    "thread",
    "get",
    input.threadId,
    "--sanitize-content",
  ];

  try {
    const { stdout } = await (options.runner ?? runGog)("gog", args, {
      timeout: 15_000,
      maxBuffer: 1_048_576,
    });
    const parsed: unknown = JSON.parse(stdout);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("thread" in parsed) ||
      typeof parsed.thread !== "object" ||
      parsed.thread === null ||
      !("messages" in parsed.thread) ||
      !Array.isArray(parsed.thread.messages)
    ) {
      return fail(
        "EMAIL_PROVIDER_RESPONSE_INVALID",
        "The Gmail provider returned an unsupported thread response.",
        false,
      );
    }
    if (parsed.thread.messages.length === 0) {
      return fail(
        "EMAIL_THREAD_NOT_FOUND",
        "The requested thread has no retrievable messages.",
        false,
      );
    }
    if (
      parsed.thread.messages.length > 100 ||
      ("id" in parsed.thread &&
        typeof parsed.thread.id === "string" &&
        parsed.thread.id !== input.threadId)
    ) {
      return fail(
        "EMAIL_PROVIDER_RESPONSE_INVALID",
        "The Gmail provider returned an unsupported thread response.",
        false,
      );
    }

    const messages: Array<{
      message: RetrievedTestEmail;
      internalDate: number;
    }> = [];
    for (const value of parsed.thread.messages) {
      if (input.unreadOnly) {
        if (
          typeof value !== "object" ||
          value === null ||
          !("labelIds" in value) ||
          !Array.isArray(value.labelIds)
        )
          return fail(
            "EMAIL_PROVIDER_RESPONSE_INVALID",
            "Unread message labels are unavailable; no unread-message claim.",
            false,
          );
        if (!value.labelIds.includes("UNREAD")) continue;
      }
      if (
        typeof value !== "object" ||
        value === null ||
        !("id" in value) ||
        typeof value.id !== "string" ||
        !value.id ||
        !("internalDate" in value) ||
        typeof value.internalDate !== "number" ||
        !Number.isFinite(value.internalDate) ||
        !("headers" in value) ||
        typeof value.headers !== "object" ||
        value.headers === null ||
        !("from" in value.headers) ||
        typeof value.headers.from !== "string" ||
        !("subject" in value.headers) ||
        typeof value.headers.subject !== "string" ||
        !("date" in value.headers) ||
        typeof value.headers.date !== "string" ||
        !("body" in value) ||
        typeof value.body !== "string"
      ) {
        return fail(
          "EMAIL_PROVIDER_RESPONSE_INVALID",
          "The Gmail provider returned an unsupported message.",
          false,
        );
      }
      if (
        input.sender &&
        !value.headers.from.toLowerCase().includes(input.sender.toLowerCase())
      )
        continue;
      if (
        input.after &&
        value.internalDate <
          Temporal.PlainDate.from(input.after).toZonedDateTime({
            timeZone: "America/Los_Angeles",
            plainTime: "00:00",
          }).epochMilliseconds
      )
        continue;
      if (value.body.length > 12_000) {
        return fail(
          "EMAIL_MESSAGE_TOO_LARGE",
          "The latest message is too large to return safely.",
          false,
        );
      }
      const to = "to" in value.headers ? value.headers.to : undefined;
      if (to !== undefined && typeof to !== "string") {
        return fail(
          "EMAIL_PROVIDER_RESPONSE_INVALID",
          "The Gmail provider returned an unsupported message header.",
          false,
        );
      }
      messages.push({
        internalDate: value.internalDate,
        message: {
          messageId: value.id,
          from: value.headers.from,
          ...(typeof to === "string" ? { to } : {}),
          subject: value.headers.subject,
          date: value.headers.date,
          textBody: value.body,
        },
      });
    }

    messages.sort((a, b) => a.internalDate - b.internalDate);
    const latest = messages.at(-1);
    if (!latest) {
      return fail(
        "EMAIL_THREAD_NOT_FOUND",
        "The requested thread has no retrievable messages.",
        false,
      );
    }
    return {
      status: "success",
      data: {
        threadId: input.threadId,
        message: latest.message,
        contentTrust: "untrusted_external_content",
      },
    };
  } catch {
    return fail(
      "EMAIL_PROVIDER_UNAVAILABLE",
      "The dedicated Gmail thread could not be retrieved safely.",
      true,
    );
  }
}
