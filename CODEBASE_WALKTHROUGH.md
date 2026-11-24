# Personal assistant codebase walkthrough

## Start here

The active project is a Telegram personal assistant with **calendar, email, web search and a local to-do list**. OpenClaw supplies messaging, model execution, skills and native scheduling. Our TypeScript plugin supplies restricted tools, human command handlers, task storage, reports, routing policy and durable checkpoints.

This describes current source. It is not a claim that the new source is deployed. Historical documents and evidence are retained under evidence/history and in DEV_LOG.md; current acceptance is in IMPLEMENTATION_CHECKLIST.md.

## Reading order

1. README.md → SKILLS.md → IMPLEMENTATION_CHECKLIST.md: capabilities, boundaries and remaining evidence.
2. src/tasks/store.ts → src/tasks/store.test.ts: task schema, transactions, stable IDs, immutable events and duplicates.
3. src/plugin/src/telegram-auth.ts → todo-commands.ts: human authorization and task changes.
4. src/plugin/src/index.ts: find `list_todos`, then tool wrappers and plugin registration.
5. src/scheduler/reports.ts → calendar-intelligence.ts → assistant-state.ts: report composition, calendar calculations and alert/memory persistence.
6. src/integrations/: provider reads, email classification, proposed replies and approved-send outbox.
7. src/router/policy.ts → src/plugin/src/router-hooks.ts: model/privacy decisions and actual served-model telemetry.
8. src/persistence/runtime-checkpoint.ts → cloud-archive.ts → native-vault.ts: local durability through cloud recovery.
9. scripts/local-gateway.mjs → deploy/assistant-runtime.mjs → deploy/Dockerfile: configuration, process startup and container assembly.
10. Read the adjacent tests and dated DEV_LOG evidence before interpreting a feature as live-verified.

## Request flows

```text
Natural language → Telegram → OpenClaw → routing hook → model → read-only typed tool → evidence-grounded response

/todoadd → authenticated Telegram command → validate title/date/priority → SQLite transaction + event → GCS checkpoint → confirmation

/tododone → authenticated command → lookup task → atomic completion + event → checkpoint → confirmation

Native cron → assistant_report → provider reads + task list → deduplicated report/alert → OpenClaw Telegram delivery

/reviewemail → stored exact proposed payload → authenticated /approveemail → durable approved outbox → provider send
```

Model tools do not mutate tasks. Human commands use host-created sender context, not an identity provided in model arguments. Identical title/date/priority returns the same task; repeated completion produces no additional event. Task dates are not calendar bookings. There is no task edit/delete/reopen/recurrence operation yet.

A checkpoint failure can occur after a local task transaction commits. Commands report uncertainty and advise inspecting the list before retrying. Stable identity prevents duplicate retry effects. Alert reservations do not by themselves prove Telegram delivery.

## Startup and persistence

There is no `npm start` entry point. Root src/index.ts only exports the project name. The local launcher prepares OpenClaw and optionally starts Gateway; cloud Docker CMD starts deploy/assistant-runtime.mjs. The native scheduler runs jobs without an infinite sleep loop.

State lives on transactional local disk. assistant.sqlite contains tasks/events, preferences, alert reservations, mailbox state, routing metadata and email outbox tables. GCS stores immutable snapshots; the native vault encrypts selected workspace/provider/native scheduler state. SQLite never runs on a GCS FUSE mount.

Legacy filenames exist only in migration code so earlier private backups remain readable. Earlier native conversation state may mention retired functionality, but the new registered tool allowlist excludes it. A live cutover must verify restored state and updated skill/workspace instructions; compilation alone does not establish migration success.

## Models

Main assistant conversations are private: local Gemma or hold. Cloud reasoning requires the host-selected isolated public-research workspace. Length/keyword heuristics classify complexity; privacy rules override complexity. Actual provider/model metadata and routing outcomes are recorded without raw prompts.

## File reference

Generated dependencies, private state and historical artifacts are grouped separately. Each maintained source/configuration/test file below has a current scope description.

