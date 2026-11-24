# AGENTS.md — ApplyPilot implementation contract

> Read this file, `SKILLS.md`, and the original engineering plan (`plan.md`, or the supplied ApplyPilot plan) **before modifying code**. The plan is the project source of truth; this document converts it into execution gates. If the assignment PDFs are present, verify any claimed rubric requirement against them. Do not silently reinterpret contradictions. Do not implement real-employer application submission: all mutating browser workflows use synthetic profiles and controlled test sites only.

## 0. Mission and non-negotiable working protocol

Build **ApplyPilot**, an OpenClaw-based TypeScript/Node.js controlled job-application agent plus proactive personal assistant. The required end-to-end vertical slice is: synthetic candidate -> controlled job URL -> evidence-based eligibility -> grounded answers and résumé -> browser fill -> independent verification -> authenticated human approval -> idempotent test-site submission -> independent confirmation -> durable record.

**ONE STEP AT A TIME.** Work on the earliest incomplete gate in Section 5. Never start the next gate until the current gate passes. At each gate:

1. Read the gate's prerequisites and expected observable behavior; identify the exact files and commands involved.
2. Implement the smallest testable vertical slice. Do not add speculative features.
3. Run formatting, typechecking, linting, unit tests, then the gate's integration/E2E test as appropriate.
4. **Inspect actual outputs** (assertions, returned payloads, UI state, database records, logs, remote responses); do not treat process exit code or an LLM assertion as sufficient proof.
5. Run at least one **happy path**, **boundary/edge case**, and **failure/negative case** per feature. For irreversible operations also test unauthorized, interrupted, and duplicate attempts.
6. Record test inputs, exact commands, expected vs actual outputs, exit codes, redacted log excerpts or evidence paths, discovered defects, fixes, and rerun results in `DEV_LOG.md`.
7. Update the gate's checkbox in `IMPLEMENTATION_CHECKLIST.md` only after evidence is recorded. If blocked, mark `BLOCKED`, explain why, and stop; do not check the box or continue dependent work.
8. Present a concise checkpoint summary: what changed, tests and results, evidence, known risks, and the **next** gate. Await user instruction/approval before moving to the next numbered gate unless the user explicitly authorizes autonomous sequential execution.

**Do not fabricate:** successful requests, benchmark numbers, deployed resources, screenshots, tests, timestamps, model identity, or grader access. A mocked integration test never counts as a live integration test. Preserve failing outputs and reproduce fixes. Never delete a failed test from the log. Do not commit secrets or synthetic credentials.

## 1. Source precedence and project scope

1. Assignment Description/rubric and associated assignment PDFs (when available): authoritative for mandatory grading criteria.
2. Supplied `plan.md`: project scope, selected technology and implementation design.
3. This `AGENTS.md`: agent execution discipline and gates.
4. `SKILLS.md`: functional contracts and skill-level acceptance tests.
5. README, code, and tests: must agree with the above; report discrepancies rather than assuming.

Treat plan statements about **OpenClaw, Cloud Run Instance, Gemma 4 via Ollama/Tailscale, task-aware routing, four skills, at least four advanced features, persistence, 48-hour operation, security, performance comparison, and submission evidence** as requirements to implement and verify. The plan chooses **all six** advanced features and **ClawHub** publication. Planned engineering targets (60 held-out eligible attempts, VACR >=90%, zero unsafe submissions, 10 cases x 3 task types x 2 models) are **project acceptance targets**, not automatically rubric requirements. Exact pinned versions are provisional until verified against available runtime and APIs; record changes.

### Hard scope limits

- Use fictional identities, résumés, employers, recruiter messages, calendar events, and dedicated temporary accounts only.
- Inspect arbitrary job URLs only in a read-only, safe mode; mutate/submit **only** exact allowlisted controlled test origins. Reject redirect-to-other-origin, SSRF, unsupported CAPTCHA, or ambiguous submit state.
- Never auto-send email, change calendar events, or submit applications without explicit human approval at the enforcement boundary. Approval must be authenticated, single-use, bound to verified revision and operation, and revalidated at execution.
- The LLM proposes; deterministic code authorizes. No prompt, webpage, email, or skill description can override this.
- Do not attempt real employer applications or claim production compatibility with arbitrary ATS sites.

