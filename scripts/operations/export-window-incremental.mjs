// Incremental, read-only export of a formal window. Safe to run repeatedly while
// the window is in progress: only samples missing from OUTPUT/raw are downloaded,
// then every summary is recomputed from the full local set.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { assessWindow } from "./window.mjs";

const [manifestPath, output] = process.argv.slice(2);
if (!manifestPath || !output)
  throw Error(
    "Usage: node scripts/operations/export-window-incremental.mjs MANIFEST_JSON OUTPUT_DIRECTORY",
  );
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const project =
  process.env.APPLYPILOT_GCP_PROJECT ?? "amplified-coder-510723-p3";
const bucket =
  process.env.APPLYPILOT_GCS_BUCKET ?? "applypilot-amplified-coder-510723-p3";
const raw = join(output, "raw");
mkdirSync(raw, { recursive: true });
const gcloud = (args, input) =>
  execFileSync("gcloud", args, {
    encoding: "utf8",
    input,
    timeout: 900000,
    maxBuffer: 256 * 1024 * 1024,
  });
const write = (name, value) =>
  writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");

const startName = manifest.start.replace(/[:.]/g, "-");
const endName = manifest.end.replace(/[:.]/g, "-") + ".json";
const objects = gcloud([
  "storage",
  "ls",
  `gs://${bucket}/operations/samples/`,
  "--recursive",
  `--project=${project}`,
])
  .trim()
  .split(/\r?\n/)
  .filter(
    (x) =>
      x.endsWith(".json") && basename(x) >= startName && basename(x) <= endName,
  )
  .sort((a, b) => basename(a).localeCompare(basename(b)));
const have = new Set(readdirSync(raw));
const missing = objects.filter((x) => !have.has(basename(x)));
if (missing.length)
  gcloud(
    ["storage", "cp", "-I", raw + "/", `--project=${project}`],
    missing.join("\n") + "\n",
  );
console.error(`objects=${objects.length} downloaded=${missing.length}`);

const files = readdirSync(raw)
  .filter((f) => f.endsWith(".json"))
  .sort();
const samples = files.map((f) =>
  JSON.parse(readFileSync(join(raw, f), "utf8")),
);
samples.sort((a, b) => a.at.localeCompare(b.at));
const assessment = assessWindow(manifest, samples);
let maxInterval = 0;
for (let i = 1; i < samples.length; i++)
  maxInterval = Math.max(
    maxInterval,
    (Date.parse(samples[i].at) - Date.parse(samples[i - 1].at)) / 1000,
  );

// Independent Cloud Logging copy of the same samples.
// Bound by the newest downloaded sample so in-progress runs compare like sets.
// Log entry timestamps trail the sample's own `at` slightly, so a complete
// window is bounded by its end instead.
const until = assessment.completeTime
  ? manifest.end
  : new Date(
      Math.min(Date.parse(samples.at(-1).at), Date.parse(manifest.end)),
    ).toISOString();
const logged = JSON.parse(
  gcloud([
    "logging",
    "read",
    `jsonPayload.event="operations.sample" AND timestamp>="${manifest.start}" AND timestamp<="${until}"`,
    `--project=${project}`,
    "--limit=10000",
    "--format=json(jsonPayload.at)",
  ]),
).map((e) => e.jsonPayload.at);
// Cloud Logging ingestion lags a little; in progress, skip the newest 3 minutes.
const cutoff = assessment.completeTime
  ? Date.parse(manifest.end)
  : Date.parse(until) - 180000;
const loggedSet = new Set(logged.filter((t) => Date.parse(t) <= cutoff));
const gcsSet = new Set(
  samples.map((s) => s.at).filter((t) => Date.parse(t) <= cutoff),
);
const reconciliation = {
  cloudLoggingSamples: loggedSet.size,
  gcsSamples: gcsSet.size,
  missingFromCloudLogging: [...gcsSet].filter((t) => !loggedSet.has(t)),
  missingFromGcs: [...loggedSet].filter((t) => !gcsSet.has(t)),
};

