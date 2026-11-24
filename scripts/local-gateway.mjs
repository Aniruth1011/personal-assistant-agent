import { DatabaseSync, backup } from "node:sqlite";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  cpSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (existsSync(".env")) process.loadEnvFile(".env");
const runtimeRoot = resolve(process.env.APPLYPILOT_RUNTIME_ROOT ?? ".runtime");
const state = resolve(runtimeRoot, "state");
const configPath = resolve(state, "openclaw.json");
const workspace = resolve(runtimeRoot, "workspace");
mkdirSync(workspace, { recursive: true, mode: 0o700 });
for (const name of ["SOUL.md", "USER.md", "IDENTITY.md", "MEMORY.md"])
  if (name !== "MEMORY.md" || !existsSync(resolve(workspace, name)))
    cpSync(name, resolve(workspace, name));
cpSync("skills", resolve(workspace, "skills"), { recursive: true });
const host = resolve(".runtime/host/node_modules/openclaw/openclaw.mjs");
if (!existsSync(host))
  throw new Error(
    "Install the pinned host: npm install --prefix .runtime/host --save-exact openclaw@2026.11.2",
  );
mkdirSync(state, { recursive: true, mode: 0o700 });
chmodSync(state, 0o700);
// One-time consistent local-state migration; retain original file for rollback.
const legacyDb = resolve(state, "applications.sqlite");
const assistantDb = resolve(state, "assistant.sqlite");
if (!existsSync(assistantDb) && existsSync(legacyDb)) {
  const db = new DatabaseSync(legacyDb, { readOnly: true });
  try {
    await backup(db, assistantDb);
  } finally {
    db.close();
  }
  chmodSync(assistantDb, 0o600);
}

const old = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, "utf8"))
  : {};
const token = old.gateway?.auth?.token || randomBytes(32).toString("hex");
const telegramEnabled = Boolean(process.env.TELEGRAM_BOT_TOKEN);
const telegramUser = process.env.TELEGRAM_ALLOWED_USER_ID;
if (telegramEnabled && !/^[1-9]\d*$/.test(telegramUser ?? ""))
  throw new Error(
    "Telegram requires a verified numeric TELEGRAM_ALLOWED_USER_ID",
  );
