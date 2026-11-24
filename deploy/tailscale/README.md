# ApplyPilot tailnet access setup

Use the dedicated project Gmail tailnet. Do not replace a university or shared
network policy. Keep Google Cloud billing on the authorized USC project.

Run `node scripts/prepare-tailnet-policy.mjs` from the repository with Node24.
It checks the active dedicated account and generates
`.runtime/applypilot-tailnet-policy.json` using the laptop's actual tailnet IP.
The committed template uses a documentation-only IP; never apply it directly.

In the dedicated Tailscale admin console, open Access controls and the JSON
editor. Replace the initial policy with the generated private JSON, validate its
tests, and save. The policy allows only the cloud tag to laptop TCP11434 and
members/invited sharing users to tagged cloud TCP443. Omitted traffic is denied.
Do not retain the default allow-all grant alongside these rules. The existing
USC network policy must remain untouched.

After successful policy validation, create a non-reusable, non-ephemeral auth key
with `tag:applypilot-cloud`. Save it only in the ignored `.env` as
`TAILSCALE_AUTH_KEY`; do not paste keys into chat. A short key lifetime suffices
for initial registration. Cloud node state must be persisted securely so future
restarts do not need to reuse this enrollment key. Never use an ephemeral node
for the stable grader endpoint.

Do not enable laptop Serve until the saved policy is verified. Then use the
installed CLI's TCP forwarding to loopback Ollama on port11434. Never use Funnel.
Cloud traffic must explicitly use the userspace SOCKS proxy; grader HTTPS remains
protected by OpenClaw authentication. A saved policy alone does not prove network
isolation: test actual allowed and denied paths from cloud before Gate9 passes.

References: [policy syntax](https://tailscale.com/docs/reference/syntax/policy-file),
[grants selectors](https://tailscale.com/docs/reference/targets-and-selectors).
