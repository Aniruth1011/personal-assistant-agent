import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const earliest = process.argv.includes("--video")
  ? Date.parse(
      JSON.parse(readFileSync(".runtime/video-demo-plan.json", "utf8")).startAt,
    )
  : Date.now() - 30 * 60 * 1000;
if (!Number.isFinite(earliest))
  throw Error("Arm the video schedule before using --video.");

// Assignment3_local_Gemma.pdf Part3 requires a metadata-only, newest-first view.
const raw = execFileSync(
  "gcloud",
  [
    "logging",
    "read",
    'resource.labels.instance_name="applypilot-gate9" AND jsonPayload.event="operations.sample" AND jsonPayload.routes.kind:*',
    "--project=amplified-coder-510723-p3",
    "--freshness=30m",
    "--order=desc",
    "--limit=100",
    "--format=json",
  ],
  { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
);
const rows = JSON.parse(raw)
  .flatMap((entry) => entry.jsonPayload?.routes ?? [])
  .filter(
    (row) =>
      Date.parse(row.at) >= Math.max(earliest, Date.now() - 30 * 60 * 1000),
  )
  .sort((a, b) => String(b.at).localeCompare(String(a.at)));
console.log("UTC TIME\tKIND\tREQUEST ID\tROUTE\tREASON\tMODEL\tOUTCOME");
for (const row of rows) {
  console.log(
    [
      row.at,
      row.kind,
      row.id,
      row.target,
      row.reason,
      row.model ?? row.selectedModel,
      row.outcome,
    ]
      .map((value) => String(value ?? "—").replace(/[\r\n\t]/g, " "))
      .join("\t"),
  );
}
if (rows.length === 0) console.log("No routing records in the last30minutes.");
