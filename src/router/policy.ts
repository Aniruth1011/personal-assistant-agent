import { z } from "zod";
export const RouteTaskSchema = z.strictObject({
  privacy: z.enum(["private", "public"]),
  complexity: z.enum(["short", "reasoning"]),
  localAvailable: z.boolean(),
  cloudAvailable: z.boolean(),
  cloudRateLimited: z.boolean(),
});
export type RouteTask = z.infer<typeof RouteTaskSchema>;
export type RouteDecision = {
  target: "local" | "cloud" | "held";
  reason: string;
  privacy: RouteTask["privacy"];
  fallbacks: readonly string[];
};
export function decideRoute(raw: RouteTask): RouteDecision {
  const t = RouteTaskSchema.parse(raw);
  const decide = (
    target: RouteDecision["target"],
    reason: string,
  ): RouteDecision => ({ target, reason, privacy: t.privacy, fallbacks: [] });
  if (t.privacy === "private")
    return t.localAvailable
      ? decide("local", "private_local_only")
      : decide("held", "private_local_unavailable");
  if (t.cloudRateLimited)
    return t.localAvailable
      ? decide("local", "cloud_rate_limit_local")
      : decide("held", "cloud_rate_limit_no_local");
  if (t.complexity === "short" && t.localAvailable)
    return decide("local", "short_local");
  if (t.cloudAvailable)
    return decide(
      "cloud",
      t.complexity === "reasoning"
        ? "public_reasoning_cloud"
        : "public_local_down_cloud",
    );
  if (t.localAvailable) return decide("local", "cloud_unavailable_local");
  return decide("held", "no_eligible_model");
}

// Adapted from OpenClaw 2026.11.2 src/cron/isolated-agent/run.ts
// https://github.com/openclaw/openclaw — exact scheduler boilerplate only.
// This removes no user content and grants no public authority. Unknown wrappers
// remain conservative; workspace identity, attachments and durable taint still win.
const nativeScheduledSuffix =
  "\n\nThis is an unattended scheduled run. Nobody is present to clarify or approve, so complete the task with what you have. Your final reply is the deliverable — not a plan, an acknowledgement, or a request for input. If nothing needs doing, reply exactly NO_REPLY. If you cannot complete the task, explain what blocked it and what you tried. Where the job's own instructions conflict with this preamble, the job's instructions win (a question or plan the job explicitly requests is a valid deliverable). If this job is no longer needed, remove it if your available tools allow.";

/** Public routing requires a host-selected isolated workspace, never a prompt assertion. */
export function hasSensitiveContent(prompt: string): boolean {
  return /\b(private|confidential|secrets?|passwords?|gmail|e-?mails?|inbox|calendars?|meetings?|medical|salary|authorization|ssn|to-?dos?)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{3}-\d{2}-\d{4}\b|\b(?:my|our|her|his|their)\s+(?:home|address|phone|number|account|location|health|tasks?|profile|token|key|schedule)\b|\b\d{1,6}\s+[a-z0-9 .-]+\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr)\b|(?:\+?\d[ ().-]*){10,15}|\b(?:sk-|Bearer\s+)[a-z0-9_-]{12,}/i.test(
    prompt,
  );
}

export function classifyTask(
  prompt: string,
  trustedPublicWorkspace: boolean,
  tainted = false,
  hasAttachments = false,
): Pick<RouteTask, "privacy" | "complexity"> {
  if (prompt.endsWith(nativeScheduledSuffix))
    prompt = prompt.slice(0, -nativeScheduledSuffix.length);
  const privateMarker = hasSensitiveContent(prompt);
  const privacy =
    !trustedPublicWorkspace || tainted || hasAttachments || privateMarker
      ? "private"
      : "public";
  const complexity =
    prompt.length > 1200 ||
    /\b(compare|analy[sz]e|reason|tradeoffs?|design|evaluate|plan|explain|why|search|research|look up|step[ -]by[ -]step)\b/i.test(
      prompt,
    )
      ? "reasoning"
      : "short";
  return { privacy, complexity };
}

/**
 * A single current message that may be answered by the isolated public
 * workspace on the private agent's behalf. Only this text crosses; history,
 * workspace files and attachments never do. Conservative: personal pronouns,
 * private-domain nouns and requests needing private tools stay on the private
 * agent (local Gemma, or held).
 */
export function delegablePublicMessage(
  prompt: string,
  hasAttachments = false,
): boolean {
  const text = prompt.trim();
  if (!text || text.length > 2000 || hasAttachments) return false;
  if (classifyTask(text, true).privacy !== "public") return false;
  return !/\b(my|mine|our|ours|e-?mails?|mail|inbox|mailbox|calendars?|meetings?|schedule|tasks?|to-?dos?|reminders?|appointments?|remember|memory|profile|preferences?|approve|send|draft|reply)\b/i.test(
    text,
  );
}
