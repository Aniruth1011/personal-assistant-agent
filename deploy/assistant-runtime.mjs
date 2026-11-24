import { selectApplicationSnapshot } from "../src/persistence/select-snapshot.ts";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  openSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { Storage } from "@google-cloud/storage";
import {
  NativeVault,
  restoreNativeFiles,
  sealNativeFiles,
} from "../src/persistence/native-vault.ts";
import { CloudArchive, GcsObjects } from "../src/persistence/cloud-archive.ts";
import { createAssistantCheckpoint } from "../src/persistence/runtime-checkpoint.ts";
import { cloudSmoke } from "./cloud-smoke.mjs";
import { KnowledgeStore } from "../src/knowledge/store.ts";
import { AssistantState } from "../src/scheduler/assistant-state.ts";
import { createOllamaProxy } from "./ollama-proxy.mjs";
const exec = promisify(execFile);
const emit = (event, data = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
process.on("uncaughtException", async (error) => {
  writeFileSync("/data/startup-error.log", String(error.stack ?? error), {
    mode: 0o600,
  });
  emit("assistant.startup_failed", {
    code: error.code ?? "STARTUP_FAILED",
    reason: /^[A-Z_]+$/.test(error.message)
      ? error.message
      : "SEE_PRIVATE_STARTUP_LOG",
  });
  try {
    const diagnostic = [
      String(error.stack ?? error),
      ...["gateway", "tailscaled"].map((name) =>
        existsSync(`/data/${name}.log`)
          ? readFileSync(`/data/${name}.log`, "utf8").slice(-24000)
          : "",
      ),
      // OpenClaw writes agent-turn and provider errors to its own file log.
      ...(existsSync("/tmp/openclaw")
        ? readdirSync("/tmp/openclaw")
            .filter((f) => f.endsWith(".log"))
            .sort()
            .slice(-1)
            .map((f) =>
              readFileSync(join("/tmp/openclaw", f), "utf8").slice(-48000),
            )
        : []),
    ].join("\n");
    const encrypted = sealNativeFiles(
      { "workspace/ERROR.md": Buffer.from(diagnostic) },
      Buffer.from(readFileSync("/secrets/backup/key", "utf8").trim(), "base64"),
    );
    await new Storage()
      .bucket(process.env.APPLYPILOT_GCS_BUCKET)
      .file(`infrastructure/diagnostics/${Date.now()}.enc`)
      .save(encrypted, {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    emit("assistant.encrypted_diagnostic_saved");
  } catch {
    emit("assistant.diagnostic_save_failed");
  }
  process.exit(1);
});
const root = "/data/runtime";
const credentials = JSON.parse(
  readFileSync("/secrets/runtime/credentials", "utf8"),
);
for (const name of [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_USER_ID",
  "APPLYPILOT_TEST_GMAIL_ACCOUNT",
  "APPLYPILOT_TEST_CALENDAR_ID",
  "APPLYPILOT_CLOUD_MODEL",
  "GOG_KEYRING_PASSWORD",
]) {
  if (typeof credentials.env[name] !== "string" || !credentials.env[name])
    throw Error("RUNTIME_CREDENTIAL_MISSING");
  process.env[name] = credentials.env[name];
}
Object.assign(process.env, {
  APPLYPILOT_FULL_RUNTIME: "1",
  APPLYPILOT_RUNTIME_ROOT: root,
  OPENCLAW_STATE_DIR: join(root, "state"),
  OPENCLAW_CONFIG_PATH: join(root, "state/openclaw.json"),
  GOG_HOME: join(root, "gog"),
  GOG_KEYRING_BACKEND: "file",
});
const key = Buffer.from(
  readFileSync("/secrets/backup/key", "utf8").trim(),
  "base64",
);
const storage = new Storage(),
  bucket = process.env.APPLYPILOT_GCS_BUCKET;
if (!bucket) throw Error("PRODUCTION_ARCHIVE_REQUIRED");
const vault = new NativeVault(root, bucket, key, storage);
let network, proxy;
const children = [];
let stopping = false,
  restored = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    if (network) network.readiness.ready = false;
    for (const child of children) child.kill("SIGTERM");
    await Promise.all(
      children.map((child) =>
        child.exitCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => {
              child.once("exit", resolve);
              setTimeout(resolve, 20000).unref();
            }),
      ),
    );
    if (restored)
      try {
        await vault.save();
        emit("assistant.shutdown_checkpoint");
      } catch {
        emit("assistant.shutdown_checkpoint_failed");
      }
    proxy?.close();
    network?.stopNetwork();
    process.exit(0);
  });
