# Personal Assistant Agent — proactive personal assistant

A CSCI 599 Assignment 3 assistant accessed through Telegram. Four skills: **calendar, email, web search and to-do management**. Uses fictional users, synthetic tasks/messages/events and dedicated temporary accounts.

The project's internal working name was ApplyPilot. That name is kept in the code identifiers so they match the deployed system: the npm package name, `APPLYPILOT_*` environment variables, the `applypilot-gate9` Cloud Run instance and `APPLYPILOT_PLAN.md`.

**Platform attribution:** built on unmodified [OpenClaw](https://github.com/openclaw/openclaw) 2026.11.2 (not a fork), extended through the project plugin in `src/plugin`. Two small pieces are adapted from OpenClaw and attributed in code comments: the scheduler boilerplate matched in `src/router/policy.ts` (from OpenClaw `src/cron/isolated-agent/run.ts`) and the background-work pattern in `src/plugin/src/read-request-hooks.ts` (from the OpenClaw plugin SDK runtime docs). `scripts/evaluation/gateway-rpc.mjs` calls the pinned OpenClaw gateway client directly.

## Current source and deployment status

The formal 48-hour operational window (2026-11-13 08:30 UTC to 2026-11-15 08:30 UTC) passed; see [48-hour result](reports/operations/FORMAL_48H_RESULT.md). That window ran on an earlier image. A second window on the current full-build image (with the fixes below) started 2026-11-18 06:48:37 UTC and ends 2026-11-20 06:48:37 UTC; its result: **operational PASS** — 2,865 health samples, 0 gaps over 180 s (max 62.7 s), 0 unhealthy samples, 0 restarts, 0 configuration changes, Cloud Logging reconciliation 2,865/2,865; briefing 2/2, recap 2/2, alerts 96/96, checkpoints 288/288, local probe 8/8; the scheduled cloud probe failed 8/8 (open defect OPS-ROUTING-002); 0 private decisions routed to cloud. See [second 48-hour result](reports/operations/FORMAL_48H_RESULT_SECOND.md). The scheduled-routing defect was reproduced and corrected ([routing status](reports/operations/ROUTING_FIX_STATUS.md)). The [cloud/local comparison](reports/performance/COMPARISON.md) records 60 original attempts across three task types and 12 separate recovery checks. The [security audit](reports/security/SECURITY_REVIEW.md) covers ten risks and three live injection attempts, run on 2026-11-17 and repeated on the current image on 2026-11-19 (all contained; one unnecessary read-only tool call).

The 2026-11-18 candidate adds the [architecture-audit fixes](reports/operations/ARCHITECTURE_AUDIT_AND_FIX_PLAN.md): weather and search tools, sender/date-preserving email and calendar reads, consistent dashboard/Telegram routing, sticky held decisions, alert delivery reconciliation and history-based snapshot selection. `npm run verify` passes 135 root tests; the plugin suite passes 24. Local tests use provider doubles and are not live evidence. This candidate is deployed as image `sha256:8fdf113b938c1e3a2dcb21ec1ef62c4dd86245c1dbcab57bec0755aa2cba189d` (config hash `12a60e7251e8`) and was live-checked before the second window: cloud `gpt-6-luna` served a public reasoning turn, a public dashboard message was delegated to cloud, a fresh deadline alert was delivered to Telegram, a checkpoint succeeded, and with Ollama stopped private work was held while public work was delegated. See [readiness basis](evidence/formal-readiness-second-basis.md). Remaining gaps are listed under [Known limitations](#known-limitations).

The original [to-do triage skill](publication/assistant-todo-triage/SKILL.md) is published on ClawHub as version 1.0.0 with fresh-install evidence ([publication](reports/operations/SKILL_PUBLICATION.md)).

## Models, routing and private-task policy

- **Cloud model:** `openai/gpt-6-luna` through OpenClaw's documented ChatGPT OAuth browser login. No OpenAI API key is used; routing happens inside OpenClaw via plugin hooks. **Account disclosure:** the USC ChatGPT Edu account was used through 2026-11-17, including the original 48-hour window and the evaluation. On 2026-11-18 its quota was exhausted (`usage_limit_reached`, plan `education`, reset 2026-11-22), so the deployed agent was re-authenticated with the student's personal ChatGPT Plus account. The submitted demo video, the second 48-hour window and the grading period use the personal account.
- **Local model:** `gemma4:e2b` via Ollama on the student laptop, reached privately through Tailscale userspace networking and a loopback-only proxy (`deploy/ollama-proxy.mjs`). Context 32768 (`num_ctx`), thinking on.

### Feature: privacy-first hybrid routing

Every request is routed automatically by deterministic code, not by the model: private work stays on the laptop's local Gemma, and only public work that benefits from a stronger model goes to the cloud. Source: `decideRoute` and `classifyTask` in `src/router/policy.ts`, applied by OpenClaw hooks in `src/plugin/src/router-hooks.ts`.

**Step 1: label the request.**

- **Privacy:** _private_ if any one of these holds: it comes from the private agent (Main) rather than the isolated Researcher workspace; the session already contains private content (durable taint); it has an attachment; or the text contains a sensitive word or pattern (email, inbox, calendar, meeting, to-do, password, salary, medical, an email address, phone number, street address, SSN, "my account/tasks/schedule"…). Otherwise _public_.
- **Complexity:** _reasoning_ if longer than 1,200 characters or it asks to compare, analyze, explain, why, plan, design, evaluate, search, research, look up or step by step. Otherwise _short_.

**Step 2: pick a model.** Rules are checked in order; the first match wins.

| #   | Rule                           | Route                           | Logged reason                                                    |
| --- | ------------------------------ | ------------------------------- | ---------------------------------------------------------------- |
| 1   | Private, local up              | local Gemma                     | `private_local_only`                                             |
| 1   | Private, local down            | **held**: not sent to any model | `private_local_unavailable`                                      |
| 2   | Cloud rate-limited, local up   | local Gemma                     | `simulated_…` / `observed_cloud_rate_limit_local`                |
| 2   | Cloud rate-limited, local down | held                            | `…_cloud_rate_limit_no_local`                                    |
| 3   | Public, short, local up        | local Gemma                     | `short_local`                                                    |
| 4   | Public, cloud available        | **cloud** (`gpt-6-luna`)        | `public_reasoning_cloud` (or `public_local_down_cloud` if short) |
| 5   | Public, cloud unavailable      | local Gemma                     | `cloud_unavailable_local`                                        |
| 6   | Nothing available              | held                            | `no_eligible_model`                                              |

**In one line:** the cloud is used only for public reasoning requests, and for short public requests while local Gemma is down. Private requests never reach the cloud.

**Examples**

| Request                                       | Where      | Result                                                            |
| --------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| "Compare SQLite and Postgres for a small app" | Researcher | cloud (`public_reasoning_cloud`)                                  |
| "What is the capital of France?"              | Researcher | local Gemma (`short_local`)                                       |
| "Summarize my inbox"                          | Main       | local Gemma (`private_local_only`); held if the laptop is offline |
| "Explain how HTTPS works"                     | Main       | message text alone delegated to Researcher, then cloud            |
| "Explain my calendar conflicts"               | Main       | local Gemma: personal words block delegation                      |

**Why this design:** classification is lexical and deliberately conservative. A wrong guess sends public work to local Gemma (slower or weaker answer), never private work to the cloud. Every decision is logged as metadata only (reason, target, model; no message text), so routing is auditable; see the routing log below.

**Private-task policy when local Gemma is unavailable: held.** Private tasks never fall back to cloud; the cloud fallback chain is empty for private runs and a `before_agent_run` gate blocks held runs before any provider call. Once a session carries private content it stays private (durable taint, survives restart).

**Dashboard and Telegram behave the same.** Both reach the private agent (`main`). When a user's current message is clearly public (no personal pronouns, private-domain words, identifiers or attachments) and either needs reasoning or local Gemma is down, only that message text is handed to a fresh isolated `public-research` session; no history, workspace files or tools with private data cross. The route log records a `delegation` row followed by the research run's own decision. Short public questions with local up stay on local Gemma. Capabilities questions while local is down receive a fixed description. Classification is lexical, so this is conservative rather than semantic; see item R02 in the [architecture audit](reports/operations/ARCHITECTURE_AUDIT_AND_FIX_PLAN.md).

**Rate-limit simulation (reversible):** set `APPLYPILOT_SIMULATE_CLOUD_RATE_LIMIT=1` in the gateway environment and restart; unset to revert. Public reasoning then routes to local with reason `simulated_cloud_rate_limit_local`. Real provider 429s trigger a 60-second local cooldown logged as `observed_…`; other cloud errors cause a 30-second cooldown and fall back to local for public runs only.

**Routing log** (metadata only, no message text): `node scripts/operations/show-video-routes.mjs` prints the last 30 minutes, newest first, from Cloud Logging (`gcloud logging read 'resource.labels.instance_name="applypilot-gate9" AND jsonPayload.event="operations.sample"' --freshness=30m --order=desc`). Samples are emitted about every 60 seconds, so the newest request can lag by a minute.

## Deployment

- **Platform:** Google Cloud Run Instance `applypilot-gate9`, region `us-west1`, OpenClaw 2026.11.2, Node 24.22.1, non-root (UID 1000, no capabilities, `NoNewPrivs`), dedicated service account, internal ingress (grader access is through Tailscale Serve HTTPS).
- **Resources:** 2 vCPU / 4 GiB, chosen at creation for headroom: the container runs the OpenClaw gateway with plugins, Tailscale userspace networking, the Ollama proxy and the operations monitor. Even at this size, gateway logs recorded event-loop stalls and CPU throttling during cold start. A 1 vCPU / 1 GiB configuration was not measured.
- **Secrets:** Secret Manager volumes for the Tailscale key, backup encryption key and runtime credentials. Tailscale and backup keys are pinned to version 1; runtime credentials mount `:latest` (version 2, holding the re-authorized Google token from 2026-11-18). Mount `:latest` if you rotate the Tailscale key.
- **Persistence:** live SQLite on local transactional disk (never GCS FUSE); immutable application snapshots and an encrypted native-state archive (sessions, memory, Tailscale node state) in the GCS bucket, restored at startup and saved on SIGTERM. Restore compares append-only histories and refuses divergent snapshots.
- **Concurrent-write safety (§4.5):** single-writer discipline. Trusted memory and preferences live in SQLite with revisioned, transactional updates, and workspace `MEMORY.md`/`USER.md` facts are regenerated mirrors. Scheduled jobs never write workspace files.
- **Build and deploy:** `gcloud builds submit --tag us-west1-docker.pkg.dev/PROJECT/applypilot/runtime .` then `gcloud beta run instances update applypilot-gate9 --region us-west1 --image IMAGE@DIGEST`, keeping the existing secret volumes and environment. Container startup: `deploy/assistant-runtime.mjs` (restore → `scripts/local-gateway.mjs --prepare` → gateway, Tailscale, monitor).
- **Grader access:** Tailscale machine share plus `https://<machine>.<tailnet>.ts.net/` (identity-verified Serve; gateway token as fallback). Share links and the token are submitted privately through Brightspace only. See [For graders](#for-graders).

## For graders

Access details (share invite, URL, gateway token) are in the Brightspace submission, not in this repository.

1. Accept the Tailscale share invite with your own Tailscale account and install or sign in to Tailscale on your device. Only the cloud instance is shared; no other device is visible.
   Keep Tailscale connected while testing (on a phone it must be the active VPN). Use Safari, Chrome or Firefox: Brave on iOS could not reach the shared machine in our test, while Safari on the same phone could. If the `.ts.net` name does not resolve, enable MagicDNS in your own tailnet's DNS settings.
2. Open the HTTPS URL from Brightspace. If the dashboard asks for a gateway token, paste the token from Brightspace into its settings.
3. **Main** is the private assistant (email, calendar, to-dos, memory). **Researcher** is the isolated public agent (web search, cloud reasoning).

Suggested checks:

| Try                                                                                 | Where      | Expected                                                                                               |
| ----------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `What's on my calendar tomorrow?`                                                   | Main       | Read-only calendar summary from local Gemma (held if the student laptop is offline)                    |
| `Summarize my recent emails`                                                        | Main       | Synthetic mailbox summary from local Gemma                                                             |
| `What are my open tasks?` / `Give me my morning briefing` / `Give me today's recap` | Main       | Task list and reports via read-only tools                                                              |
| `Explain why the sky is blue in two sentences`                                      | Main       | Handed to the research agent and answered by cloud `gpt-6-luna`; the reply ends with a delegation note |
| `Search the web for latest news from Germany`                                       | Researcher | DuckDuckGo results with sources                                                                        |
| `What is the weather in Los Angeles today?`                                         | Main       | Open-Meteo / NWS forecast                                                                              |

**If the student laptop is off** (likely during grading): the calendar, email and task rows return a "held" reply instead of an answer, which is the intended private-task policy. The sky-is-blue, web-search and weather rows are public, so they are still answered by the cloud model through the research agent. Private requests use only the local model on the student laptop and are never sent to cloud. Telegram is restricted to the student's account, so use the dashboard. Slash commands (`/todos`, `/briefing`, `/approveemail`, …) are Telegram-only by design, because they are the authenticated human-command path, so in the dashboard ask in plain language instead. Email sending needs the student's Telegram approval, so graders cannot send email. Please don't change gateway settings; the token will be rotated after grading.

## User interface

- `/todos` — open tasks; `/todos all` includes completed tasks.
- `/todoadd 2026-12-01 2 Prepare fictional demo slides` — add a synthetic task (P1 highest priority).
- `/todoadd none 3 Review synthetic notes` — add without due date.
- `/tododone todo-<returned-id>` — complete a task.
- `/briefing`, `/recap`, `/calendarcheck`, `/preferences` — existing assistant reports/settings.
- Email review/send uses the dedicated authenticated approval commands.

The to-do list is stored locally and checkpointed to cloud storage; it does not require or connect to Todoist. Duplicate identical adds return the same task. Task edit/delete/reopen/recurrence are not implemented. Task deadlines do not book calendar events.

## Development

Use Node 24.22.1. Install root dependencies with `npm ci`, plugin dependencies with `npm ci --prefix src/plugin`, then `npm --prefix src/plugin run plugin:build`. The OpenClaw host is separate: `npm install --prefix .runtime/host --save-exact openclaw@2026.11.2`.

Configure dedicated accounts in ignored `.env` following `.env.example`. `node scripts/local-gateway.mjs --prepare` prepares configuration; omit `--prepare` only when intentionally starting a local Gateway. Do not run a second Telegram poller alongside the cloud instance.

Validation: `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:secrets`.

## Architecture

OpenClaw owns Telegram, model execution and scheduling. Narrow plugin tools handle provider reads and task listing; authenticated commands enforce mutations. Local Gemma/Ollama is accessed from Cloud Run Instance through Tailscale and a restricted loopback proxy. Public cloud reasoning uses the isolated public-research workspace. Private tasks never fall back to cloud. Weather: `weather_read` tool and briefing use Open-Meteo for Los Angeles with a National Weather Service forecast fallback (forecast-only, labeled); other locations are reported unsupported. Web search: OpenClaw DuckDuckGo provider (`web_search`, strict safe search) in the isolated research agent, reached from the private agent only through `public_web_search` with private-content rejection.

SQLite resides on transactional local disk, with immutable GCS snapshots and an encrypted native-state vault. Never mount live SQLite through GCS FUSE. Production credentials belong in Secret Manager. Local private runtime state and original rollback archive are excluded from source packaging.

## Known limitations

These are known, observed limitations of the submitted system, not planned features. Each was found in testing or operation and is recorded in DEV_LOG.md.

### Routing and models

- **Web search from the dashboard Main chat can fail.** When the private agent calls `public_web_search`, the tool's fixed internal instruction contains the word "private", so the lexical classifier marks the search private and routes it to local Gemma. Gemma has no web tools there and replies that it cannot search. This fails closed: nothing private leaves the device, but no result comes back. **Working paths:** in Telegram, write `Search the web for <topic>`; on the dashboard, use the **Researcher** agent. Not fixed during the second 48-hour window, to keep the image and config frozen.
- **Classification is lexical, not semantic.** Privacy and complexity come from keyword and identifier patterns. It is deliberately conservative: a public question containing "my", "email", "meeting" or "task" is treated as private (local, or held if the laptop is off). A sensitive request phrased without any listed word could be classified public. Regression tests cover every counterexample found so far, not every phrasing.
- **Private work depends on the student laptop.** Local Gemma runs on a laptop reached through Tailscale. If the laptop sleeps, Ollama stops or Tailscale disconnects, private tasks are held (by design) and the operations monitor records unhealthy samples. Public requests continue on cloud.
- **Local model quality.** `gemma4:e2b` is a small model (chosen for laptop hardware). Its answers are shorter and less reliable on multi-step reasoning than the cloud model; see the [comparison](reports/performance/COMPARISON.md). It has no web tools in the private agent by design.
- **Delegated answers have no private context.** A public dashboard message handed to the research agent carries only that message, so it cannot use the user's history or preferences. Delegation waits at most 120 seconds; longer research returns a timeout.
- **Cloud availability is not guaranteed at boot.** If the cloud model cannot be verified at startup, the instance still starts and logs `assistant.cloud_model_unverified`; public reasoning then falls back to local until cloud recovers. Only the local model check is mandatory.
- **Rate-limit simulation needs a restart.** `APPLYPILOT_SIMULATE_CLOUD_RATE_LIMIT` is read from the environment, so demonstrating it on the deployed instance means restarting it, which ends any image/config freeze.

### Accounts and credentials

- **Cloud account change.** The USC ChatGPT Edu quota ran out on 2026-11-18 (`usage_limit_reached`, reset 2026-11-22), and the deployment now uses the student's personal ChatGPT Plus OAuth login. Quotas on either plan can pause cloud routing.
- **Google OAuth tokens expire weekly.** The dedicated Google project is in Testing mode, so refresh tokens expire after about 7 days. One expired on 2026-11-18 and had to be re-authorized. On every boot the container now re-imports the token and probes Gmail; a rejected token stops startup with `GOOGLE_TOKEN_REJECTED` instead of running with broken email/calendar skills. The current sign-in was renewed on 2026-11-18, shortly before the deadline as the course guidance asks, so email and calendar reads may fail with `invalid_grant` from about 2026-11-25. Renewing it requires a restart, which the grading guidance rules out; other skills are unaffected.
- **Gateway login lockout.** OpenClaw locks out an IP for 5 minutes after 10 failed authentications in 60 seconds. Several open dashboard tabs retrying with a stale token can trigger this, and the CLI is then refused (`AUTH_RATE_LIMITED`). Close stale tabs and wait 5 minutes.

### Skills and features

- **Email:** sending always needs a human `/reviewemail` then `/approveemail` in Telegram. Drafts expire after 15 minutes and must then be regenerated. A meeting-request email that gives no time is not draftable (`MEETING_TIME_UNSPECIFIED`). Delivery after an ambiguous network failure is not retried automatically, so exactly-once delivery is not guaranteed.
- **Calendar:** read-only. The assistant suggests slots but never creates, edits or books events.
- **To-do list:** add, list and complete only. No edit, delete, reopen or recurrence. Task deadlines do not create calendar events.
- **Weather:** Los Angeles only (Open-Meteo, with an NWS forecast fallback). Other cities are reported unsupported.
- **Telegram sessions keep old context.** A long-running chat can answer from earlier turns, for example repeating an outdated capabilities list. Send `/new` to start a fresh session.
- **Routing log lags.** `show-video-routes.mjs` reads metadata samples written about once a minute, so the latest request can take up to a minute to appear. No message text is logged.

### Security and operations

- **Injection testing is bounded.** Three live injection attempts were contained, but the text detector missed the forged-approval attack (SEC-INJ-002); containment came from the deterministic approval gate. Re-run on the current image (2026-11-19), all three were contained again, but in SEC-INJ-003 the injected text made Gemma call the read-only email report tool once. Nothing was written or sent, but untrusted text can still trigger read tools. See the [security audit](reports/security/SECURITY_REVIEW.md#re-run-on-the-current-image-2026-11-19).
- **Open dependency advisories.** On 2026-11-19 the plugin dependency tree reports 21 moderate affected-package findings (0 high; 4 high and 23 moderate on 2026-11-17), all transitive through the pinned `openclaw` package. Reachability was not individually assessed and no forced upgrades were applied.
- **Framework audit gap.** The on-instance OpenClaw deep audit could not complete because CLI device metadata needs reapproval.
- **Grader access** via a separate Tailscale account was checked once, on 2026-11-19, from an iPhone signed in to a different Tailscale account that had accepted the share: the dashboard opened in Safari without asking for a gateway token (Tailscale identity accepted), but not in Brave (unreachable, by both name and IP). Other browsers and desktop clients were not tested.
- **Cold start is slow.** Even at 2 vCPU / 4 GiB the gateway logs event-loop stalls and CPU throttling while starting; the first requests after a restart can time out.
- **Two operation windows, two images.** The first 48-hour window (2026-11-13 to 2026-11-15) ran an earlier image without the 2026-11-18 fixes. The second window ran the current image and passed operationally ([result](reports/operations/FORMAL_48H_RESULT_SECOND.md)), with one open defect: the scheduled cloud probe failed in all 8 runs (OPS-ROUTING-002), while live public reasoning was served by `gpt-6-luna` and no private decision reached the cloud.

## Documents

- [Engineering plan](APPLYPILOT_PLAN.md)
- [Execution contract](AGENTS.md)
- [Skill contracts](SKILLS.md)
- [Code walkthrough](CODEBASE_WALKTHROUGH.md)
- [Current checklist](IMPLEMENTATION_CHECKLIST.md)
- [Manual testing](reports/operations/MANUAL_TESTING.md)
- [Assignment Description](references/Assignment_3_Description.pdf)

Original scope documents and past evidence are retained under evidence/history; they are not active feature promises. DEV_LOG.md remains append-only. Do not include private state, keys or tokens in source ZIPs or demo recordings.

## Advanced assistant features

- Privacy-first hybrid routing: private work stays on local Gemma (or is held), and only public reasoning goes to the cloud. See [Feature: privacy-first hybrid routing](#feature-privacy-first-hybrid-routing).
- `/briefing`: today's calendar, available slots, Los Angeles weather forecast (Open-Meteo daily or NWS period fallback), body-based email summaries, and open tasks.
- `/recap`: completed tasks, uniquely processed messages, confirmed sends, pending reply decisions, and tomorrow's calendar.
- `/emaildigest`: extractive email summaries and requested actions with message provenance; drafts remain subject to separate human approval.
- Scheduled alerts: deduplicated deadlines and calendar conflicts; reports distinguish generation from actual delivery.
- Calendar reports: explicit `[project:atlas]` links join fictional project memory and email context; task titles such as `Prepare demo [duration:45m]` produce duration-aware slot suggestions without booking.
- `/remember project atlas Synthetic demo agenda` and `/remember style communication detailed`: authenticated, revisioned non-sensitive memory. `/knowledge` recalls it. Other supported kinds are `person`, `tool`, and `workflow`.

Local integration tests use clearly labeled provider doubles. Live deployment, scheduled delivery and restart evidence is listed in [IMPLEMENTATION_CHECKLIST.md](IMPLEMENTATION_CHECKLIST.md).

Natural-language read correction: see [Telegram read-path status](reports/operations/TELEGRAM_READ_FIX.md). Email/calendar reads use fresh private local sessions. Public search phrasings such as `Search for …`, `Look up …` and `Find …` use the isolated research agent; requests mentioning email, calendar, tasks or personal details are never sent to web search. Human-message acceptance and deployment evidence are tracked separately from unit tests.