## 2. Required architecture and selected stack

- **Agent platform:** OpenClaw Gateway, pinned and verified (plan baseline 2026.10.9).
- **Language:** TypeScript, Node.js (plan baseline Node 24.22.1); package lockfile, pinned image digest.
- **Models:** verified cloud model via OpenClaw (OpenAI OAuth preferred; verified NVIDIA NIM fallback) and local Gemma 4 through laptop Ollama.
- **Hybrid routing:** OpenClaw plugin `before_model_resolve` or verified equivalent; deterministic rule, no private cloud fallback, route/served-model telemetry without raw prompt text.
- **Browser:** Playwright executor behind narrow typed OpenClaw plugin tools, DOM/accessibility assertions; managed browser only when policy-constrained.
- **Schemas:** TypeBox or compatible runtime-validated TypeScript contracts.
- **State:** SQLite on local transactional disk; immutable append-only events and validated snapshots in Google Cloud Storage; workspace memory persisted durably. **Never run live SQLite on GCS FUSE.**
- **Deployment:** Google Cloud Run **Instance**, not Service; dedicated service account, Artifact Registry, Secret Manager, Cloud Logging, Cloud Storage bucket.
- **Connectivity:** Tailscale userspace in cloud container, explicit SOCKS/proxy route to laptop Ollama via Tailscale Serve (not Funnel); loopback Ollama, least-privilege tailnet grants, stable grader access.
- **Messaging:** Telegram with sender allowlist.
- **Skills:** `applypilot`, `email`, `calendar`, `web-search` (see `SKILLS.md`).
- **Scheduling:** OpenClaw Automations/cron with timezone and deduplicated durable cursors; no infinite sleep loop.
- **Google integrations:** dedicated test Gmail and Calendar, preferably `gogcli` wrapped in narrow tools.
- **Weather:** Open-Meteo with fixed synthetic demo city.
- **Advanced integration:** publish student-created ApplyPilot skill to ClawHub with pinned version and fresh-install transcript.

Validate the **actual** installed OpenClaw plugin hooks, Node compatibility, and local Gemma model/context/tool-use in Gate 1. Per the user's sequencing decision, defer cloud-model authentication, Cloud Run Instance availability, and Tailscale proxy behavior to Gate 9; those checks remain mandatory and Gate 9 cannot pass without them. Never assume documentation or a sample image guarantees compatibility.

## 3. Repository organization and mandatory records

Recommended layout (adapt to existing repository without destructive restructuring):

```text
AGENTS.md                 # this execution contract
SKILLS.md                 # skill specifications and tests
plan.md                   # supplied engineering plan (preserve)
README.md
DEV_LOG.md                # chronological, append-only development/test evidence
IMPLEMENTATION_CHECKLIST.md  # live gate and requirement tracking
PROCESS_LOG.md            # assignment-required AI-tool/process disclosure
.env.example              # placeholders only
src/{plugin,router,policy,applications,browser,integrations,persistence,scheduler}/
skills/{applypilot,email,calendar,web-search}/SKILL.md
tests/{unit,integration,e2e,security,fixtures,benchmark}/
fixtures/{profiles,resumes,jobs,emails,calendar,sites}/
deploy/{Dockerfile,cloudrun,tailscale}/
reports/{security,performance,operations}/
evidence/                  # redacted captures, test reports, sanitized logs
```

`SKILLS.md` is a **project-level specification**, not a substitute for actual OpenClaw skill files. Create the four `skills/<name>/SKILL.md` files using the installed OpenClaw version's expected skill metadata/format. Keep tool implementations and runtime policy in TypeScript; do not put authorization only in skill prose.

### DEV_LOG.md — append after EVERY implementation/test action

Use this template for each entry (UTC ISO-8601 time, no fabricated timestamps):

