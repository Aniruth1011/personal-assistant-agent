// Builds the Brightspace ZIP from the non-ignored project files, refusing
// anything that looks like private state or credentials.
//   node scripts/package-submission.mjs [OUTPUT_ZIP] [--video PATH_TO_MP4]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  rmSync,
} from "node:fs";
import { resolve, basename } from "node:path";

const args = process.argv.slice(2);
const videoAt = args.indexOf("--video");
const video = videoAt >= 0 ? resolve(args[videoAt + 1]) : null;
const output = resolve(
  args.find(
    (a, i) => !a.startsWith("--") && (videoAt < 0 || i !== videoAt + 1),
  ) ?? "../aniruth_sundararajan_a3.zip",
);
const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });

const excluded = [/^references\/Lecture_/];
const forbidden = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)/,
  /\.sqlite(-wal|-shm)?$/,
  /(^|\/)\.runtime\//,
  /(^|\/)node_modules\//,
  /(^|\/)client_secret[^/]*\.json$/,
  /(^|\/)oauth_client[^/]*\.json$/,
  /(^|\/)credentials\.json$/,
  /\.(pem|key|p12|enc|keyring)$/,
  /(^|\/)evidence\/private\//,
];
const files = run("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
])
  .split("\n")
  .filter(Boolean)
  .filter((f) => existsSync(f))
  .filter((f) => !excluded.some((r) => r.test(f)))
  .sort();
const bad = files.filter((f) => forbidden.some((r) => r.test(f)));
if (bad.length) throw Error(`FORBIDDEN_FILES:\n${bad.join("\n")}`);

const required = [
  "README.md",
  "PROCESS_LOG.md",
  "SOUL.md",
  "USER.md",
  ".env.example",
  "reports/security/SECURITY_REVIEW.md",
  "reports/performance/COMPARISON.md",
  "reports/operations/FORMAL_48H_RESULT.md",
  "evidence/formal-operation/assessment-final.json",
  "deploy/Dockerfile",
  "src/router/policy.ts",
];
const missing = required.filter((f) => !files.includes(f));
if (missing.length) throw Error(`MISSING_REQUIRED:\n${missing.join("\n")}`);

run("node", ["scripts/check-secrets.mjs"], { stdio: "inherit" });

const manifest = {
  generatedAt: new Date().toISOString(),
  files: files.length,
  sha256: Object.fromEntries(
    files.map((f) => [
      f,
      createHash("sha256").update(readFileSync(f)).digest("hex"),
    ]),
  ),
};
const manifestPath = "SUBMISSION_MANIFEST.json";
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const list = [...files, manifestPath];
if (existsSync(output)) rmSync(output);
run("zip", ["-X", "-q", output, "-@"], { input: list.join("\n") + "\n" });
if (video) run("zip", ["-X", "-q", "-j", output, video]);
rmSync(manifestPath);

const entries = run("unzip", ["-Z1", output]).split("\n").filter(Boolean);
const leaked = entries.filter((f) => forbidden.some((r) => r.test(f)));
if (leaked.length) throw Error(`ZIP_CONTAINS_FORBIDDEN:\n${leaked.join("\n")}`);
const digest = createHash("sha256").update(readFileSync(output)).digest("hex");
console.log(
  JSON.stringify(
    {
      zip: output,
      entries: entries.length,
      megabytes: +(statSync(output).size / 1048576).toFixed(1),
      sha256: digest,
      video: video ? basename(video) : null,
      secondWindowEvidence: entries.some((f) =>
        f.startsWith("evidence/formal-operation-second/"),
      ),
      secondWindowReport: entries.includes(
        "reports/operations/FORMAL_48H_RESULT_SECOND.md",
      ),
      processLogAi: entries.includes("PROCESS_LOG_AI.md"),
    },
    null,
    2,
  ),
);
