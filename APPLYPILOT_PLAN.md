# Personal assistant — revised Assignment 3 engineering plan

## Scope decision

The user chose a to-do list as the fourth skill and removed the previous specialized workflow from the active project. The original plan is preserved at evidence/history/pre-todo-scope/APPLYPILOT_PLAN.md; historical implementation evidence remains intact. ApplyPilot identifiers remain infrastructure compatibility identifiers, not a claim about product scope.

The fourth skill now uses local SQLite task storage and authenticated Telegram commands. It is not connected to Todoist; no third-party account is needed. Existing Todoist integration remains an alternative only if explicitly chosen later. Task dates do not create calendar events.

## Assignment compliance

| Requirement | Implementation and required evidence |
| --- | --- |
| Four skills (§2.3) | calendar, email, web-search, todo; actual deployed execution of all four |
| >=4 of six advanced features (§2.4) | Retain all-six target: morning briefing, recap, email integration, alerts, calendar intelligence and knowledge/preferences |
| Mandatory demo behavior | Morning briefing, recap and proactive alert, independent of chosen feature combination |
| Hybrid models | Platform-authenticated cloud model plus laptop Gemma 4/Ollama; task-aware policy, served-model logs, private outage hold |
| Persistent memory and scheduling | Native workspace/sessions/scheduler plus local transactional state and GCS archival; restart tests |
| Security | Container isolation plus scoped tools, secret management, untrusted-content defenses, code-enforced email approval and recipient allowlist; >=5-risk report and >=3 injection attempts if claiming that defense |
| Test data | Dedicated temporary email and Google Calendar; fictional user, project tasks and events only |
| Deployment | Cloud Run Instance, private Tailscale laptop path, GCS, actual external grader access |
| Continuous operation | Formal >=48-hour window only after readiness and explicit user go-ahead |
| Model comparison | Same test cases on both models across >=3 task types; actual quality, latency, cost and routing evidence |
| Advanced integration | Still required. Proposed custom to-do/assistant orchestration skill publication must be reviewed, packaged and tested; no publication is currently claimed |
| Submission | Source/README, process disclosure, personalization files, security/performance/operations reports, 5–7-minute MP4 and private grader credentials |

Section 2.3 skills and Section 2.4 features may reuse integrations but must separately satisfy their behavioral criteria. Task management is a skill, not a seventh item in the six-feature menu.

## Architecture and flows

Telegram → OpenClaw → private/local or isolated public/cloud routing → narrow tools → email/calendar/task adapters → transactional SQLite → immutable GCS snapshot and encrypted native vault.

Read path: natural-language task request → `list_todos` → tasks with status, priority and due date → grounded reply.
Mutation path: authenticated `/todoadd` or `/tododone` → strict validation → deterministic operation identity → transaction and append-only event → cloud checkpoint → confirmation. Models and scheduled workflows cannot mutate tasks.
Proactive path: native cron → assistant_report → email/calendar/weather plus tasks → deduplicated alerts or briefing/recap → Telegram delivery record. Notification reservation alone is not proof of delivery.

No custom dashboard is required; Telegram is the user interface. No browser executor or controlled form server is part of the active product.

## Task data and limitations

Task: stable ID, title, optional ISO due date, priority 1–4 (1 highest), open/completed status, creation/completion timestamps. Identical title/date/priority maps to the same task, including completed tasks. This deliberately prevents duplicate retries; editing, reopening, recurring tasks and deletion are out of scope for this first slice.

TaskEvent: immutable sequence, task ID, operation, timestamp. SQLite uses WAL, FULL synchronous transactions and restricted file permissions. Human authorization is rechecked at mutation. Provider failures and checkpoint failures are reported honestly. Dates are interpreted in the configured assistant timezone.

Email/calendar existing functionality remains, with generalized synthetic project/meeting vocabulary. Earlier stored classifications remain historical; live migration requires explicit verification before cutover.

## Ordered implementation and acceptance

