import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { listTestEmailThreads } from "../src/integrations/gogcli-email.ts";
import { listTestCalendarEvents } from "../src/integrations/gogcli-calendar.ts";
const exec = promisify(execFile);
export async function cloudSmoke(emit, localAvailable) {
  const security = readFileSync("/proc/self/status", "utf8");
  const capabilities = /^CapEff:\s*(\w+)/m.exec(security)?.[1];
  const noNewPrivileges = /^NoNewPrivs:\s*(\w+)/m.exec(security)?.[1];
  if (
    process.getuid() === 0 ||
    capabilities !== "0000000000000000" ||
    noNewPrivileges !== "1"
  )
    throw Error("RUNTIME_ISOLATION_FAILED");
  emit("assistant.isolation_verified", {
    uid: process.getuid(),
    capabilities,
    noNewPrivileges,
  });
  const account = process.env.APPLYPILOT_TEST_GMAIL_ACCOUNT;
  const emails = await listTestEmailThreads(
    { maxResults: 1 },
    { configuredAccount: account },
  );
  const now = new Date();
  const calendar = await listTestCalendarEvents(
    {
      from: now.toISOString(),
      to: new Date(now.getTime() + 86400000).toISOString(),
      timeZone: "America/Los_Angeles",
      maxResults: 5,
    },
    {
      configuredAccount: account,
      configuredCalendarId: process.env.APPLYPILOT_TEST_CALENDAR_ID,
    },
  );
  if (emails.status !== "success" || calendar.status !== "success")
    throw Error("GOOGLE_LIVE_READ_FAILED");
  emit("assistant.google_read_verified", {
    emailCount: emails.data.threads.length,
    calendarCount: calendar.data.events.length,
  });
  for (const [kind, question, expected] of [
    [
      "cloud",
      "Compare merge sort and quicksort in two short sentences. Use no tools.",
      "gpt-6-luna",
    ],
    [
      "local",
      "What is 2 plus 2? Reply only with the number. Use no tools.",
      "gemma4:e2b",
    ],
  ]) {
    if (kind === "local" && !localAvailable) {
      emit("assistant.local_model_check_held", {
        reason: "LOCAL_PATH_UNAVAILABLE",
      });
      continue;
    }
    let result;
    try {
      result = await exec(
        process.execPath,
        [
          "/opt/openclaw/node_modules/openclaw/openclaw.mjs",
          "agent",
          "--agent",
          "public-research",
          "--session-id",
          `cloud-smoke-${kind}-${Date.now()}`,
          "--message",
          question,
          "--json",
        ],
        { env: process.env, timeout: 150000, maxBuffer: 4194304 },
      );
    } catch (error) {
      // A cloud provider outage, quota exhaustion or timeout must not keep the
      // whole assistant offline; the local check below stays mandatory.
      if (kind !== "cloud") throw error;
      emit("assistant.cloud_model_unverified", {
        expected,
        failure: error.killed ? "timeout" : "command_failed",
      });
      continue;
    }
    const answer = JSON.parse(result.stdout);
    const meta = answer.result?.meta?.agentMeta;
    if (
      answer.status !== "ok" ||
      meta?.model !== expected ||
      !answer.result?.payloads?.some((p) => p.text?.trim())
    ) {
      // Metadata only: no prompt or reply text leaves the container.
      const safe = (v) =>
        typeof v === "string"
          ? v.replace(/[^\w .:/@-]/g, "").slice(0, 160)
          : undefined;
      emit("assistant.routed_model_mismatch", {
        kind,
        expected,
        status: safe(answer.status),
        provider: safe(meta?.provider),
        model: safe(meta?.model),
        payloads: answer.result?.payloads?.length ?? 0,
        error: safe(
          answer.error?.code ?? answer.error?.message ?? answer.summary,
        ),
        stopReason: safe(answer.result?.meta?.stopReason),
      });
      // An unavailable cloud account (quota, revoked login) must not take
      // Telegram, the dashboard and local Gemma down with it. Degrade
      // visibly; a wrong local answer remains fatal below.
      if (kind === "cloud") {
        emit("assistant.cloud_model_unverified", { expected });
        continue;
      }
      throw Error("CLOUD_ROUTED_MODEL_NOT_VERIFIED");
    }
    if (
      kind === "local" &&
      !answer.result.payloads.some((p) => p.text?.trim() === "4")
    )
      throw Error("CLOUD_LOCAL_ANSWER_INCORRECT");
    emit("assistant.routed_model_verified", {
      kind,
      provider: meta.provider,
      model: meta.model,
    });
  }
}
