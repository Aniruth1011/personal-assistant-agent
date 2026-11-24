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

/** Public routing requires a host-selected isolated workspace, never a prompt assertion. */
export function classifyTask(
  prompt: string,
  trustedPublicWorkspace: boolean,
  tainted = false,
  hasAttachments = false,
): Pick<RouteTask, "privacy" | "complexity"> {
  const privateMarker =
    /\b(private|confidential|secret|password|token|task|todo|user|profile|gmail|email|calendar|meeting|medical|salary|authorization|ssn)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{3}-\d{2}-\d{4}\b/i.test(
      prompt,
    );
  const privacy =
    !trustedPublicWorkspace || tainted || hasAttachments || privateMarker
      ? "private"
      : "public";
  const complexity =
    prompt.length > 1200 ||
    /\b(compare|analy[sz]e|reason|tradeoffs?|design|evaluate|plan)\b/i.test(
      prompt,
    )
      ? "reasoning"
      : "short";
  return { privacy, complexity };
}
