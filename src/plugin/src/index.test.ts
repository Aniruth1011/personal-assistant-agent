import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EmailEventStore } from "../../persistence/email-event-store.js";
import {
  classifyAssistantEmailTool,
  draftEmailReplyTool,
  listTestEventsTool,
  getTestEmailTool,
  listTestEmailsTool,
} from "./index.js";

function temporaryStateDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "applypilot-email-tool-"));
  return { directory, path: join(directory, "state.sqlite") };
}

describe("ApplyPilot OpenClaw tools", () => {
  it("wraps email thread listing with a correlation ID and opaque evidence refs", async () => {
    const state = temporaryStateDatabase();
    const env = {
      APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com",
      APPLYPILOT_STATE_DB: state.path,
    };
    const runner = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          threads: [{ id: "thread-fixture-001" }],
          nextPageToken: "cursor-page-2",
        }),
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ threads: [{ id: "thread-fixture-002" }] }),
      });
    try {
      const firstPage = await listTestEmailsTool(
        { requestId: "request-email-list-001", maxResults: 5 },
        "correlation-email-list-001",
        env,
        runner,
      );
      expect(firstPage).toEqual({
        status: "success",
        requestId: "request-email-list-001",
        correlationId: "correlation-email-list-001",
        data: {
          threads: [{ threadId: "thread-fixture-001" }],
          nextCursor: "cursor-page-2",
        },
        evidenceRefs: ["gmail-thread:thread-fixture-001"],
      });
      const replayPending = await listTestEmailsTool(
        { requestId: "request-email-list-replay-001", maxResults: 5 },
        "correlation-email-list-replay-001",
        env,
        runner,
      );
      expect(replayPending).toMatchObject({
        status: "success",
        data: {
          threads: [{ threadId: "thread-fixture-001" }],
          nextCursor: "cursor-page-2",
        },
      });
      expect(runner).toHaveBeenCalledOnce();
      const stateStore = new EmailEventStore(state.path);
      stateStore.acknowledgeMailboxThread(
        "applypilot-test@gmail.com",
        "thread-fixture-001",
      );
      stateStore.close();
      const secondPage = await listTestEmailsTool(
        {
          requestId: "request-email-list-page-2",
          maxResults: 5,
          cursor: "cursor-page-2",
        },
        "correlation-email-list-page-2",
        env,
        runner,
      );
      expect(secondPage).toMatchObject({
        status: "success",
        data: { threads: [{ threadId: "thread-fixture-002" }] },
      });
      expect(runner).toHaveBeenCalledTimes(2);
      expect(runner.mock.calls[1]?.[1]).toEqual(
        expect.arrayContaining(["--page", "cursor-page-2"]),
      );
    } finally {
      rmSync(state.directory, { recursive: true, force: true });
    }
  });

  it("fails safely on cursor conflict or provider outage without advancing state", async () => {
    const state = temporaryStateDatabase();
    const env = {
      APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com",
      APPLYPILOT_STATE_DB: state.path,
    };
    const stateStore = new EmailEventStore(state.path);
    stateStore.commitMailboxPage({
      accountId: "applypilot-test@gmail.com",
      threadIds: [],
      nextCursor: "cursor-page-2",
    });
    stateStore.close();
    const runner = vi.fn(async () => {
      throw new Error("synthetic Gmail outage");
    });
    try {
      const cursorConflict = await listTestEmailsTool(
        {
          requestId: "request-email-cursor-conflict",
          maxResults: 5,
          cursor: "cursor-not-current",
        },
        "correlation-email-cursor-conflict",
        env,
        runner,
      );
      const providerFailure = await listTestEmailsTool(
        { requestId: "request-email-list-outage", maxResults: 5 },
        "correlation-email-list-outage",
        env,
        runner,
      );
      expect(cursorConflict).toMatchObject({
        status: "failed_safe",
        error: { code: "EMAIL_CURSOR_CONFLICT", retryable: false },
      });
      expect(providerFailure).toMatchObject({
        status: "failed_safe",
        error: { code: "EMAIL_PROVIDER_UNAVAILABLE", retryable: true },
      });
      expect(runner).toHaveBeenCalledOnce();
      const persisted = new EmailEventStore(state.path);
      expect(persisted.mailboxCursor("applypilot-test@gmail.com")).toBe(
        "cursor-page-2",
      );
      expect(
        persisted.pendingMailboxThreads("applypilot-test@gmail.com", 10),
      ).toEqual([]);
      persisted.close();
    } finally {
      rmSync(state.directory, { recursive: true, force: true });
    }
  });

  it("wraps one retrieved email as untrusted content with message evidence", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await getTestEmailTool(
      {
        requestId: "request-email-get-001",
        threadId: "thread-fixture-001",
      },
      "correlation-email-get-001",
      { APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com" },
      async () => ({
        stdout: JSON.stringify({
          thread: {
            id: "thread-fixture-001",
            messages: [
              {
                id: "message-fixture-001",
                internalDate: 1,
                headers: {
                  from: "<<<EXTERNAL_UNTRUSTED_CONTENT>>>fictional project coordinator",
                  subject: "<<<EXTERNAL_UNTRUSTED_CONTENT>>>Meeting",
                  date: "<<<EXTERNAL_UNTRUSTED_CONTENT>>>synthetic date",
                },
                body: "<<<EXTERNAL_UNTRUSTED_CONTENT>>>synthetic body",
              },
            ],
          },
        }),
      }),
    );
    expect(result).toMatchObject({
      status: "success",
      requestId: "request-email-get-001",
      correlationId: "correlation-email-get-001",
      data: {
        threadId: "thread-fixture-001",
        message: { messageId: "message-fixture-001" },
        contentTrust: "untrusted_external_content",
      },
      evidenceRefs: [
        "gmail-thread:thread-fixture-001",
        "gmail-message:message-fixture-001",
      ],
    });
    expect(consoleInfo.mock.calls.flat().join(" ")).not.toContain(
      "synthetic body",
    );
    consoleInfo.mockRestore();
  });

  it("fails safely when email retrieval is unavailable", async () => {
    const result = await getTestEmailTool(
      {
        requestId: "request-email-get-failure-001",
        threadId: "thread-fixture-001",
      },
      "correlation-email-get-failure",
      { APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com" },
      async () => {
        throw new Error("synthetic provider failure");
      },
    );
    expect(result).toMatchObject({
      status: "failed_safe",
      error: { code: "EMAIL_PROVIDER_UNAVAILABLE", retryable: true },
      evidenceRefs: [],
    });
  });

  it("drafts a grounded synthetic meeting reply without sending or creating a Gmail draft", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const providerCalls: Array<{ executable: string; args: string[] }> = [];
    const runner = vi.fn(async (executable: string, args: string[]) => {
      providerCalls.push({ executable, args });
      return {
        stdout: JSON.stringify({
          thread: {
            id: "thread-fixture-001",
            messages: [
              {
                id: "message-draft-001",
                internalDate: 1,
                headers: {
                  from: "coordinator@example.test",
                  subject: "Synthetic meeting invitation",
                  date: "2026-11-10",
                },
                body: "Meeting invitation. Suggested time: 2026-11-12 10:30 AM Pacific.",
              },
            ],
          },
        }),
      };
    });
    const result = await draftEmailReplyTool(
      {
        requestId: "request-email-draft-happy",
        threadId: "thread-fixture-001",
      },
      "correlation-email-draft-happy",
      { APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com" },
      runner,
    );
    expect(result).toMatchObject({
      status: "success",
      data: {
        category: "meeting",
        body: expect.stringContaining(
          "Suggested time: 2026-11-12 10:30 AM Pacific",
        ),
        notSent: true,
        contentTrust: "untrusted_external_content",
      },
      evidenceRefs: [
        "gmail-thread:thread-fixture-001",
        "gmail-message:message-draft-001:draft-context",
      ],
    });
    expect(providerCalls[0]?.args).toContain("--readonly");
    expect(providerCalls[0]?.args).toContain("--gmail-no-send");
    expect(providerCalls[0]?.args).not.toContain("gmail.send");
    expect(providerCalls[0]?.args).not.toContain("gmail.drafts.create");
    expect(consoleInfo.mock.calls.flat().join(" ")).not.toContain(
      "Synthetic meeting invitation",
    );
    consoleInfo.mockRestore();
  });

  it("requires human review for an ambiguous email and fails safely on provider outage", async () => {
    const ambiguous = await draftEmailReplyTool(
      { requestId: "request-email-draft-edge", threadId: "thread-fixture-002" },
      "correlation-email-draft-edge",
      { APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com" },
      async () => ({
        stdout: JSON.stringify({
          thread: {
            id: "thread-fixture-002",
            messages: [
              {
                id: "message-draft-002",
                internalDate: 2,
                headers: {
                  from: "coordinator@example.test",
                  subject: "Update",
                  date: "2026-11-10",
                },
                body: "Please review the attached details.",
              },
            ],
          },
        }),
      }),
    );
    const outage = await draftEmailReplyTool(
      {
        requestId: "request-email-draft-failure",
        threadId: "thread-fixture-003",
      },
      "correlation-email-draft-failure",
      { APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com" },
      async () => {
        throw new Error("synthetic provider outage");
      },
    );
    expect(ambiguous).toMatchObject({
      status: "needs_human",
      error: { code: "EMAIL_REPLY_CONTEXT_UNCLEAR", retryable: false },
      evidenceRefs: ["gmail-message:message-draft-002"],
    });
    expect(outage).toMatchObject({
      status: "failed_safe",
      error: { code: "EMAIL_PROVIDER_UNAVAILABLE", retryable: true },
      evidenceRefs: [],
    });
  });

  it("fails safely when the dedicated test calendar is not configured", async () => {
    const result = await listTestEventsTool(
      {
        requestId: "request-calendar-list-unconfigured",
        from: "2026-11-12T00:00:00-08:00",
        to: "2026-11-13T00:00:00-08:00",
        timeZone: "America/Los_Angeles",
        maxResults: 10,
      },
      "correlation-calendar-list-unconfigured",
      { APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com" },
      vi.fn(),
    );
    expect(result).toMatchObject({
      status: "failed_safe",
      error: { code: "CALENDAR_NOT_CONFIGURED", retryable: false },
      evidenceRefs: [],
    });
  });

  it("classifies a retrieved synthetic meeting and keeps message text out of audit", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const state = temporaryStateDatabase();
    const env = {
      APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com",
      APPLYPILOT_STATE_DB: state.path,
    };
    const queuedStore = new EmailEventStore(state.path);
    queuedStore.commitMailboxPage({
      accountId: "applypilot-test@gmail.com",
      threadIds: ["thread-fixture-001"],
    });
    queuedStore.close();
    const runner = async () => ({
      stdout: JSON.stringify({
        thread: {
          id: "thread-fixture-001",
          messages: [
            {
              id: "message-classify-001",
              internalDate: 1,
              headers: {
                from: "<<<EXTERNAL_UNTRUSTED_CONTENT>>>fictional project coordinator",
                subject:
                  "<<<EXTERNAL_UNTRUSTED_CONTENT>>>Synthetic meeting invitation",
                date: "<<<EXTERNAL_UNTRUSTED_CONTENT>>>2026-11-10",
              },
              body: "<<<EXTERNAL_UNTRUSTED_CONTENT>>>Meeting invitation\nSuggested time: 2026-11-12 10:30 AM Pacific\nReply deadline: 2026-11-11 5:00 PM Pacific<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>",
            },
          ],
        },
      }),
    });
    try {
      const result = await classifyAssistantEmailTool(
        {
          requestId: "request-email-classify-001",
          threadId: "thread-fixture-001",
        },
        "correlation-email-classify-001",
        env,
        runner,
      );
      const duplicate = await classifyAssistantEmailTool(
        {
          requestId: "request-email-classify-duplicate-001",
          threadId: "thread-fixture-001",
        },
        "correlation-email-classify-duplicate-001",
        env,
        runner,
      );
      expect(result).toMatchObject({
        status: "success",
        data: {
          threadId: "thread-fixture-001",
          deduplication: { status: "new" },
          classification: {
            primaryCategory: "meeting",
            categories: ["meeting", "deadline"],
            needsHumanReview: false,
            sourceMessageId: "message-classify-001",
            contentTrust: "untrusted_external_content",
          },
        },
        evidenceRefs: [
          "gmail-thread:thread-fixture-001",
          "gmail-message:message-classify-001:classification",
        ],
      });
      expect(duplicate).toMatchObject({
        status: "success",
        data: { deduplication: { status: "duplicate" } },
      });
      const persistedStore = new EmailEventStore(state.path);
      expect(persistedStore.count()).toBe(1);
      expect(
        persistedStore.pendingMailboxThreads("applypilot-test@gmail.com", 10),
      ).toEqual([]);
      persistedStore.close();
      expect(consoleInfo.mock.calls.flat().join(" ")).not.toContain(
        "2026-11-12 10:30 AM",
      );
    } finally {
      consoleInfo.mockRestore();
      rmSync(state.directory, { recursive: true, force: true });
    }
  });

  it("returns a safe provider failure for classification", async () => {
    const state = temporaryStateDatabase();
    const queuedStore = new EmailEventStore(state.path);
    queuedStore.commitMailboxPage({
      accountId: "applypilot-test@gmail.com",
      threadIds: ["thread-failure"],
    });
    queuedStore.close();
    try {
      const result = await classifyAssistantEmailTool(
        {
          requestId: "request-email-classify-failure",
          threadId: "thread-failure",
        },
        "correlation-email-classify-failure",
        {
          APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com",
          APPLYPILOT_STATE_DB: state.path,
        },
        async () => {
          throw new Error("synthetic provider outage");
        },
      );
      expect(result).toMatchObject({
        status: "failed_safe",
        error: { code: "EMAIL_PROVIDER_UNAVAILABLE", retryable: true },
        evidenceRefs: [],
      });
      const persistedStore = new EmailEventStore(state.path);
      expect(
        persistedStore.pendingMailboxThreads("applypilot-test@gmail.com", 10),
      ).toEqual(["thread-failure"]);
      expect(persistedStore.count()).toBe(0);
      persistedStore.close();
    } finally {
      rmSync(state.directory, { recursive: true, force: true });
    }
  });

  it("fails closed when the state database is missing or unavailable", async () => {
    const runner = vi.fn(async () => ({ stdout: "{}" }));
    const missingState = await classifyAssistantEmailTool(
      { requestId: "request-email-classify-no-state", threadId: "thread-one" },
      "correlation-email-classify-no-state",
      { APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com" },
      runner,
    );
    const unavailableState = await classifyAssistantEmailTool(
      { requestId: "request-email-classify-db-fail", threadId: "thread-one" },
      "correlation-email-classify-db-fail",
      {
        APPLYPILOT_TEST_GMAIL_ACCOUNT: "applypilot-test@gmail.com",
        APPLYPILOT_STATE_DB: "/path/not-used.sqlite",
      },
      runner,
      () => {
        throw new Error("synthetic database outage");
      },
    );
    expect(missingState).toMatchObject({
      status: "failed_safe",
      error: { code: "EMAIL_STATE_NOT_CONFIGURED", retryable: false },
      evidenceRefs: [],
    });
    expect(unavailableState).toMatchObject({
      status: "failed_safe",
      error: { code: "EMAIL_EVENT_PERSISTENCE_FAILED", retryable: true },
      evidenceRefs: [],
    });
    expect(runner).not.toHaveBeenCalled();
  });
});
