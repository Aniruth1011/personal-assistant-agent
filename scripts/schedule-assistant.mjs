import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
if (existsSync(".env")) process.loadEnvFile(".env");
const runtime = resolve(process.env.APPLYPILOT_RUNTIME_ROOT ?? ".runtime");
const user = process.env.TELEGRAM_ALLOWED_USER_ID;
if (!/^[1-9]\d*$/.test(user ?? ""))
  throw Error("Verified Telegram recipient required");
const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: resolve(runtime, "state"),
  OPENCLAW_CONFIG_PATH: resolve(runtime, "state/openclaw.json"),
};
const cli = resolve(".runtime/host/node_modules/openclaw/openclaw.mjs");
const output = [];
for (const [kind, cron] of [
  ["briefing", "0 8 * * *"],
  ["recap", "0 18 * * *"],
  ["alerts", "*/30 * * * *"],
]) {
  const raw = execFileSync(
    process.execPath,
    [
      cli,
      "automations",
      "create",
      "--agent",
      "main",
      "--timeout",
      "120000",
      "--cron",
      cron,
      "--tz",
      "America/Los_Angeles",
      "--name",
      `ApplyPilot ${kind}`,
      "--declaration-key",
      `applypilot-${kind}-v1`,
      "--script",
      resolve(`automation/${kind}.code`),
      "--script-tool-budget",
      "1",
      "--script-timeout-seconds",
      "180",
      "--tools",
      "assistant_report",
      "--session",
      "isolated",
      "--announce",
      "--channel",
      "telegram",
      "--to",
      user,
      "--json",
    ],
    { env, encoding: "utf8", timeout: 150000, maxBuffer: 1048576 },
  );
  writeFileSync(resolve(runtime, `g8-schedule-${kind}.json`), raw, {
    mode: 0o600,
  });
  const job = JSON.parse(raw);
  output.push({
    kind,
    id: job.id ?? job.job?.id,
    enabled: job.enabled ?? job.job?.enabled,
  });
}
writeFileSync(
  resolve(runtime, "g8-schedule-ids.json"),
  JSON.stringify(output, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(output));
// Credential values and delivery recipient remain in private runtime configuration.
