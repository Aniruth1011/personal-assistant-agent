import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { TodoStore } from "../../tasks/store.js";
import { createAssistantCheckpoint } from "../../persistence/runtime-checkpoint.js";
import { assertTelegramActor } from "./telegram-auth.js";

export function registerTodoCommands(api: OpenClawPluginApi) {
  for (const name of ["todos", "todoadd", "tododone"])
    api.registerCommand({
      name,
      description: "Read or explicitly change your synthetic to-do list",
      acceptsArgs: true,
      requireAuth: true,
      channels: ["telegram"],
      async handler(context) {
        let store: TodoStore | undefined;
        try {
          const authorize = () => {
            assertTelegramActor(context, process.env.TELEGRAM_ALLOWED_USER_ID);
          };
          authorize();
          const path = api.pluginConfig?.assistantStatePath;
          if (typeof path !== "string")
            throw Error("TODO_STATE_NOT_CONFIGURED");
          const args = context.args?.trim() ?? "";
          store = new TodoStore(path);
          if (name === "todos") {
            if (!["", "open", "completed", "all"].includes(args))
              throw Error("TODO_INPUT_INVALID");
            const tasks = store.list(
              (args || "open") as "open" | "completed" | "all",
            );
            return {
              text:
                tasks
                  .map(
                    (t) =>
                      `${t.id}: ${t.title}; P${t.priority}; due ${t.dueDate ?? "none"}; ${t.status}`,
                  )
                  .join("\n") || "No tasks in this view.",
            };
          }
          let task;
          if (name === "todoadd") {
            const m = /^(none|\d{4}-\d{2}-\d{2}) ([1-4]) (.+)$/.exec(args);
            if (!m)
              return {
                text: "Use /todoadd YYYY-MM-DD|none 1|2|3|4 title. P1 is highest priority. Synthetic tasks only.",
              };
            task = store.add(
              {
                title: m[3],
                dueDate: m[1] === "none" ? null : m[1],
                priority: Number(m[2]),
              },
              authorize,
            );
          } else task = store.complete(args, authorize);
          await createAssistantCheckpoint(path)();
          return {
            text: `${task.id}: ${task.status}; ${task.title}. Identical requests reuse this task.`,
          };
        } catch {
          return {
            text: "To-do operation unavailable or invalid. Check /todos before retrying; a failed checkpoint may follow a saved local change.",
          };
        } finally {
          store?.close();
        }
      },
    });
}
