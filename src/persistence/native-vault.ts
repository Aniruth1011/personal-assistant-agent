import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  lstatSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { Storage } from "@google-cloud/storage";
import { z } from "zod";
import { CloudArchive, GcsObjects } from "./cloud-archive.js";
import { withCheckpointLock } from "./checkpoint-lock.js";

const MAX_BYTES = 128 * 1024 * 1024;
function allowedPath(path: string): boolean {
  if (path.split("/").some((part) => part === "." || part === ".."))
    return false;
  return (
    /^state\/(state\/openclaw\.sqlite|agents\/(main|public-research)\/agent\/openclaw-agent\.sqlite|assistant\.sqlite|applications\.sqlite|controlled-sites\.sqlite|openclaw\.json)$/.test(
      path,
    ) ||
    /^(workspace|public-workspace)\/[A-Z][A-Z0-9_]*\.md$/.test(path) ||
    /^gog\/(config|data|state)\/[A-Za-z0-9_./@:%+-]{1,240}$/.test(path) ||
    /^tailscale\/certs\/[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(path)
  );
}
const Bundle = z.strictObject({
  version: z.literal(1),
  files: z.record(
    z.string().refine(allowedPath),
    z.strictObject({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      base64: z.string(),
    }),
  ),
});
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function sealNativeFiles(
  files: Record<string, Buffer>,
  key: Buffer,
): Buffer {
  if (key.length !== 32) throw Error("INVALID_VAULT_KEY");
  const bundle = Bundle.parse({
    version: 1,
    files: Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [
        name,
        { sha256: hash(bytes), base64: bytes.toString("base64") },
      ]),
    ),
  });
  const plain = Buffer.from(JSON.stringify(bundle));
  if (plain.length > MAX_BYTES) throw Error("VAULT_TOO_LARGE");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("applypilot-native-state-v1"));
  const data = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}
export function openNativeFiles(
  bytes: Buffer,
  key: Buffer,
): Record<string, Buffer> {
  if (key.length !== 32 || bytes.length < 29 || bytes.length > MAX_BYTES)
    throw Error("INVALID_VAULT_INPUT");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from("applypilot-native-state-v1"));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const plain = gunzipSync(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]),
    { maxOutputLength: MAX_BYTES },
  );
  const bundle = Bundle.parse(JSON.parse(plain.toString()));
  const result: Record<string, Buffer> = {};
  for (const [name, value] of Object.entries(bundle.files)) {
    const content = Buffer.from(value.base64, "base64");
    if (hash(content) !== value.sha256) throw Error("VAULT_FILE_HASH_MISMATCH");
    result[name] = content;
  }
  return result;
}
export async function captureNativeFiles(
  root: string,
): Promise<Record<string, Buffer>> {
  const paths = [
    "state/state/openclaw.sqlite",
    "state/agents/main/agent/openclaw-agent.sqlite",
    "state/agents/public-research/agent/openclaw-agent.sqlite",
    "state/assistant.sqlite",
    "state/openclaw.json",
  ];
  for (const workspace of ["workspace", "public-workspace"]) {
    if (existsSync(join(root, workspace)))
      for (const file of readdirSync(join(root, workspace)))
        if (/^[A-Z][A-Z0-9_]*\.md$/.test(file))
          paths.push(`${workspace}/${file}`);
  }
  const walk = (relative: string) => {
    if (!existsSync(join(root, relative))) return;
    for (const name of readdirSync(join(root, relative))) {
      const path = `${relative}/${name}`,
        stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink()) throw Error("VAULT_SYMLINK_REJECTED");
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) paths.push(path);
    }
  };
  for (const kind of ["config", "data", "state"]) walk(`gog/${kind}`);
  walk("tailscale/certs");
  const scratch = mkdtempSync(join(tmpdir(), "applypilot-native-vault-"));
  const files: Record<string, Buffer> = {};
  try {
    for (const path of paths) {
      const source = join(root, path);
      if (!existsSync(source)) continue;
      if (!allowedPath(path) || lstatSync(source).isSymbolicLink())
        throw Error("VAULT_PATH_REJECTED");
      if (path.endsWith(".sqlite")) {
        const db = new DatabaseSync(source, { readOnly: true });
        const dest = join(scratch, randomUUID() + ".sqlite");
        try {
          await backup(db, dest);
        } finally {
          db.close();
        }
        files[path] = readFileSync(dest);
      } else files[path] = readFileSync(source);
    }
    return files;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
/** Offline only; verify all databases in scratch before activating any restored file. */
export function restoreNativeFiles(
  root: string,
  files: Record<string, Buffer>,
): void {
  if (existsSync(root) && readdirSync(root).length)
    throw Error("VAULT_RESTORE_TARGET_NOT_EMPTY");
  const scratch = mkdtempSync(join(tmpdir(), "applypilot-native-verify-"));
  try {
    for (const [name, bytes] of Object.entries(files)) {
      if (!allowedPath(name)) throw Error("VAULT_PATH_REJECTED");
      if (name.endsWith(".sqlite")) {
        const path = join(scratch, randomUUID() + ".sqlite");
        writeFileSync(path, bytes, { mode: 0o600 });
        const db = new DatabaseSync(path, { readOnly: true });
        try {
          if (
            db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
          )
            throw Error("VAULT_SQLITE_INVALID");
        } finally {
          db.close();
        }
      }
    }
    for (const [name, bytes] of Object.entries(files)) {
      const target = join(root, name);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, bytes, { mode: 0o600 });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
export class NativeVault {
  readonly prefix = "applypilot/production/native";
  constructor(
    private root: string,
    private bucket: string,
    private key: Buffer,
    private storage = new Storage(),
  ) {}
  async save(): Promise<string> {
    return withCheckpointLock(join(this.root, "native-vault"), async () => {
      const objects = new GcsObjects(this.bucket, this.storage),
        archive = new CloudArchive(objects, this.prefix);
      const sealed = sealNativeFiles(
        await captureNativeFiles(this.root),
        this.key,
      );
      const id = await archive.snapshot({ "native.enc": sealed });
      await objects.create(
        `${this.prefix}/commits/${Date.now()}-${randomUUID()}.json`,
        Buffer.from(JSON.stringify({ version: 1, snapshotId: id })),
      );
      return id;
    });
  }
  async latest(): Promise<Record<string, Buffer> | undefined> {
    const [files] = await this.storage
      .bucket(this.bucket)
      .getFiles({ prefix: `${this.prefix}/commits/` });
    const latest = files.sort((a, b) => b.name.localeCompare(a.name))[0];
    if (!latest) return undefined;
    const [receipt] = await latest.download({ validation: "crc32c" });
    const id = z
      .strictObject({
        version: z.literal(1),
        snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(JSON.parse(receipt.toString())).snapshotId;
    const snapshot = await new CloudArchive(
      new GcsObjects(this.bucket, this.storage),
      this.prefix,
    ).restore(id);
    return openNativeFiles(snapshot["native.enc"], this.key);
  }
}