```md
## Gate N / Task ID — short title — YYYY-MM-DDTHH:mm:ssZ
- Status: IN_PROGRESS | PASS | FAIL | BLOCKED
- Objective / acceptance criterion:
- Source requirement / plan reference:
- Files changed (and why):
- AI assistance: tool/model, material prompts or generated code and human edits:
- Commands and environment (version, commit, fixture IDs; redact secrets):
- Test matrix:
  | Case | Input/setup | Expected | Actual observed | Pass? | Evidence path |
  | Happy | ... | ... | ... | ... | ... |
  | Edge | ... | ... | ... | ... | ... |
  | Failure | ... | ... | ... | ... | ... |
- Output inspection: exact relevant assertions, state, logs, HTTP status, UI/DB record:
- Defects found, root cause, fix, and rerun evidence:
- Security/privacy check:
- Remaining risks / blocked dependencies:
- Gate decision and next action:
```

Append entries rather than rewriting history. Redact tokens, OAuth data, email contents, candidate identifiers, IPs if sensitive, and grader links. Store larger raw test artifacts under `evidence/` with stable filenames and reference them in the log. Maintain `PROCESS_LOG.md` separately: 200–300 word chronological assignment narrative, all AI tools/models, material prompts, substantial AI-generated code attribution, verification, and 2–3 sentences on what tools could not determine (per supplied plan).

### Test standard (mandatory for EVERY gate)

- **Unit:** deterministic policies, schema validation, state transitions, deduplication, redaction, and approval checks.
- **Integration:** actual tool contracts and storage/provider adapters; mocks clearly labeled.
- **E2E:** real controlled browser fixture, model inference, or deployed service where relevant.
- **Assertions:** verify response content, side effects, persisted state, audit events, and **absence** of forbidden effects.
- **Negative tests:** bad input, unknown fact, unauthorized user, expired approval, origin change, network timeout, duplicate request, process restart, tool failure.
- **Regression:** every bug fix adds a reproducible test; rerun prior critical paths after changes.
- **Evidence:** retain commands, exit codes, sanitized actual outputs, timestamps, fixture/commit versions. Mark tests `NOT_RUN` rather than passing by inference.

## 4. Core state and security contracts

**Entities:** `CandidateProfile` (verified facts, sources, résumé hashes); `Job` (requirements and provenance); `EligibilityResult` (`eligible|ineligible|unknown`); `Application` (form revision, answers, verification, approval, submission); `ApplicationEvent` (append-only transition); `RecruitmentEvent` (dedup key); `RouteDecision` (selected/served model and outcome).

**Application state:** `DISCOVERED -> ELIGIBILITY_CHECKED -> PREPARED -> FILLED -> VERIFIED -> AWAITING_APPROVAL -> APPROVED -> SUBMITTING -> SUBMITTED -> CONFIRMED`. On uncertainty, go to `NEEDS_HUMAN` or `FAILED_SAFE`; no LLM shortcut to `APPROVED` or `CONFIRMED`. Persist `SUBMITTING` before click, reconcile test-site record after interruption, never blindly retry. Use a site-supported idempotency key. Verify from site-owned confirmation record **and** visible confirmation UI.

**Loop budgets (initial plan values):** <=20 model turns, <=40 browser actions, <=10 minutes, <=$0.50 estimated model cost per attempt. Two identical no-progress state fingerprints -> human review. Measure and log budget consumption; document any tuning.

**Security tests:** prompt injection in job, email, and form text; unauthorized approval/send/submit; redirect/SSRF; recipient/origin allowlists; missing candidate evidence; credential/log leakage; plugin/tool allowlists; process interruption; memory poisoning. Non-root, restricted Linux capabilities, scoped service account, least privilege, and OpenClaw deep security audit are required evidence.

## 5. Sequential implementation gates — do not skip

For **each gate**, run happy/edge/failure tests, inspect outputs and side effects, log evidence, update checklist, then request user go-ahead. If a prerequisite fails, fix it before proceeding.

