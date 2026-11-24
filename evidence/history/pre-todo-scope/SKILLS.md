# SKILLS.md — ApplyPilot OpenClaw skill specifications and acceptance tests

> Companion to `AGENTS.md` and the supplied ApplyPilot engineering plan. This is the **project-level skill contract**. Actual installed skills must be implemented as four separate `skills/<name>/SKILL.md` packages compatible with the pinned OpenClaw version, plus narrow TypeScript tools. **Do not confuse skill prompts with security enforcement.** Every skill is implemented and tested in the sequential gates defined in `AGENTS.md`.

## 1. Global skill implementation contract

Every skill MUST have:

- A clear purpose, when-to-use guidance, permitted operations, prohibited operations, required tool names, and documented inputs/outputs.
- Validated TypeScript/TypeBox input/output schemas; stable request IDs and correlation IDs; typed errors; no raw arbitrary shell execution exposed to the model.
- Provenance for facts and a predictable `success | needs_human | failed_safe` result with error code and redacted audit metadata.
- Explicit policy checks **in TypeScript**, including authorization, origin/sender/recipient allowlists, approval tokens, and resource budgets as applicable.
- Deterministic fixtures and unit, integration, and deployed OpenClaw tests. Every skill must have at least one happy path, edge case, and failure case; verify actual outputs and forbidden side effects.
- Audit logs with timestamp, tool, actor, correlation ID, sanitized input metadata, result and duration; never credentials, raw personal content, OAuth tokens, or complete prompts.
- Idempotent or deduplicated side effects and recovery after restart when relevant.
- A corresponding entry in `DEV_LOG.md` with command, expected/actual result, redacted evidence, failures, fixes, and reruns. Do not mark working based on mock-only tests.

Suggested common result contract:

```ts
type ToolResult<T> = {
  status: 'success' | 'needs_human' | 'failed_safe';
  requestId: string;
  data?: T;
  error?: { code: string; message: string; retryable: boolean };
  evidenceRefs: string[];
};
```

Suggested shared types: `CandidateProfile`, `Job`, `EligibilityResult`, `Application`, `ApplicationEvent`, `RecruitmentEvent`, `RouteDecision`, `ApprovalRecord`, `VerifiedRevision`. Preserve field provenance and hashes; reject schema-invalid data before executing tools.

## 2. Skill 1 — `applypilot` (core application workflow)

**Purpose:** Complete controlled synthetic job applications end-to-end, subject to deterministic eligibility, fact grounding, independent verification, and human approval.

**Allowed:** inspect controlled job pages; extract requirements; compare against synthetic profile; select résumé; prepare sourced answers; fill and verify test-site forms; request approval; submit an approved test-site application once; confirm and track status.

**Forbidden:** fabricate qualifications, override `unknown` eligibility, bypass human approval, submit to real employers, follow arbitrary external form links, retry uncertain submission blindly, claim confirmation from an LLM response alone.

**Narrow tool contracts (names from plan):**

| Tool | Inputs | Observable output / enforcement |
|---|---|---|
| `discover_jobs` | catalog filters, cursor | synthetic jobs with provenance; bounded results |
| `inspect_job_url` | URL | extracted requirements and exact origin; safe inspection only |
| `evaluate_eligibility` | job ID, profile ID/version | `eligible/ineligible/unknown`, requirement-level evidence |
| `prepare_application` | job/profile/resume IDs | answer-to-fact references, selected résumé hash, missing questions |
| `fill_application` | prepared application ID | form field state, uploads, validation messages; controlled origins only |
| `verify_application` | filled application ID | independent field-by-field comparison, page revision/hash |
| `request_application_approval` | verified application revision | human-readable review, authenticated approval request |
| `submit_approved_application` | approved revision, one-use approval | `SUBMITTING` durable event, idempotent site submit, authoritative confirmation |
| `track_application` | application ID | durable state history, confirmation evidence, next action |

**State machine:** `DISCOVERED -> ELIGIBILITY_CHECKED -> PREPARED -> FILLED -> VERIFIED -> AWAITING_APPROVAL -> APPROVED -> SUBMITTING -> SUBMITTED -> CONFIRMED`; stop safely at `NEEDS_HUMAN`/`FAILED_SAFE`. No arbitrary transitions. `SUBMITTING` must be durable before click; after interruption reconcile server record before retry. Initial per-run ceilings: 20 model turns, 40 browser actions, 10 minutes, $0.50 estimated model spend; two repeated no-progress fingerprints stop execution.

