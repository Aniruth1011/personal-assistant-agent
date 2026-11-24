import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { AssistantState } from "../../scheduler/assistant-state.js";
import { createAssistantCheckpoint } from "../../persistence/runtime-checkpoint.js";
import { assertTelegramActor } from "./telegram-auth.js";
import { assistantReport, type ReportKind } from "../../scheduler/reports.js";

export function registerAssistantCommands(api: OpenClawPluginApi) {
  const config = api.pluginConfig ?? {};
  for (const name of [
    "briefing",
    "recap",
    "calendarcheck",
    "preferences",
    "emaildigest",
  ])
    api.registerCommand({
      name,
      description:
        "Read synthetic assistant reports or explicitly save constrained preferences",
      acceptsArgs: true,
      requireAuth: true,
      channels: ["telegram"],
      async handler(context) {
        try {
          const authorize = () =>
            assertTelegramActor(context, process.env.TELEGRAM_ALLOWED_USER_ID);
          authorize();
          if (typeof config.assistantStatePath !== "string")
            throw new Error("ASSISTANT_STATE_NOT_CONFIGURED");
          if (name === "preferences" && context.args?.trim()) {
            const match = /^(30|45|60) (on|off)$/.exec(context.args.trim());
            if (!match)
              return {
                text: "Use /preferences to read, or /preferences 30|45|60 on|off to save meeting minutes and focus-time protection.",
              };
            const store = new AssistantState(config.assistantStatePath);
            try {
              const workspace = api.config.agents?.defaults?.workspace;
              if (typeof workspace !== "string")
                throw new Error("WORKSPACE_NOT_CONFIGURED");
              const p = store.update(
                {
                  timeZone: "America/Los_Angeles",
                  meetingMinutes: Number(match[1]),
                  protectFocusTime: match[2] === "on",
                },
                authorize,
                workspace,
              );
              await createAssistantCheckpoint(config.assistantStatePath)();
              return {
                text: `Saved fictional preferences: ${p.meetingMinutes}-minute meetings; focus-time protection ${p.protectFocusTime}. Persisted with authenticated-user provenance.`,
              };
            } finally {
              store.close();
            }
          }
          const kind: ReportKind =
            name === "emaildigest"
              ? "email"
              : name === "calendarcheck"
                ? "calendar"
                : name === "preferences"
                  ? "knowledge"
                  : (name as ReportKind);
          const result = await assistantReport(kind, config);
          await createAssistantCheckpoint(config.assistantStatePath)();
          return { text: result.text };
        } catch {
          return {
            text: "Assistant report unavailable. No external mutation or automatic retry performed.",
          };
        }
      },
    });
}