### Gate 0 — Baseline, repository, requirements traceability
- Read supplied plan and all available assignment PDFs; list mandatory vs chosen vs optional requirements and document conflicts.
- Inventory repository, toolchain, hardware, accounts, credentials **availability only** (never display secrets).
- Create repository skeleton, `.gitignore`, `.env.example`, `DEV_LOG.md`, `PROCESS_LOG.md`, `IMPLEMENTATION_CHECKLIST.md`, initial README and test commands.
- **Verify:** project bootstraps; formatter/linter/typechecker/test runner execute; missing required env produces clear validation error; secret scanning detects injected fake token; no real secret committed.
- **Exit:** reproducible clean install, requirement-to-test map, all prerequisite blockers listed.

### Gate 1 — Critical feasibility probes (before building features)
- Pin/validate OpenClaw and Node; confirm TypeScript plugin tool and model-resolution hook work in installed version.
- Verify local Ollama/Gemma 4 inference with agent-sized context and tool-call generation. Use synthetic inputs only.
- Cloud model authentication/response, Cloud Run **Instance**, and Tailscale Serve/proxy checks are deferred to Gate 9 by explicit user direction and remain mandatory there. Gate 2 builds the controlled origin; Gate 5 validates the local approval flow.
- **Verify:** actual local response body, served model ID/context, hook-selected model, `/api/tags`, tool-call output, and an intentionally broken local-server scenario.
- **Exit:** local compatibility matrix passes; record the deferred cloud/deployment checks in the Gate 9 acceptance criteria. Stop if the local OpenClaw/Gemma path fails.

### Gate 2 — Synthetic fixtures, schemas, and controlled application sites
- Define runtime schemas and versioned synthetic candidate, résumé, job, email, calendar fixtures.
- Build three controlled sites: single-page, multi-step, conditional/dynamic; expose authoritative submission records and idempotency keys.
- **Verify:** schema roundtrip, invalid/missing facts rejected; each form renders/validates; duplicate submission key produces one server record; cross-origin navigation rejected.
- **Exit:** deterministic fixtures and ground-truth test IDs.

### Gate 3 — Job inspection, eligibility, résumé selection, grounded answers
- Implement safe job URL parsing, requirements provenance, deterministic hard-eligibility decisions, résumé selection, evidence-backed question answers.
- **Verify:** eligible/ineligible/unknown; contradictory facts; missing authorization; unsupported question; malicious instructions inside job description ignored. Assert no invented claims.
- **Exit:** prepared application payload with verifiable source references; unknowns block progression.

### Gate 4 — Browser fill, uploads, multi-step navigation, verification
- Implement typed Playwright executor with origin allowlist, field mapping, upload, conditional field handling, validation capture, and independent DOM verifier.
- **Verify:** all three site types, every field type, hidden/changed field, stale selector, wrong résumé, form error, redirect, crash, timeout; compare actual DOM values to prepared facts.
- **Exit:** `VERIFIED` only for exact matching, valid form state; no submit in this gate.

### Gate 5 — Approval, submission, idempotency, durable recovery
- Implement authenticated revision-bound one-use approval; recheck eligibility/revision before submission; persist state and append-only events; submit controlled site and independently confirm.
- Implement transactional local SQLite state, append-only application events, and restart recovery; define the archive boundary for immutable object storage.
- **Verify:** approved submit confirmed; unauthorized/expired/replayed/stale approval denied; interruption before/after click; duplicate retry; local event replay/restart restores application state. Real GCS writes, archive replay, and GCS failure injection remain mandatory in Gate 9 per the user's GCP sequencing decision. Confirm forbidden attempts produce **zero** server submission records.
- **Exit:** complete safe end-to-end controlled application vertical slice.

### Gate 6 — OpenClaw plugin and four skills
- Register narrow typed ApplyPilot tools and implement four real OpenClaw skill packages per `SKILLS.md`.
- Integrate dedicated test Gmail/Calendar, web search, Telegram allowlist; keep email send approval code-enforced.
- **Verify:** each skill through deployed/runtime OpenClaw, not just direct library calls; wrong tool input, unauthorized Telegram sender, email send without approval, provider outage, and malformed search results.
- **Exit:** four distinct skills exercised with actual evidence.