// Scheduled-job review from the run records each sample carries; later samples
// overwrite earlier snapshots of the same run.
const start = Date.parse(manifest.start);
const end = Date.parse(manifest.end);
const jobs = new Map();
const runs = new Map();
const routes = new Map();
for (const s of samples) {
  for (const j of s.jobs ?? []) jobs.set(j.id, j.declarationKey ?? j.id);
  for (const r of s.runs ?? []) runs.set(`${r.job_id}:${r.receipt_id}`, r);
  for (const r of s.routes ?? []) routes.set(r.seq, r);
}
const jobReview = {};
for (const r of runs.values()) {
  if (r.started_at_ms < start || r.started_at_ms > end) continue;
  const key = jobs.get(r.job_id) ?? r.job_id;
  const row = (jobReview[key] ??= { ok: 0, notOk: [], deliveryStates: {} });
  if (r.status === "ok" && !r.has_error) row.ok++;
  else
    row.notOk.push({
      at: new Date(r.started_at_ms).toISOString(),
      status: r.status,
    });
  row.deliveryStates[r.delivery_attempt_state] =
    (row.deliveryStates[r.delivery_attempt_state] ?? 0) + 1;
}
const lastJobs = (samples.at(-1)?.jobs ?? []).map((j) => ({
  declarationKey: j.declarationKey,
  enabled: j.enabled,
  lastRunAt: j.lastRunAtMs ? new Date(j.lastRunAtMs).toISOString() : null,
  lastRunStatus: j.lastRunStatus,
  lastDeliveryStatus: j.lastDeliveryStatus,
  consecutiveErrors: j.consecutiveErrors,
}));
const routeRows = [...routes.values()]
  .filter((r) => Date.parse(r.at) >= start && Date.parse(r.at) <= end)
  .sort((a, b) => a.seq - b.seq);
const tally = (rows, key) =>
  rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});
const routeSummary = {
  rows: routeRows.length,
  decisionReasons: tally(
    routeRows.filter((r) => r.kind === "decision"),
    "reason",
  ),
  servedModels: tally(
    routeRows.filter((r) => r.kind === "served"),
    "model",
  ),
  delegations: routeRows.filter((r) => r.kind === "delegation").length,
  privateServedByCloud: routeRows.filter(
    (r) =>
      r.kind === "decision" &&
      r.task?.privacy === "private" &&
      r.target === "cloud",
  ).length,
};
const first = samples[0];
const last = samples.at(-1);
const memoryFiles = Object.keys(last?.memoryHashes ?? {});
const memory = Object.fromEntries(
  memoryFiles.map((f) => [
    f,
    new Set(samples.map((s) => s.memoryHashes?.[f])).size,
  ]),
);

const checksums = Object.fromEntries(
  files.map((f) => [
    f,
    createHash("sha256")
      .update(readFileSync(join(raw, f)))
      .digest("hex"),
  ]),
);
const summary = {
  generatedAt: new Date().toISOString(),
  window: { start: manifest.start, end: manifest.end },
  image: manifest.image,
  configHash: manifest.configHash,
  status: assessment.status,
  completeTime: assessment.completeTime,
  observedThrough: assessment.observedThrough,
  samples: samples.length,
  firstSample: first?.at,
  lastSample: last?.at,
  maxIntervalSeconds: maxInterval,
  gapsOver180s: assessment.gaps.length,
  unhealthy: assessment.unhealthy.length,
  configDrift: assessment.configDrift.length,
  bootIds: assessment.bootIds,
  restartReviewRequired: assessment.restartReviewRequired,
  logReconciled:
    !reconciliation.missingFromCloudLogging.length &&
    !reconciliation.missingFromGcs.length,
  countsFirst: first?.counts,
  countsLast: last?.counts,
  memoryFileVersions: memory,
};
write("manifest.json", manifest);
write("assessment.json", assessment);
write("objects.json", objects);
write("log-reconciliation.json", reconciliation);
write("job-review.json", { jobs: jobReview, lastJobState: lastJobs });
write("route-summary.json", routeSummary);
write("checksums.json", checksums);
write("summary.json", summary);
if (!existsSync(join(output, "README.md")))
  writeFileSync(
    join(output, "README.md"),
    "Read-only export of the second formal window. raw/ holds every GCS health sample; summary.json, assessment.json, log-reconciliation.json, job-review.json and route-summary.json are recomputed from raw/ by scripts/operations/export-window-incremental.mjs.\n",
  );
console.log(
  JSON.stringify({ summary, jobs: jobReview, routeSummary }, null, 2),
);
