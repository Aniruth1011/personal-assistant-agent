# Inbox, weather and adversarial coverage audit

Audit date: 2026-11-17 UTC. No runtime code, deployment, inbox contents or schedules changed.

## Findings

- Email reports query `newer_than:30d subject:synthetic`, at most ten threads. Unread adds `is:unread`; briefing uses unread/starred/important. There is no full-inbox sender/date search interface. The query does not require `in:inbox`.
- Local intent probe: “Is there any new mail from xyz?” returns no recognized read intent. “Check if there is new email from coordinator@example.test” becomes generic email intent. The Telegram dispatch adapter replaces recognized email questions with a generic report request, losing sender/date constraints. These are function/source findings, not a live Telegram sender-query test.
- Reports warn when another page exists. Ordinary email summaries do not traverse subsequent pages. Alerts persist cursors and pending retries across runs. Each retrieved thread contributes only its latest message, not every message or every unread message. This is insufficient to promise comprehensive mailbox answers.
- Summaries are extractive: up to two sentences/400 characters and three action excerpts. Important details elsewhere in a message or earlier in a thread can be omitted.
- Bounds include ten threads/page, at most 100 messages/thread, body size validation, one MiB provider output and 15-second provider timeout. These bounds and retry/deduplication tests are not a large-mailbox/concurrent-request load test. Sequential retrieval can accumulate latency.
- Weather uses Open-Meteo, falling back to NWS, for a fixed Los Angeles location. Fresh laptop and deployed-cloud calls both timed out on Open-Meteo at approximately eight seconds; both NWS requests returned HTTP 200 and validated forecast-only output. This proves successful fallback during observed primary failure, not failure-free Open-Meteo operation. Primary failure diagnostics are currently swallowed by the production helper. Both providers failing yields explicit unavailable output.
- Existing Gmail retrieval requests sanitization and untrusted-content wrapping. No current end-to-end HTML attachment/inbox injection test was located. Sanitizer flags alone are not proof of sanitization effectiveness.
- Direct summarizer fixtures flagged explicit instruction override/token disclosure, but did not flag disguised HTML forwarding or plain-text mailbox-upload instructions, which appeared as action excerpts. These fixtures bypass Gmail sanitization and demonstrate summarizer limitations, not proven browser script execution or successful data exfiltration.
- Explicit authenticated payload-bound approval, recipient restrictions and durable send state remain separate deterministic controls. Passing their tests does not establish complete adversarial content handling.
- No checklist explicitly identified as “16 checks” was found in the searched current tests, security report, evidence or assignment-description extraction. User clarification requested; no 16/16 claim made.

## Verification

`npx --yes --package=node@24.22.1 --package=npm@11.9.0 npm test -- src/integrations/gogcli-email.test.ts src/integrations/email-classifier.test.ts src/integrations/approved-email.test.ts src/scheduler/assistant.test.ts src/persistence/email-event-store.test.ts tests/integration/advanced-features.test.ts` exited 0: 42 tests across six files passed. Provider doubles are not live Gmail stress evidence.

Evidence: `evidence/inbox-weather-audit-tests.txt`, `evidence/inbox-weather-function-probes.json`, `evidence/inbox-weather-local-audit.json`, `evidence/inbox-weather-cloud-audit.json`.

The first attempt to reuse the old SSH connection exited 255 (broken pipe). A new SSH session connected to deployed image bb67eb5a42942b44e8a2f28871a70673a05b4549b307310fb03bbbd98adcb1b5 and completed the read-only weather probe.

## Next acceptance work

1. Preserve sender/date/unread intent in a constrained structured mailbox query; define “new”, paginate within explicit budgets, and disclose exact scope/partial coverage. Stay within the dedicated synthetic account.
2. Exercise more than ten threads, multiple messages per thread, unread-vs-latest mismatches, no matches, oversized bodies, provider errors, concurrent reads, retries and restart. Verify correctness and latency, not just absence of crashes.
3. Add adversarial MIME/HTML-body and HTML-attachment fixtures through the real sanitization/report path. Verify no unauthorized sends, attachment execution, external fetches or memory/task changes. Include at least three distinct documented attacks and the user's 16-item checklist once identified.
4. Diagnose primary weather connectivity and preserve provider/fallback diagnostics; test timeout, rate-limit, malformed/stale output and both-provider failure without claiming external APIs can never fail.

Do not present comprehensive inbox Q&A, full HTML-injection resistance or failure-free Open-Meteo as completed video features yet. Original 48-hour evidence is unchanged.