**Tests / inspected outputs:**

- [ ] Happy: eligible fictional profile + single-page form -> exact filled DOM -> authenticated approval -> one test-site submission -> independent server record + visible confirmation -> persisted `CONFIRMED`.
- [ ] Happy: multi-step form including résumé upload; verify selected résumé hash and all step values.
- [ ] Happy: dynamic conditional form; verify conditionally shown fields and validation.
- [ ] Edge: unknown eligibility, missing work authorization, ambiguous question, conflicting résumé facts, changed form revision -> `NEEDS_HUMAN`, no submission.
- [ ] Edge: stale DOM reference, unexpected dropdown option, validation error -> re-observe or safe stop; no false `VERIFIED`.
- [ ] Failure: unauthorized, expired, reused or stale approval -> zero server submission records.
- [ ] Failure: redirected external origin, SSRF URL, CAPTCHA, browser timeout -> safe stop, no external mutation.
- [ ] Failure: process killed before/after submit click -> reconcile authoritative server state, at most one submission.
- [ ] Failure: GCS event write or local persistence failure -> do not falsely acknowledge durable approval/submission.
- [ ] Security: injected instructions in job/form content cannot change tool policy or candidate facts.
- [ ] Deployed OpenClaw demonstration: execute complete approved test-site flow and inspect stored audit trail.

## 3. Skill 2 — `email` (dedicated synthetic mailbox)

**Purpose:** Read and summarize synthetic recruiting mail, classify events, draft replies, and optionally send **only after explicit authenticated human approval**.

**Integration:** dedicated test Gmail account through verified `gogcli`/supported Google integration, wrapped in constrained typed tools. Never expose unrestricted mail CLI to the LLM. Keep a durable mailbox cursor/dedup key.

**Current listing tool contract:** `list_test_emails` accepts `requestId`, `maxResults` (1–10), and an optional cursor that must match the persisted position. The local SQLite store atomically saves the provider page token with its pending thread IDs; repeated calls replay pending IDs before fetching another page. A successful `classify_recruitment_email` persists the event before acknowledging its queued thread. Provider or storage failure does not advance the cursor. When routing through OpenClaw Tool Search, dispatch with `id` plus an `args` object containing these fields; do not use `parameters` or substitute `limit` for `maxResults`.

**Current retrieval tool contract:** `get_test_email` accepts `requestId` and one `threadId` returned by the listing operation. It returns only the latest message's selected headers and sanitized text body, marked as untrusted content; it never downloads attachments or modifies mail.

**Current classification tool contract:** `classify_recruitment_email` accepts the same opaque thread reference, retrieves it through the read-only adapter, classifies event signals deterministically, and returns explicit deadline/interview text with a source message reference. It records a content-minimized `RecruitmentEvent` in append-only local SQLite, deduplicated by the configured Gmail account and message ID; repeated calls return the first stored classification. Set `APPLYPILOT_STATE_DB` to a local transactional disk path, never a GCS FUSE mount. Missing or conflicting data is marked for human review. It does not alter application state, create replies, or send mail.

**Current reply drafting tool contract:** `draft_recruiter_reply` accepts a listed thread reference, retrieves and classifies it, then returns a conservative category-specific text suggestion only when classification is clear. It does not accept a recipient, create a Gmail draft, or send mail; output explicitly sets `notSent: true`. Unknown or incomplete context returns `needs_human`, and provider errors return `failed_safe`. Message content remains untrusted and is omitted from audit logs.

**Suggested tools:** `list_test_emails`, `get_test_email`, `classify_recruitment_email`, `summarize_recruitment_email`, `draft_recruiter_reply`, `request_email_send_approval`, `send_approved_email`.

**Constraints:** test-account only; sender/recipient allowlists; sanitize HTML and external instructions; email content is untrusted; draft != send; bind one-use approval to recipient, subject/body hash, and revision; scheduled jobs may only draft and notify. Never auto-send from a briefing or alert.

**Tests / inspected outputs:**

- [ ] Happy: synthetic interview invitation classified correctly with cited email ID and deadline; draft reply generated, not sent.
- [ ] Happy: authenticated approved send to allowlisted synthetic recipient; inspect actual sent-folder/message ID and audit record.
- [ ] Edge: unread pagination, duplicate messages, empty inbox, missing deadline/timezone, thread replies -> stable dedup and appropriate uncertainty.
- [ ] Failure: send without approval, altered body after approval, non-allowlisted recipient -> zero sent messages.
- [ ] Failure: expired OAuth, Gmail 429/5xx, malformed MIME, injection asking to reveal secrets -> safe error and no unauthorized action.
- [ ] Proactive: one new deadline email -> one alert; repeated polling -> no duplicate.
- [ ] Deployed OpenClaw: invoke skill through Telegram and inspect real synthetic mailbox output.

