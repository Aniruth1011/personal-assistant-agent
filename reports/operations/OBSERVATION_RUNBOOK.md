# Formal 48-hour observation

Status: IN_PROGRESS. Formal window: 2026-11-13T08:30:39.916Z through 2026-11-15T08:30:39.916Z. See `evidence/formal-window-manifest.json`. Preparatory samples do not count as the formal observation.

The supervised cloud monitor samples approximately once per minute after the previous sample finishes. Each sample goes to Cloud Logging (`operations.sample`) and an immutable Cloud Storage object under `operations/samples/`. A separate `operations.archived` receipt proves a successful independent readback. Archive failures retain the route cursor and emit a failure event. Startup and shutdown have boot identifiers; observations are never silently joined across restarts.

Recorded metadata includes application/Gateway health, local model availability, route decisions and served model outcomes, native cron declarations and run receipts, delivery queue counts, task/fact/report counts, workspace/config hashes and aggregate transcript counts. Transcript counts include scheduled and CLI conversations and must not be labelled Telegram-only. Model availability is not proof of successful inference: use route outcomes and explicit model probes alongside it. Message bodies, credentials, email text and saved fact values are excluded from these samples. Native encrypted state snapshots remain separate recovery artifacts.

Before starting, verify HTTPS authentication and grader access, nonempty human-created memory recovery, a newly delivered deadline alert, actual cloud and local inference, the security audit and routing failure policy. Preserve their timestamped evidence. Keep the laptop powered, awake and connected for local inference. Do not count startup as healthy operation. Notify the user of readiness and follow the applicable explicit start authorization.

The operator supplies a JSON object with seven verified boolean flags: `https`, `memoryRecovery`, `freshAlert`, `localModel`, `cloudModel`, `securityAudit`, `routingFailurePolicy`. The start command is:

```sh
node scripts/operations/start-window.mjs /private/path/verified-readiness.json
```

It rejects false/missing flags, stale or unhealthy samples and unpinned image names. It records the actual deployed image digest, config hash, UTC start/end, timezone and boot identity in GCS with create-only semantics. A singleton `operations/active-window.json` prevents concurrent/accidental overlapping starts. If interrupted after that claim, inspect and recover the existing claim; do not silently delete it or manufacture a new start time. The local manifest is `evidence/formal-window-manifest.json`.

During observation, preserve native cron receipt success/delivery, morning briefing, recap and nonempty alerts, local/cloud inference outcomes, token refresh, memory continuity, lifecycle events and incidents. Record every restart, missed event, provider outage and monitoring gap. Do not change the image or configuration silently. A runtime restart requires incident and state-continuity review; a gap is never counted as proven continuous service.

Export the window without relying on ephemeral container logs:

```sh
node scripts/operations/export-window.mjs evidence/formal-window-manifest.json
```

This downloads immutable samples and produces a coverage assessment under `evidence/formal-operation/`. It flags gaps over 180 seconds, unhealthy samples, configuration changes and boot changes. It never declares the assignment passed automatically: even full timestamp coverage requires manual review of scheduled event delivery, meaningful operations, privacy holds, token refresh and incidents. Preserve the relevant Cloud Logging lifecycle records independently and reconcile them against the samples. The export may take several minutes for roughly 2,880 objects; it does not mutate the running service.

Operational health sampling is infrastructure monitoring. The assistant's proactive features continue to use native OpenClaw cron.

Before the window, two additional native agentTurn cron jobs were registered on public-research: `40 */6 * * *` (simple local question) and `45 */6 * * *` (public comparison question), timezone America/Los_Angeles. Both have `toolsAllow: []`, `delivery.mode: none` and no model override; routing remains task-aware. Preserve their results as liveness evidence, not benchmark measurements. IDs and configuration are in `evidence/observation-model-schedules.json`. Disable these observation-only probes after the completed window and evidence review if they are no longer needed.
