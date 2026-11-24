# ApplyPilot implementation checklist

Source of truth: [AGENTS.md](./AGENTS.md), [SKILLS.md](./SKILLS.md), and [APPLYPILOT_PLAN.md](./APPLYPILOT_PLAN.md). A checkbox is checked only after its required evidence is recorded in `DEV_LOG.md`.

## Sequential gates

- [x] Gate 0 — Baseline, repository, requirements traceability — evidence: `DEV_LOG.md` G0-04. Earlier registry and workspace-permission blockers were resolved after the user updated permissions.
- [x] Gate 1 — Local feasibility probes — local Gemma/OpenClaw routing evidence: `DEV_LOG.md` G1-03. By user's sequencing decision, cloud-model auth, Tailscale, and Cloud Run checks remain mandatory in Gate 9; controlled site/approval are built and validated in Gates 2/5.
- [x] Gate 2 — Synthetic fixtures, schemas, controlled sites — evidence: `DEV_LOG.md` G2-01/G2-02/G2-03; Zod contracts, fixture/hash validation, three live local form routes, idempotency, validation, and origin rejection verified.
- [x] Gate 3 — Eligibility and grounded preparation — evidence: `DEV_LOG.md` G3-01; controlled URL lookup, hard-requirement status, exact-role résumé selection, sourced answers, and human clarification are covered.
- [x] Gate 4 — Browser execution and verification — evidence: `DEV_LOG.md` G4-01; Playwright exercised all three local form families, read back values, uploaded verified résumé bytes, and blocked redirects/mutations without submission.
- [x] Gate 5 — Approval, submission, local persistence, recovery — evidence: `DEV_LOG.md` G5-01; live browser submission required allowlisted authenticated approval, exact revision check, append-only SQLite events, independent site record and confirmation UI, one-use idempotency, and restart reconciliation. GCS archive/replay remains mandatory at Gate 9 by user sequencing.
- [x] Gate 6 — Four skills, authenticated Telegram, approved controlled application and approved synthetic email send — G6-50. Real local Gemma read four skills and executed four tools; actual human approvals independently verified against site/Gmail and durable records. Evidence: `evidence/g6-model-execution.json`, `evidence/g6-human-telegram-confirmation.json`, `evidence/g6-human-email-confirmation.json`. Latest regression: 128 tests pass; earlier failures preserved.
- [x] Gate 7 — Policy matrix, persistent privacy state, native routing/served-model telemetry and live local outage/recovery pass (G7-05; `evidence/g7-live-routing.json`). Cloud branches explicitly use test doubles until mandatory real-provider checks in Gate 9.
- [x] Gate 8 — PASS (G8-13): six proactive components, native schedules with actual Telegram deliveries, durable preferences and alert dedup/restart; 155 tests pass. Imported Google Calendar events independently verified for exact conflict, slots and delivered preparation context. Evidence: `evidence/g8-calendar-completion.json`, `evidence/g8-native-delivery.json`, `evidence/g8-due-dedup.json`, `evidence/g8-runtime-restart.json`.
- [ ] Gate 9 — IN_PROGRESS; cloud manual-testing handoff verified (G9-30). Cloud assistant readiness200, Google reads, three browser forms, actual Luna and recovered Gemma routing, persisted records and active schedules verified. Laptop VPN conflict resolved by user. HTTPS/grader access, final deployed security/restart acceptance remain open; formal48h NOT_STARTED.
- [ ] Gate 10 — Formal 48-hour operation
- [ ] Gate 11 — Held-out evaluation and reports
- [ ] Gate 12 — ClawHub, video, packaging, final audit

## Product progress

- [x] Controlled job URL resolution, evidence-based eligibility, résumé selection, and grounded answers — `DEV_LOG.md` G3-01.
- [x] Synthetic candidate/resumé fixtures and schema validation — `DEV_LOG.md` G2-01.
- [x] Single-page, multi-step, conditional form filling, verified résumé upload, and independent value checks — `DEV_LOG.md` G4-01.
- [x] Authenticated approval bound to verified revision, safe idempotent controlled submission, independent confirmation, and local restart reconciliation — `DEV_LOG.md` G5-01.
- [ ] Durable GCS archive/replay — Gate 9.
- [x] OpenClaw `fill_application` invocation through a running Gateway — live authenticated HTTP calls, three controlled form families, SQLite state, unauthorized denial and zero submissions; G6-39.
- [ ] Email/calendar integrations, four OpenClaw skills, hybrid routing, proactive features, cloud deployment, 48-hour operation, evaluation, and submission package — Gates 6–12.

## Assignment requirement traceability

The detailed compulsory-requirement matrix and evidence plan are in Section 1 of `APPLYPILOT_PLAN.md`. The rubric and deliverable requirements are cross-checked against the five assignment PDFs. Remaining live-integration and deployment verification belongs to later gates.
