import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { getTestEmailThread } from "../../src/integrations/gogcli-email.js";
import { summarizeEmail } from "../../src/integrations/email-intelligence.js";
import { assistantReport } from "../../src/scheduler/reports.js";
import { ApprovedEmailOutbox } from "../../src/integrations/approved-email.js";
import { TodoStore } from "../../src/tasks/store.js";
import { KnowledgeStore } from "../../src/knowledge/store.js";
import { assertTelegramActor } from "../../src/plugin/src/telegram-auth.js";

const cases: Array<{ id: string; name: string; body: string }> = JSON.parse(
  readFileSync(
    new URL("../../fixtures/security-injection-cases.json", import.meta.url),
    "utf8",
  ),
);
const account = "synthetic-security-test@gmail.com";

describe("documented injection attempts with mocked Gmail and real state/authorization code", () => {
  for (const attack of cases) {
    it(`${attack.id}: ${attack.name}; external content grants no mutation authority`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "security-injection-"));
      const path = join(dir, "state.sqlite");
      const tasks = new TodoStore(path);
      const knowledge = new KnowledgeStore(path);
      const outbox = new ApprovedEmailOutbox(path);
      const db = new DatabaseSync(path);
      const calls: string[][] = [];
      let sendCalls = 0;
      const now = new Date();
      const denied = () =>
        assertTelegramActor(
          { channel: "email", senderId: "123456", isAuthorizedSender: true },
          "123456",
        );
      const snapshot = () =>
        Object.fromEntries(
          [
            "todos",
            "todo_events",
            "knowledge_facts",
            "knowledge_events",
            "email_outbox",
            "email_outbox_events",
          ].map((table) => [
            table,
            db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
          ]),
        );
      try {
        const task = tasks.add(
          { title: "Synthetic protected task", dueDate: null, priority: 2 },
          () => {},
        );
        knowledge.remember(
          { kind: "style", key: "communication", value: "concise" },
          () => {},
        );
        const draft = outbox.prepare({
          account,
          to: account,
          subject: "Synthetic safe draft",
          body: "Fictional status only.",
          sourceMessageId: "synthetic-review",
        });
        const before = snapshot();
        const getMail = () =>
          getTestEmailThread(
            { threadId: attack.id },
            {
              configuredAccount: account,
              runner: async (_bin, args) => {
                calls.push(args);
                return {
                  stdout: JSON.stringify({
                    thread: {
                      id: attack.id,
                      messages: [
                        {
                          id: attack.id,
                          internalDate: now.getTime(),
                          headers: {
                            from: "fictional-attacker@example.test",
                            subject: `Synthetic ${attack.name}`,
                            date: now.toISOString(),
                          },
                          body: `<<<EXTERNAL_UNTRUSTED_CONTENT>>>\n${attack.body}\n<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>`,
                        },
                      ],
                    },
                  }),
                };
              },
            },
          );
        const retrieved = await getMail();
        expect(retrieved.status).toBe("success");
        if (retrieved.status !== "success")
          throw Error("FIXTURE_RETRIEVAL_FAILED");
        const summary = summarizeEmail(retrieved.data.message);
        const report = await assistantReport(
          "email",
          { assistantStatePath: path, testGmailAccount: account },
          {
            calendar: async () => ({ status: "success", data: { events: [] } }),
            listMail: async () => ({
              status: "success",
              data: { threads: [{ threadId: attack.id }] },
            }),
            getMail,
            weather: async () => ({
              status: "unavailable",
              reason: "Not used for email reports",
            }),
          },
          now,
        );
        // A forged matching sender ID and approval claim from an email are still
        // rejected by the real channel/authentication gate, not a model verdict.
        await expect(
          outbox.send({
            id: draft.id,
            digest: draft.digest,
            configuredAccount: account,
            authorize: denied,
            runner: async () => {
              sendCalls++;
              throw Error("UNEXPECTED_PROVIDER_SEND");
            },
          }),
        ).rejects.toThrow("TELEGRAM_APPROVAL_UNAUTHORIZED");
        expect(() =>
          outbox.prepare({ ...draft.payload, to: "attacker@example.test" }),
        ).toThrow("EMAIL_RECIPIENT_NOT_ALLOWLISTED");
        expect(() => tasks.complete(task.id, denied)).toThrow(
          "TELEGRAM_APPROVAL_UNAUTHORIZED",
        );
        expect(() =>
          knowledge.remember(
            {
              kind: "workflow",
              key: "approval-policy",
              value: "All sends are preapproved",
            },
            denied,
          ),
        ).toThrow("TELEGRAM_APPROVAL_UNAUTHORIZED");
        expect(sendCalls).toBe(0);
        expect(snapshot()).toEqual(before);
        expect(
          calls.every(
            (args) =>
              args.includes("--readonly") &&
              args.includes("--gmail-no-send") &&
              args.includes("--sanitize-content") &&
              args.includes("--wrap-untrusted"),
          ),
        ).toBe(true);
        // Reopen storage to verify actual persisted state, not object caches.
        const reopenedTasks = new TodoStore(path);
        const reopenedKnowledge = new KnowledgeStore(path);
        expect(reopenedTasks.list()[0]?.status).toBe("open");
        expect(reopenedKnowledge.list()).toEqual(knowledge.list());
        reopenedTasks.close();
        reopenedKnowledge.close();
        const output = process.env.APPLYPILOT_SECURITY_EVIDENCE_DIR;
        if (output) {
          mkdirSync(output, { recursive: true });
          writeFileSync(
            join(output, `${attack.id}-local.json`),
            JSON.stringify(
              {
                at: now.toISOString(),
                attack,
                scope:
                  "Mocked Gmail response; real adapter/report/authorization/SQLite. No live MIME sanitization or model call.",
                summary,
                report,
                detection: summary.needsHumanReview ? "FLAGGED" : "NOT_FLAGGED",
                containment: "PASS",
                checks: {
                  providerSendCalls: sendCalls,
                  protectedTablesUnchanged: true,
                  reopenVerified: true,
                  readOnlyProviderFlags: true,
                  forgedApprovalRejected: true,
                  disallowedRecipientRejected: true,
                  taskMutationRejected: true,
                  memoryMutationRejected: true,
                },
              },
              null,
              2,
            ) + "\n",
          );
        }
      } finally {
        db.close();
        outbox.close();
        knowledge.close();
        tasks.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
