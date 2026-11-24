import { readFileSync, writeFileSync } from "node:fs";
const config = JSON.parse(readFileSync(".runtime/state/openclaw.json", "utf8"));
async function invoke(tool, args) {
  const response = await fetch("http://127.0.0.1:19877/tools/invoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.gateway.auth.token}`,
    },
    body: JSON.stringify({ tool, args }),
    signal: AbortSignal.timeout(30000),
  });
  return { http: response.status, body: await response.json() };
}
const memory = await invoke("assistant_report", { kind: "knowledge" });
const invalid = await invoke("assistant_report", { kind: "not-a-kind" });
const calendar = await invoke("list_test_events", {
  from: "2026-11-13T00:00:00-08:00",
  to: "2026-11-14T00:00:00-08:00",
  timeZone: "America/Los_Angeles",
  maxResults: 50,
});
const prior = JSON.parse(
  readFileSync(".runtime/g8-post-restart-run.json", "utf8"),
).run;
const rejected =
  invalid.http >= 400 ||
  invalid.body.result?.isError === true ||
  invalid.body.ok === false;
if (!rejected) throw Error("INVALID_KIND_WAS_ACCEPTED");
if (memory.http !== 200 || memory.body.result?.details?.status !== "success")
  throw Error("MEMORY_READ_FAILED");
if (
  prior.status !== "ok" ||
  prior.delivered ||
  prior.deliverySuppressionReason !== "empty"
)
  throw Error("DUPLICATE_AFTER_RESTART");
const evidence = {
  recordedAt: new Date().toISOString(),
  memory: {
    http: memory.http,
    preferences: memory.body.result.details.preferences,
  },
  invalidInput: { http: invalid.http, rejected },
  calendar: {
    http: calendar.http,
    status: calendar.body.result?.details?.status,
    eventCount: calendar.body.result?.details?.data?.events?.length,
  },
  postRestartAlert: {
    status: prior.status,
    delivered: prior.delivered,
    deliverySuppressionReason: prior.deliverySuppressionReason,
  },
  workspaceMemoryExists: readFileSync(
    ".runtime/workspace/MEMORY.md",
    "utf8",
  ).includes("Fictional"),
};
writeFileSync(
  "evidence/g8-runtime-restart.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence));
