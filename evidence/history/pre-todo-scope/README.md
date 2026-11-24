# ApplyPilot

ApplyPilot is planned as an OpenClaw-based CSCI 599 Assignment 3 project. The system will operate on fictional candidate data and controlled test application sites only. It will not submit applications to real employers.

## Project documents

- [Codebase walkthrough: reading order, execution flows and file reference](./CODEBASE_WALKTHROUGH.md)

- [Engineering plan](./APPLYPILOT_PLAN.md)
- [Implementation gates](./AGENTS.md)
- [Skill specifications](./SKILLS.md)
- [Assignment Description](./Assignment_3_Description.pdf)
- [Setup Recommendations](./Assignment_3_Setup_Recommendations.pdf)
- [Deployment Reference](./Deployment_Reference.pdf)
- [Local Gemma and Grader Access](./Assignment3_local_Gemma.pdf)
- [Video Instructions](./Assignment3_Video_Instructions.pdf)

## Current status

Gates 0–8 have evidence-backed passes. Gate 9 is in progress. The full assistant is deployed to Cloud Run Instance `applypilot-gate9` for manual testing, using image `sha256:c1f7f0da4aa6c07f4483faa62660b0ef70fda84b453afa7f5eb3f9d5ac7d1d1d`. Gateway readiness, Google reads, three browser form families, actual Luna/Gemma routing, persisted application records and active schedules are verified in `evidence/g9-cloud-manual-handoff.json` and `evidence/g9-deployed-readiness.json`. The user resolved the Cisco VPN conflict; keep laptop Ollama and Tailscale online. Private tasks hold if that path fails. HTTPS/grader access and final Gate 9 acceptance remain open. The formal 48-hour test has not started. Follow [MANUAL_TESTING.md](reports/operations/MANUAL_TESTING.md).

The Linux container builds and passes non-root/capability isolation checks. Its initial cloud entry is explicitly a connectivity probe, not the complete deployed assistant. Cloud Run deployment, cloud-origin Tailscale inference, stable grader access, remaining security findings, and full restart recovery must pass before Gate 9 closes. The formal 48-hour window has not started. Evaluation, ClawHub publication, video, and final packaging remain later gates. See `IMPLEMENTATION_CHECKLIST.md` and `DEV_LOG.md` for evidence and retained failures.

## Reproducible local Gateway diagnostics

Use Node 24.22.1. Keep the OpenClaw host separate from the plugin development installation:

```sh
npm install --prefix .runtime/host --save-exact openclaw@2026.11.2
npm --prefix src/plugin install
npm --prefix src/plugin run plugin:build
npx playwright install chromium
node scripts/local-gateway.mjs
```

The launcher reads ignored `.env` for dedicated Google and Telegram settings, stores a generated Gateway token in private `.runtime/state/openclaw.json`, and binds to loopback port 19877. Set `APPLYPILOT_CLOUD_MODEL=openai/gpt-6-luna` only after authenticating that provider; this enables a separate public research workspace. Main conversations remain private/local. In a separate terminal start `npm run sites:serve`. The historical `check-live-gateway.mjs` probe assumes an empty Gate 6 database and must not be used against an installation containing approved submissions. Never publish `.runtime`, `.env`, or tokens. Final release archives require their own credential scan.

## Local bootstrap

