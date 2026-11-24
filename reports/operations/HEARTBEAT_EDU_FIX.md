# Persistent heartbeat and USC Edu correction

November17,2026. This is post-observation correction evidence; the original48-hour image and logs are unchanged.

## OpenAI account

The supported OpenClaw browser OAuth flow saved a USC identity whose token metadata reports `education`. A supported live configuration patch restricts automatic OpenAI credential selection to this profile. The existing scheduled cloud probe was explicitly rebound to the same profile. Both a fresh automatic cloud request after that restriction and the scheduled probe completed on actual `openai/gpt-6-luna`.

The previous Free-account credential remains in private native storage but is excluded from automatic selection. Historical sessions can retain their previous explicit account choice: use fresh Researcher chats for the final recording. Dedicated Gmail/Calendar credentials and scopes were not changed. Signing in to USC ChatGPT does not connect a USC mailbox.

OAuth renewal did not require a container rebuild. Account entitlement is evidenced by saved token metadata and successful inference, not an independent billing audit. No API key or OAuth token is included in these artifacts.

## Heartbeat and proactive delivery

The redundant main-session heartbeat had echoed old assistant refusals. Native scheduled report jobs already own briefing, recap and alert delivery. The supported configuration now sets `agents.defaults.heartbeat.every` to `0m`, `target` to `none`, and `isolatedSession` to `true`; `tools.exec.notifyOnExit` is false. The startup generator writes these values after every restored state, preventing a redeploy from restoring default30-minute polling.

This intentionally disables ambient model polling; it does not disable the native automation scheduler. Original briefing08:00Pacific, recap18:00Pacific and alerts every30minutes remain enabled. The historical failed messages are preserved. No transcript deletion was used as a fix.

Cloud Build `8df2647e-0b40-4cbf-9799-680aaaa61534` produced immutable image `sha256:8f395e0a2212843eb7a3617cc8cc189ae9114b3443a399b871fcf72cdb5062b1`, a minimal layer over the prior verified image. A successful encrypted checkpoint preceded replacement. Cloud Run update succeeded, and read-only inspection after boot confirmed the new heartbeat settings, Edu-only selection policy and restored Edu OAuth credential.

## Verification and limitations

Repository verification passed103tests across23files, formatting, lint, typecheck and credential-pattern scan. Live config.patch and cron.update succeeded. An attempted CLI auth-order edit refused live-state ownership; no offline-write bypass was attempted. Supported Gateway config.patch was used instead. Early HTTPS probes during startup failed with connection refused and are retained separately from successful readiness checks.

Evidence is under `evidence/heartbeat-edu-fix`: source/image provenance, verification output, Edu-only inference and scheduled probe receipts, and restored configuration. Final post-startup model and scheduled-delivery results are recorded separately as they complete. User owns the remaining grader-access setup. A fresh synthetic source email is required for another clean approval/send recording; no email was sent during these fixes.

## Separate ordinary-reply correction

Image8f395 reached HTTPS readiness at2026-11-17T19:31:38.441Z. Startup verified actualLuna/Gemma and Google reads; all three separate scheduled preflight messages subsequently completed and were confirmed delivered. However, an operator `chat.send` with delivery disabled showed that ordinary capability answers could still append historical report text. This is distinct from recurring heartbeat execution.

The read-request plugin now recognizes anchored capability questions and dispatches authenticated Telegram requests into a fresh private session with no old history. The model still generates the answer; this is not a canned greeting. Tools are disabled for that child context. Other requests and unauthenticated/group senders do not receive this dispatch. Stable identities prevent retry duplication. Plugin tests cover these boundaries and all20 pass; root103tests and build also pass. The original failure is preserved in `greeting-history-contamination.json`.

Cloud Build `6b77728b-2de8-4aa9-bd6f-65559097248a` produced final candidate `sha256:b520e3abc4c130d23c8d02194677f2011a6e0a30e7c71777bba874e6135653a2`. A fresh encrypted checkpoint preceded the replacement. Final startup/model validation and genuine human Telegram retest remain distinct checks; do not infer either from source tests.

## Final deployment verification

Final imageb520 reached HTTPS readiness at2026-11-17T19:44:02.650Z. Startup verified cloudgpt-6-luna,localgemma4:e2b,Google reads and containerisolation. The deployed hook hash matches the tested artifact. Edu-only credential selection and heartbeat suppression persisted. All three newly scheduled final-image preflight jobs completed successfully with `delivered:true`; see `scheduled-preflight-final-image.json`.

An operator probe of the isolated capabilities context returned four clean sentences from Gemma with zero tools and no historical report/refusal. The authenticated-human Telegram dispatch still needs the requested human greeting retest; this result must not be relabelled as that test. A clean new inbox source for a new approval/send take has also been requested but not observed. The corrected seed wording is “Following up on your request: The fictional Atlas demo notes are ready. Please confirm receipt.” The earlier sample wording was not recognized by the bounded classifier and must not be presented as successfully handled. No more deployment is planned for these fixes.