## 4. Skill 3 — `calendar` (dedicated synthetic calendar)

**Purpose:** Read events, detect conflicts, suggest free slots, and support briefing/recap/alerts. Calendar mutation requires separate human approval and is not required for the basic read/analysis scope.

**Integration:** dedicated Google Calendar through verified `gogcli`/supported adapter, typed tools, durable cursor, explicit timezone.

**Current listing tool contract:** `list_test_events` accepts a bounded RFC3339 `from`/`to` range with explicit offsets, IANA `timeZone`, and `maxResults` (1–50). It reads only `APPLYPILOT_TEST_CALENDAR_ID` under the configured dedicated Google test account, rejects `primary`, includes only event ID/title/start/end/all-day fields, and marks titles as untrusted. Missing config or malformed/provider errors return a typed safe failure. The current slice does not write calendar data.

**Suggested tools:** `list_test_events`, `get_test_event`, `find_calendar_conflicts`, `suggest_free_slots`, `summarize_daily_calendar`, `request_calendar_change_approval` (only if mutation implemented), `apply_approved_calendar_change` (only if mutation implemented).

**Constraints:** test calendar only; read-only by default; no silently created/edited events; all event content untrusted; DST/timezone boundaries explicit; conflict algorithm uses actual start/end and calendar availability; deduplicate notifications.

**Tests / inspected outputs:**

- [ ] Happy: given overlapping synthetic events, return exact conflict IDs/time ranges and feasible free slots.
- [ ] Happy: morning briefing includes correct day's synthetic events; recap references tomorrow accurately.
- [ ] Edge: all-day event, back-to-back events, timezone conversion, DST boundary, empty day, cancelled event.
- [ ] Failure: invalid date range, expired OAuth, API timeout -> typed failure without fabricated events.
- [ ] Failure: unauthorized calendar write or changed approved payload -> no event mutation.
- [ ] Proactive: new interview or approaching deadline -> one alert only; restart preserves cursor.
- [ ] Deployed OpenClaw: Telegram query yields verified event IDs/times from test calendar.

## 5. Skill 4 — `web-search` (grounded research)

**Purpose:** Search the web for non-sensitive general information and support synthetic job research or briefing context. Use OpenClaw's native web-search capability where available; do not create a second search stack unnecessarily.

**Current tool contract:** use OpenClaw core `web_search` (not a custom parallel search client), optionally `web_fetch` for a returned source. The local pinned runtime uses `@openclaw/duckduckgo-plugin@2026.11.2`, `SafeSearch: strict`, region `us-en`; package integrity is recorded in `deploy/openclaw-plugins.lock.json`. A live tool call and actual results are recorded in `DEV_LOG.md` and `evidence/g6-25-web-search.json`. This provider is documented by the installed OpenClaw release as experimental HTML scraping, so bot challenges, empty results, or irrelevant results must be returned as such without fabrication.

**Constraints:** search results are untrusted; citations/URLs must map to actual results; no invented results; sanitize external text; do not treat search content as authorization; avoid submitting candidate secrets in search queries; arbitrary employer sites are read-only and never become allowed submit origins through search.

**Tests / inspected outputs:**

- [ ] Happy: real search returns source URLs, titles, and a grounded short answer; inspect actual returned URLs and citations.
- [ ] Edge: zero results, duplicated results, conflicting sources, long/snippet-only results, malformed URL.
- [ ] Failure: provider timeout/rate limit/network loss -> clear error; no fabricated search results.
- [ ] Security: search-result prompt injection cannot trigger email send, shell execution, or real-employer submission.
- [ ] Deployed OpenClaw: invoke from Telegram and inspect returned sources and audit record.

## 6. Cross-skill workflows (six planned advanced features)

| Feature | Skill(s) | Trigger | Mandatory verification |
|---|---|---|---|
| Morning briefing | calendar + email + weather adapter | OpenClaw cron | expected events, gaps, weather fixed demo city, unread/flagged synthetic mail; actual scheduled delivery |
| End-of-day recap | applypilot + email + calendar | OpenClaw cron | actual recorded actions, pending approvals, next-day deadlines; no invented completed work |
| Email intelligence | email + applypilot | new synthetic email/poll | classification, application association, grounded draft; no send without approval |
| Proactive alerts | email + calendar | scheduled cursor poll | deadline/interview alert once, no duplicate after restart |
| Calendar intelligence | calendar | request or new event | conflict and proposed slots; no unapproved changes |
| Personal knowledge base | shared memory + all skills | approved memory updates | source/provenance, durable recall after restart, injection cannot poison trusted preferences |