Requirements: Node.js 24.22.1 and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npx playwright install chromium
npm run verify
```

For local web search, install the OpenClaw provider recorded in `deploy/openclaw-plugins.lock.json` and select `duckduckgo` as `tools.web.search.provider`. Set its SafeSearch to `strict` and region to `us-en`; the provider is experimental and must not be treated as an authoritative source.

The E2E browser tests exercise only the controlled local sites. Playwright installs its Chromium browser separately from the npm package.

For the environment validation smoke check, copy `.env.example` to `.env` and set local-only values. Set `APPLYPILOT_STATE_DB` to a local transactional SQLite path; do not place live SQLite on a GCS FUSE mount. Never commit `.env` or place real credentials in the repository.

## Controlled synthetic sites

Start the three local form fixtures with `npm run sites:serve`. The server binds to `127.0.0.1:3210` and provides:

- `/apply/single-page` — single-page synthetic application.
- `/apply/multi-step` — two-step form.
- `/apply/dynamic` — conditional sponsorship field and synthetic résumé file input.
- `/jobs/platform-engineer` — versioned fictional job listing linked to the single-page form.
- `/api/submissions` — test-only submission endpoint with origin checks, an idempotency key, and authoritative in-memory confirmation records.

All profile, résumé, job, email, and calendar data in `fixtures/` is fictional. These endpoints are for local controlled testing; they do not represent real employer systems.

The application lifecycle uses a local SQLite database with append-only events and validated state. Submission requires an authenticated allowlisted approver and is bound to the verified revision. The test-only Playwright submit path permits one matching POST to the controlled site, then checks the site record and confirmation page. After a lost response, recovery reconciles the idempotency key and holds for a fresh human decision if the site has no record. Gate 9 adds create-only GCS archives and verified replay, with mandatory checkpoints before submission or email send.

### Local Telegram application review

The launcher uses Gemma 4 E2B for private work. Opt-in public research uses the
verified cloud model through the task-aware router; private requests never fall back to cloud.
The bot accepts only the configured numeric Telegram user ID; groups and remote
configuration writes are disabled. Keep its token in ignored `.env`.

After `fill_application` returns a durable application ID, send
`/reviewapplication APPLICATION_ID` to your bot. Review the synthetic fields and
controlled URL. If correct, send the exact `/approveapplication` command returned
by that review. Its revision and digest must match, and its authenticated sender
must still be allowlisted at execution. A model tool cannot issue approval.
`/statusapplication APPLICATION_ID` reads durable state. After interrupted
submission, `/reconcileapplication APPLICATION_ID` checks existing site records
and confirmation UI; it never retries submission. A missing record requires human
review. The controlled fixture server currently retains its records only during
its process lifetime; keep it running during this local test.

Install the pinned search provider alongside the isolated OpenClaw host:

```sh
npm install --prefix .runtime/host --save-exact @openclaw/duckduckgo-plugin@2026.11.2
```

`node scripts/check-live-skills.mjs` collects sanitized live Gateway RPC outcomes.
RPC success, mocked transport tests, actual model-directed tool execution, and
real human Telegram approval are recorded separately in `DEV_LOG.md`.

### Approved synthetic email test

Send `/reviewemail THREAD_ID` in the authorized Telegram chat using a thread ID
from the dedicated test inbox. Review the complete displayed recipient, subject,
and reply text. The returned `/approveemail EMAIL_ID DIGEST` command is an
explicit approval to send precisely that email. The recipient is restricted to
the dedicated test account itself. The LLM has no sending tool.

Approval expires after 15 minutes. Re-reviewing an expired unsent draft renews its
review window. Duplicate attempts, changed content, wrong recipients and
unauthorized senders are rejected. Gmail has no send idempotency key, so an
interrupted or uncertain send is held and never retried automatically. Use
`/emailstatus EMAIL_ID` and inspect the test Sent folder. `SENT` records a provider
message ID; independent Sent-folder verification is collected separately.

### Hybrid routing development status

Gate 7 implements a deterministic routing matrix and records replayable decision
facts, selected model, actual served provider/model, usage and latency in local
SQLite. It never writes prompts into route telemetry. Unknown cost stays null.
The regular assistant workspace is treated as private; a session that has handled
private content stays private across restarts. Public cloud work must use an
isolated public workspace, not a prompt claiming to be public.

Private tasks use local Gemma or are held with no cloud fallback. Short public
tasks prefer local; public reasoning and eligible local outages prefer an
available cloud provider; simulated cloud rate limits select eligible local
inference. Set `APPLYPILOT_SIMULATE_CLOUD_RATE_LIMIT=1` in the launcher environment
to exercise the simulation; unset it to restore normal policy. This does not
consume cloud quota. Cloud paths have now also been exercised against actual GPT-6 Luna in an isolated
public workspace. Gate 9 records actual provider/model telemetry and retains the
earlier test-double evidence as such.

### Proactive assistant development status (Gate 8)

The authenticated Telegram commands `/briefing`, `/recap`, `/calendarcheck`, and
`/preferences` use deterministic report code. `/preferences 30 on` saves a
30-minute fictional interview preference and protects weekday 09:00–11:00 focus
time; accepted durations are 30, 45, and 60, and focus protection is `on` or `off`.
Preferences persist in SQLite and mirror to the private workspace `MEMORY.md`.
No model tool can write these preferences.

`scripts/schedule-assistant.mjs` installs native OpenClaw script automations at
08:00 and 18:00 America/Los_Angeles, with alert checks every 30 minutes. Jobs have
only `assistant_report`, one tool call, and a 180-second deadline. These are
local development schedules, **not the formal 48-hour observation window**.
Briefing, recap, and alert delivery through the scheduler have actual Telegram
acknowledgements in `evidence/g8-native-delivery.json`.

Reports use dedicated-calendar events, bounded synthetic Gmail results, and
Open-Meteo weather for fixed Los Angeles. Calendar gaps respect saved focus time;
proposed slots never begin in the past. All-day events conservatively block time.
A full 50-event calendar response suppresses availability claims because it may
be truncated. Email briefings show the first ten unread/flagged synthetic threads;
alert polling retains pagination and failed-thread queues across restarts.
Provider errors remain explicit rather than becoming empty calendars/inboxes.

Alert reservations are durable **before** delivery. They are not delivery receipts:
OpenClaw run history supplies delivery evidence. An interrupted/ambiguous delivery
remains reserved for operator review rather than being automatically resent.
This favors avoiding duplicates and can require human recovery for a missed alert.
Calendar and email text cannot authorize actions or become trusted preferences.

Gate 8 passed local runtime acceptance (DEV_LOG G8-13). The user imported the two
fictional November 13 appointments into the dedicated test calendar. Exact overlap,
free slots, grounded preparation context and actual Telegram recap delivery are
verified in `evidence/g8-calendar-completion.json`. Gate 9 cloud deployment and
instance persistence remain pending. No personal-calendar availability or real
ATS compatibility is claimed.

### Credentials: where they live

`npm run check:env` loads the local `.env` and validates current integration
settings. It does not establish live provider access or cloud deployment readiness.

- Google OAuth client ID/secret and refresh tokens: already registered with `gog`;
  blank legacy `GOOGLE_CLIENT_*` entries in `.env` are not missing runtime secrets.
- Dedicated Gmail account and secondary Calendar ID: `.env` selects the synthetic
  account/calendar. Cloud billing uses the separately authorized USC account.
- OpenClaw gateway token: generated and persisted in private
  `.runtime/state/openclaw.json`. The local launcher does not consume a duplicate
  `OPENCLAW_GATEWAY_TOKEN` variable. Do not rotate the working token unnecessarily.
- Application/email approval: authenticated Telegram sender, exact payload/revision,
  expiring single-use SQLite records and execution-time revalidation. The legacy
  `APPROVAL_SIGNING_KEY` scaffold variable is unused; no placeholder key provides
  authority. It has been removed from the example and environment validator.
- Tailscale enrollment: `TAILSCALE_AUTH_KEY` in ignored `.env`; never publish it.
  Enrollment and persistent node-state recovery must be verified separately.
- Cloud deployment: credential transfer into scoped Secret Manager secrets and
  container-compatible Google credential storage remains Gate 9 work. A laptop
  login alone does not prove credentials will work inside the cloud container.
- Cloud model: platform-managed cloud login and an actual served-model response
  are still required. Google Cloud billing and the gateway token do not authenticate
  an LLM provider. Current assistant routing remains local until that is verified.
