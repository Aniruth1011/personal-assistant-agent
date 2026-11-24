import { randomUUID } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { classifyTask, decideRoute } from "../../router/policy.js";
import { RouteStore } from "../../router/store.js";

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
          available: async () => true,
        }
      : undefined);
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
  ) => {
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
    const cloudAvailable = cloud ? await cloud.available() : false;
    const task = {
      ...classification,
      localAvailable,
      cloudAvailable,
      cloudRateLimited:
        process.env.APPLYPILOT_SIMULATE_CLOUD_RATE_LIMIT === "1",
    };
    const decision = decideRoute(task);
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
    return decision;
  };
  api.on("before_agent_reply", async (event, ctx) => {
    const decision = await resolve(event.cleanedBody, ctx);
    if (decision.target === "held")
      return {
        handled: true,
        reason: decision.reason,
        reply: {
          text: "Held safely: the required local model is unavailable. No task content was sent to a cloud model.",
        },
      };
  });
  api.on("before_model_resolve", async (event, ctx) => {
    const decision = await resolve(
      event.prompt,
      ctx,
      Boolean(event.attachments?.length),
    );
    if (decision.target === "cloud" && cloud)
      return {
        providerOverride: cloud.provider,
        modelOverride: cloud.model,
        fallbacksOverride: [],
      };
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
    record((s) => s.outcome(event.runId, event.outcome, event.durationMs));
  });
}
