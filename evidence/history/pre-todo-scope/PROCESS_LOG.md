# AI-assisted development process log

ApplyPilot is in progress. OpenAI Codex (GPT-6 family; exact served model identifier unavailable) assisted planning, implementation, test authoring, and documentation under `AGENTS.md` and `SKILLS.md`. Generated code was checked against actual command output, browser state, SQLite records, provider responses, and OpenClaw plugin validation.

Gate 0 reviewed the five Assignment 3 PDFs and recorded requirements. Gate 1 checked OpenClaw 2026.11.2, Node 24.22.1, the TypeScript plugin/model hook, and local Gemma 4 E2B through Ollama. Cloud-model authentication, Cloud Run, GCS, and Tailscale are deferred to Gate 9 by user direction. Gates 2–5 implemented synthetic fixtures and forms, eligibility and grounded answers, Playwright fill/readback, transactional application state, revision-bound human approval, controlled submission, confirmation, and restart reconciliation.

Gate 6 added four OpenClaw skills, synthetic job discovery, Gmail read/classification/deduplication and draft-only replies, Calendar read-only listing, and native web search. Gateway calls verified email classification/drafting, web search, and an empty test-calendar response. Gmail and Calendar OAuth validate with Gmail and Calendar read-only scopes. In this session Codex added `fill_application`, its typed plugin contract, a ready synthetic job fixture, and controlled-browser tests. Playwright filled and read back three form families, persisted `AWAITING_APPROVAL`, and observed zero submissions. Unsupported facts, external origins, and an unavailable server were handled safely. Node 24.22.1 verification passed formatting, lint, types, 15 test files / 118 tests, and secret scanning; the plugin suite passed 34/34 and OpenClaw plugin validation passed.

The new tool has not yet been invoked through a running Gateway. Telegram setup remains pending. Authenticated email sending also remains open in Gate 6. GCS archive/replay, cloud inference, Cloud Run, Tailscale, formal 48-hour operation, evaluation results, grader access, and final submission are not claimed. No real-employer application was submitted. AI tools cannot establish those live-resource outcomes without the configured services and collected evidence.

## Material prompts and attribution

- User: “Implement the plan”; generated scaffold, deterministic policy, controlled sites, browser and persistence modules.
- User: “test, it . do everythong to fix it”; drove failure cases and verification.
- User: “update scopes ... based on what you read ... finish the entire process ... with appropriate logs”; GPT-6 Astra aligned scope to the rubric and restored a separate local Gateway host.
- `src/applications/`, `src/browser/`, `src/persistence/`, `src/integrations/`, `src/plugin/src/`: initial implementation and test drafts by Codex (earlier exact served model unknown), revised through recorded failures.
- `scripts/local-gateway.mjs`, `scripts/check-live-gateway.mjs`: drafted by Codex/GPT-6 Astra for authenticated startup and live form checks.
- Local Gemma 4 E2B was used for runtime inference/tool-call probes; it did not author these source modules.

## Verification and limitations

DEV_LOG.md and evidence/ distinguish unit/mocked checks, actual provider calls, Gateway HTTP invocation and model-driven agent runs. Browser assertions compare DOM values and authoritative site records; SQLite is inspected independently. Final rubric evidence and reports are still incomplete.

## Student learning reflection — pending

The student must provide 2–3 sentences in their own voice explaining what they personally learned and what AI tools could not determine. This reflection is not fabricated by the coding agent.

### Additional implementation attribution — 2026-11-12

Following the user prompts “finish 6,7,8,9” and “do next steps,” Codex generated
the native Telegram application/email review handlers, approved-email SQLite
outbox, host-generated audit IDs, runtime setup changes, and regression tests.
Actual application approval came from the human through Telegram and was checked
against independent site and SQLite records. Email-provider tests are explicitly
mocked until a separate real send approval is observed. Failed model tool-use
probes were retained; successful runs were checked against stored tool-result
transcripts rather than the model's claims.

### Gate 8 implementation attribution

Codex generated the deterministic assistant report, Temporal calendar analysis,
weather validation, constrained preference storage and authenticated commands,
native automation scripts, and associated tests. Material instruction: complete
Gates 7–9 sequentially, retain every safety gate, and defer the formal 48-hour
window. Verification used actual Gateway tool responses, Gmail/calendar reads,
weather responses, and native scheduler Telegram delivery acknowledgements.
Mocked-provider tests cover failures and pagination; they are distinct from live
integration evidence. Earlier lint failure and report-display/past-slot defects
were preserved in DEV_LOG with fixes and reruns. Live calendar conflict evidence
cannot be inferred from an empty provider response. This entry attributes work;
it does not substitute for the student's own final learning reflection.
