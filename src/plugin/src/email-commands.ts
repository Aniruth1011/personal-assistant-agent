import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { ApprovedEmailOutbox } from "../../integrations/approved-email.js";
import { getTestEmailThread } from "../../integrations/gogcli-email.js";
import { classifyAssistantEmail } from "../../integrations/email-classifier.js";
import { draftEmailReply } from "../../integrations/email-reply-draft.js";
import { assertTelegramActor } from "./telegram-auth.js";
import { createAssistantCheckpoint } from "../../persistence/runtime-checkpoint.js";

export function registerEmailCommands(api: OpenClawPluginApi) {
  const config = api.pluginConfig ?? {};
  for (const action of ["reviewemail", "approveemail", "emailstatus"])
    api.registerCommand({
      name: action,
      description:
        "Review or approve a synthetic reply to the dedicated test account only",
      acceptsArgs: true,
      requireAuth: true,
      channels: ["telegram"],
      async handler(context) {
        let outbox: ApprovedEmailOutbox | undefined;
        try {
          const authorize = () => {
            assertTelegramActor(context, process.env.TELEGRAM_ALLOWED_USER_ID);
          };
          authorize();
          const account = config.testGmailAccount;
          if (
            typeof account !== "string" ||
            typeof config.assistantStatePath !== "string"
          )
            throw new Error("EMAIL_STATE_NOT_CONFIGURED");
          const parts = (context.args ?? "").trim().split(/\s+/);
          outbox = new ApprovedEmailOutbox(config.assistantStatePath);
          if (action === "reviewemail") {
            if (parts.length !== 1 || !/^[A-Za-z0-9_-]{1,256}$/.test(parts[0]!))
              throw new Error("EMAIL_THREAD_ID_INVALID");
            const mail = await getTestEmailThread(
              { threadId: parts[0]! },
              { configuredAccount: account },
            );
            if (mail.status !== "success") throw new Error(mail.error.code);
            const draft = draftEmailReply(
              classifyAssistantEmail(mail.data.message),
              mail.data.message,
            );
            if (!draft) throw new Error("EMAIL_CONTEXT_NEEDS_HUMAN");
            authorize();
            const record = outbox.prepare({
              account,
              to: account,
              subject:
                "ApplyPilot synthetic project coordinator reply — approval test",
              body: draft.body,
              sourceMessageId: mail.data.message.messageId,
            });
            await createAssistantCheckpoint(config.assistantStatePath)();
            if (record.status !== "DRAFT")
              return {
                text: `${record.id}: ${record.status}. This draft cannot be approved again. Use /emailstatus ${record.id}. For SENDING or NEEDS_HUMAN, inspect the dedicated Sent folder before any further action.`,
              };
            return {
              text: [
                `SYNTHETIC EMAIL REVIEW — ${record.status}`,
                `Draft: ${record.id}`,
                `To: ${record.payload.to}`,
                `Subject: ${record.payload.subject}`,
                record.payload.body,
                `Expires: ${record.expiresAt}`,
                "This sends only to the dedicated test account itself. If you approve exactly this recipient and content, send:",
                `/approveemail ${record.id} ${record.digest}`,
              ].join("\n"),
            };
          }
          if (!/^email-[a-f0-9]{24}$/.test(parts[0] ?? ""))
            throw new Error("EMAIL_DRAFT_ID_INVALID");
          if (action === "emailstatus") {
            if (parts.length !== 1) throw new Error("EMAIL_COMMAND_INVALID");
            const record = outbox.get(parts[0]!);
            if (!record) throw new Error("EMAIL_DRAFT_NOT_FOUND");
            return {
              text: `${record.id}: ${record.status}. ${record.status === "NEEDS_HUMAN" || record.status === "SENDING" ? "Inspect the test Sent folder; do not retry." : ""}`,
            };
          }
          if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1] ?? ""))
            throw new Error("EMAIL_COMMAND_INVALID");
          const sent = await outbox.send({
            id: parts[0]!,
            digest: parts[1]!,
            configuredAccount: account,
            authorize,
          });
          api.logger.info(
            JSON.stringify({
              event: "applypilot.human_email",
              draftId: sent.id,
              status: sent.status,
            }),
          );
          return {
            text: `${sent.id}: ${sent.status}. Gmail returned a message ID. Independent Sent-folder verification remains required; duplicate send attempts are blocked.`,
          };
        } catch (error) {
          const code =
            error instanceof Error && /^[A-Z_]+$/.test(error.message)
              ? error.message
              : "EMAIL_COMMAND_FAILED_SAFE";
          api.logger.warn(
            JSON.stringify({ event: "applypilot.email_command", action, code }),
          );
          return { text: `Stopped safely: ${code}. No automatic send retry.` };
        } finally {
          outbox?.close();
        }
      },
    });
}
