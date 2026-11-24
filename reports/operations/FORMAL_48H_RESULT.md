# Formal 48-hour operation: verified result

**Operational observation: PASS. Overall assignment: INCOMPLETE.**

Verified 2026-11-15T08:40:13.815255+00:00. Window: **2026-11-13 08:30:39.916 UTC to 2026-11-15 08:30:39.916 UTC** (November13–15, 00:30:39.916 PST). The original immutable start manifest remains unchanged.

| Check                                     | Actual result                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Duration                                  | 48 hours                                                                                |
| Durable health samples                    | 2,864                                                                                   |
| Independent logging reconciliation        | All2,864 GCS samples matched Cloud Logging timestamps                                   |
| Maximum sampling interval                 | 62.331 seconds, below declared180-second gap threshold                                  |
| Unhealthy samples / schema issues         | 0                                                                                       |
| Observed restarts / configuration changes | 0 / 0; one boot identity, one configuration hash                                        |
| Morning briefing                          | 2/2 successful and confirmed delivered                                                  |
| Evening recap                             | 2/2 successful and confirmed delivered                                                  |
| Alert polling                             | 96/96 successful; no new alerts, so delivery suppressed                                 |
| Encrypted checkpoints                     | 288/288 successful                                                                      |
| Scheduled model probes                    | 16/16 executed, but all used local Gemma                                                |
| Native background work                    | 96 heartbeat runs and2 memory-promotion runs successful                                 |
| Saved user data                           | One task and one learned fact retained; all five monitored memory-file hashes unchanged |

Evidence is under `evidence/formal-operation/`: `assessment-final.json`, `log-reconciliation.json`, `task-run-review.json`, `execution-summary.json`, `unique-runs.json`, `unique-routes.json`, `checksums.json` and all raw timestamped samples. `result.json` is the reviewed decision; the automated assessment intentionally stops at coverage complete until delivery/incident review is performed.

Native task-run detail records independently confirmed `delivered=true` for all four briefing/recap messages. Both briefings contained forecasts and the task; both recaps contained activity and the task. Report summaries did not show provider-unavailable markers. Job execution success is not a benchmark of answer quality. The fresh nonempty deadline alert was delivered before the window; this report does not reclassify it as an in-window alert.

## Open defect: OPS-ROUTING-001

The eight jobs named cloud probes were configured for public-research, but their actual native run records identify `ollama/gemma4:e2b`, not the cloud model. Captured routing telemetry contains private-local decisions. The classifier checks broad private markers and persistent taint; interaction with scheduled prompt/context needs a focused reproduction before assigning an exact root cause. No private-to-cloud leakage was observed. Do not count the job label as proof of cloud inference. Earlier actual cloud startup evidence remains valid for that earlier time, but does not establish cloud execution during this window.

This is a hybrid-routing acceptance defect, not an observed uptime failure. Fix and repeat the relevant scheduled routing demonstration before claiming the assignment complete. Do not rewrite historical logs or silently relabel these probes.

## Collection and limitations

Collected read-only using the reauthenticated project operator account. Downloaded selected immutable GCS objects with `gcloud storage cp -I`, assessed them with the existing coverage function, reconciled Cloud Logging metadata, then decrypted the existing native snapshot locally to inspect task receipts. Runtime code/configuration remained untouched. IAP SSH attempts failed after the window (backend port22 unavailable); no restart was attempted. Raw restored databases remain private under `.runtime/`, outside submission artifacts.

Health sampling cannot exclude a transient event between samples. Successful repeated Google reads demonstrate continuing provider access, but an explicit OAuth token-refresh event was not separately instrumented. Framework deep-audit and dependency findings remain separate from operational health. Evaluation, original-skill publication, final documentation, video and grader-account handoff remain submission work.