const files = await vault.latest();
if (files?.["state/applications.sqlite"] && !files["state/assistant.sqlite"]) {
  files["state/assistant.sqlite"] = files["state/applications.sqlite"];
}
if (files) {
  delete files["state/applications.sqlite"];
  delete files["state/controlled-sites.sqlite"];
}
if (
  !files ||
  !files["state/state/openclaw.sqlite"] ||
  !files["state/assistant.sqlite"]
)
  throw Error("VERIFIED_BOOTSTRAP_REQUIRED");
// The database-specific checkpoints may be newer than the periodic native backup.
// Overlay legacy first, then current receipts, so a checkpoint newer than the
// native vault survives a crash even before the first new vault is saved.
for (const [kind, filename] of [
  ["applications", "applications.sqlite"],
  ["assistant", "assistant.sqlite"],
]) {
  const prefix = `${process.env.APPLYPILOT_ARCHIVE_PREFIX ?? "applypilot/production"}/${kind}`;
  const [commits] = await storage
    .bucket(bucket)
    .getFiles({ prefix: `${prefix}/commits/` });
  const latest = commits.sort((a, b) => b.name.localeCompare(a.name))[0];
  if (latest) {
    const [bytes] = await latest.download({ validation: "crc32c" });
    const receipt = JSON.parse(bytes.toString());
    if (receipt.version !== 1 || !/^[a-f0-9]{64}$/.test(receipt.snapshotId))
      throw Error("INVALID_CHECKPOINT_RECEIPT");
    const snapshot = await new CloudArchive(
      new GcsObjects(bucket, storage),
      prefix,
    ).restore(receipt.snapshotId);
    if (!snapshot[filename]) throw Error("CHECKPOINT_DATABASE_MISSING");
    files["state/assistant.sqlite"] = selectApplicationSnapshot(
      files["state/assistant.sqlite"],
      snapshot[filename],
    );
  }
}
restoreNativeFiles(root, files);
restored = true;
emit("assistant.state_restored", { files: Object.keys(files).length });
// Imported Google tokens are stored under a dedicated encrypted Linux file keyring.
const importGoogleToken = async () => {
  const client = "/data/google-client.json",
    token = "/data/google-token.json";
  writeFileSync(client, JSON.stringify(credentials.googleClient), {
    mode: 0o600,
  });
  writeFileSync(token, JSON.stringify(credentials.googleToken), {
    mode: 0o600,
  });
  try {
    await exec("gog", ["auth", "credentials", "set", client], {
      env: process.env,
    });
    await exec("gog", ["auth", "tokens", "import", token], {
      env: process.env,
    });
  } finally {
    rmSync(client, { force: true });
    rmSync(token, { force: true });
  }
};
// A restored keyring can hold a refresh token Google has since revoked or
// expired (Testing-mode tokens last 7 days). Only an explicit auth rejection
// triggers re-import from the provisioned secret; transient errors do not.
const googleAuthRejected = async () => {
  try {
    await exec(
      "gog",
      [
        "gmail",
        "search",
        "newer_than:1d",
        "--account",
        process.env.APPLYPILOT_TEST_GMAIL_ACCOUNT,
        "--max",
        "1",
        "--json",
      ],
      { env: process.env, timeout: 30000 },
    );
    return false;
  } catch (error) {
    return /invalid_grant|auth_required/.test(
      `${error.stdout ?? ""}${error.stderr ?? ""}`,
    );
  }
};
if (!existsSync(join(root, "gog-imported"))) {
  // Retain a restored keyring; never replace its newer refresh token unnecessarily.
  let hasAccount = false;
  try {
    const r = await exec("gog", ["auth", "list", "--json"], {
      env: process.env,
    });
    hasAccount = r.stdout.includes(process.env.APPLYPILOT_TEST_GMAIL_ACCOUNT);
  } catch {
    /* first bootstrap */
  }
  if (!hasAccount) await importGoogleToken();
}
// Runs on every boot: a listed account can still hold a rejected token.
if (await googleAuthRejected()) {
  await importGoogleToken();
  emit("assistant.google_token_reimported");
  if (await googleAuthRejected()) throw Error("GOOGLE_TOKEN_REJECTED");
}
emit("assistant.google_credentials_ready");
await exec(process.execPath, ["scripts/local-gateway.mjs", "--prepare"], {
  env: process.env,
});
// Rebuild workspace memory from the newest verified database checkpoint.
// Its facts can be newer than the periodic native workspace snapshot.
const knowledge = new KnowledgeStore(join(root, "state/assistant.sqlite"));
try {
  knowledge.mirror(join(root, "workspace"));
} finally {
  knowledge.close();
}
const preferences = new AssistantState(join(root, "state/assistant.sqlite"));
try {
  preferences.mirror(join(root, "workspace"));
} finally {
  preferences.close();
}
const configPath = process.env.OPENCLAW_CONFIG_PATH;
const config = JSON.parse(readFileSync(configPath, "utf8"));
config.gateway.auth.allowTailscale = true;
config.gateway.bind = "loopback";
config.gateway.tailscale = { mode: "serve" };
config.gateway.trustedProxies = ["127.0.0.1", "::1"];
// Old machine-native plugin installation records must not load paths from macOS.
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", {
  mode: 0o600,
});
network = await import("./connectivity-probe.mjs");
network.readiness.phase = "assistant_starting";
proxy = createOllamaProxy(process.env.APPLYPILOT_OLLAMA_TAIL_HOST);
await new Promise((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(11434, "127.0.0.1", resolve);
});
const start = (name, args) => {
  const fd =
    name === "operations"
      ? null
      : openSync(join("/data", `${name}.log`), "a", 0o600);
  const child = spawn(process.execPath, args, {
    env: process.env,
    stdio:
      name === "operations"
        ? ["ignore", "inherit", "inherit"]
        : ["ignore", fd, fd],
  });
  children.push(child);
  child.on("exit", (code) => {
    if (!stopping) {
      emit("assistant.child_exit", { name, code });
      throw Error(`CHILD_EXIT_${name.toUpperCase()}`);
    }
  });
  return child;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitHttp(url) {
  const started = Date.now();
  let nextReport = started;
  let last = "NO_RESPONSE";
  while (Date.now() - started < 600000) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      last = `HTTP_${r.status}`;
      if (r.ok) return;
    } catch {
      last = "REQUEST_TIMEOUT_OR_UNAVAILABLE";
    }
    if (Date.now() >= nextReport) {
      emit("assistant.readiness_wait", {
        endpoint: new URL(url).pathname,
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
        response: last,
      });
      nextReport = Date.now() + 30000;
    }
    await wait(1000);
  }
  throw Error("ASSISTANT_STARTUP_TIMEOUT");
}
const cli = "/opt/openclaw/node_modules/openclaw/openclaw.mjs";
start("operations", ["--import", "tsx", "deploy/operations-monitor.mjs"]);
emit("assistant.gateway_starting");
start("gateway", [cli, "gateway", "run"]);
await waitHttp("http://127.0.0.1:19877/readyz");
await exec(process.execPath, ["scripts/schedule-assistant.mjs"], {
  env: process.env,
  timeout: 420000,
  maxBuffer: 1048576,
});
await exec(
  process.execPath,
  [
    cli,
    "automations",
    "create",
    "--agent",
    "main",
    "--no-deliver",
    "--timeout",
    "120000",
    "--cron",
    "*/10 * * * *",
    "--tz",
    "America/Los_Angeles",
    "--name",
    "ApplyPilot encrypted checkpoint",
    "--declaration-key",
    "applypilot-native-checkpoint-v1",
    "--script",
    "/app/automation/checkpoint.code",
    "--script-tool-budget",
    "1",
    "--script-timeout-seconds",
    "180",
    "--tools",
    "durability_checkpoint",
    "--session",
    "isolated",
    "--json",
  ],
  { env: process.env, timeout: 60000 },
);
await createAssistantCheckpoint(join(root, "state/assistant.sqlite"))();
await cloudSmoke(emit, network.connection.localModelVerified);
await vault.save();
const status = JSON.parse((await network.ts(["status", "--json"])).stdout);
if (status.CertDomains?.length) {
  const dns = status.Self.DNSName.replace(/\.$/, "");
  const live = JSON.parse(readFileSync(configPath, "utf8"));
  live.gateway.controlUi = {
    ...live.gateway.controlUi,
    allowedOrigins: [`https://${dns}`],
  };
  writeFileSync(configPath, JSON.stringify(live, null, 2) + "\n", {
    mode: 0o600,
  });
  // OpenClaw owns the Serve route and its identity-verified ingress listener.
  // Do not overwrite it with an external proxy to the ordinary Gateway port.
  const serve = JSON.parse(
    (await network.ts(["serve", "status", "--json"])).stdout,
  );
  if (!JSON.stringify(serve).includes(`${dns}:443`))
    throw Error("MANAGED_TAILSCALE_SERVE_MISSING");
  emit("assistant.https_enabled");
} else emit("assistant.https_pending_admin");
network.readiness.phase = "assistant_manual_testing";
network.readiness.ready = true;
emit("assistant.ready", {
  telegram: true,
  localModelAvailable: network.connection.localModelVerified,
  formal48h: "NOT_STARTED",
});
