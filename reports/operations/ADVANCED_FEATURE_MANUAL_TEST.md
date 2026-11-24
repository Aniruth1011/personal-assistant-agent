# Human acceptance of the advanced features

Use only the dedicated test account/calendar and fictional data. These steps are pending until actual results are recorded; they are not claims of completed demonstrations.

1. In Telegram, send `/remember project atlas Fictional demo agenda and test milestones`, then `/knowledge`. Repeat the remember command: it must retain the same revision. Change the wording explicitly: it must increment the revision.
2. Send `/remember style communication detailed`. A subsequent email digest should include requested action lines when present in source messages.
3. Send `/todoadd 2026-11-13 2 Prepare Atlas demo [duration:45m]`, then `/todos`. Repeat the add: it must return the same ID. Adapt the date if testing later. `/recap` plans tomorrow; `/calendarcheck` plans today. Outside working hours, no available slot is a correct result.
4. Send `/briefing`, `/emaildigest`, `/calendarcheck`, and `/recap`. Inspect actual source facts. The weather fallback says NWS forecast and explicitly reports unavailable current observations. Recap distinguishes processed messages, sent messages, and reports generated.
5. To demonstrate linked meeting preparation, manually create a fictional event in the dedicated test calendar with `[project:atlas]` in its description. Enter the exact times yourself; the assistant does not book it. Optionally create a second overlapping fictional event to test conflicts. `/calendarcheck` must cite the project fact revision and report the real overlap.
6. For email context, manually send a message to the dedicated test inbox with subject `Synthetic project update [project:atlas]` and body `Please review the fictional Atlas slides before the demo. [project:atlas]`. `/emaildigest` must summarize that actual request; calendar context must cite the email source when tags match. Reply suggestions must not claim the slides were reviewed. Do not approve a send unless you intend the exact displayed synthetic reply.
7. Wait for a scheduled deadline alert and inspect its native delivery record. A repeated poll must not resend the same alert. Morning briefing is scheduled at 08:00 and recap at 18:00 America/Los_Angeles; alerts poll every 30 minutes. A one-shot acceptance schedule can verify delivery without starting the formal 48-hour observation.
8. After the deployment restart test, `/knowledge` and `/todos` must retain the same facts, revision and task ID. Complete the returned task with `/tododone ID`; a repeat must not create another completion event. `/recap` should show its completion.

Tailscale HTTPS certificates must be enabled separately for private browser/grader access. Formal 48-hour observation still requires a separate explicit go-ahead after readiness.