1. Remove retired tools, commands, fixtures, browser dependency, server startup and old report sections. Preserve archived documentation and development evidence. Verify current registered tool set exactly.
2. Implement task store and commands. Test create/list/complete, invalid dates, missing IDs, unauthorized users, revoked authority, duplicates, immutable events and process reopen.
3. Integrate read-only task tool, briefing/recap and due alerts. Test correct content, timezone handling, deduplication and restart.
4. Compile plugin; inspect manifest/tools/skills. Run existing provider/routing/persistence/security regressions. Prepare a clean workspace; prevent old skill instructions remaining enabled.
5. Rebuild cloud image and migrate state safely, preserving original backup. Verify four skills through the deployed agent and actual Telegram task changes. Current cloud image remains old until this explicit cutover succeeds.
6. Complete open security/HTTPS/grader readiness items. Revalidate local/cloud/privacy routes and restart continuity. Report readiness; wait for permission to start formal observation.
7. Observe >=48 hours with frozen image/config, meaningful scheduled work, incident records and timestamps. Do not call earlier historical uptime the new formal window.
8. Run reproducible evaluation and package reports. Proposed comparison: 10 synthetic cases each for email summarization, calendar reasoning and task prioritization on each model (60 runs); this sample size is a project target, not a rubric minimum. Record all failures, actual models, latency and measured/estimated costs explicitly.
9. Resolve and complete advanced integration evidence, fresh install, 5–7 minute demo, final source/archive scan and submission checklist.

## Evaluation

Measure task operation correctness, duplicate side effects, unauthorized changes, persistence recovery, due-alert precision and duplicate rate, evidence-grounded answer accuracy, model latency and cost. Separate deterministic storage tests, mocked provider tests, real provider checks, model turns and Telegram interaction evidence. No invented results. Held-out scenarios include ambiguous dates, missing task IDs, unauthorized senders and injected instructions in external text.

## Outstanding risks

Source changes are not deployed behavior. Legacy native state contains historical transcripts and retired database tables; preserve them privately rather than silently deleting user state. Import only supported active state, remove stale enabled tools/skill instructions, and verify restart before cutover. The two-day forecast has live API evidence. Source-based email summaries, activity/pending-decision recaps, explicit project-linked meeting context, duration-aware task slots, and authenticated revisioned knowledge now pass local tests. Cloud and human-interaction demonstrations remain distinct acceptance items. At the time of writing, skill publication, formal observation and final evaluation were pending; all three have since completed (see IMPLEMENTATION_CHECKLIST.md).


## Six-feature completion contract

Briefing includes a validated forecast (Open-Meteo daily or NWS periods) and extractive email body summaries. Recap includes completed tasks, unique messages processed, confirmed sends, pending drafts, and tomorrow's schedule. Email intelligence retains message provenance, urgent/action signals and source-grounded reply drafts; suspicious input holds the draft. Alerts remain native scheduled, durably deduplicated notifications with separate delivery evidence. Calendar context uses explicit `[project:key]` tags and source references; task duration tags determine suggested free slots without booking. Human `/remember` updates non-sensitive fictional facts and communication style; `/knowledge` recalls revisions. SQLite is authoritative, workspace KNOWLEDGE.md is a rebuilt mirror, and encrypted vault/checkpoints support recovery. No model or external document can authorize a memory mutation.

Acceptance distinguishes mocked provider tests, actual API reads, deployed tool calls, authenticated Telegram commands, scheduled delivery, and restart recovery. None substitutes for the formal 48-hour window, evaluation, or submission artifacts.


Cloud verification found Open-Meteo TCP connections timing out while the NWS API responded successfully. The weather adapter therefore falls back to the official NWS points/forecast endpoints for the fixed demo city. It validates the exact HTTPS forecast host/path, timestamps, units, period continuity, temperature and precipitation bounds; it never substitutes a forecast temperature for a current observation. This is an implementation reliability choice, not an assignment-mandated provider. Reference: https://www.weather.gov/documentation/services-web-api.


## User authorization update — 2026-11-13

The user explicitly instructed: after completing the feature work, reread the entire Assignment Description, compare requirements with code/functionality/technology/cloud deployment, verify local operation, then start the 48-hour run with comprehensive logs. This authorizes starting after the fresh audit and mandatory readiness checks pass, without another permission round. Report readiness and the actual start time; do not start while genuine readiness blockers remain. The formal window had not yet started when this was written. Status 2026-11-19: the first formal window ran 2026-11-13T08:30:39Z to 2026-11-15 (see reports/operations/FORMAL_48H_RESULT.md); a second window on the current image runs 2026-11-18T06:48:37Z to 2026-11-20T06:48:37Z.
