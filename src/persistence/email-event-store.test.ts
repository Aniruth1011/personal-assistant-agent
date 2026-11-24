import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  EmailEventStore,
  type PersistedProjectClassification,
} from "./email-event-store.js";

function classification(
  sourceMessageId = "synthetic-message-001",
): PersistedProjectClassification {
  return {
    primaryCategory: "meeting",
    categories: ["meeting", "deadline"],
    confidence: "high",
    needsHumanReview: false,
    reviewReasons: [],
    matchedSignals: ["meeting_phrase", "deadline_phrase"],
    deadlineText: "2026-11-11 5:00 PM Pacific",
    meetingTimeText: "2026-11-12 10:30 AM Pacific",
    sourceMessageId,
    contentTrust: "untrusted_external_content",
  };
}

describe("durable project event store", () => {
  let directory = "";
  let store: EmailEventStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = "";
  });

  function createStore(clock?: () => Date) {
    directory = mkdtempSync(join(tmpdir(), "applypilot-email-events-"));
    store = new EmailEventStore(
      join(directory, "state", "applypilot.sqlite"),
      clock,
    );
    return store;
  }

  it("inserts one event and returns the original on duplicate replay", () => {
    const fixedTime = new Date("2026-11-10T23:50:00.000Z");
    const eventStore = createStore(() => fixedTime);
    const first = eventStore.record({
      accountId: "ApplyPilot-Test@gmail.com",
      messageId: "synthetic-message-001",
      classification: classification(),
    });
    const duplicate = eventStore.record({
      accountId: "applypilot-test@gmail.com",
      messageId: "synthetic-message-001",
      classification: {
        ...classification(),
        primaryCategory: "unknown",
        categories: [],
        confidence: "low",
        needsHumanReview: true,
      },
    });

    expect(first).toEqual({
      deduplication: "new",
      firstObservedAt: fixedTime.toISOString(),
      classification: classification(),
    });
    expect(duplicate).toEqual({
      deduplication: "duplicate",
      firstObservedAt: first.firstObservedAt,
      classification: first.classification,
    });
    expect(eventStore.count()).toBe(1);
  });

  it("reopens the SQLite file and recognizes a duplicate after restart", () => {
    directory = mkdtempSync(join(tmpdir(), "applypilot-email-restart-"));
    const databasePath = join(directory, "events.sqlite");
    store = new EmailEventStore(databasePath);
    const original = store.record({
      accountId: "applypilot-test@gmail.com",
      messageId: "synthetic-message-002",
      classification: classification("synthetic-message-002"),
    });
    store.close();
    store = undefined;
    store = new EmailEventStore(databasePath);

    const replay = store.record({
      accountId: "applypilot-test@gmail.com",
      messageId: "synthetic-message-002",
      classification: classification("synthetic-message-002"),
    });
    expect(replay).toMatchObject({
      deduplication: "duplicate",
      firstObservedAt: original.firstObservedAt,
      classification: original.classification,
    });
    expect(store.count()).toBe(1);
  });

  it("persists mailbox pagination and pending threads across restart", () => {
    directory = mkdtempSync(join(tmpdir(), "applypilot-mailbox-cursor-"));
    const databasePath = join(directory, "mailbox.sqlite");
    store = new EmailEventStore(databasePath);
    store.commitMailboxPage({
      accountId: "applypilot-test@gmail.com",
      threadIds: ["thread-a", "thread-b"],
      nextCursor: "cursor-page-2",
    });
    expect(store.mailboxCursor("APPLYPILOT-TEST@gmail.com")).toBe(
      "cursor-page-2",
    );
    expect(store.pendingMailboxThreads("applypilot-test@gmail.com", 1)).toEqual(
      ["thread-a"],
    );
    store.acknowledgeMailboxThread("applypilot-test@gmail.com", "thread-a");
    store.close();
    store = new EmailEventStore(databasePath);

    expect(store.mailboxCursor("applypilot-test@gmail.com")).toBe(
      "cursor-page-2",
    );
    expect(
      store.pendingMailboxThreads("applypilot-test@gmail.com", 10),
    ).toEqual(["thread-b"]);
    store.acknowledgeMailboxThread("applypilot-test@gmail.com", "thread-b");
    expect(
      store.pendingMailboxThreads("applypilot-test@gmail.com", 10),
    ).toEqual([]);
    store.commitMailboxPage({
      accountId: "applypilot-test@gmail.com",
      threadIds: ["thread-c"],
    });
    expect(store.mailboxCursor("applypilot-test@gmail.com")).toBeUndefined();
    expect(
      store.pendingMailboxThreads("applypilot-test@gmail.com", 10),
    ).toEqual(["thread-c"]);
  });

  it("rejects malformed mailbox cursor/thread state before writing", () => {
    const eventStore = createStore();
    expect(() =>
      eventStore.commitMailboxPage({
        accountId: "applypilot-test@gmail.com",
        threadIds: ["../unsafe"],
        nextCursor: "cursor-1",
      }),
    ).toThrow("MAILBOX_THREAD_IDS_INVALID");
    expect(() =>
      eventStore.commitMailboxPage({
        accountId: "applypilot-test@gmail.com",
        threadIds: [],
        nextCursor: "--gmail.send",
      }),
    ).toThrow("MAILBOX_CURSOR_INVALID");
    expect(
      eventStore.mailboxCursor("applypilot-test@gmail.com"),
    ).toBeUndefined();
    expect(
      eventStore.pendingMailboxThreads("applypilot-test@gmail.com", 10),
    ).toEqual([]);
  });

  it("scopes deduplication to account and message and rejects mismatched IDs", () => {
    const eventStore = createStore();
    eventStore.record({
      accountId: "applypilot-test@gmail.com",
      messageId: "synthetic-message-003",
      classification: classification("synthetic-message-003"),
    });
    const otherAccount = eventStore.record({
      accountId: "second-test@gmail.com",
      messageId: "synthetic-message-003",
      classification: classification("synthetic-message-003"),
    });

    expect(otherAccount.deduplication).toBe("new");
    expect(eventStore.count()).toBe(2);
    expect(() =>
      eventStore.record({
        accountId: "applypilot-test@gmail.com",
        messageId: "different-message",
        classification: classification("synthetic-message-003"),
      }),
    ).toThrow("EMAIL_EVENT_MESSAGE_MISMATCH");
  });

  it("keeps event rows append-only and rejects non-durable database paths", () => {
    const eventStore = createStore();
    eventStore.record({
      accountId: "applypilot-test@gmail.com",
      messageId: "synthetic-message-004",
      classification: classification("synthetic-message-004"),
    });
    const auditDb = new DatabaseSync(
      join(directory, "state", "applypilot.sqlite"),
    );
    expect(() =>
      auditDb
        .prepare("UPDATE project_events SET classification_json = '{}' ")
        .run(),
    ).toThrow();
    expect(() => auditDb.prepare("DELETE FROM project_events").run()).toThrow();
    auditDb.close();
    expect(
      statSync(join(directory, "state", "applypilot.sqlite")).mode & 0o777,
    ).toBe(0o600);
    expect(() => new EmailEventStore(":memory:")).toThrow(
      "EMAIL_EVENT_DATABASE_PATH_INVALID",
    );
  });

  it("fails safely when SQLite cannot open the requested database", () => {
    const pathThatIsADirectory = mkdtempSync(
      join(tmpdir(), "applypilot-invalid-sqlite-path-"),
    );
    directory = pathThatIsADirectory;
    expect(() => new EmailEventStore(pathThatIsADirectory)).toThrow();
  });
});