### Gate 7 — Hybrid router, telemetry, failure policy
- Implement deterministic local/cloud selection with privacy classification, verified model hook, cloud rate-limit simulation, and route logs.
- **Verify:** short -> local, complex -> cloud (deterministic test double until Gate 9), private -> local, private + local down -> held, non-private + local down -> permitted cloud test double, simulated rate limit -> eligible local. Inspect actual local served model and route telemetry; verify no raw prompts in logs.
- **Exit:** replayable policy matrix and logs. Gate 9 must repeat cloud-eligible and private routing against actual cloud/local models and record served-model identity.

### Gate 8 — Six proactive features, memory, scheduling
- Implement morning briefing, end-of-day recap, email intelligence, deadline alerts, calendar conflict intelligence, and synthetic personal knowledge base.
- Schedule using OpenClaw cron; persist dedup cursors and preferences; scheduled jobs only draft/notify.
- **Verify:** scheduled briefing and recap contain expected fixture facts; new deadline generates one alert; duplicate poll generates zero; conflicting event recognized; restart retains memory/cursor; timezone boundary and expired Google auth fail safely.
- **Exit:** at least four features meet assignment threshold; plan target is all six.

### Gate 9 — Harden, deploy, and establish grader access
- Build non-root container, drop capabilities, restrict tools/origins/recipients, store secrets in Secret Manager, deploy Cloud Run **Instance**, configure GCS and verify immutable event/snapshot writes and replay, Tailscale stable grader identity and least-privilege grants, logging and health checks.
- Complete the cloud feasibility checks explicitly deferred from Gate 1: reauthenticate and verify the cloud model response, validate Cloud Run Instance startup, and prove the Tailscale Serve/proxy route from Cloud Run to laptop Ollama.
- **Verify:** actual deployed HTTPS/Telegram exchange, cloud and local model responses with served IDs, cloud-to-laptop `/api/tags` and inference, private-task hold when local path is broken, bucket persistence after restart, local Ollama LAN access denied, grader access path tested, `openclaw security audit --deep`, three injection tests, and secret scan. Capture timestamps.
- **Exit:** all deferred feasibility and deployment checks pass; deployment readiness checklist signed off; **only now** begin formal 48-hour observation.

### Gate 10 — Formal 48-hour operation
- Record UTC start, exact deployment image/config, cron timezone, monitoring cadence. Do not silently change code/config during window.
- Collect lifecycle logs, route decisions, scheduled jobs, test email/calendar alerts, persistence/recovery, incidents and gaps. Record any restarts truthfully.
- **Verify:** full >=48-hour timestamp coverage and meaningful operation, no undocumented gap, successful scheduled events, post-restart continuity. A preliminary soak is not the formal window.
- **Exit:** timestamped redacted operational evidence and incident log.

### Gate 11 — Held-out evaluation, baselines, and security/performance reports
- Version development vs held-out datasets; target >=60 eligible held-out attempts across three site families plus ineligible/unknown cases.
- Run static automation and basic OpenClaw browser-agent baselines on same tasks and safety gates.
- Compute VACR = correctly verified + approved + submitted + independently confirmed eligible attempts / all eligible attempted applications; report numerator, denominator, CI, and exclusions.
- Measure field accuracy, unsupported claims, intervention, recovery, confirmation, p50/p95 latency, cost/application.
- Compare both models on same 10 cases x 3 task types (60 runs), recording actual served model, correctness, routing, latency and cost.
- **Verify:** independent ground truth, no data leakage across splits, reproducible scoring, explicit failed cases; no invented or selectively omitted results.
- **Exit:** reports with raw anonymized data, commands, limitations, security audit >=5 risks/mitigations.

### Gate 12 — ClawHub, video, packaging, final audit
- Publish ApplyPilot skill at pinned ClawHub version, sanitize package, capture fresh pinned OpenClaw installation and run transcript.
- Record one 5–7 minute MP4 with device identifier, deployed OpenClaw version, Gemma listing, local/cloud/private-off/private-on routing sequence, logs, `ollama ps`, Telegram, morning briefing, alert, recap; show no secrets.
- Complete README, `PROCESS_LOG.md`, source ZIP, `.env.example`, reports, 48-hour evidence, and private grader handoff through Brightspace.
- **Verify:** clean-room install from ZIP, checksum/artifact listing, video length/content checklist, link accessibility, no embedded credentials, all gates reconciled to evidence.
- **Exit:** complete submission package; do not claim submitted until user actually submits.

