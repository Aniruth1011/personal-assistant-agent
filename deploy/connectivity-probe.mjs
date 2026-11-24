// Gate 9 infrastructure probe only. Does not start Telegram or mutate user data.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, request } from "node:http";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  openSync,
  symlinkSync,
} from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { SocksProxyAgent } from "socks-proxy-agent";

const exec = promisify(execFile);
const bucketName = process.env.APPLYPILOT_GCS_BUCKET;
const laptop = process.env.APPLYPILOT_OLLAMA_TAIL_HOST;
if (!bucketName || !/^100\.(?:\d{1,3}\.){2}\d{1,3}$/.test(laptop ?? ""))
  throw new Error("PROBE_CONFIGURATION_MISSING");
const key = Buffer.from(
  readFileSync("/secrets/backup/key", "utf8").trim(),
  "base64",
);
if (key.length !== 32) throw new Error("INVALID_BACKUP_KEY");
const bucket = new Storage().bucket(bucketName);
const prefix = "infrastructure/tailscale/";
mkdirSync("/data", { recursive: true, mode: 0o700 });
const emit = (event, data = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
const encrypt = (bytes) => {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
};
const decrypt = (bytes) => {
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
};
const [files] = await bucket.getFiles({ prefix });
const previous = files
  .filter((f) =>
    /^infrastructure\/tailscale\/\d{13}-[a-f0-9]{64}\.enc$/.test(f.name),
  )
  .sort((a, b) => b.name.localeCompare(a.name))[0];
if (previous) {
  const [bytes] = await previous.download({ validation: "crc32c" });
  const state = decrypt(bytes);
  JSON.parse(state.toString());
  writeFileSync("/data/tailscale.state", state, { mode: 0o600 });
  emit("tailscale.identity_restored");
}
const tslog = openSync("/data/tailscaled.log", "a", 0o600);
// --state alone does not establish TailscaleVarRoot for ACME certificates.
mkdirSync("/data/runtime/tailscale", { recursive: true, mode: 0o700 });
const daemon = spawn(
  "tailscaled",
  [
    "--tun=userspace-networking",
    "--state=/data/tailscale.state",
    "--statedir=/data/runtime/tailscale",
    "--socket=/data/tailscaled.sock",
    "--socks5-server=127.0.0.1:1055",
  ],
  { stdio: ["ignore", tslog, tslog] },
);
daemon.on("exit", (code) => {
  emit("tailscale.exit", { code });
  process.exit(code || 1);
});
export const ts = (args) =>
  exec("tailscale", ["--socket=/data/tailscaled.sock", ...args], {
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (let i = 0; i < 60 && !existsSync("/data/tailscaled.sock"); i++)
  await wait(500);
// OpenClaw verifies Serve identities with the default Tailscale CLI socket.
// The container user owns this directory; no elevated runtime privileges needed.
if (!existsSync("/var/run/tailscale/tailscaled.sock"))
  symlinkSync("/data/tailscaled.sock", "/var/run/tailscale/tailscaled.sock");
await ts([
  "up",
  "--accept-dns=false",
  "--hostname=applypilot-cloud",
  "--advertise-tags=tag:applypilot-cloud",
  ...(!previous ? ["--auth-key=file:/secrets/tailscale/key"] : []),
]);
const state = readFileSync("/data/tailscale.state");
JSON.parse(state.toString());
const cipherText = encrypt(state);
const name = `${prefix}${Date.now()}-${createHash("sha256").update(cipherText).digest("hex")}.enc`;
await bucket.file(name).save(cipherText, {
  resumable: false,
  validation: "crc32c",
  preconditionOpts: { ifGenerationMatch: 0 },
});
const [readback] = await bucket.file(name).download({ validation: "crc32c" });
if (!decrypt(readback).equals(state))
  throw new Error("IDENTITY_ARCHIVE_READBACK_FAILED");
const status = JSON.parse((await ts(["status", "--json"])).stdout);
if (status.BackendState !== "Running") throw new Error("TAILSCALE_NOT_RUNNING");
emit("tailscale.identity_durable", {
  restored: Boolean(previous),
  tagged: status.Self?.Tags?.includes("tag:applypilot-cloud") === true,
});
const agent = new SocksProxyAgent("socks5h://127.0.0.1:1055");
function upstream(path, body, port = 11434, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const bytes = body ? Buffer.from(JSON.stringify(body)) : undefined;
    const req = request(
      {
        host: laptop,
        port,
        path,
        method: bytes ? "POST" : "GET",
        agent,
        headers: bytes
          ? {
              "content-type": "application/json",
              "content-length": bytes.length,
            }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (x) => chunks.push(x));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("UPSTREAM_TIMEOUT")));
    req.end(bytes);
  });
}
export const connection = { localModelVerified: false };
let answer = { model: "gemma4:e2b" };
try {
  let tags;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      tags = await upstream("/api/tags", undefined, 11434, 5000);
      break;
    } catch (error) {
      emit("cloud_to_laptop.connect_retry", {
        attempt,
        code: error.code ?? "SOCKS_CONNECTION_NOT_READY",
      });
      if (attempt === 2) throw error;
      await wait(3000);
    }
  }
  if (
    tags.status !== 200 ||
    !JSON.parse(tags.body).models.some((m) => m.name === "gemma4:e2b")
  )
    throw new Error("LOCAL_MODEL_NOT_LISTED");
  const inference = await upstream("/api/chat", {
    model: "gemma4:e2b",
    messages: [
      {
        role: "user",
        content: "What is 2 plus 2? Reply with only the number.",
      },
    ],
    stream: false,
    think: false,
    options: { num_ctx: 32768, num_predict: 32, temperature: 0 },
  });
  answer = JSON.parse(inference.body);
  if (
    inference.status !== 200 ||
    answer.model !== "gemma4:e2b" ||
    answer.message?.content?.trim() !== "4"
  )
    throw new Error("LOCAL_INFERENCE_NOT_VERIFIED");
  emit("cloud_to_laptop.inference_verified", {
    model: answer.model,
    answer: "4",
    context: 32768,
    proxy: "explicit_socks5",
  });
  connection.localModelVerified = true;
} catch (error) {
  if (process.env.APPLYPILOT_FULL_RUNTIME !== "1") throw error;
  emit("cloud_to_laptop.unavailable", {
    privateTasks: "held",
    verification: "NOT_PASSED",
  });
}
export const readiness = {
  ready: process.env.APPLYPILOT_FULL_RUNTIME !== "1",
  phase: "connectivity_probe",
};
createServer((req, res) => {
  res.writeHead(req.url === "/healthz" ? (readiness.ready ? 200 : 503) : 404, {
    "content-type": "application/json",
  });
  res.end(
    JSON.stringify(
      req.url === "/healthz"
        ? {
            status: readiness.ready ? "ready" : "starting",
            phase: readiness.phase,
            localModel: answer.model,
          }
        : { error: "NOT_FOUND" },
    ),
  );
}).listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
emit("probe.ready");
export function stopNetwork() {
  daemon.removeAllListeners("exit");
  daemon.kill("SIGTERM");
}
if (process.env.APPLYPILOT_FULL_RUNTIME !== "1")
  process.on("SIGTERM", () => {
    stopNetwork();
    process.exit(0);
  });
