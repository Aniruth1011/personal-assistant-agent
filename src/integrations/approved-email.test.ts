import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApprovedEmailOutbox } from "./approved-email.js";
const payload = {
  account: "synthetic-test-account@gmail.com",
  to: "synthetic-test-account@gmail.com",
  subject: "Synthetic approval test",
  body: "Thank you for the synthetic meeting invitation.",
  sourceMessageId: "synthetic-message-1",
};
describe("approved synthetic email outbox (mock provider; no real sends)", () => {
  it("holds when cloud checkpoint fails before send and rejects retry", async () => {
    const checkpoint = vi.fn(async () => {
      throw new Error("GCS_UNAVAILABLE");
    });
    const box = new ApprovedEmailOutbox(":memory:", checkpoint);
    const runner = vi.fn();
    try {
      const draft = box.prepare(payload);
      const input = {
        id: draft.id,
        digest: draft.digest,
        configuredAccount: payload.account,
        authorize: () => {},
        runner,
      };
      await expect(box.send(input)).rejects.toThrow(
        "EMAIL_SEND_UNCERTAIN_NO_RETRY",
      );
      expect(box.get(draft.id)?.status).toBe("NEEDS_HUMAN");
      await expect(box.send(input)).rejects.toThrow("EMAIL_ALREADY_ATTEMPTED");
      expect(runner).not.toHaveBeenCalled();
    } finally {
      box.close();
    }
  });
  it("rejects edited persisted content and interrupted sends without contacting Gmail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "email-tamper-"));
    const path = join(dir, "outbox.sqlite");
    const box = new ApprovedEmailOutbox(path);
    const raw = new DatabaseSync(path);
    const runner = vi.fn();
    try {
      const draft = box.prepare(payload);
      const input = {
        id: draft.id,
        digest: draft.digest,
        configuredAccount: payload.account,
        authorize: () => {},
        runner,
      };
      raw
        .prepare("UPDATE email_outbox SET payload_json=? WHERE id=?")
        .run(
          JSON.stringify({ ...payload, body: "Changed after review" }),
          draft.id,
        );
      await expect(box.send(input)).rejects.toThrow("EMAIL_REVIEW_CHANGED");
      raw
        .prepare(
          "UPDATE email_outbox SET payload_json=?,status='SENDING' WHERE id=?",
        )
        .run(JSON.stringify(payload), draft.id);
      await expect(box.send(input)).rejects.toThrow("EMAIL_ALREADY_ATTEMPTED");
      expect(runner).not.toHaveBeenCalled();
    } finally {
      raw.close();
      box.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("renews only expired unsent reviews without creating a second draft", () => {
    const box = new ApprovedEmailOutbox(":memory:");
    try {
      const first = box.prepare(payload, 0);
      const renewed = box.prepare(payload, 1000000);
      expect(renewed.id).toBe(first.id);
      expect(renewed.expiresAt > first.expiresAt).toBe(true);
      expect(renewed.status).toBe("DRAFT");
    } finally {
      box.close();
    }
  });

  it("sends only reviewed content once; persists the result across restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "email-test-"));
    const path = join(dir, "outbox.sqlite");
    let box = new ApprovedEmailOutbox(path);
    try {
      const draft = box.prepare(payload);
      const authorize = vi.fn();
      const runner = vi.fn(async (_bin, args: string[]) => {
        expect(args).toContain("--enable-commands-exact=gmail.send");
        expect(args[args.indexOf("--to") + 1]).toBe(payload.to);
        expect(
          readFileSync(args[args.indexOf("--body-file") + 1]!, "utf8"),
        ).toBe(payload.body);
        return { stdout: JSON.stringify({ messageId: "synthetic-sent-1" }) };
      });
      expect(
        (
          await box.send({
            id: draft.id,
            digest: draft.digest,
            configuredAccount: payload.account,
            authorize,
            runner,
          })
        ).status,
      ).toBe("SENT");
      expect(authorize).toHaveBeenCalledTimes(3);
      box.close();
      box = new ApprovedEmailOutbox(path);
      await expect(
        box.send({
          id: draft.id,
          digest: draft.digest,
          configuredAccount: payload.account,
          authorize,
          runner,
        }),
      ).rejects.toThrow("EMAIL_ALREADY_ATTEMPTED");
      expect(runner).toHaveBeenCalledTimes(1);
      expect(box.get(draft.id)?.messageId).toBe("synthetic-sent-1");
    } finally {
      box.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects unauthorized, changed, expired and non-allowlisted sends with no provider calls", async () => {
    const box = new ApprovedEmailOutbox(":memory:");
    const runner = vi.fn();
    const authorize = () => {};
    try {
      const draft = box.prepare(payload, 1000);
      const base = {
        id: draft.id,
        digest: draft.digest,
        configuredAccount: payload.account,
        authorize,
        runner,
        now: 2000,
      };
      await expect(
        box.send({
          ...base,
          authorize: () => {
            throw new Error("UNAUTHORIZED");
          },
        }),
      ).rejects.toThrow("UNAUTHORIZED");
      await expect(
        box.send({ ...base, digest: "0".repeat(64) }),
      ).rejects.toThrow("EMAIL_REVIEW_CHANGED");
      await expect(
        box.send({ ...base, configuredAccount: "another@gmail.com" }),
      ).rejects.toThrow("EMAIL_RECIPIENT_NOT_ALLOWLISTED");
      await expect(box.send({ ...base, now: 1000000 })).rejects.toThrow(
        "EMAIL_REVIEW_EXPIRED",
      );
      expect(() =>
        box.prepare({ ...payload, to: "someone@example.test" }),
      ).toThrow("EMAIL_RECIPIENT_NOT_ALLOWLISTED");
      expect(runner).not.toHaveBeenCalled();
      expect(box.get(draft.id)?.status).toBe("DRAFT");
    } finally {
      box.close();
    }
  });
  it("holds ambiguous network failures without a duplicate provider call", async () => {
    const box = new ApprovedEmailOutbox(":memory:");
    const draft = box.prepare(payload);
    const runner = vi.fn(async () => {
      throw new Error("provider may have committed");
    });
    const input = {
      id: draft.id,
      digest: draft.digest,
      configuredAccount: payload.account,
      authorize: () => {},
      runner,
    };
    try {
      await expect(box.send(input)).rejects.toThrow(
        "EMAIL_SEND_UNCERTAIN_NO_RETRY",
      );
      expect(box.get(draft.id)?.status).toBe("NEEDS_HUMAN");
      await expect(box.send(input)).rejects.toThrow("EMAIL_ALREADY_ATTEMPTED");
      expect(runner).toHaveBeenCalledTimes(1);
    } finally {
      box.close();
    }
  });
});
