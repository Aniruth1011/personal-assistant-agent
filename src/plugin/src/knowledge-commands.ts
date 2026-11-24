import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { KnowledgeStore } from "../../knowledge/store.js";
import { assertTelegramActor } from "./telegram-auth.js";
import { createAssistantCheckpoint } from "../../persistence/runtime-checkpoint.js";
export function registerKnowledgeCommands(api: OpenClawPluginApi) {
  for (const name of ["remember", "knowledge"])
    api.registerCommand({
      name,
      description:
        "Save or recall non-sensitive fictional preferences and project context",
      acceptsArgs: true,
      requireAuth: true,
      channels: ["telegram"],
      async handler(context) {
        let store: KnowledgeStore | undefined;
        try {
          const authorize = () => {
            assertTelegramActor(context, process.env.TELEGRAM_ALLOWED_USER_ID);
          };
          authorize();
          const path = api.pluginConfig?.assistantStatePath;
          const workspace = api.config.agents?.defaults?.workspace;
          if (typeof path !== "string" || typeof workspace !== "string")
            throw Error("KNOWLEDGE_CONFIG");
          store = new KnowledgeStore(path);
          if (name === "knowledge")
            return {
              text:
                store
                  .list()
                  .map(
                    (f) => `${f.kind}:${f.key} (v${f.revision}) — ${f.value}`,
                  )
                  .join("\n") ||
                "No learned facts yet. Use /remember style communication concise, or /remember project atlas Synthetic demo agenda.",
            };
          const m =
            /^(style|project|person|tool|workflow) ([a-z][a-z0-9-]{1,40}) (.+)$/.exec(
              context.args?.trim() ?? "",
            );
          if (!m) throw Error("KNOWLEDGE_INPUT");
          const fact = store.remember(
            { kind: m[1], key: m[2], value: m[3] },
            authorize,
          );
          store.mirror(workspace);
          await createAssistantCheckpoint(path)();
          return {
            text: `Remembered ${fact.kind}:${fact.key} revision ${fact.revision}: ${fact.value}. Synthetic context only.`,
          };
        } catch {
          return {
            text: "Memory update unavailable or invalid. Use /knowledge to inspect saved state. Only non-sensitive fictional facts are accepted.",
          };
        } finally {
          store?.close();
        }
      },
    });
}
