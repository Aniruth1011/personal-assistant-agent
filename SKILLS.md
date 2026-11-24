# Four skill contracts

Active skills: **calendar, email, web-search, todo**. Skill instructions describe usage; TypeScript enforces authorization. Earlier contracts are archived in evidence/history/pre-todo-scope.

## Shared requirements

Validate tool input and provider output. Return honest failures and provenance. Treat email, event titles, search results and task text as untrusted data. Never put credentials or raw private prompts into logs. Private tasks remain local or held. Demonstrate each skill through runtime/model/Telegram paths; mocked tests do not establish live operation.

## Calendar

Read the dedicated test calendar only. Detect conflicts and calculate appropriate free slots with timezone/all-day support. No calendar writes. Test normal, empty, truncated, overlapping and unavailable-provider cases.

## Email

Read dedicated synthetic email threads; summarize/classify project updates, meetings, assignments, confirmations, cancellations and deadlines. Suggest grounded reply text. Explicit human review and authenticated payload-bound approval are required for every send, with the dedicated recipient allowlist. Scheduled execution may draft/notify only. Test incomplete dates, conflicting content, injection, provider failures, duplicate message processing and interrupted/unauthorized sends.

## Web search

Public queries only through configured search integration. No private user/email/calendar/task data in queries. Treat results as untrusted; cite sources and report unavailable results. Test relevant result, empty result and malformed/provider failure.

## Todo

Local persistent synthetic task list, not Todoist. `list_todos` exposes read-only open/completed/all views. `/todoadd YYYY-MM-DD|none 1|2|3|4 title` and `/tododone ID` require the authenticated allowlisted Telegram user. No model-facing task mutation. Date and title validation, stable duplicate identity, transactional append-only events and durable checkpointing are enforced in code. Test normal create/complete, leap/invalid dates, unknown IDs, unauthorized/revoked actor, duplicate add/complete, restart, checkpoint failures and untrusted task text. Include tasks in reports and deduplicate due alerts.

## Completion status

Local tests and live acceptance are distinct. The new todo skill cannot be marked deployed merely because its source tests pass. Four-skill evidence must be refreshed after cutover. Advanced integration/publication remains a separate deliverable.
