# Manual testing after scope cutover

Do not use this checklist as proof that the new source is deployed. First verify the image/config and exactly one Telegram consumer. Formal 48-hour observation requires separate approval.

1. Send `/todos`: inspect actual open tasks.
2. Send `/todoadd 2026-12-01 2 Prepare fictional demo slides`; note returned ID. Repeat exactly; verify one task, not two.
3. Send `/tododone ID`; repeat; verify one completion event and completed status in `/todos all`.
4. Invalid date `/todoadd 2026-02-30 2 Invalid demo` must create no task. Unauthorized sender must change no state.
5. Ask naturally for your open tasks; verify the model calls list_todos and reports persisted facts.
6. Trigger briefing/recap and scheduled due alerts with controlled clock/data. Verify task content, deduplication and actual Telegram delivery separately.
7. Verify dedicated email/calendar reads, reviewed synthetic email sending, public web search, actual cloud/local routing and private outage hold.
8. Restart the new deployment: verify task/preferences/history and scheduler continuity; no duplicate task or send.
9. Verify private grader access and record sanitized evidence before readiness sign-off.
