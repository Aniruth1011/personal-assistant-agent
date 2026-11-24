import { chmodSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const category = z.enum([
  "confirmation",
  "project_update",
  "assignment",
  "meeting",
  "cancellation",
  "deadline",
]);

const PersistedClassificationSchema = z.strictObject({
  primaryCategory: category.or(z.literal("unknown")),
  categories: z.array(category).max(6),
  confidence: z.enum(["high", "low"]),
  needsHumanReview: z.boolean(),
  reviewReasons: z.array(z.string().min(1).max(80)).max(20),
  matchedSignals: z.array(z.string().min(1).max(80)).max(20),
  deadlineText: z.string().max(160).optional(),
  meetingTimeText: z.string().max(160).optional(),
  sourceMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  contentTrust: z.literal("untrusted_external_content"),
});

export type PersistedProjectClassification = z.infer<
  typeof PersistedClassificationSchema
>;

export type ProjectEventRecordResult = {
  deduplication: "new" | "duplicate";
  firstObservedAt: string;
  classification: PersistedProjectClassification;
};

type ProjectEventRow = {
  classification_json: string;
  first_observed_at: string;
};

export class EmailEventStore {
  readonly #db: DatabaseSync;
  readonly #clock: () => Date;

  constructor(databasePath: string, clock: () => Date = () => new Date()) {
    if (!databasePath.trim() || databasePath === ":memory:") {
      throw new Error("EMAIL_EVENT_DATABASE_PATH_INVALID");
    }
    const absolutePath = resolve(databasePath);
    mkdirSync(dirname(absolutePath), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(absolutePath);
    this.#clock = clock;
    try {
      this.#db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS project_events (
          dedup_key TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          classification_json TEXT NOT NULL,
          first_observed_at TEXT NOT NULL,
          UNIQUE (account_id, message_id)
        );
        CREATE TRIGGER IF NOT EXISTS project_events_no_update
          BEFORE UPDATE ON project_events
          BEGIN SELECT RAISE(ABORT, 'project events are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS project_events_no_delete
          BEFORE DELETE ON project_events
          BEGIN SELECT RAISE(ABORT, 'project events are append-only'); END;
        CREATE TABLE IF NOT EXISTS mailbox_cursors (
          account_id TEXT PRIMARY KEY,
          next_page_token TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mailbox_pending_threads (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          queued_at TEXT NOT NULL,
          UNIQUE (account_id, thread_id)
        );
        CREATE INDEX IF NOT EXISTS mailbox_pending_account_sequence
          ON mailbox_pending_threads(account_id, sequence);
      `);
      chmodSync(absolutePath, 0o600);
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  record(input: {
    accountId: string;
    messageId: string;
    classification: PersistedProjectClassification;
  }): ProjectEventRecordResult {
    const accountId = input.accountId.trim().toLowerCase();
    if (!/^[^\s@]+@gmail\.com$/i.test(accountId)) {
      throw new Error("EMAIL_EVENT_ACCOUNT_INVALID");
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.messageId)) {
      throw new Error("EMAIL_EVENT_MESSAGE_ID_INVALID");
    }
    const classification = PersistedClassificationSchema.parse(
      input.classification,
    );
    if (classification.sourceMessageId !== input.messageId) {
      throw new Error("EMAIL_EVENT_MESSAGE_MISMATCH");
    }

    const dedupKey = createHash("sha256")
      .update(`${accountId}\n${input.messageId}`)
      .digest("hex");
    const firstObservedAt = this.#clock().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.#db
        .prepare(
          `INSERT INTO project_events
            (dedup_key, account_id, message_id, classification_json, first_observed_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(dedup_key) DO NOTHING`,
        )
        .run(
          dedupKey,
          accountId,
          input.messageId,
          JSON.stringify(classification),
          firstObservedAt,
        );
      const row = this.#db
        .prepare(
          `SELECT classification_json, first_observed_at
           FROM project_events WHERE dedup_key = ?`,
        )
        .get(dedupKey) as ProjectEventRow | undefined;
      if (!row) throw new Error("EMAIL_EVENT_RECORD_MISSING");
      const storedClassification = PersistedClassificationSchema.parse(
        JSON.parse(row.classification_json),
      );
      this.#db.exec("COMMIT");
      return {
        deduplication: Number(inserted.changes) === 1 ? "new" : "duplicate",
        firstObservedAt: row.first_observed_at,
        classification: storedClassification,
      };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  count(): number {
    const row = this.#db
      .prepare("SELECT COUNT(*) AS count FROM project_events")
      .get() as { count: number };
    return Number(row.count);
  }

  mailboxCursor(accountIdInput: string): string | undefined {
    const accountId = this.#validateAccountId(accountIdInput);
    const row = this.#db
      .prepare(
        "SELECT next_page_token FROM mailbox_cursors WHERE account_id = ?",
      )
      .get(accountId) as { next_page_token: string | null } | undefined;
    return row?.next_page_token ?? undefined;
  }

  pendingMailboxThreads(accountIdInput: string, limit: number): string[] {
    const accountId = this.#validateAccountId(accountIdInput);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw new Error("MAILBOX_PENDING_LIMIT_INVALID");
    }
    const rows = this.#db
      .prepare(
        `SELECT thread_id FROM mailbox_pending_threads
         WHERE account_id = ? ORDER BY sequence LIMIT ?`,
      )
      .all(accountId, limit) as Array<{ thread_id: string }>;
    return rows.map((row) => row.thread_id);
  }

  commitMailboxPage(input: {
    accountId: string;
    threadIds: string[];
    nextCursor?: string;
  }): void {
    const accountId = this.#validateAccountId(input.accountId);
    if (
      input.nextCursor !== undefined &&
      !/^[A-Za-z0-9_-]{1,2048}$/.test(input.nextCursor)
    ) {
      throw new Error("MAILBOX_CURSOR_INVALID");
    }
    if (
      input.threadIds.length > 10 ||
      input.threadIds.some(
        (threadId) => !/^[A-Za-z0-9_-]{1,128}$/.test(threadId),
      )
    ) {
      throw new Error("MAILBOX_THREAD_IDS_INVALID");
    }
    const updatedAt = this.#clock().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare(
          `INSERT INTO mailbox_cursors (account_id, next_page_token, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET
             next_page_token = excluded.next_page_token,
             updated_at = excluded.updated_at`,
        )
        .run(accountId, input.nextCursor ?? null, updatedAt);
      const insertThread = this.#db.prepare(
        `INSERT INTO mailbox_pending_threads (account_id, thread_id, queued_at)
         VALUES (?, ?, ?) ON CONFLICT(account_id, thread_id) DO NOTHING`,
      );
      for (const threadId of input.threadIds) {
        insertThread.run(accountId, threadId, updatedAt);
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  acknowledgeMailboxThread(accountIdInput: string, threadId: string): void {
    const accountId = this.#validateAccountId(accountIdInput);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) {
      throw new Error("MAILBOX_THREAD_ID_INVALID");
    }
    this.#db
      .prepare(
        "DELETE FROM mailbox_pending_threads WHERE account_id = ? AND thread_id = ?",
      )
      .run(accountId, threadId);
  }

  close(): void {
    this.#db.close();
  }

  #validateAccountId(accountIdInput: string): string {
    const accountId = accountIdInput.trim().toLowerCase();
    if (!/^[^\s@]+@gmail\.com$/i.test(accountId)) {
      throw new Error("EMAIL_EVENT_ACCOUNT_INVALID");
    }
    return accountId;
  }
}
