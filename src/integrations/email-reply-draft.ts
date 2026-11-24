import { summarizeEmail } from "./email-intelligence.js";
import type { RetrievedTestEmail } from "./gogcli-email.js";
import type { AssistantEmailClassification } from "./email-classifier.js";

export type EmailReplyDraft = {
  category: Exclude<AssistantEmailClassification["primaryCategory"], "unknown">;
  body: string;
  notSent: true;
};

const replyTemplates: Record<EmailReplyDraft["category"], string> = {
  confirmation:
    "Thank you for confirming receipt of my request. I appreciate the update.",
  project_update: "Thank you for the update. I appreciate you reaching out.",
  assignment:
    "Thank you for sharing the assignment details. Could you please confirm the expected completion window and any instructions I should follow?",
  meeting:
    "Thank you for the meeting invitation. Could you please share the available time options and any details I should review beforehand?",
  cancellation:
    "Thank you for letting me know. I appreciate your time and consideration.",
  deadline:
    "Thank you for the update. Could you please clarify the deadline and any next steps I should be aware of?",
};

export function draftEmailReply(
  classification: AssistantEmailClassification,
  message?: RetrievedTestEmail,
): EmailReplyDraft | undefined {
  if (
    classification.needsHumanReview ||
    classification.primaryCategory === "unknown"
  ) {
    return undefined;
  }

  const summary = message ? summarizeEmail(message) : undefined;
  if (summary?.needsHumanReview) return undefined;
  const body = summary
    ? `Thank you for the message. I noted the following point: “${summary.summary}”${summary.actions.length ? `\nBefore I commit, could you confirm the priority of this request: “${summary.actions[0]}”?` : "\nPlease let me know if any response or preparation is required."}`
    : replyTemplates[classification.primaryCategory];
  return {
    category: classification.primaryCategory,
    body,
    notSent: true,
  };
}
