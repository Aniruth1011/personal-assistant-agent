import { describe, it, expect, vi } from "vitest";
import type {
  OpenClawPluginApi,
  OpenClawPluginCommandDefinition,
} from "openclaw/plugin-sdk/plugin-entry";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerTodoCommands } from "./todo-commands.js";
import plugin from "./index.js";
import { TodoStore } from "../../tasks/store.js";
describe("to-do command boundary", () => {
  it("registers only the intended assistant tools", () => {
    expect(
      getToolPluginMetadata(plugin)
        ?.tools.map((t) => t.name)
        .sort(),
    ).toEqual(
      [
        "list_todos",
        "durability_checkpoint",
        "assistant_report",
        "weather_read",
        "public_web_search",
        "list_test_emails",
        "get_test_email",
        "classify_assistant_email",
        "draft_email_reply",
        "list_test_events",
      ].sort(),
    );
  });
  it("authenticates human commands, validates arguments and persists actual completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "todo-command-"));
    const commands: OpenClawPluginCommandDefinition[] = [];
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456");
    try {
      const path = join(dir, "state.sqlite");
      registerTodoCommands({
        pluginConfig: { assistantStatePath: path },
        registerCommand: (c: OpenClawPluginCommandDefinition) =>
          commands.push(c),
      } as unknown as OpenClawPluginApi);
      const add = commands.find((c) => c.name === "todoadd")!;
      const ctx = {
        channel: "telegram",
        senderId: "123456",
        isAuthorizedSender: true,
        args: "2026-12-01 2 Prepare demo",
      } as Parameters<typeof add.handler>[0];
      expect((await add.handler({ ...ctx, senderId: "999" })).text).toContain(
        "unavailable",
      );
      expect(
        (await add.handler({ ...ctx, args: "tomorrow do something" })).text,
      ).toContain("Use /todoadd");
      expect((await add.handler(ctx)).text).toContain(": open;");
      vi.stubEnv("APPLYPILOT_ENV", "production");
      vi.stubEnv("APPLYPILOT_GCS_BUCKET", "");
      const held = await add.handler({
        ...ctx,
        args: "none 3 Synthetic checkpoint failure",
      });
      expect(held.text).toContain(
        "failed checkpoint may follow a saved local change",
      );
      vi.stubEnv("APPLYPILOT_ENV", "test");
      await add.handler({
        ...ctx,
        args: "none 3 Synthetic checkpoint failure",
      });
      const store = new TodoStore(path);
      const id = store.list()[0]!.id;
      store.close();
      const done = commands.find((c) => c.name === "tododone")!;
      expect((await done.handler({ ...ctx, args: id })).text).toContain(
        ": completed;",
      );
      expect((await done.handler({ ...ctx, args: id })).text).toContain(
        ": completed;",
      );
      const reopened = new TodoStore(path);
      expect(reopened.list("all")).toHaveLength(2);
      expect(reopened.list("completed")).toHaveLength(1);
      reopened.close();
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
