import type { RetrievedTestEmail } from "./gogcli-email.js";

export const assistantEmailCategories = [
  "confirmation",
  "project_update",
  "assignment",
  "meeting",
  "cancellation",
  "deadline",
] as const;

export type AssistantEmailCategory = (typeof assistantEmailCategories)[number];

export type AssistantEmailClassification = {
  primaryCategory: AssistantEmailCategory | "unknown";
  categories: AssistantEmailCategory[];
  confidence: "high" | "low";
  needsHumanReview: boolean;
  reviewReasons: string[];
  matchedSignals: string[];
  deadlineText?: string;
  meetingTimeText?: string;
  sourceMessageId: string;
  contentTrust: "untrusted_external_content";
};

function unwrap(value: string): string {
  return value
    .replace(/<<<\s*EXTERNAL_UNTRUSTED_CONTENT\s*>>>/gi, "")
    .replace(/<<<\s*END_EXTERNAL_UNTRUSTED_CONTENT\s*>>>/gi, "")
    .replace(/\\r\\n|\\n|\\r/g, "\n")
    .trim();
}

function captureLine(text: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text);
  const value = match?.[1]?.trim();
  return value ? value.slice(0, 160) : undefined;
}

function containsValidIsoDate(text: string): boolean {
  const match = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function containsValidTwelveHourTime(text: string): boolean {
  const match = /\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i.exec(text);
  if (!match) return false;
  return (
    Number(match[1]) >= 1 && Number(match[1]) <= 12 && Number(match[2]) <= 59
  );
}

export function classifyAssistantEmail(
  message: RetrievedTestEmail,
): AssistantEmailClassification {
  const subject = unwrap(message.subject);
  const body = unwrap(message.textBody);
  const combined = `${subject}\n${body}`;
  const categories = new Set<AssistantEmailCategory>();
  const matchedSignals: string[] = [];

  if (
    /\b(?:not selected|not moving forward|(?:request|meeting) (?:was )?(?:cancelled|canceled|rejected)|we regret to inform|unable to offer you|decline your request)\b/i.test(
      combined,
    )
  ) {
    categories.add("cancellation");
    matchedSignals.push("cancellation_phrase");
  }
  if (
    /\b(?:assignment|coding challenge|technical exercise|take[- ]home|online test)\b/i.test(
      combined,
    )
  ) {
    categories.add("assignment");
    matchedSignals.push("assignment_phrase");
  }
  if (
    /\b(?:meeting|screening call|mock meeting)\b/i.test(combined) &&
    /\b(?:invite|invitation|schedule|scheduled|proposed|suggested|mock meeting|meeting)\b/i.test(
      combined,
    )
  ) {
    categories.add("meeting");
    matchedSignals.push("meeting_phrase");
  }
  if (
    /\b(?:request (?:has been |was )?received|confirm(?:ation|ed) your request|thank you for your request|we have received your request)\b/i.test(
      combined,
    )
  ) {
    categories.add("confirmation");
    matchedSignals.push("request_confirmation_phrase");
  }
  if (
    /^\s*re\s*:/i.test(subject) ||
    /\b(?:following up on your request|thanks? for reaching out|thank you for reaching out)\b/i.test(
      combined,
    )
  ) {
    categories.add("project_update");
    matchedSignals.push("project_update_phrase");
  }

  const deadlineText = captureLine(
    body,
    /\b(?:reply\s+deadline|deadline|due(?:\s+by|\s+date)?|respond\s+by|complete\s+by|submit\s+by|no\s+later\s+than)\s*:?\s*([^\n\r.]{1,160})/i,
  );
  if (deadlineText) {
    categories.add("deadline");
    matchedSignals.push("deadline_phrase");
  }

  const meetingTimeText = captureLine(
    body,
    /\b(?:suggested\s+time|proposed\s+time|meeting\s+time|meeting\s+on|scheduled\s+for)\s*:?\s*([^\n\r.]{1,160})/i,
  );

  const orderedCategories = assistantEmailCategories.filter((category) =>
    categories.has(category),
  );
  const conflictingSignals =
    categories.has("cancellation") &&
    (categories.has("meeting") ||
      categories.has("assignment") ||
      categories.has("confirmation"));
  const reviewReasons: string[] = [];
  if (orderedCategories.length === 0) {
    reviewReasons.push("NO_CLASSIFIABLE_EVENT");
  }
  if (conflictingSignals) {
    reviewReasons.push("CONFLICTING_EVENT_SIGNALS");
  }
  if (categories.has("meeting") && !meetingTimeText) {
    reviewReasons.push("MEETING_TIME_UNSPECIFIED");
  } else if (
    categories.has("meeting") &&
    meetingTimeText &&
    (!containsValidIsoDate(meetingTimeText) ||
      !containsValidTwelveHourTime(meetingTimeText))
  ) {
    reviewReasons.push("MEETING_TIME_INCOMPLETE");
  }
  if (
    categories.has("deadline") &&
    (!deadlineText || !containsValidIsoDate(deadlineText))
  ) {
    reviewReasons.push("DEADLINE_DATE_UNSPECIFIED");
  }

  const primaryCategory = conflictingSignals
    ? "unknown"
    : (orderedCategories.find((category) => category !== "deadline") ??
      orderedCategories[0] ??
      "unknown");

  return {
    primaryCategory,
    categories: orderedCategories,
    confidence:
      orderedCategories.length > 0 && reviewReasons.length === 0
        ? "high"
        : "low",
    needsHumanReview: reviewReasons.length > 0,
    reviewReasons,
    matchedSignals,
    ...(deadlineText ? { deadlineText } : {}),
    ...(meetingTimeText ? { meetingTimeText } : {}),
    sourceMessageId: message.messageId,
    contentTrust: "untrusted_external_content",
  };
}
