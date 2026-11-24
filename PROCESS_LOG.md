# AI TOOLS USED

- **OpenAI Codex** — primary development agent for most of the project (exact model identifier was not exposed by the tool).
- **Claude Code (Claude Opus 5.5, `claude-opus-5-5`)** — 2026-11-17/18: review of the interrupted Codex candidate, gap fixes, requirement re-audit.
- **Gemma 4 E2B via Ollama** — runtime local model only; not used to write code.
  -** Chatgpt Web - I used it to make AGENT and SKILLS.md

# DEVELOPMENT NARRATIVE

1. Scoping the assignment and planning the assignment : I first started with ChatGPT Codex Plan Mode - Where I prompted it to refer all the Assignment description pdfs and supplementary documents to make a full scoped step by step plan. After That, I reviewed the plan steps to ensure it scoped out the Assignment Requirements. I also shared the plan with Chatgpt Web to make a AGENTS and SKILLS.md
2. I set up the environment for thr project by initializing Typescript, Vitest, ESLint. Then I installed openclaw 2026.11.2 and also installed Ollama to serve gemma 4 e2b.
3. Next I worked on integrating gmail. I installed Gog CLI and connected a dedicated synthetic Gmail account using Google OAuth. I made a fictional email to test the integration. the OAuth configuration and consent, I implemented read-only thread listing, message retrieval, deterministic classification, and durable deduplication. one thing i observed was that the model sometimes described a tool call without actually executing it. In another case, OpenClaw rejected the call because the tool-dispatch wrapper used the wrong argument structure. I then fixed the dispatch implementation, corrected the tool arguments, and verified execution through Gateway receipts and plugin audit events.
4. Next I worked on integrating google calendar and web search. I implemented a Google Calendar adapter using the dedicated test account and a separate synthetic calendar. I faced intial integration issues because I had not given Calendar permissions, After adding read-only Calendar consent, the API still returned HTTP 403 because Google Calendar API was disabled in the associated project. After enabling the API, I encountered another problem: the Gog command name and field-filter placement did not match my original implementation. So I checked the installed CLI documentation and corrected the command structure.
5. Next, I integrated Telegram and human approbal. I created a Telegram bot and configured an explicit numeric sender allowlist. I restricted the bot to the authenticated test user rather than allowing unrestricted messages. I implemented authenticated commands for reviewing application details, approving actions, managing tasks, checking status, and reviewing email drafts. For email sending, I implemented a outbox with approval expiry, content hashes, and single-use authorization. I observed that a single telegram response was not enough to prove that an email had to be sent. So I told Codex to verify that the gmail had been sent with the persisted output.
6. NExt I went to implement Advanced Assistant features - I prompted codex to implement proactive briefings, evening recaps, calendar conflict detection, available meeting slots, task reminders, weather reports, email summaries, and persistent knowledge - all wrt the constraints as given in the Description pdf. I told it to use Sqlite for structured state and maintained workspace knowledge files for the assistant's saved context.
7. Coming to Hybrid model routing , I instructed Codex to keep private tasks on local Gemma and use the cloud model for other reasoning tasks. The routing decision is done using semantics and prompt length. If semantically it points to confidentiality or the prompt length is too less, it decides to route to Gemma, otherwise cloud model for which I used Gpt Luna.
8. Deploying to Google Cloud Run Instances , for this, I configured a Google Cloud project, Artifact Registry, Secret Manager, Cloud Storage, and a dedicated runtime service account.
   I built a Linux container containing the assistant and its required dependencies. I configured Tailscale so the cloud-hosted assistant could access the local Gemma server without exposing Ollama publicly.
9. next i implemented Persistent State and Recovery for the for native assistant state and SQLite databases. the goal was to preserve tasks, knowledge, schedule and other required state across Cloud Run Instance replacements.
10. Next, the 48 hour operational test, After the cloud assistant was ready, I started the formal 48-hour observation period from November 13 to November 15, 2026. I did period monitoring for health, outcomes and activity. the system observed collected 2,864 samples. On observation, I didnt find any unhealthy samples, no monitoring gaps exceeding the configured threshold, and no configuration drift during the window. However, out of the 2864, there were 8 cloud labelled probes that had actually been executed on gemma instead of cloud.
11. I then made a paired evaluation with 30 synthetic test cases, executed against both local Gemma and the cloud model. I measured completion, content correctness, strict output-format compliance, and successful-turn latency. The two models sometimes produced different output structures even when their answers contained similar information. Some cloud requests also failed because of authentication or transport problems. I resolved it by asking codex to fix the failed attempts , renewed the supported OAuth authorization, and ran separately identified supplemental cases rather than overwriting the original results.
12. Openclaw skill : I built a stand alone to do triage skill with a a deterministic helper for organizing tasks. I tested its handling of priorities, dates, duplicates, invalid inputs, and stable ordering. I then published it to Clawhub.
13. Security : I checked the assistant's security boundaries, like authentication, private-model routing, email approval, external-content handling, and persistence. I made some synthetic malicious documents with instructions to override policy, forge email approval, and poison stored memory. My Observation is that the assistant did not always explicitly identify malicious text as an attack. However, the tested operations did not perform unauthorized sends or protected-state mutations. I verified by comparing protected SQLite tables before and after the tests, inspected actual model tool calls, and tested authorization failures.
14. End to end Testing : I did trials with Live Telegram and the dashboard for to-do management, Gmail, Calendar, web search, model routing, private-model outages, and recovery. I faced some initial issues because Gemma repeated previous conversation content, omitted tool calls, or produced an incorrect time conversion. I told Codex to check them out using the conversation history and tool receipt, and then revised the request-dispatch and report-rendering behavior. I also discovered that background heartbeat activity could interfere with demonstration conversations, so I disabled heartbeats while preserving scheduled briefing, recap, and reminder jobs.

