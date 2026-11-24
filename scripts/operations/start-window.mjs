import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { makeWindow } from "./window.mjs";
const [readinessPath, label, authorization] = process.argv.slice(2);
// Every window has its own claim and evidence file; earlier windows' claims and
// manifests are never overwritten.
if (!readinessPath || !/^[a-z0-9-]{1,40}$/.test(label ?? "") || !authorization)
  throw Error(
    'Usage: node scripts/operations/start-window.mjs READINESS_JSON LABEL "AUTHORIZATION" (only after verified readiness)',
  );
const project = process.env.GOOGLE_CLOUD_PROJECT ?? "amplified-coder-510723-p3";
const bucket =
  process.env.APPLYPILOT_GCS_BUCKET ?? "applypilot-amplified-coder-510723-p3";
const call = (args) =>
  execFileSync("gcloud", args, {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
  });
const existing = call([
  "storage",
  "ls",
  `gs://${bucket}/operations/samples/`,
  "--recursive",
])
  .trim()
  .split(/\r?\n/)
  .filter((x) => x.endsWith(".json"))
  .sort((a, b) => basename(a).localeCompare(basename(b)))
  .at(-1);
if (!existing) throw Error("NO_DURABLE_SAMPLES");
const sample = JSON.parse(call(["storage", "cat", existing]));
const instance = JSON.parse(
  call([
    "beta",
    "run",
    "instances",
    "describe",
    "applypilot-gate9",
    "--region=us-west1",
    `--project=${project}`,
    "--format=json",
  ]),
);
const readiness = JSON.parse(readFileSync(readinessPath, "utf8"));
// A singleton claim prevents overlapping windows, including concurrent operators.
// Preserve it after completion; a deliberate new observation requires review.
const manifest = makeWindow({
  readiness,
  sample,
  image: instance.spec.containers[0].image,
  authorization,
});
const dir = mkdtempSync(join(tmpdir(), "applypilot-window-"));
try {
  const path = join(dir, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", {
    mode: 0o600,
  });
  const uri = `gs://${bucket}/operations/manifests/${manifest.id}.json`;
  call([
    "storage",
    "cp",
    path,
    `gs://${bucket}/operations/active-window-${label}.json`,
    "--if-generation-match=0",
  ]);
  call(["storage", "cp", path, uri, "--if-generation-match=0"]);
  const observed = JSON.parse(call(["storage", "cat", uri]));
  if (JSON.stringify(observed) !== JSON.stringify(manifest))
    throw Error("MANIFEST_READBACK_FAILED");
  writeFileSync(
    `evidence/formal-window-${label}-manifest.json`,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      start: manifest.start,
      end: manifest.end,
      id: manifest.id,
      status: manifest.status,
    }),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
