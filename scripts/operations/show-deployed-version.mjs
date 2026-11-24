import { readFileSync } from "node:fs";
import { resolve } from "node:path";
process.env.OPENCLAW_STATE_DIR = resolve(".runtime/state");
process.env.OPENCLAW_CONFIG_PATH = resolve(".runtime/state/openclaw.json");
const { r: load } =
  await import("../../.runtime/host/node_modules/openclaw/dist/device-identity-DEOkZBE2.mjs");
const { t: GatewayClient } =
  await import("../../.runtime/host/node_modules/openclaw/dist/client-BFZnuo31.mjs");
const identity = load();
const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH));
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    client.stop();
    reject(new Error("PAIR_TIMEOUT"));
  }, 15000);
  const client = new GatewayClient({
    url: readFileSync(".runtime/advanced-cloud-url", "utf8")
      .trim()
      .replace("https:", "wss:"),
    token: config.gateway.auth.token,
    deviceIdentity: identity,
    scopes: ["operator.read", "operator.write", "operator.admin"],
    clientName: "cli",
    clientVersion: "2026.11.2",
    mode: "cli",
    onHelloOk: async (hello) => {
      clearTimeout(timer);
      const version = hello.server?.version;
      if (typeof version !== "string" || !version.trim()) {
        console.error("The deployed Gateway did not report a version.");
        process.exitCode = 1;
      } else {
        console.log("Authenticated deployed OpenClaw Gateway");
        console.log("Version: " + version);
        console.log("Verified at: " + new Date().toISOString());
      }
      await client.stopAndWait({ timeoutMs: 2000 });
      resolve();
    },
    onConnectError: (e) => {
      clearTimeout(timer);
      client.stop();
      reject(e);
    },
  });
  client.start();
});