| File                                                                                                         | Responsibility                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [.dockerignore](.dockerignore)                                                                               | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [.env.example](.env.example)                                                                                 | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [.gitignore](.gitignore)                                                                                     | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [.prettierignore](.prettierignore)                                                                           | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [AGENTS.md](AGENTS.md)                                                                                       | Current execution, security and sequential acceptance contract.                                                                                      |
| [APPLYPILOT_PLAN.md](APPLYPILOT_PLAN.md)                                                                     | Current personal-assistant scope, requirements, architecture and ordered acceptance plan.                                                            |
| [CODEBASE_WALKTHROUGH.md](CODEBASE_WALKTHROUGH.md)                                                           | This current navigation and per-file reference.                                                                                                      |
| [DEV_LOG.md](DEV_LOG.md)                                                                                     | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [IDENTITY.md](IDENTITY.md)                                                                                   | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [IMPLEMENTATION_CHECKLIST.md](IMPLEMENTATION_CHECKLIST.md)                                                   | Current-scope acceptance checklist. Historical passes are not new deployment acceptance.                                                             |
| [MEMORY.md](MEMORY.md)                                                                                       | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [PROCESS_LOG.md](PROCESS_LOG.md)                                                                             | Student-written AI tools, development narrative, code attribution, verification and reflection.                                                      |
| [README.md](README.md)                                                                                       | Current capabilities, commands, setup and deployment caveats.                                                                                        |
| [SKILLS.md](SKILLS.md)                                                                                       | Four active skill contracts and verification criteria.                                                                                               |
| [SOUL.md](SOUL.md)                                                                                           | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [USER.md](USER.md)                                                                                           | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [automation/alerts.code](automation/alerts.code)                                                             | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [automation/briefing.code](automation/briefing.code)                                                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [automation/checkpoint.code](automation/checkpoint.code)                                                     | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [automation/recap.code](automation/recap.code)                                                               | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [deploy/Dockerfile](deploy/Dockerfile)                                                                       | Pinned non-root Linux cloud container, provider tools, compiled plugin and Gateway runtime; no standalone browser installation.                      |
| [deploy/assistant-runtime.mjs](deploy/assistant-runtime.mjs)                                                 | Cloud state restore/migration, provider credentials, Tailscale/proxy, Gateway startup, scheduling, readiness and shutdown archive.                   |
| [deploy/cloud-smoke.mjs](deploy/cloud-smoke.mjs)                                                             | Non-root/capability checks, real Google reads and cloud/local served-model probes. No browser/form checks.                                           |
| [deploy/connectivity-probe.mjs](deploy/connectivity-probe.mjs)                                               | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [deploy/ollama-proxy.mjs](deploy/ollama-proxy.mjs)                                                           | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [deploy/openclaw-plugins.lock.json](deploy/openclaw-plugins.lock.json)                                       | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [deploy/runtime/package-lock.json](deploy/runtime/package-lock.json)                                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [deploy/runtime/package.json](deploy/runtime/package.json)                                                   | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [deploy/tailscale/README.md](deploy/tailscale/README.md)                                                     | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [deploy/tailscale/policy.template.json](deploy/tailscale/policy.template.json)                               | Template for least-privilege tailnet grants; editing this file alone does not apply policy to Tailscale.                                             |
| [eslint.config.js](eslint.config.js)                                                                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [fixtures/calendar/applypilot-demo.ics](fixtures/calendar/applypilot-demo.ics)                               | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [fixtures/calendar/synthetic-meeting-v1.json](fixtures/calendar/synthetic-meeting-v1.json)                   | Fictional meeting calendar fixture.                                                                                                                  |
| [fixtures/emails/synthetic-meeting-invitation-v1.json](fixtures/emails/synthetic-meeting-invitation-v1.json) | Fictional meeting email fixture.                                                                                                                     |
| [package-lock.json](package-lock.json)                                                                       | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [package.json](package.json)                                                                                 | Root npm scripts, supported Node versions and shared dependency pins.                                                                                |
| [reports/operations/MANUAL_TESTING.md](reports/operations/MANUAL_TESTING.md)                                 | Human testing instructions and expected controlled bot workflows.                                                                                    |
| [scripts/check-assistant-runtime.mjs](scripts/check-assistant-runtime.mjs)                                   | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [scripts/check-env.mjs](scripts/check-env.mjs)                                                               | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [scripts/check-live-skills.mjs](scripts/check-live-skills.mjs)                                               | Direct Gateway provider/task tool diagnostic. Review fixed calendar window before live use; not model-dispatch proof.                                |
| [scripts/check-secrets.mjs](scripts/check-secrets.mjs)                                                       | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [scripts/collect-model-evidence.mjs](scripts/collect-model-evidence.mjs)                                     | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [scripts/local-gateway.mjs](scripts/local-gateway.mjs)                                                       | Workspace/config builder and optional Gateway launcher. Migrates old local SQLite via backup; config enables exactly calendar/email/web-search/todo. |
| [scripts/prepare-tailnet-policy.mjs](scripts/prepare-tailnet-policy.mjs)                                     | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [scripts/schedule-assistant.mjs](scripts/schedule-assistant.mjs)                                             | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [skills/calendar/SKILL.md](skills/calendar/SKILL.md)                                                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [skills/email/SKILL.md](skills/email/SKILL.md)                                                               | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [skills/todo/SKILL.md](skills/todo/SKILL.md)                                                                 | Instructions for reading tasks and guiding human mutation commands. Local list, no Todoist connection.                                               |
| [skills/web-search/SKILL.md](skills/web-search/SKILL.md)                                                     | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/index.ts](src/index.ts)                                                                                 | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/integrations/approved-email.test.ts](src/integrations/approved-email.test.ts)                           | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/integrations/approved-email.ts](src/integrations/approved-email.ts)                                     | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/integrations/email-classifier.test.ts](src/integrations/email-classifier.test.ts)                       | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/integrations/email-classifier.ts](src/integrations/email-classifier.ts)                                 | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/integrations/email-reply-draft.ts](src/integrations/email-reply-draft.ts)                               | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/integrations/gogcli-calendar.test.ts](src/integrations/gogcli-calendar.test.ts)                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/integrations/gogcli-calendar.ts](src/integrations/gogcli-calendar.ts)                                   | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/integrations/gogcli-email.test.ts](src/integrations/gogcli-email.test.ts)                               | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/integrations/gogcli-email.ts](src/integrations/gogcli-email.ts)                                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/integrations/weather.ts](src/integrations/weather.ts)                                                   | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/persistence/checkpoint-lock.test.ts](src/persistence/checkpoint-lock.test.ts)                           | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/persistence/checkpoint-lock.ts](src/persistence/checkpoint-lock.ts)                                     | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/persistence/cloud-archive.test.ts](src/persistence/cloud-archive.test.ts)                               | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/persistence/cloud-archive.ts](src/persistence/cloud-archive.ts)                                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/persistence/email-event-store.test.ts](src/persistence/email-event-store.test.ts)                       | Mailbox cursor and event-deduplication/storage regressions.                                                                                          |
| [src/persistence/email-event-store.ts](src/persistence/email-event-store.ts)                                 | Append-only generalized email classifications plus durable mailbox cursor/pending thread processing.                                                 |
| [src/persistence/native-vault.test.ts](src/persistence/native-vault.test.ts)                                 | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/persistence/native-vault.ts](src/persistence/native-vault.ts)                                           | Encrypted native-state backup/restore. Accepts legacy filenames solely for migration; new captures use assistant.sqlite.                             |
| [src/persistence/runtime-checkpoint.ts](src/persistence/runtime-checkpoint.ts)                               | Consistent SQLite backup to immutable verified GCS snapshot and commit receipt. Development without bucket is a no-op; production requires archive.  |
| [src/plugin/README.md](src/plugin/README.md)                                                                 | Plugin build and configuration instructions.                                                                                                         |
| [src/plugin/openclaw.plugin.json](src/plugin/openclaw.plugin.json)                                           | Plugin identity, strict configuration schema and current tool contract names.                                                                        |
| [src/plugin/package-lock.json](src/plugin/package-lock.json)                                                 | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/plugin/package.json](src/plugin/package.json)                                                           | Plugin package/build scripts, host compatibility and dependency pins.                                                                                |
| [src/plugin/src/assistant-commands.test.ts](src/plugin/src/assistant-commands.test.ts)                       | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/plugin/src/assistant-commands.ts](src/plugin/src/assistant-commands.ts)                                 | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/plugin/src/email-commands.ts](src/plugin/src/email-commands.ts)                                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/plugin/src/index.test.ts](src/plugin/src/index.test.ts)                                                 | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/plugin/src/index.ts](src/plugin/src/index.ts)                                                           | Plugin entry: typed email/calendar/report/task tools, durability tool, routing hooks and authenticated command registration.                         |
| [src/plugin/src/router-hooks.test.ts](src/plugin/src/router-hooks.test.ts)                                   | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/plugin/src/router-hooks.ts](src/plugin/src/router-hooks.ts)                                             | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/plugin/src/telegram-auth.ts](src/plugin/src/telegram-auth.ts)                                           | Shared host-context Telegram authorization. Rejects wrong channel, sender or unauthenticated context.                                                |
| [src/plugin/src/todo-commands.test.ts](src/plugin/src/todo-commands.test.ts)                                 | Exact registered-tool inventory and authenticated task command tests, including malformed/unauthorized/duplicate operations.                         |
| [src/plugin/src/todo-commands.ts](src/plugin/src/todo-commands.ts)                                           | Human-only /todos, /todoadd and /tododone command handlers with authorization, validation and post-write checkpoint.                                 |
| [src/plugin/tsconfig.json](src/plugin/tsconfig.json)                                                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/plugin/vitest.config.ts](src/plugin/vitest.config.ts)                                                   | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/router/policy.test.ts](src/router/policy.test.ts)                                                       | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/router/policy.ts](src/router/policy.ts)                                                                 | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/router/store.ts](src/router/store.ts)                                                                   | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/scheduler/assistant-state.ts](src/scheduler/assistant-state.ts)                                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/scheduler/assistant.test.ts](src/scheduler/assistant.test.ts)                                           | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/scheduler/calendar-intelligence.test.ts](src/scheduler/calendar-intelligence.test.ts)                   | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [src/scheduler/calendar-intelligence.ts](src/scheduler/calendar-intelligence.ts)                             | Timezone-aware calendar window, conflict and free-slot calculations; pure analysis without provider writes.                                          |
| [src/scheduler/reports.ts](src/scheduler/reports.ts)                                                         | Combines email/calendar/weather and task state into reports; includes open tasks, today’s completions and deduplicated due alerts.                   |
| [src/tasks/store.test.ts](src/tasks/store.test.ts)                                                           | Actual database tests for add/complete/reopen-process persistence, duplicates, bad dates/titles, authorization and immutable event history.          |
| [src/tasks/store.ts](src/tasks/store.ts)                                                                     | Local task schemas, stable duplicate identity, SQLite transactions, immutable events, list/create/complete and restart recovery.                     |
| [tests/integration/ollama-proxy.test.mjs](tests/integration/ollama-proxy.test.mjs)                           | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [tests/unit/smoke.test.ts](tests/unit/smoke.test.ts)                                                         | Project configuration or reference; inspect the file alongside its owning module.                                                                    |
| [tsconfig.json](tsconfig.json)                                                                               | Project configuration or reference; inspect the file alongside its owning module.                                                                    |

