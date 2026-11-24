# OPS-ROUTING-001: correction and live routing verification

The original 48-hour window and its evidence remain unchanged. Baseline routing files and manifest/result copies are preserved in evidence/routing-fix; baseline.json records hashes.

## Reproduction and correction

OpenClaw 2026.11.2 appends an unattended-run suffix containing “task” and “plan”. The former matches the private classifier and the latter can contaminate complexity classification. The regression using that exact native suffix failed against the original implementation (1 failed, 11 passed). Both probes were configured and executed as public-research according to the retained native run review, but the envelope can classify them private and persist session taint.

The correction removes only the exact pinned native suffix before classifying the request. It does not remove arbitrary instructions, clear session taint, change workspace authority, or bypass attachment/private checks. Unknown framework suffixes remain conservatively classified. This establishes a reproducible trigger, not a claim that every historical turn has been individually replayed.

Verification: root formatting, lint, typecheck, 94 tests and credential scan passed on rerun. Initial integration test failed because sandbox loopback listen was denied (EPERM); failure evidence is retained. Plugin 15 tests and TypeScript build passed. These are local results, not live provider evidence.

## Live acceptance update — 2026-11-16

Corrected image: sha256:e7cdaeb8fee94df39729e4829c80bbf6904df70ab77f23de2e6da375e642aad7. Direct and native scheduled reasoning now serve gpt-6-luna; simple and recovered private requests serve gemma4:e2b. Actual Ollama SIGSTOP outage held private work (providerStarted=false, zero served events) while public arithmetic completed through cloud. Ollama was restored in finally. Both permanent observation probes were rerun successfully with intended models. Cloud automation additionally required explicit existing OAuth profile binding; this has been applied to the recurring cloud probe without changing historical records.

Rate-limit simulation: scoped APPLYPILOT_SIMULATE_CLOUD_RATE_LIMIT=1 in a separate state using the deployed plugin and platform CLI completed on Gemma, reason cloud_rate_limit_local. The first --local attempt was refused because production state was owned by a running Gateway; an isolated configuration initially referenced missing main and was corrected. Failures preserved. Isolated runner initialization was slow and its empty tool allow list did not constrain prompt size (reported estimated43206 tokens against24576 budget). This run verifies the rate-limit route and response only; it is not a benchmark or proof of context preservation. Production routing paths retain their original restricted tool configuration.

Evidence: evidence/routing-fix/{simple,reasoning,private-held,public-offline,private-recovery,original-local-probe,original-cloud-probe,route-events,isolated-events}.json and rate-limit-rerun.txt. A scheduled failure receipt's default model field was not interpreted as served inference. Temporary probes were removed. Rollout startup took approximately ten minutes with event-loop stalls; state recovered, Google reads and both models subsequently passed. No new48h window was started. Comparative evaluation and publication were pending at the time; both completed later on 2026-11-16 (see reports/performance/COMPARISON.md and reports/operations/SKILL_PUBLICATION.md).

## OAuth renewal and evaluation update

Cloud OAuth was renewed after token_revoked during evaluation. Direct cloud inference succeeded, then the scheduled probe correctly refused a replaced account binding. Explicit rebinding followed by native cron rerun succeeded on gpt-6-luna (reauth-scheduled-cloud-rebound.json). The encrypted checkpoint succeeded before planned image replacement. The paired comparison has60original attempts plus12separate post-renewal checks, documented in reports/performance/COMPARISON.md. Original operational evidence remains unchanged.

## Final restart verification

Current deployed image: `sha256:0b42b1f0a78c188a3205764504bedbb80a6531d11ff5dcf1497dfb3309569e59`. This adds the OAuth-enabled generator to the pinned routing-correction image. Post-replacement startup verified restored state, dedicated Google reads, uid1000 with zero effective capabilities and no-new-privileges, actual gpt-6-luna and Gemma4 E2B, and HTTPS readiness at2026-11-16T20:48:43.763Z. The recurring cloud probe succeeded over authenticated HTTPS after restart (`oauth-restart-scheduled-cloud.json`), proving renewed account binding survived. Startup took approximately7minutes24seconds from restored state to full readiness; this occurred after the original formal window. Comparative evaluation is complete. Original skill publication and fresh-install helper execution are verified in `reports/operations/SKILL_PUBLICATION.md`.
