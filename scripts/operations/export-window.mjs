import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { assessWindow } from "./window.mjs";
const [manifestPath, output = "evidence/formal-operation"] =
  process.argv.slice(2);
if (!manifestPath)
  throw Error(
    "Usage: node scripts/operations/export-window.mjs MANIFEST_JSON [OUTPUT_DIRECTORY]",
  );
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const bucket =
  process.env.APPLYPILOT_GCS_BUCKET ?? "applypilot-amplified-coder-510723-p3";
const call = (args) =>
  execFileSync("gcloud", args, {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024,
  });
mkdirSync(output, { recursive: true });
const start = manifest.start.replace(/[:.]/g, "-");
const end = manifest.end.replace(/[:.]/g, "-");
const objects = call([
  "storage",
  "ls",
  `gs://${bucket}/operations/samples/`,
  "--recursive",
])
  .trim()
  .split(/\r?\n/)
  .filter(
    (x) =>
      x.endsWith(".json") &&
      basename(x) >= start &&
      basename(x) <= end + ".json",
  );
const samples = [];
for (const uri of objects) {
  const bytes = call(["storage", "cat", uri]);
  const sample = JSON.parse(bytes);
  samples.push(sample);
  writeFileSync(join(output, `${sample.bootId}-${basename(uri)}`), bytes);
}
const assessment = assessWindow(manifest, samples);
writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
writeFileSync(
  join(output, "assessment.json"),
  JSON.stringify(assessment, null, 2) + "\n",
);
writeFileSync(
  join(output, "objects.json"),
  JSON.stringify(objects, null, 2) + "\n",
);
console.log(JSON.stringify(assessment));