## Files that are not active source

- Assignment and lecture PDFs remain unchanged authoritative/reference inputs.
- evidence/ contains dated observations, including historical failures; scope and timestamps matter.
- evidence/history/pre-todo-scope/ preserves earlier contracts and documentation for provenance. It is not active product documentation.
- DEV_LOG.md is append-only and intentionally retains the complete historical narrative.
- .gitkeep files only preserve empty directories.
- .runtime/ and .env contain private runtime/configuration material; never publish. A private pre-change rollback archive is retained there.
- node_modules/ contains third-party code, not project-authored modules.
- src/plugin/dist/ is generated compiled output; rebuild it after source changes, never edit it directly.
- SQLite/WAL/SHM files are mutable runtime state, not source fixtures.

## Verification commands

Use Node 24.22.1. Run npm run format:check, npm run typecheck, npm run lint, npm test, npm run check:secrets and npm --prefix src/plugin run plugin:build. Live provider/model/Telegram and cloud restart checks are separate acceptance items. Never start a second Telegram poller against the same token.

## Advanced feature flow

1. Telegram `/briefing`, `/recap`, `/calendarcheck`, or `/emaildigest` enters `src/plugin/src/assistant-commands.ts`; native cron scripts call the same `assistant_report` tool.
2. `src/scheduler/reports.ts` obtains dedicated calendar and Gmail data. `src/integrations/weather.ts` validates an actual two-day Open-Meteo forecast, with a clearly labeled NWS period forecast fallback when the primary is unavailable.
3. `src/integrations/email-intelligence.ts` selects source sentences and requested actions, flags suspicious instructions, and retains message IDs. `email-reply-draft.ts` uses that context without sending.
4. `src/scheduler/context.ts` joins explicit project tags to saved facts/emails and fits prioritized tasks into non-overlapping calendar gaps. It never books events.
5. `src/scheduler/assistant-state.ts` records unique processed messages, report generation, preferences and alert reservations. Recaps distinguish generated reports from delivered messages and show pending email decisions.
6. Human `/remember` and `/knowledge` commands enter `src/plugin/src/knowledge-commands.ts`. `src/knowledge/store.ts` authenticates writes, validates non-sensitive fictional values, retains revisions, and mirrors facts to workspace `KNOWLEDGE.md`. Native vault and assistant checkpoints preserve state.
7. `tests/integration/advanced-features.test.ts` tests the combined feature flows with explicitly mocked providers; `src/plugin/src/knowledge-commands.test.ts` tests the human authorization boundary and checkpoint uncertainty. Live weather and deployment evidence are recorded separately.
