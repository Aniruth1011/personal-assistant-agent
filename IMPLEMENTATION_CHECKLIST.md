# Active implementation checklist

Status as of 2026-11-19. Scope supersedes the earlier feature checklist; archived completion claims remain historical. Each item cites the evidence that closes it; nothing is closed by inference from source compilation or mocks.

## Scope and local implementation

- [x] Scope migration: active code/config/docs remove retired workflow; regression suite passes — `evidence/todo-scope-verify-final.txt`, `evidence/todo-scope-configuration.json`, `evidence/todo-scope-removal.json`
- [x] Local to-do store: add/list/complete, authorization, deduplication, events and restart — same evidence
- [x] To-do plugin tools and human command tests — same evidence
- [x] Briefing/recap/alert task integration and deduplication tests — same evidence
- [x] Compiled plugin manifest/skill inventory validated — same evidence
- [x] All six feature implementations pass local happy/edge/failure checks — `evidence/advanced-features-verify-command-boundary.txt`; live weather in `evidence/advanced-weather-live.json`
- [x] Current verification (2026-11-19): lint, typecheck, 135 root tests, 24 plugin tests, credential scan — DEV_LOG 2026-11-19T08:45Z

## Live skills and proactive features

- [x] Four skills demonstrated through deployed runtime/model/Telegram:
  - email: `evidence/telegram-fix/r5-human-email.json`, `rehearsal-email-review.json`, `rehearsal-email-send-confirmed.json`, `rehearsal-email-duplicate-blocked.json`
  - calendar: `evidence/telegram-fix/r6-human-calendar.json`
  - web search: `evidence/telegram-fix/public-search-telegram.json`, `search-delivery.json`, `rehearsal-web-search.json`
  - to-do: `evidence/telegram-fix/rehearsal-todo-created.json`, `rehearsal-todo-deduplicated.json`, `rehearsal-todo-completed.json`
- [x] Proactive features demonstrated on the deployed runtime:
  - scheduled briefing and recap: `evidence/advanced-scheduled-delivery.json`, plus second-window deliveries
  - fresh deadline alert with duplicate suppression: `evidence/readiness-fresh-alert-delivery.json`, `evidence/readiness-alert-dedup-live.json`
  - email intelligence: `evidence/advanced-cloud-live-final.json`
  - calendar conflicts and slots: `evidence/telegram-fix/r6-human-calendar.json`
  - knowledge across restart: `evidence/readiness-memory-after-restart.json`
  - Limitation: the tagged `[project:key]` meeting-context path was not demonstrated live.
- [x] Cloud/local actual served-model and privacy-outage evidence — `evidence/readiness-final-model-startup.json`, `evidence/readiness-private-outage-cloud.json`, `evidence/readiness-local-recovered.json`; dashboard paths in `evidence/telegram-fix/dashboard-human-*.json`

## Deployment, recovery and security

- [x] Cloud image built and deployed with safe state migration; current image `sha256:8fdf113b…` — `evidence/formal-readiness-second-basis.md`
- [x] GCS/native vault recovery after deployed restart, including nonempty human task/fact with identical hashes — `evidence/advanced-recovery-*.json`, `evidence/readiness-memory-after-restart.json`
- [x] Isolation inspection and ten-risk security report — `evidence/security-audit/cloud-isolation.json`, `reports/security/SECURITY_REVIEW.md`
- [x] Framework deep audit executed and findings preserved — `evidence/security-audit/cloud-deep.json`
- [x] Three distinct deployed injection attempts, run 2026-11-17 and re-run on the current image 2026-11-19 (all contained; SEC-INJ-003 made one unnecessary read-only tool call) — `evidence/security-audit/`, `evidence/security-audit/rerun-20261119/`
- [ ] Resolve remaining security findings (injection detector coverage, plugin dependency advisories). Not fixed; documented as remaining risks in `reports/security/SECURITY_REVIEW.md` and README "Known limitations".
- [x] Grader HTTPS access: token path verified (`evidence/readiness-https-live.json`); separate-account Tailscale share verified 2026-11-19 from an iPhone in Safari with no token prompt (Brave on iOS could not connect) — DEV_LOG 2026-11-19T06:12Z

## Operation and evaluation

- [x] First >=48-hour window with timestamp coverage, scheduling and incident logs — `reports/operations/FORMAL_48H_RESULT.md`; routing defect OPS-ROUTING-001 preserved and corrected in `reports/operations/ROUTING_FIX_STATUS.md`
- [x] Second >=48-hour window on the current image (2026-11-18T06:48:37Z to 2026-11-20T06:48:37Z): operational PASS, 2,865 samples, 0 gaps/unhealthy/restarts/drift, logging reconciled 2,865/2,865 — `reports/operations/FORMAL_48H_RESULT_SECOND.md`, `evidence/formal-operation-second/`. Open defect OPS-ROUTING-002: scheduled cloud probe 0/8.
- [x] >=3-task-type cloud/local comparison with raw results — `reports/performance/COMPARISON.md` (60 original attempts plus 12 recovery checks)
- [x] To-do correctness/deduplication/recovery/security — unit tests; live create/duplicate/complete receipts above; task survived full-instance replacement with identical hashes; task counts unchanged across all injection attempts
- [x] Original skill published on ClawHub at 1.0.0; fresh install and execution verified — `reports/operations/SKILL_PUBLICATION.md`

## Submission

- [x] README, personalization (`SOUL.md`, `USER.md`, `IDENTITY.md`, `MEMORY.md`), student-written `PROCESS_LOG.md`
- [x] Demo MP4 recorded (`Assignment3-CSCI599-aniruths.mp4`, uploaded separately) and private grader handoff prepared outside the repository
- [ ] Sanitized source ZIP `aniruth_sundararajan_a3.zip` — built with `scripts/package-submission.mjs` after the second window
