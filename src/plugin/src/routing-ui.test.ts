import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { routingRows, registerRoutingUi } from "./routing-ui.js";
import { RouteStore } from "../../router/store.js";
describe("routing website evidence boundary", () => {
  it("separates selected and served models and excludes private session identifiers", () => {
    const dir = mkdtempSync(join(tmpdir(), "routing-view-"));
    const path = join(dir, "db");
    const s = new RouteStore(path);
    try {
      s.decision(
        "r1",
        "private-secret-session",
        {
          target: "cloud",
          reason: "public_reasoning_cloud",
          privacy: "public",
          fallbacks: [],
        },
        "openai/gpt-6-luna",
        {
          privacy: "public",
          complexity: "reasoning",
          localAvailable: true,
          cloudAvailable: true,
          cloudRateLimited: false,
        },
      );
      let rows = routingRows(path);
      expect(rows[0].servedModel).toBeUndefined();
      s.served("r1", "ollama", "gemma4:e2b", {});
      s.outcome("r1", "completed", 20);
      rows = routingRows(path);
      expect(rows[0]).toMatchObject({
        selectedModel: "openai/gpt-6-luna",
        servedModel: "ollama/gemma4:e2b",
        outcome: "completed",
      });
      expect(JSON.stringify(rows)).not.toContain("private-secret-session");
      expect(JSON.stringify(rows)).not.toContain("sessionHash");
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("registers a native read-scope tab and protects its entire HTTP prefix with Gateway authentication", () => {
    const routes: unknown[] = [];
    const tabs: unknown[] = [];
    registerRoutingUi({
      pluginConfig: { assistantStatePath: "/synthetic/db" },
      session: {
        controls: { registerControlUiDescriptor: (x: unknown) => tabs.push(x) },
      },
      registerHttpRoute: (x: unknown) => routes.push(x),
    } as unknown as OpenClawPluginApi);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      path: "/plugins/applypilot/routing",
      auth: "gateway",
      match: "prefix",
    });
    expect(tabs[0]).toMatchObject({
      slug: "routing",
      requiredScopes: ["operator.read"],
    });
  });
});
