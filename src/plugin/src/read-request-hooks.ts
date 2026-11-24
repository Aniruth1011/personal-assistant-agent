import { createHash } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { classifyTask } from "../../router/policy.js";

export function capabilitiesIntent(text: string): boolean {
  return /^(?:(?:hi|hello|hey)[,!\s]+)?(?:what can you do|how can you help(?: me)?|what are your capabilities)[?.!\s]*$/i.test(
    text.trim(),
  );
}

export function weatherIntent(text: string): boolean {
  return (
    /\b(weather|forecast|rain(?:ing)?|umbrella|temperature)\b/i.test(text) &&
    !/\b(email|inbox|calendar|quoted|document says)\b/i.test(text)
  );
}
export function readIntent(text: string) {
  if (
    !/\b(show|list|read|check|summari[sz]e|summary|what|when|find|is|are|any|have)\b/i.test(
      text,
    )
  )
    return;
  if (/\b(calendar|time slots?|schedule gaps?)\b/i.test(text))
    return "calendar";
  if (/\b(emails?|mail|inbox|mailbox)\b/i.test(text))
    return /\bunread\b/i.test(text) ? "unread_email" : "email";
  return undefined;
}

export function publicSearchQuery(text: string): string | undefined {
  const match =
    /^(?:search (?:the (?:public )?web )?for|look up|find (?:the )?)\s*([^\r\n]{1,300})$/i.exec(
      text.trim(),
    );
  if (!match) return;
  const query = match[1]
    .replace(/\s+and (?:give|send) me (?:its|the) links?\.?$/i, "")
    .trim();
  if (
    classifyTask(query, true).privacy !== "public" ||
    /\b(my|mine|our|personal|address|phone|credentials)\b|https?:|[<>`{}]/i.test(
      query,
    ) ||
    // Private-domain nouns belong to assistant_report, never to an external search.
    /\b(e-?mails?|mail|inbox|mailbox|calendar|meetings?|schedule|tasks?|to-?dos?|reminders?|appointments?)\b/i.test(
      query,
    )
  )
    return;
  return query;
}

export function registerReadRequestHooks(api: OpenClawPluginApi) {
  // Legacy embedded callers omit currentUserMessage in prompt-build. Capture
  // intent from the documented current-request model-resolution event instead
  // of falling back to a prompt that may contain reconstructed history.
  const reports = new Map<string, { kind: string; text?: string }>();
  api.on("after_tool_call", (event, ctx) => {
    const pending = ctx.sessionKey ? reports.get(ctx.sessionKey) : undefined;
    if (
      !pending ||
      event.toolName !== "assistant_report" ||
      event.error ||
      event.params.kind !== pending.kind
    )
      return;
    const result = event.result as
      { content?: Array<{ type?: string; text?: string }> } | undefined;
    for (const block of result?.content ?? []) {
      if (block.type !== "text" || !block.text) continue;
      try {
        const report = JSON.parse(block.text) as {
          status?: string;
          text?: string;
          issues?: unknown[];
        };
        if (
          (report.status === "success" || report.status === "partial") &&
          typeof report.text === "string"
        ) {
          pending.text =
            report.text +
            (report.issues?.length
              ? `\nProvider issues: ${JSON.stringify(report.issues)}`
              : "");
        }
      } catch {
        /* Malformed receipts must not become successful replies. */
      }
    }
  });
  const intents = new Map<
    string,
    { kind: ReturnType<typeof readIntent>; text: string }
  >();
  api.on("before_model_resolve", (event, ctx) => {
    if (ctx.runId)
      intents.set(ctx.runId, {
        kind: readIntent(event.prompt),
        text: event.prompt,
      });
  });
  api.on("before_tool_call", (event, ctx) => {
    const current = ctx.runId ? intents.get(ctx.runId) : undefined;
    if (event.toolName === "web-search")
      return {
        block: true,
        blockReason:
          "Unknown tool. Use the registered public search capability; never invent tool names.",
      };
    if (
      event.toolName === "web_search" ||
      event.toolName === "public_web_search"
    ) {
      const query = event.params.query;
      if (
        typeof query !== "string" ||
        !publicSearchQuery(`Search the public web for ${query}`)
      )
        return {
          block: true,
          blockReason:
            "Private or unsupported search query; no external search authorized.",
        };
    }
    if (!current) return;
    if (event.toolName === "assistant_report" && current.kind)
      return {
        params: { ...event.params, kind: current.kind, query: current.text },
      };
    if (event.toolName === "weather_read" && weatherIntent(current.text))
      return { params: { ...event.params, question: current.text } };
  });
  api.on("agent_end", (_event, ctx) => {
    if (ctx.runId) intents.delete(ctx.runId);
  });
  api.on("before_prompt_build", (event, ctx) => {
    const text =
      event.currentUserMessage ??
      (ctx.runId ? intents.get(ctx.runId)?.text : undefined);
    if (text && weatherIntent(text))
      return {
        toolsAllow: ["weather_read"],
        appendSystemContext: `Call weather_read with the current question: ${JSON.stringify(text)}. Use only its returned weather evidence. Reproduce its verified text without changing the date or expanding to other forecast periods. Never substitute web-search, web_search or a private briefing. Distinguish forecasts from observations and state unsupported locations honestly.`,
      };
    if (ctx.sessionKey?.startsWith("agent:main:subagent:capabilities-"))
      return {
        toolsAllow: [],
        appendSystemContext:
          "Answer only the current capabilities question. No reports or external actions.",
      };
    const search = text ? publicSearchQuery(text) : undefined;
    if (search && ctx.agentId !== "public-research")
      return {
        toolsAllow: ["public_web_search"],
        appendSystemContext: `Use public_web_search with ${JSON.stringify({ query: search })}. This sends only the explicit public query to an isolated researcher. Do not pass private history or other context.`,
      };
    if (ctx.agentId === "public-research")
      return {
        appendSystemContext:
          "For an explicit web search request call web_search (underscore), not a skill name. Report only actual returned sources. Never invent a successful search.",
      };
    const kind =
      text !== undefined
        ? readIntent(text)
        : ctx.runId
          ? intents.get(ctx.runId)?.kind
          : undefined;
    if (!kind) return;
    return {
      toolsAllow: ["assistant_report"],
      appendSystemContext: `The current request requires fresh provider evidence. First call assistant_report with {"kind":"${kind}","query":${JSON.stringify(text ?? "")}}. Do not answer from previous replies, memory or a compaction summary. After the tool returns, answer the current request using only its results, including partial/unavailable status. Never claim no emails or no events without that fresh result. Never send email or change calendar/tasks.`,
    };
  });
  // Adapted from the pinned OpenClaw plugin runtime API:
  // https://docs.openclaw.ai/plugins/sdk-runtime/background-work
  // Only an explicit authenticated human public-search request crosses to a new
  // isolated workspace; no private session history, profile or attachments copy.
  api.on(
    "before_dispatch",
    async (event, ctx) => {
      if (
        !process.env.TELEGRAM_ALLOWED_USER_ID ||
        !ctx.sessionKey?.startsWith("agent:main:") ||
        ctx.channelId !== "telegram" ||
        event.isGroup === true ||
        ctx.senderId !== process.env.TELEGRAM_ALLOWED_USER_ID ||
        !ctx.messageId
      )
        return;
      const query = publicSearchQuery(event.content);
      const capabilities = capabilitiesIntent(event.content);
      const kind =
        query || capabilities ? undefined : readIntent(event.content);
      if (!query && !kind && !capabilities) return;
      const label = query
        ? "Public web search"
        : capabilities
          ? "Capabilities request"
          : "Private read request";
      const id = createHash("sha256")
        .update(
          JSON.stringify([
            ctx.channelId,
            ctx.accountId,
            ctx.conversationId,
            ctx.senderId,
            ctx.messageId,
          ]),
        )
        .digest("hex")
        .slice(0, 32);
      const sessionKey = query
        ? `agent:public-research:subagent:public-search-${id}`
        : `agent:main:subagent:${capabilities ? "capabilities" : "private-read"}-${id}`;
      if (kind) reports.set(sessionKey, { kind });
      try {
        const run = await api.runtime.subagent.run({
          sessionKey,
          message: query
            ? `Analyze public web search results for this query: ${JSON.stringify(query)}. Call web_search with that query and return source links. Do not use skills_search as a substitute.`
            : capabilities
              ? "Describe your supported personal-assistant capabilities in at most four short sentences: dedicated test email summaries and human-approved replies, read-only calendar suggestions, public web research, and persistent to-do management. Mention scheduled briefings, reminders and recaps. Do not call tools, include a report, repeat past messages, or claim an action has occurred."
              : `Current private read request: ${JSON.stringify(event.content)}. First call assistant_report with ${JSON.stringify({ kind, query: event.content })}. Preserve the sender, date and unread constraints. Report only the current tool result and its exact coverage. Do not send email or mutate state.`,
          deliver: false,
          idempotencyKey: `${query ? "public-search" : capabilities ? "capabilities" : "private-read"}-${id}`,
        });
        const result = await api.runtime.subagent.waitForRun({
          runId: run.runId,
          timeoutMs: 120000,
        });
        const modelText =
          result.terminalReply?.disposition === "visible"
            ? result.terminalReply.text
            : undefined;
        const text =
          query || capabilities ? modelText : reports.get(sessionKey)?.text;
        return {
          handled: true,
          text:
            result.status === "ok" && text
              ? text
              : `${label} did not complete successfully. No result is being claimed; please retry later.`,
        };
      } catch {
        return {
          handled: true,
          text: `${label} is unavailable. No result is being claimed. Please retry later.`,
        };
      } finally {
        reports.delete(sessionKey);
      }
    },
    { priority: 100, timeoutMs: 140000 },
  );
}
