import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { zstdDecompressSync } from "node:zlib";
const sessions = [
  "gate6-model-skills",
  "gate6-direct-tools",
  "gate6-direct-integrations",
  "gate6-email-single",
  "gate6-email-natural",
  "gate6-email-hostid",
  "gate6-calendar-hostid",
  "gate6-search-direct",
  "gate6-search-skill",
  "gate6-search-thinking",
  "gate6-four-skills-thinking",
];
const db = new DatabaseSync(
  ".runtime/state/agents/main/agent/openclaw-agent.sqlite",
  { readOnly: true },
);
const runs = [];
try {
  for (const session of sessions) {
    const path = `.runtime/${session}.json`;
    if (!existsSync(path) || !readFileSync(path, "utf8").trim()) continue;
    const output = JSON.parse(readFileSync(path, "utf8"));
    const meta = output.result?.meta ?? {};
    const toolResults = [];
    const skillReads = [];
    for (const row of db
      .prepare(
        "SELECT event_json, event_zstd FROM transcript_events WHERE session_id=? ORDER BY seq",
      )
      .all(session)) {
      const event = JSON.parse(
        row.event_json ?? zstdDecompressSync(row.event_zstd).toString(),
      );
      const message = event.message ?? {};
      if (message.role === "assistant") {
        for (const block of message.content ?? [])
          if (block.type === "toolCall" && block.name === "skills_read")
            skillReads.push(block.arguments?.name);
      }
      if (message.role !== "toolResult") continue;
      const result = {
        tool: message.toolName,
        isError: Boolean(message.isError),
      };
      if (message.details?.status) result.status = message.details.status;
      if (message.toolName === "web_search")
        result.sources = message.details?.results?.map((item) => item.url);
      toolResults.push(result);
    }
    runs.push({
      session,
      model: meta.agentMeta?.model,
      provider: meta.agentMeta?.provider,
      durationMs: meta.durationMs,
      toolResults,
      skillReads,
      skillNames:
        meta.systemPromptReport?.skills?.entries?.map((item) => item.name) ??
        [],
      limitation:
        "Development smoke probe; not held-out evaluation or a Telegram human approval.",
    });
  }
} finally {
  db.close();
}
writeFileSync(
  "evidence/g6-model-execution.json",
  JSON.stringify({ at: new Date().toISOString(), runs }, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    runs.map((r) => ({
      session: r.session,
      calls: r.toolResults.map((t) => ({ tool: t.tool, isError: t.isError })),
      skillReads: r.skillReads,
    })),
    null,
    2,
  ),
);
