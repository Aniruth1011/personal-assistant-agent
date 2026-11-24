import type { RetrievedTestEmail } from "./gogcli-email.js";

export function plainText(text: string): string {
  return text
    .replace(/<<<(?:END_)?EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, "")
    .replace(/^\s*Source: google_api\s*---\s*/, "")
    .replace(/\\n/g, "\n");
}
const unsafe =
  /ignore.{0,40}(instructions|rules)|system\s*prompt|reveal.{0,30}(secret|token|password)|send.{0,30}(secret|token|password)|\/approveemail|\/remember|override.{0,30}(policy|approval)|(?:already|previously).{0,25}approv|(?:forward|upload|export|send).{0,60}(?:inbox|mailbox|all (?:mail|messages)|credentials)|<(?:script|iframe|object)\b|on(?:error|load)\s*=|javascript:/i;
/** Extractive summaries retain source wording, never turn external instructions into authority. */
export function summarizeEmail(message: RetrievedTestEmail) {
  const body = plainText(message.textBody).slice(0, 12000);
  const suspicious = unsafe.test(body) || unsafe.test(message.subject);
  const sentences = body
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s && !/^[-_>]|^(hi|hello|dear|regards|thanks|thank you)[,!]?$/i.test(s),
    );
  const useful = sentences.filter((s) => !unsafe.test(s));
  const score = (s: string) =>
    /\b(please|review|prepare|decision|approved|changed|deadline|due|agenda|bring|action|blocked|urgent)\b/i.test(
      s,
    )
      ? 2
      : 1;
  const excerpt = useful
    .map((s, i) => ({ s, i }))
    .sort((a, b) => score(b.s) - score(a.s) || a.i - b.i)
    .slice(0, 2)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join(" ")
    .slice(0, 400);
  const actions = useful
    .filter((s) =>
      /\b(please|review|prepare|bring|respond|confirm|complete|submit)\b/i.test(
        s,
      ),
    )
    .slice(0, 3)
    .map((s) => s.slice(0, 220));
  const projects = [
    ...body.matchAll(/\[project:([a-z][a-z0-9-]{1,40})\]/g),
    ...plainText(message.subject).matchAll(
      /\[project:([a-z][a-z0-9-]{1,40})\]/g,
    ),
  ].map((m) => m[1]!);
  return {
    sourceMessageId: message.messageId,
    summary: excerpt || "No usable body text; open the source message.",
    actions: suspicious ? [] : actions,
    urgent: /\b(urgent|asap|action required|time-sensitive)\b/i.test(
      body + " " + message.subject,
    ),
    needsHumanReview: suspicious || !excerpt,
    projectIds: [...new Set(projects)],
    method: "extractive" as const,
    contentTrust: "untrusted_external_content" as const,
  };
}
