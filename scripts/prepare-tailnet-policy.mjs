import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
process.loadEnvFile(".env");
const cli = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const status = JSON.parse(
  execFileSync(cli, ["status", "--json"], { encoding: "utf8", timeout: 10000 }),
);
const owner = status.User?.[String(status.Self?.UserID)]?.LoginName;
if (
  status.BackendState !== "Running" ||
  owner !== process.env.APPLYPILOT_TEST_GMAIL_ACCOUNT ||
  status.CurrentTailnet?.Name !== owner
)
  throw Error("Dedicated test tailnet must be active");
const ip = status.Self?.TailscaleIPs?.find((value) =>
  /^100\.(?:\d{1,3}\.){2}\d{1,3}$/.test(value),
);
if (!ip) throw Error("Missing laptop tailnet IPv4 address");
const policy = JSON.parse(
  readFileSync("deploy/tailscale/policy.template.json", "utf8"),
);
policy.hosts["applypilot-laptop"] = ip;
policy.tests.push({
  src: owner,
  accept: ["tag:applypilot-cloud:443"],
  deny: ["applypilot-laptop:11434", "tag:applypilot-cloud:11434"],
});
mkdirSync(".runtime", { recursive: true, mode: 0o700 });
writeFileSync(
  ".runtime/applypilot-tailnet-policy.json",
  JSON.stringify(policy, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  "Prepared private policy for the verified dedicated tailnet; not applied. No Serve endpoint enabled.",
);