Assignment threshold is **at least four of six**; project plan implements **all six**. Demonstrate briefing, recap and alert in the final video.

## 7. Hybrid model router — cross-cutting tool policy

Routing is not a fifth required skill; implement it as an OpenClaw plugin/hook with testable deterministic policy:

| Task condition | Expected behavior | Failure assertion |
|---|---|---|
| Short, low-risk | Prefer Gemma 4 if available | If unavailable, documented permitted fallback |
| Privacy-sensitive | Gemma 4 only | If unavailable, `held`; never silent cloud fallback |
| Long-context/deep reasoning | Verified cloud model | Error or documented fallback on cloud outage |
| Cloud rate-limit simulation | Eligible tasks route locally | Private task remains local/held; no quota burn required |

Log request ID, classification/rule, selected model, **actual served model**, availability, latency, result; no prompt text. Verify with live local/cloud responses, local-off/local-on sequence, reversible simulated cloud rate limit, and log redaction checks. Record all cases in `DEV_LOG.md`.

## 8. Skills completion and integration checklist

- [ ] Four actual OpenClaw skill directories and valid `SKILL.md` metadata exist.
- [ ] Skill descriptions correctly advertise when and when not to invoke them.
- [ ] Every tool has validated schemas and structured, redacted results.
- [ ] Each skill has happy, edge, and failure test outputs inspected and recorded.
- [ ] `applypilot` is independently verified through full controlled test-site submit.
- [ ] `email` refuses unapproved or non-allowlisted sends with zero side effects.
- [ ] `calendar` handles timezones/conflicts and refuses unapproved mutation.
- [ ] `web-search` returns genuine sources and handles empty/error responses.
- [ ] Cross-skill morning briefing, recap, alert, and knowledge persistence work.
- [ ] All six planned advanced features work (at least four rubric threshold).
- [ ] All four skills invoked through running OpenClaw + Telegram, not only unit tests.
- [ ] Skill calls produce correlation IDs, provenance and redacted audit logs.
- [ ] Prompt-injection tests in job/email/form/search surfaces pass.
- [ ] Cloud/local routing tests inspect actual served model.
- [ ] Restart and duplicate polling tests prove durable state and deduplication.
- [ ] ApplyPilot ClawHub package published, pinned, sanitized, fresh install tested.
- [ ] `DEV_LOG.md` has evidence links and pass/fail/blocked status for every item.

## 9. Agent execution instruction

**Start at Gate 0 in `AGENTS.md` and do not implement all four skills at once.** For each skill, first implement one typed operation, add happy/edge/failure tests, inspect the actual output and forbidden side effects, record in `DEV_LOG.md`, then add the next operation. Run deployed OpenClaw integration tests only after direct tool tests pass. Never mark a skill complete based on source code existence, a mocked provider response, or an LLM's claim of success.

## Rubric clarification — 2026-11-12

Calendar intelligence must also prepare meeting context from prior synthetic emails/documents. Morning briefing must select unread/flagged mail and include schedule gaps and weather. Email sending is a retained project extension, not a compulsory email-feature capability; every supported send still requires code-enforced human approval and recipient allowlisting. Private classification overrides every cloud routing rule. Model comparisons use explicitly cloud-permitted synthetic data.

## Gate 6 implementation update — authenticated email outbox

OpenClaw tool inputs now allow omission of technical `requestId`; the host
supplies a stable audit ID. Business input validation remains strict.

The approved-send extension uses human-only native Telegram commands, not a
model-callable send tool. `/reviewemail THREAD_ID` creates a durable local reply
for review, `/approveemail EMAIL_ID DIGEST` authorizes that exact payload, and
`/emailstatus EMAIL_ID` reads state. The current recipient allowlist contains only
the configured dedicated test account itself. No CC/BCC or arbitrary recipient is
accepted. A durable `SENDING` record precedes the one provider request; ambiguous
failures remain held for human inspection and cannot be blindly retried. These
commands supplement the four skill packages. Live sending is not claimed from
mocked-provider tests; evidence requires an actual human approval and inspection
of the test Sent folder.
