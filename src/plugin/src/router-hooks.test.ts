import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { registerRouterHooks } from "./router-hooks.js";
import { RouteStore } from "../../router/store.js";
import { decideRoute, type RouteTask } from "../../router/policy.js";

describe("router plugin contracts (cloud is an explicit test double)", () => {
  it("selects cloud for isolated public reasoning, preserves private taint after restart, and holds private tasks locally", async () => {
    const dir = mkdtempSync(join(tmpdir(), "route-hooks-"));
    const path = join(dir, "state.sqlite");
    type Context = { sessionKey: string; agentId: string; runId: string };
    type Event = { prompt: string; cleanedBody?: string };
    const hooks = new Map<string, (e: Event, c: Context) => Promise<unknown>>();
    let local = true;
    const register = () =>
      registerRouterHooks(
        {
          pluginConfig: { assistantStatePath: path },
          on: (name: string, fn: unknown) =>
            hooks.set(name, fn as (e: Event, c: Context) => Promise<unknown>),
        } as unknown as OpenClawPluginApi,
        {
          localAvailable: async () => local,
          cloud: {
            provider: "test-cloud",
            model: "synthetic-double",
            available: async () => true,
          },
        },
      );
    try {
      register();
      const context = {
        sessionKey: "public-synthetic-session",
        agentId: "public-research",
        runId: "synthetic-run",
      };
      expect(
        await hooks.get("before_model_resolve")!(
          { prompt: "Compare sorting algorithms" },
          context,
        ),
      ).toEqual({
        providerOverride: "test-cloud",
        modelOverride: "synthetic-double",
        fallbacksOverride: ["ollama/gemma4:e2b"],
      });
      expect(
        await hooks.get("before_model_resolve")!(
          { prompt: "My private user profile" },
          context,
        ),
      ).toMatchObject({ providerOverride: "ollama", fallbacksOverride: [] });
      hooks.clear();
      register();
      local = false;
      expect(
        await hooks.get("before_agent_reply")!(
          { prompt: "", cleanedBody: "Compare sorting algorithms" },
          context,
        ),
      ).toMatchObject({ handled: true, reason: "private_local_unavailable" });
      expect(
        await hooks.get("before_agent_run")!(
          { prompt: "Compare sorting algorithms" },
          context,
        ),
      ).toMatchObject({ outcome: "block" });
      const store = new RouteStore(path);
      try {
        const events = store.events();
        expect(JSON.stringify(events)).not.toContain("My private user profile");
        expect(JSON.stringify(events)).not.toContain(context.sessionKey);
        for (const e of events.filter((e) => e.kind === "decision"))
          expect(decideRoute(e.task as RouteTask).target).toBe(e.target);
        expect(store.tainted(context.sessionKey)).toBe(true);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
  it("keeps a held run held across hooks and separates observed 429 from simulation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "route-hooks-held-"));
    const path = join(dir, "state.sqlite");
    type Handler = (e: unknown, c: unknown) => Promise<unknown>;
    const hooks = new Map<string, Handler>();
    let local = false;
    registerRouterHooks(
      {
        pluginConfig: { assistantStatePath: path },
        on: (name: string, fn: unknown) => hooks.set(name, fn as Handler),
      } as unknown as OpenClawPluginApi,
      {
        localAvailable: async () => local,
        cloud: {
          provider: "test-cloud",
          model: "synthetic-double",
          available: async () => true,
        },
      },
    );
    try {
      const priv = { sessionKey: "main-session", agentId: "main", runId: "r1" };
      await hooks.get("before_model_resolve")!(
        { prompt: "Summarize my inbox" },
        priv,
      );
      local = true; // availability recovers between hooks
      expect(
        await hooks.get("before_agent_run")!(
          { prompt: "Summarize my inbox", messages: [] },
          priv,
        ),
      ).toMatchObject({ outcome: "block" });
      await hooks.get("before_agent_reply")!({ cleanedBody: "x" }, priv);
      expect(
        await hooks.get("before_agent_run")!(
          { prompt: "x", messages: [] },
          priv,
        ),
      ).toMatchObject({ outcome: "block" });

      const pub = {
        sessionKey: "pub",
        agentId: "public-research",
        runId: "r2",
      };
      await hooks.get("model_call_ended")!(
        {
          runId: "r0",
          provider: "test-cloud",
          outcome: "error",
          errorCategory: "rate_limit",
          durationMs: 5,
        },
        pub,
      );
      expect(
        await hooks.get("before_model_resolve")!(
          { prompt: "Compare sorting algorithms" },
          pub,
        ),
      ).toMatchObject({ providerOverride: "ollama" });
      const store = new RouteStore(path);
      try {
        expect(JSON.stringify(store.events())).toContain(
          "observed_cloud_rate_limit_local",
        );
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("hands only a public current message from the private agent to an isolated research run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "route-hooks-delegate-"));
    const path = join(dir, "state.sqlite");
    type Handler = (e: unknown, c: unknown) => Promise<unknown>;
    const hooks = new Map<string, Handler>();
    let local = false;
    const runs: Array<{ sessionKey: string; message: string }> = [];
    registerRouterHooks(
      {
        pluginConfig: { assistantStatePath: path },
        on: (name: string, fn: unknown) => hooks.set(name, fn as Handler),
        runtime: {
          subagent: {
            run: async (p: { sessionKey: string; message: string }) => {
              runs.push(p);
              return { runId: `child-${runs.length}` };
            },
            waitForRun: async () => ({
              status: "ok",
              terminalReply: {
                disposition: "visible",
                text: "Rayleigh scattering.",
              },
            }),
          },
        },
      } as unknown as OpenClawPluginApi,
      {
        localAvailable: async () => local,
        cloud: {
          provider: "test-cloud",
          model: "synthetic-double",
          available: async () => true,
        },
      },
    );
    const reply = hooks.get("before_agent_reply")!;
    const main = (runId: string, trigger = "user") => ({
      sessionKey: "agent:main:main",
      agentId: "main",
      runId,
      trigger,
    });
    try {
      // Laptop off: a public question is still answered via the isolated agent.
      expect(
        await reply(
          { cleanedBody: "Explain step by step why the sky is blue." },
          main("d1"),
        ),
      ).toMatchObject({ handled: true, reason: "public_delegated" });
      expect(runs[0]!.message).toBe(
        "Explain step by step why the sky is blue.",
      );
      expect(runs[0]!.sessionKey).toMatch(
        /^agent:public-research:subagent:delegated-/,
      );
      // Private text is held, never handed over.
      expect(
        await reply(
          {
            cleanedBody:
              "This is confidential: remind me my locker code is on a sticky note.",
          },
          main("d2"),
        ),
      ).toMatchObject({ handled: true, reason: "private_local_unavailable" });
      for (const text of [
        "Summarize my emails",
        "What tasks are due today?",
        "Remember that I like tea",
      ])
        expect(
          await reply({ cleanedBody: text }, main(`p-${text}`)),
        ).toMatchObject({ reason: "private_local_unavailable" });
      // Capabilities answered deterministically while local is down.
      expect(
        await reply({ cleanedBody: "Hi, what can you do?" }, main("d3")),
      ).toMatchObject({ reason: "capabilities_static" });
      // Scheduled and subagent turns are never redirected.
      expect(
        await reply(
          { cleanedBody: "Explain why tides happen" },
          main("d4", "cron"),
        ),
      ).toMatchObject({ reason: "private_local_unavailable" });
      // Local up: a short task stays on the private agent's local model.
      local = true;
      expect(
        await reply({ cleanedBody: "What is 12 times 9?" }, main("d5")),
      ).toBeUndefined();
      expect(
        await reply(
          { cleanedBody: "Compare quicksort and mergesort" },
          main("d6"),
        ),
      ).toMatchObject({ reason: "public_delegated" });
      expect(runs.map((r) => r.message)).toEqual([
        "Explain step by step why the sky is blue.",
        "Compare quicksort and mergesort",
      ]);
      const store = new RouteStore(path);
      try {
        const events = store.events().filter((e) => e.kind === "delegation");
        expect(events.map((e) => e.reason)).toEqual([
          "public_local_unavailable_delegated",
          "capabilities_static_local_unavailable",
          "public_reasoning_delegated",
        ]);
        expect(JSON.stringify(store.events())).not.toContain("sky is blue");
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
