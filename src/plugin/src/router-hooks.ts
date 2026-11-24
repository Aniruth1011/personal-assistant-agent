import { createHash, randomUUID } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  classifyTask,
  decideRoute,
  delegablePublicMessage,
  type RouteDecision,
} from "../../router/policy.js";
import { RouteStore } from "../../router/store.js";
import { capabilitiesIntent } from "./read-request-hooks.js";

const capabilitiesText =
  "I can summarize the dedicated test mailbox and draft replies that you approve in Telegram, read the test calendar to find conflicts and free slots, search the public web, and manage a persistent to-do list. I also send scheduled morning briefings, reminders and evening recaps. Local Gemma is currently unavailable, so private requests are held until it returns; public questions are still answered by the cloud model.";

export async function localModelAvailable(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return false;
    const d = (await r.json()) as { models?: Array<{ name?: string }> };
    return d.models?.some((m) => m.name === "gemma4:e2b") === true;
  } catch {
    return false;
  }
}
export function registerRouterHooks(
  api: OpenClawPluginApi,
  options: {
    localAvailable?: () => Promise<boolean>;
    cloud?: {
      provider: string;
      model: string;
      available: () => Promise<boolean>;
    };
  } = {},
) {
  const path = api.pluginConfig?.assistantStatePath;
  if (typeof path !== "string") return;
  const cloud =
    options.cloud ??
    (api.pluginConfig?.cloudModel === "openai/gpt-6-luna"
      ? {
          provider: "openai",
          model: "gpt-6-luna",
          // OAuth accounts live in the native profile database, not necessarily config.auth.profiles.
          // This is configuration eligibility; actual provider failures trigger cooldown/failover below.
          available: async () =>
            api.pluginConfig?.cloudModel === "openai/gpt-6-luna",
        }
      : undefined);
  let cloudUnavailableUntil = 0;
  let cloudRateLimitedUntil = 0;
  // One effective decision per run. Later hooks may only make it stricter:
  // a held run is never relaxed because availability changed between hooks.
  const decisions = new Map<string, RouteDecision>();
  const record = <T>(fn: (store: RouteStore) => T): T => {
    const s = new RouteStore(path);
    try {
      return fn(s);
    } finally {
      s.close();
    }
  };
  const resolve = async (
    prompt: string,
    ctx: {
      runId?: string;
      sessionKey?: string;
      sessionId?: string;
      agentId?: string;
    },
    attachments = false,
  ): Promise<RouteDecision> => {
    const session =
      ctx.sessionKey ?? ctx.sessionId ?? "unknown-private-session";
    // The regular assistant has private workspace memory. Public work must use a
    // separately configured workspace without profile/mail/calendar access.
    const classification = record((s) => {
      const t = classifyTask(
        prompt,
        ctx.agentId === "public-research",
        s.tainted(session),
        attachments,
      );
      if (t.privacy === "private") s.markPrivate(session);
      return t;
    });
    const localAvailable = await (
      options.localAvailable ?? localModelAvailable
    )();
    const cloudAvailable =
      cloud && Date.now() >= cloudUnavailableUntil
        ? await cloud.available()
        : false;
    // The rubric simulation flag and an observed provider 429 both force the
    // rate-limit branch, but are recorded under distinct reasons.
    const simulatedRateLimit =
      process.env.APPLYPILOT_SIMULATE_CLOUD_RATE_LIMIT === "1";
    const task = {
      ...classification,
      localAvailable,
      cloudAvailable,
      cloudRateLimited:
        simulatedRateLimit || Date.now() < cloudRateLimitedUntil,
    };
    let decision = decideRoute(task);
    if (decision.reason.startsWith("cloud_rate_limit"))
      decision = {
        ...decision,
        reason: `${simulatedRateLimit ? "simulated" : "observed"}_${decision.reason}`,
      };
    const previous = ctx.runId ? decisions.get(ctx.runId) : undefined;
    if (previous?.target === "held" && decision.target !== "held")
      decision = previous;
    const id = ctx.runId ?? randomUUID();
    record((s) =>
      s.decision(
        id,
        session,
        decision,
        decision.target === "local"
          ? "ollama/gemma4:e2b"
          : decision.target === "cloud" && cloud
            ? `${cloud.provider}/${cloud.model}`
            : null,
        task,
      ),
    );
    if (ctx.runId) {
      decisions.set(ctx.runId, decision);
      if (decisions.size > 1000)
        decisions.delete(decisions.keys().next().value!);
    }
    return decision;
  };
  // Gate before any provider invocation (runs after before_model_resolve and
  // before the first model call on embedded, CLI, cron and subagent runs).
  api.on("before_agent_run", async (event, ctx) => {
    const decision =
      (ctx.runId ? decisions.get(ctx.runId) : undefined) ??
      (await resolve(event.prompt, ctx));
    if (decision.target === "held")
      return {
        outcome: "block",
        reason: decision.reason,
        category: "privacy_availability",
        message:
          "Held safely: no eligible model is available. Private content was not sent to cloud. Please retry after local service recovers.",
      };
  });
  api.on("agent_end", (_event, ctx) => {
    if (ctx.runId) {
      decisions.delete(ctx.runId);
      withAttachments.delete(ctx.runId);
    }
  });
  const withAttachments = new Set<string>();
  // Dashboard and channel turns on the private agent share this path, so a
  // public question behaves the same wherever it is asked.
  const delegate = async (
    text: string,
    ctx: {
      runId?: string;
      sessionKey?: string;
      sessionId?: string;
      agentId?: string;
      trigger?: string;
    },
  ) => {
    if (
      !cloud ||
      !api.runtime?.subagent ||
      ctx.agentId !== "main" ||
      ctx.trigger !== "user" ||
      (ctx.sessionKey ?? "").includes(":subagent:")
    )
      return;
    const attached = ctx.runId ? withAttachments.has(ctx.runId) : false;
    const localUp = await (options.localAvailable ?? localModelAvailable)();
    const session =
      ctx.sessionKey ?? ctx.sessionId ?? "unknown-private-session";
    const id = ctx.runId ?? randomUUID();
    if (!localUp && !attached && capabilitiesIntent(text)) {
      record((s) =>
        s.delegation(
          id,
          session,
          "capabilities_static_local_unavailable",
          "none",
        ),
      );
      return {
        handled: true,
        reason: "capabilities_static",
        reply: { text: capabilitiesText },
      };
    }
    if (!delegablePublicMessage(text, attached)) return;
    if (localUp && classifyTask(text, true).complexity !== "reasoning") return;
    const child = createHash("sha256")
      .update(`delegated:${id}`)
      .digest("hex")
      .slice(0, 32);
    const sessionKey = `agent:public-research:subagent:delegated-${child}`;
    record((s) =>
      s.delegation(
        id,
        session,
        localUp
          ? "public_reasoning_delegated"
          : "public_local_unavailable_delegated",
        sessionKey,
      ),
    );
    try {
      const run = await api.runtime.subagent.run({
        sessionKey,
        message: text.trim(),
        deliver: false,
        idempotencyKey: `delegated-${child}`,
      });
      const result = await api.runtime.subagent.waitForRun({
        runId: run.runId,
        timeoutMs: 120000,
      });
      const answer =
        result.status === "ok" &&
        result.terminalReply?.disposition === "visible"
          ? result.terminalReply.text
          : undefined;
      return {
        handled: true,
        reason: "public_delegated",
        reply: {
          text: answer
            ? `${answer}\n\n(Answered by the isolated public-research agent; no private history was shared.)`
            : "This public request could not be completed by the isolated research agent. Nothing private was sent. Please retry shortly.",
        },
      };
    } catch {
      return {
        handled: true,
        reason: "public_delegation_failed",
        reply: {
          text: "The isolated research agent is unavailable. Nothing private was sent. Please retry shortly.",
        },
      };
    }
  };
  api.on(
    "before_agent_reply",
    async (event, ctx) => {
      const delegated = await delegate(event.cleanedBody, ctx);
      if (delegated) return delegated;
      const decision = await resolve(event.cleanedBody, ctx);
      if (decision.target === "held")
        return {
          handled: true,
          reason: decision.reason,
          reply: {
            text: "Held safely: the required local model is unavailable. No task content was sent to a cloud model.",
          },
        };
    },
    { timeoutMs: 140000 },
  );
  api.on("before_model_resolve", async (event, ctx) => {
    if (ctx.runId && event.attachments?.length) withAttachments.add(ctx.runId);
    const decision = await resolve(
      event.prompt,
      ctx,
      Boolean(event.attachments?.length),
    );
    // Only public requests reach cloud, so falling back to local is safe.
    if (decision.target === "cloud" && cloud)
      return {
        providerOverride: cloud.provider,
        modelOverride: cloud.model,
        fallbacksOverride: ["ollama/gemma4:e2b"],
      };
    // This hook cannot block. A held run gets local with no fallback chain (so
    // never cloud) and is then stopped by before_agent_run before invocation.
    return {
      providerOverride: "ollama",
      modelOverride: "gemma4:e2b",
      fallbacksOverride: [],
    };
  });
  api.on("llm_output", (event) => {
    record((s) =>
      s.served(event.runId, event.provider, event.model, {
        input: event.usage?.input,
        output: event.usage?.output,
        total: event.usage?.total,
      }),
    );
  });
  api.on("model_call_ended", (event) => {
    if (event.provider === cloud?.provider && event.outcome === "error") {
      const category = event.errorCategory ?? "";
      if (/429|rate.?limit/i.test(category))
        cloudRateLimitedUntil = Date.now() + 60000;
      else cloudUnavailableUntil = Date.now() + 30000;
    }
    if (event.provider === cloud?.provider && event.outcome === "completed") {
      cloudUnavailableUntil = 0;
      cloudRateLimitedUntil = 0;
    }
    record((s) => s.outcome(event.runId, event.outcome, event.durationMs));
  });
}
