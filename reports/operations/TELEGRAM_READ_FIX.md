# Telegram read-path correction (completed 2026-11-16)

Original human Telegram tests passed to-do listing but failed email, calendar and public search. Email and calendar answered without current provider tools; search attempted the wrong tool name while the local model intentionally lacked web tools.

The authenticated public-search dispatch now copies only the explicit public query into a fresh public-research session. Actual Telegram evidence shows gpt-6-luna called web_search and returned sources, followed by a channel delivery receipt. The received query said “open law”, so legal-documentation results are not represented as OpenClaw results. Private chat history is never forwarded to that workspace.

The unread-email report now uses a strict unread synthetic-mail query scoped to the last30days. Fresh local Gemma probes called assistant_report with unread_email and calendar and returned actual mail and free-slot data. However, the next human tests in the existing Telegram session still answered without tools. These failures are preserved; isolated probes do not close Telegram acceptance.

Revision5 therefore dispatches authenticated email/calendar read requests into fresh main-agent sessions using a normalized read-only intent. Main sessions retain private classification and local-only routing; local unavailability must hold. Calendar intent wins the user's mixed calendar/email wording. Draft requests retain their normal tool path. Each inbound message has a stable idempotency identity. Human retest and immutable deployment/restart verification remain pending.

Verification:99root tests and19plugin tests passed, along with formatting, lint, typecheck, secret scan and plugin build. These are code checks, not a live acceptance pass.

Evidence: `evidence/telegram-fix/r4-human-failures.json`, `r4-read-probes.json`, `public-search-telegram.json`, `search-delivery.json`, `verify-r5.txt`, `plugin-r5-tests.txt`. Original48-hour observation evidence is preserved; no new formal window was started.

Revision5 human email and calendar requests invoked the correct report tools on local Gemma. Calendar prose added an incorrect parenthetical time conversion, so revision6 returns only the matching live report receipt for a private read, with honest failure if no receipt is available. The original model answer remains in evidence. Revision6 durable restart passed at2026-11-16T23:06:24.628Z, including actual cloud/local models, isolation, Google access and authenticated HTTPS. The final human Telegram calendar request succeeded on local Gemma, called assistant_report(kind=calendar), returned a valid23:10–00:10UTC slot and has a native successful Telegram delivery receipt at23:09:17.380Z. See r6-human-calendar.json. The delivery log records status rather than retaining the outgoing message body.

Final deployed image: `sha256:83dcc8200d0fd68a144192d0eab7a8f0a12e5e248c7d7bd2cd8f078b74233293`. Compiled-hook hash matches the tested local artifact. See `restart-r6-checks.json` and `final-hook-sha256.txt`. Pre-restart side-effect comparison shows unchanged task, knowledge, email-outbox and memory state; report records increased from195to200. No new48-hour window was started.