const pluginConfig = {
  assistantStatePath: resolve(state, "assistant.sqlite"),
};
const cloudEnabled = process.env.APPLYPILOT_CLOUD_MODEL === "openai/gpt-6-luna";
const publicWorkspace = resolve(runtimeRoot, "public-workspace");
if (cloudEnabled) {
  pluginConfig.cloudModel = "openai/gpt-6-luna";
  mkdirSync(publicWorkspace, { recursive: true, mode: 0o700 });
  cpSync("skills/web-search", resolve(publicWorkspace, "skills/web-search"), {
    recursive: true,
  });
  writeFileSync(
    resolve(publicWorkspace, "AGENTS.md"),
    "Public research only. No personal information, mail, calendar, private memory or credentials. Answer public technical questions. No external mutations.\n",
    { mode: 0o600 },
  );
}
for (const [key, envName] of [
  ["testGmailAccount", "APPLYPILOT_TEST_GMAIL_ACCOUNT"],
  ["testCalendarId", "APPLYPILOT_TEST_CALENDAR_ID"],
]) {
  if (process.env[envName]) pluginConfig[key] = process.env[envName];
}
const config = {
  ...old,
  agents: {
    ...old.agents,
    ...(cloudEnabled
      ? {
          ownership: "explicit",
          entries: {
            ...old.agents?.entries,
            main: { workspace },
            "public-research": {
              workspace: publicWorkspace,
              skills: ["web-search"],
              tools: { allow: ["web_search", "skills_search", "weather_read"] },
            },
          },
        }
      : {}),
    defaults: {
      ...old.agents?.defaults,
      workspace,
      skills: ["todo", "email", "calendar", "web-search"],
      model: { primary: "ollama/gemma4:e2b", fallbacks: [] },
      thinkingDefault: "low",
      // Native report jobs own proactive delivery. Ambient model turns can
      // replay old chat failures and must not resume after state restoration.
      heartbeat: {
        ...old.agents?.defaults?.heartbeat,
        every: "0m",
        target: "none",
        isolatedSession: true,
        ...(cloudEnabled ? { agentId: "main" } : {}),
      },
      ...(cloudEnabled
        ? {
            authInheritance: { agentId: "main" },
            systemAgent: { agentId: "main" },
            models: {
              "openai/gpt-6-luna": { agentRuntime: { id: "openclaw" } },
            },
          }
        : {}),
    },
  },
  ...(cloudEnabled
    ? {
        bindings: [
          { agentId: "main", match: { channel: "telegram", accountId: "*" } },
        ],
      }
    : {}),
  models: {
    ...old.models,
    providers: {
      ...old.models?.providers,
      ollama: {
        baseUrl: "http://127.0.0.1:11434",
        api: "ollama",
        apiKey: "ollama-local",
        models: [
          {
            id: "gemma4:e2b",
            name: "Gemma 4 E2B (local)",
            reasoning: true,
            input: ["text"],
            contextWindow: 32768,
            maxTokens: 4096,
            params: { temperature: 0, num_ctx: 32768, think: true },
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  },
  channels: {
    ...old.channels,
    telegram: {
      enabled: telegramEnabled,
      dmPolicy: telegramEnabled ? "allowlist" : "disabled",
      allowFrom: telegramEnabled ? [telegramUser] : [],
      groupPolicy: "disabled",
      configWrites: false,
    },
  },
  gateway: {
    ...old.gateway,
    mode: "local",
    bind: "loopback",
    port: 19877,
    auth: { mode: "token", token },
  },
  plugins: {
    allow: telegramEnabled
      ? [
          "applypilot-agent",
          "telegram",
          "duckduckgo",
          ...(cloudEnabled ? ["openai"] : []),
        ]
      : ["applypilot-agent", "duckduckgo", ...(cloudEnabled ? ["openai"] : [])],
    load: {
      paths: [
        resolve("src/plugin"),
        resolve(".runtime/host/node_modules/@openclaw/duckduckgo-plugin"),
      ],
    },
    entries: {
      "applypilot-agent": {
        enabled: true,
        config: pluginConfig,
        hooks: { allowConversationAccess: true },
      },
      "memory-core": {
        ...old.plugins?.entries?.["memory-core"],
        config: {
          ...old.plugins?.entries?.["memory-core"]?.config,
          dreaming: { enabled: false },
        },
      },
      telegram: { enabled: telegramEnabled },
      openai: { enabled: cloudEnabled },
      duckduckgo: {
        enabled: true,
        config: { webSearch: { safeSearch: "strict", region: "us-en" } },
      },
    },
  },
  tools: {
    exec: { notifyOnExit: false },
    toolSearch: false,
    byProvider: {
      "ollama/gemma4:e2b": { deny: ["group:web", "browser"] },
    },
    web: { search: { provider: "duckduckgo" } },
    allow: [
      "durability_checkpoint",
      "assistant_report",
      "weather_read",
      "public_web_search",
      "list_todos",
      "list_test_emails",
      "get_test_email",
      "classify_assistant_email",
      "draft_email_reply",
      "list_test_events",
      "web_search",
      "skills_read",
      "skills_search",
    ],
  },
};
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", {
  mode: 0o600,
});
chmodSync(configPath, 0o600);
console.log(
  "Local diagnostic Gateway: loopback port 19877; token authentication; private state in .runtime/state.",
);
if (!process.argv.includes("--prepare")) {
  const child = spawn(process.execPath, [host, "gateway", "run"], {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: state,
      OPENCLAW_CONFIG_PATH: configPath,
    },
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
