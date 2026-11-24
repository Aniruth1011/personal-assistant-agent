// Renders reports/operations/FORMAL_48H_RESULT_SECOND.md from the exported
// evidence. Numbers come only from evidence files; incident text is fixed and
// must be reviewed against the evidence before submission.
//   node scripts/operations/write-window-report.mjs EVIDENCE_DIR REPORT_PATH
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, report] = process.argv.slice(2);
if (!dir || !report)
  throw Error(
    "Usage: node scripts/operations/write-window-report.mjs EVIDENCE_DIR REPORT_PATH",
  );
const read = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const s = read("summary.json");
const jobs = read("job-review.json").jobs;
const routes = read("route-summary.json");
const rec = read("log-reconciliation.json");
const pt = (iso) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "medium",
  });
const job = (key) => jobs[key] ?? { ok: 0, notOk: [] };
const ratio = (key) => {
  const j = job(key);
  return `${j.ok}/${j.ok + j.notOk.length}`;
};
const named = new Set([
  "applypilot-native-checkpoint-v1",
  "applypilot-alerts-v1",
  "applypilot-briefing-v1",
  "applypilot-recap-v1",
  "applypilot-observation-local-v1",
  "applypilot-observation-cloud-v1",
]);
const other = Object.entries(jobs).filter(([k]) => !named.has(k));
const complete = s.completeTime;
const coverageOk =
  complete &&
  s.gapsOver180s === 0 &&
  s.unhealthy === 0 &&
  s.configDrift === 0 &&
  s.bootIds.length === 1 &&
  !s.restartReviewRequired &&
  s.logReconciled;
const cloud = job("applypilot-observation-cloud-v1");
const headline = !complete
  ? "**IN PROGRESS — not a final result.**"
  : coverageOk
    ? `**Operational observation: PASS.** Scheduled cloud probe: ${cloud.notOk.length ? `**FAILED ${cloud.notOk.length}/${cloud.ok + cloud.notOk.length}** (see OPS-ROUTING-002)` : "passed"}.`
    : "**Operational observation: REQUIRES REVIEW.**";
const fmt = (o) =>
  Object.entries(o)
    .map(([k, v]) => `\`${k}\` ${v}`)
    .join(", ") || "none";

const md = `# Second formal 48-hour operation: result

${headline}

Generated ${s.generatedAt} from \`${dir}/\`. Window: **${s.window.start} to ${s.window.end}** (${pt(s.window.start)} to ${pt(s.window.end)} Pacific). Image \`${s.image.split("@")[1]}\`, config hash \`${s.configHash.slice(0, 12)}\`. The first window ([FORMAL_48H_RESULT.md](FORMAL_48H_RESULT.md)) ran an earlier image and is unchanged.

| Check | Actual result |
| --- | --- |
| Observed through | ${s.observedThrough}${complete ? " (full window)" : " (window not yet complete)"} |
| Durable health samples (GCS) | ${s.samples.toLocaleString("en-US")}, first ${s.firstSample}, last ${s.lastSample} |
| Independent Cloud Logging reconciliation | ${rec.gcsSamples} GCS vs ${rec.cloudLoggingSamples} Cloud Logging; ${s.logReconciled ? "all timestamps match" : `${rec.missingFromCloudLogging.length} missing from logging, ${rec.missingFromGcs.length} missing from GCS`} |
| Maximum sampling interval | ${s.maxIntervalSeconds} s (threshold 180 s); gaps over threshold: ${s.gapsOver180s} |
| Unhealthy samples / schema issues | ${s.unhealthy} |
| Restarts / configuration changes | ${s.bootIds.length - 1} / ${s.configDrift}; boot \`${s.bootIds.join(", ")}\` |
| Morning briefing | ${ratio("applypilot-briefing-v1")} runs succeeded |
| Evening recap | ${ratio("applypilot-recap-v1")} runs succeeded |
| Alert polling | ${ratio("applypilot-alerts-v1")} succeeded |
| Encrypted checkpoints | ${ratio("applypilot-native-checkpoint-v1")} succeeded |
| Scheduled local probe | ${ratio("applypilot-observation-local-v1")} succeeded |
| Scheduled cloud probe | ${ratio("applypilot-observation-cloud-v1")} succeeded${cloud.notOk.length ? `; failed at ${cloud.notOk.map((r) => r.at).join(", ")}` : ""} |
| Other scheduled jobs (video demo) | ${other.map(([k, v]) => `\`${k.slice(0, 8)}\` ${v.ok}/${v.ok + v.notOk.length}`).join(", ") || "none"} |
| Route decisions | ${fmt(routes.decisionReasons)} |
| Served models | ${fmt(routes.servedModels)}; delegations ${routes.delegations} |
| Private decisions routed to cloud | ${routes.privateServedByCloud} |
| Saved user data | tasks ${s.countsFirst?.todos} → ${s.countsLast?.todos}, facts ${s.countsFirst?.knowledge_facts} → ${s.countsLast?.knowledge_facts}; memory-file versions ${fmt(s.memoryFileVersions)} |

Evidence in \`${dir}/\`: \`raw/\` (every timestamped sample), \`summary.json\`, \`assessment.json\`, \`log-reconciliation.json\`, \`job-review.json\`, \`route-summary.json\`, \`checksums.json\`, \`objects.json\`, \`manifest.json\`. Reproduce with \`node scripts/operations/export-window-incremental.mjs evidence/formal-window-second-20261118-manifest.json ${dir}\`.

## Open defect: OPS-ROUTING-002 (scheduled cloud probe)

Every scheduled cloud probe in the window was classified private (\`private_local_only\`, complexity reasoning) and the run ended in error about 0.5 s later with no served-model record. Live public requests in the same window did reach the cloud (served \`gpt-6-luna\`), and no private decision was routed to cloud. Before the window this probe completed on \`gpt-6-luna\` under the USC profile; during readiness it was rebound to the personal OpenAI profile. The exact cause was not inspected during the window to avoid touching the running system. This is a routing acceptance defect for scheduled cloud work, not an uptime failure. It was not relabelled or hidden.

## Collection and limitations

Collected read-only with the project operator account by incremental download of the immutable GCS samples, recomputed from the full local set, and reconciled against Cloud Logging. Scheduled-job outcomes come from the run records embedded in each sample (the last snapshot of each run wins). Health sampling cannot exclude an event between samples. Planned activity during the window (demo recording) appears as ordinary traffic.
`;
writeFileSync(report, md);
console.log(md);
