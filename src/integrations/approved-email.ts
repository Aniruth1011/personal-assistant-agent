import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { GogCommandRunner } from "./gogcli-email.js";
import { createAssistantCheckpoint } from "../persistence/runtime-checkpoint.js";

const exec = promisify(execFile);
const Payload = z.strictObject({
  account: z.email().regex(/^[^\s@]+@gmail\.com$/),
  to: z.email(),
  subject: z
    .string()
    .min(1)
    .max(200)
    .refine((v) => !/[\r\n]/.test(v)),
  body: z.string().min(1).max(10000),
  sourceMessageId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(256),
});
type EmailPayload = z.infer<typeof Payload>;
type OutboxRecord = {
  id: string;
  digest: string;
  payload: EmailPayload;
  status: string;
  messageId: string | null;
  expiresAt: string;
};

/** Self-addressed synthetic test mail only. No model-callable sending surface. */
export class ApprovedEmailOutbox {
  readonly #db: DatabaseSync;
  readonly #checkpoint: () => Promise<void>;
  constructor(path: string, checkpoint?: () => Promise<void>) {
    this.#checkpoint = checkpoint ?? createAssistantCheckpoint(path);
    this.#db = new DatabaseSync(path);
    this.#db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS email_outbox (
        id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL,
        status TEXT NOT NULL, expires_at TEXT NOT NULL, approved_at TEXT, message_id TEXT
      );
      CREATE TABLE IF NOT EXISTS email_outbox_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS email_outbox_events_no_update BEFORE UPDATE ON email_outbox_events BEGIN SELECT RAISE(ABORT,'append-only'); END;
      CREATE TRIGGER IF NOT EXISTS email_outbox_events_no_delete BEFORE DELETE ON email_outbox_events BEGIN SELECT RAISE(ABORT,'append-only'); END;`);
  }
  prepare(raw: EmailPayload, now = Date.now()): OutboxRecord {
    const payload = Payload.parse(raw);
    if (payload.to !== payload.account)
      throw new Error("EMAIL_RECIPIENT_NOT_ALLOWLISTED");
    const digest = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    const id = `email-${digest.slice(0, 24)}`;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.get(id);
      if (!old) {
        this.#db
          .prepare(
            "INSERT INTO email_outbox (id,digest,payload_json,status,expires_at) VALUES (?,?,?,?,?)",
          )
          .run(
            id,
            digest,
            JSON.stringify(payload),
            "DRAFT",
            new Date(now + 15 * 60000).toISOString(),
          );
        this.#event(id, "DRAFT");
      } else if (
        old.status === "DRAFT" &&
        old.expiresAt <= new Date(now).toISOString()
      ) {
        this.#db
          .prepare(
            "UPDATE email_outbox SET expires_at=? WHERE id=? AND status='DRAFT'",
          )
          .run(new Date(now + 15 * 60000).toISOString(), id);
        this.#event(id, "REVIEW_RENEWED");
      }
      this.#db.exec("COMMIT");
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
    return this.get(id)!;
  }
  get(id: string): OutboxRecord | undefined {
    const r = this.#db
      .prepare("SELECT * FROM email_outbox WHERE id=?")
      .get(id) as
      | {
          id: string;
          digest: string;
          payload_json: string;
          status: string;
          message_id: string | null;
          expires_at: string;
        }
      | undefined;
    return r
      ? {
          id: r.id,
          digest: r.digest,
          payload: Payload.parse(JSON.parse(r.payload_json)),
          status: r.status,
          messageId: r.message_id,
          expiresAt: r.expires_at,
        }
      : undefined;
  }
  async send(input: {
    id: string;
    digest: string;
    configuredAccount: string;
    authorize: () => void;
    now?: number;
    runner?: GogCommandRunner;
  }): Promise<OutboxRecord> {
    input.authorize();
    const record = this.get(input.id);
    if (!record) throw new Error("EMAIL_DRAFT_NOT_FOUND");
    if (
      record.digest !== input.digest ||
      createHash("sha256")
        .update(JSON.stringify(record.payload))
        .digest("hex") !== record.digest
    )
      throw new Error("EMAIL_REVIEW_CHANGED");
    if (record.status !== "DRAFT") throw new Error("EMAIL_ALREADY_ATTEMPTED");
    if (record.expiresAt <= new Date(input.now ?? Date.now()).toISOString())
      throw new Error("EMAIL_REVIEW_EXPIRED");
    if (
      record.payload.account !== input.configuredAccount ||
      record.payload.to !== input.configuredAccount
    )
      throw new Error("EMAIL_RECIPIENT_NOT_ALLOWLISTED");
    const directory = mkdtempSync(join(tmpdir(), "applypilot-approved-mail-"));
    try {
      const bodyPath = join(directory, "body.txt");
      writeFileSync(bodyPath, record.payload.body, { mode: 0o600 });
      input.authorize();
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        const changed = this.#db
          .prepare(
            "UPDATE email_outbox SET status='SENDING',approved_at=? WHERE id=? AND status='DRAFT' AND digest=?",
          )
          .run(new Date().toISOString(), input.id, input.digest);
        if (changed.changes !== 1) throw new Error("EMAIL_ALREADY_ATTEMPTED");
        this.#event(input.id, "SENDING");
        this.#db.exec("COMMIT");
      } catch (e) {
        this.#db.exec("ROLLBACK");
        throw e;
      }
      try {
        await this.#checkpoint();
        input.authorize();
        const runner =
          input.runner ??
          (async (binary, args, options) => {
            const r = await exec(binary, args, options);
            return { stdout: r.stdout };
          });
        const response = await runner(
          "gog",
          [
            "--account",
            input.configuredAccount,
            "--json",
            "--no-input",
            "--enable-commands-exact=gmail.send",
            "gmail",
            "send",
            "--to",
            record.payload.to,
            "--subject",
            record.payload.subject,
            "--body-file",
            bodyPath,
          ],
          { timeout: 30000, maxBuffer: 65536 },
        );
        const result = JSON.parse(response.stdout) as {
          id?: unknown;
          messageId?: unknown;
        };
        const messageId = result.messageId ?? result.id;
        if (
          typeof messageId !== "string" ||
          !/^[A-Za-z0-9_-]{1,256}$/.test(messageId)
        )
          throw new Error("EMAIL_PROVIDER_RESULT_UNVERIFIED");
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          this.#db
            .prepare(
              "UPDATE email_outbox SET status='SENT',message_id=? WHERE id=? AND status='SENDING'",
            )
            .run(messageId, input.id);
          this.#event(input.id, "SENT");
          this.#db.exec("COMMIT");
        } catch (e) {
          this.#db.exec("ROLLBACK");
          throw e;
        }
      } catch {
        // Gmail offers no send idempotency key: never retry after an uncertain send.
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          this.#db
            .prepare(
              "UPDATE email_outbox SET status='NEEDS_HUMAN' WHERE id=? AND status='SENDING'",
            )
            .run(input.id);
          this.#event(input.id, "NEEDS_HUMAN");
          this.#db.exec("COMMIT");
        } catch (e) {
          this.#db.exec("ROLLBACK");
          throw e;
        }
        throw new Error("EMAIL_SEND_UNCERTAIN_NO_RETRY");
      }
      await this.#checkpoint();
      return this.get(input.id)!;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  close() {
    this.#db.close();
  }
  #event(id: string, status: string) {
    this.#db
      .prepare("INSERT INTO email_outbox_events(id,status,at) VALUES(?,?,?)")
      .run(id, status, new Date().toISOString());
  }
}
