# Remaining submission acceptance

Status as of 2026-11-19. Full item-by-item status with evidence: [IMPLEMENTATION_CHECKLIST.md](../../IMPLEMENTATION_CHECKLIST.md).

## Completed

- Four skills (email, calendar, web search, to-do) through the deployed runtime and Telegram, with tool/model receipts.
- Proactive features on the deployed runtime: scheduled briefing and recap, a fresh deadline alert with duplicate suppression, email intelligence, calendar conflicts and slots, and knowledge across restart.
- First 48-hour window: operational PASS. OPS-ROUTING-001 was disclosed and corrected.
- Corrected hybrid routing, including private outage hold and recovery.
- 60 paired cloud/local evaluation attempts plus 12 recovery checks.
- Original ClawHub skill 1.0.0 with fresh install and execution.
- Security audit with ten risks and three injection attempts (2026-11-17), re-run on the current image (2026-11-19).
- Grader access verified from a separate Tailscale account.
- README, personalization files, student-written PROCESS_LOG.md and demo video.

## Remaining at submission time

1. Done 2026-11-20: second window exported and reported (operational PASS; OPS-ROUTING-002 open). Steps were:
   - export its evidence with `scripts/operations/export-window-incremental.mjs`
   - render `reports/operations/FORMAL_48H_RESULT_SECOND.md`, including open defect OPS-ROUTING-002 (scheduled cloud probe)
   - update the README and checklist with the actual result
2. Build `aniruth_sundararajan_a3.zip` with `scripts/package-submission.mjs` (secret scan, forbidden-file check, hash manifest).
3. Submit the ZIP, the video and the private grader handoff through Brightspace.

## Known open items (documented, not fixed)

- OPS-ROUTING-002: scheduled cloud probe failing in the second window.
- Web search from the dashboard Main chat.
- Injection detector coverage, and SEC-INJ-003's unnecessary read-only tool call.
- Plugin dependency advisories.
- The tagged meeting-context path was not demonstrated live.

See README "Known limitations".