# AI generated code attribution

- `src/router/policy.ts`, `src/plugin/src/router-hooks.ts` — hybrid privacy/complexity routing scaffold
  generated by Codex; I chose the "private tasks stay local or are held, never cloud" policy.
  Scheduler-envelope fix (OPS-ROUTING-001) generated by Codex after I found that scheduled cloud probes were
  running on Gemma. Sticky held decisions, observed/simulated rate-limit labels and public-message delegation
  added by Claude Code.
- `src/plugin/src/index.ts`, `read-request-hooks.ts`, `todo-commands.ts`, `email-commands.ts` — tools, intent
  handling and authenticated Telegram commands generated by Codex; the guard that keeps private requests out
  of web search added by Claude Code. Single-use human approval for email sends was my requirement.
- `src/tasks/store.ts` and to-do commands — generated by Codex after I replaced the job-application workflow
  with a to-do list as the fourth skill.
- `src/integrations/*`, `src/scheduler/*`, `src/knowledge/store.ts` — email/calendar/weather adapters,
  briefing, recap, alerts and memory generated by Codex; NWS weather fallback added after my live tests showed
  Open-Meteo failing from the cloud.
- `src/persistence/*`, `deploy/*` — SQLite persistence, GCS snapshots and container startup generated by
  Codex; snapshot selection rework by Claude Code. Deployment failures were debugged together and are kept in
  DEV_LOG.
- `scripts/evaluation/*` — cloud/local evaluation runner and scoring generated by Codex.
- `publication/assistant-todo-triage` — ClawHub skill generated by Codex; published under my ClawHub account.
- `scripts/operations/export-window-incremental.mjs`, `write-window-report.mjs` — second 48-hour window
  export and report generated by Claude Code; a job-tally ordering bug was found and fixed during review.
- `scripts/operations/rerun-injection.mjs` — re-run of the three prompt-injection attacks generated by Claude
  Code, with slow pacing and stop-on-anomaly added at my request so the live 48-hour run was not disturbed.
- `scripts/package-submission.mjs` — submission ZIP builder with secret and forbidden-file checks generated
  by Claude Code.

# Verification Narrative

- For verification, every change I did ran via `npm run verify`. This was a minimum working requirement.
- For skills in telegram, I tested email, calendar, web search and to-dos by messaging the bot from telegram. I checked the replies against the dedicated synthetic mailbox, calendar and task list, not just whether the bot answered.
- For routing, I verified using the route logs for the model that actually served each request. Like this, during my first 48 hr run, I found that some scheduled "cloud" probes were really running on local Gemma, because
  scheduler boilerplate tripped the privacy classifier (OPS-ROUTING-001). I fixed it, re-ran it.
- Regarding private task policy, I stopped Ollama on my laptop purposefully. I observed private requests being held and
  not sent to the cloud, while public ones still got answers.
- for the proactive features, I observed the scheduled briefing, recap, alerts and checkpoints arrive in
  Telegram. Live testing showed the weather API failing from the cloud, as it was working with the morning briefing, but not when asked independently, so it was fixed, and a National Weather Service fallback was added and re-tested.
- For security, I tried 3 prompt-injection attacks on the deployed agent and compared tasks, memory and
  the email outbox before and after. I repeated them on the new image on 2026-11-19, slowly, so the live run
  was not disturbed. Nothing changed. The 3rd attack caused an unnecessary read-only tool call, but the final output was still unchanged and no harm was done.
- For grader access, I checked using my phone with second account. It opened in Safari with no token prompt but not in Brave, so I added that to the grader instructions.
- While Reviewing Codex and Claudes output, I found some system/semantic mistakes of AI , such as - "find emails from …" would have gone to public web search - a home address was classified as public - a held run could be relaxed between hooks - a missing USER.md would have crashed a fresh container - the README told graders to use Telegram-only slash commands - the report script mislabelled finished jobs as running - the ZIP script ignored its output path
  I fixed each one of them.
- AI Credits - After my first 48 hr run, right before submission, My USC ChatGPT Edu account ran out of quota. Everything up to and including the first 48-hour
  window and the evaluation used the USC account. To keep the deployment running, I re-authenticated it with
  my personal ChatGPT Plus account through the same OpenClaw OAuth login; the final demo video, the second
  48-hour window and grading use my personal account. No API key was added, and I disclose the change in the README.

# WHAT I LEARNED

- One thing I learnt that AI cant do well is good judgement so as to what works. So, while developing the project, there were cases when the router routed by only to local model and to the cloud, and as per the policy, it was not wrong. So Codex kept telling that the router worked, but that was not the intended outcome, So I took the call to fix the router implementation.
- When building hybrid systems, we will need to ensure the router works efficiently, as improper routing might cause latency or undesired outcomes.
- When working on a model with a quota, we must keep monitoring it, as IT might fail any time.