## 6. Master completion checklist (copy into IMPLEMENTATION_CHECKLIST.md)

Use `[ ]`, `[x]`, or `BLOCKED`; append evidence links/commit IDs for each item.

### Product
- [ ] Controlled job discovery/URL inspection; extraction with provenance
- [ ] Evidence-based eligibility (`eligible/ineligible/unknown`)
- [ ] Versioned synthetic candidate and résumé selection
- [ ] Grounded application answers; unsupported facts blocked
- [ ] Single-page, multi-step, conditional form support and résumé upload
- [ ] Independent field validation and UI error detection
- [ ] Authenticated human approval bound to exact verified revision
- [ ] Safe idempotent submit and independent confirmation
- [ ] Application status tracking and restart reconciliation

### Platform and integrations
- [ ] Verified pinned OpenClaw + Node + TypeScript plugin
- [ ] Working cloud model and laptop Gemma 4/Ollama
- [ ] Cloud-origin Tailscale path to Ollama; private fallback hold
- [ ] Task-aware router with reasons, actual served model and outcomes
- [ ] Telegram authorized-user interaction
- [ ] Four working skills: applypilot, email, calendar, web-search
- [ ] Dedicated synthetic Gmail/Calendar integrations
- [ ] Six planned proactive features (at least four mandatory)
- [ ] Durable memory, cron, deduplicated alerts and restart recovery

### Security, cloud and evaluation
- [ ] Cloud Run **Instance** deployed with GCS bucket
- [ ] Non-root isolation, reduced capabilities, least-privilege tools/secrets
- [ ] Email send and application submit approval gates
- [ ] Origin/recipient/sender allowlists, injection/SSRF/duplicate tests
- [ ] OpenClaw deep security audit and security report
- [ ] Stable grader access via Tailscale
- [ ] Documented 48-hour operation and timestamp coverage
- [ ] Held-out application evaluation and both baselines
- [ ] VACR, safety, accuracy, latency, recovery and cost reports
- [ ] Cloud/local comparison for three task types

### Submission and process
- [ ] Every gate has happy/edge/failure tests with inspected actual output
- [ ] `DEV_LOG.md` complete and chronological; blockers recorded
- [ ] `PROCESS_LOG.md` meets assignment requirements
- [ ] ClawHub publication and fresh install transcript
- [ ] README, sanitized source ZIP, reproducible environment
- [ ] 5–7 minute MP4 with all required evidence
- [ ] Grader access details provided privately; no secrets leaked

## 7. Mandatory agent response format after each gate

```text
GATE: <number/name> — PASS | FAIL | BLOCKED
IMPLEMENTED: <files and behavior>
TESTS: <happy / edge / failure; command; actual result>
OUTPUT VERIFIED: <specific UI/HTTP/DB/model/log evidence>
SECURITY / REGRESSION: <results>
DEV_LOG: <entry and evidence paths>
REMAINING ISSUES: <none or explicit blockers>
NEXT GATE: <name; do not begin until authorized>
```

**First action:** inspect repository and available plan/assignment files, then execute **Gate 0 only**. Do not jump to coding the whole system in one pass.

## Session authorization — 2026-11-12

The user authorized completing the remaining process autonomously, with scope alignment to the fresh rubric review and appropriate logs. Continue sequential gates without requesting another go-ahead at each gate. Preserve safety approvals at external-action boundaries and mark genuine missing-account/live-evidence blockers honestly. Apply the rubric alignment amendment in APPLYPILOT_PLAN.md.

## User sequencing update — formal observation approval

The user explicitly requested notification before the formal 48-hour test, and the assistant committed to waiting for their go-ahead. Continue authorized preparation sequentially, but do not start Gate 10 observation until the user explicitly approves its start after readiness is reported.
