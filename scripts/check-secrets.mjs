import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".runtime",
]);
const ignoredFiles = new Set([".env.example", "package-lock.json"]);
const ignoredExtensions = new Set([
  ".pdf",
  ".sqlite",
  ".sqlite-shm",
  ".sqlite-wal",
]);
const rules = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

async function collect(fileOrDirectory) {
  const info = await stat(fileOrDirectory);
  if (info.isFile()) return [fileOrDirectory];
  const entries = await readdir(fileOrDirectory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !ignoredDirectories.has(entry.name))
      .map((entry) => collect(path.join(fileOrDirectory, entry.name))),
  );
  return nested.flat();
}

const targets = process.argv.slice(2).map((item) => path.resolve(item));
const files = (
  targets.length > 0
    ? await Promise.all(targets.map(collect))
    : await collect(root)
).flat();
const findings = [];

for (const file of files) {
  if (
    ignoredFiles.has(path.basename(file)) ||
    ignoredExtensions.has(path.extname(file).toLowerCase())
  ) {
    continue;
  }
  const contents = await readFile(file, "utf8");
  for (const rule of rules) {
    rule.lastIndex = 0;
    if (rule.test(contents)) findings.push(path.relative(root, file));
  }
}

if (findings.length > 0) {
  for (const file of new Set(findings))
    console.error(`Possible credential pattern: ${file}`);
  process.exitCode = 1;
} else {
  console.log(
    `No configured credential patterns found in ${files.length} file(s).`,
  );
}
