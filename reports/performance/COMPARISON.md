# Cloud/local deployed-agent comparison

Run: `paired-20261116`. Raw records and summary: `evidence/evaluation/paired-20261116`.

Thirty synthetic cases across three types were each attempted on both routes (60 turns). Identical user prompts and expected labels were fixed before execution. Arm order alternated. The initial OpenAI OAuth account was revoked partway through; execution paused and resumed after user reauthentication with the user-selected login. The stored profile ID remained unchanged; an account identity change was not independently established. See blocker.json and resumption.json for the boundary. This is not an uninterrupted experiment. Each request used a fresh session and idempotency key, disabled delivery, and requested no tools. Failures are retained; there are no silent retries.

| Type                   | Route | Completed / attempted | Content correct | Strict JSON + correct | Field accuracy | Median ms | P95 ms |
| ---------------------- | ----- | --------------------: | --------------: | --------------------: | -------------: | --------: | -----: |
| bulletin_extraction    | local |                 10/10 |              10 |                     0 |         100.0% |    9255.0 |  15158 |
| bulletin_extraction    | cloud |                  9/10 |               9 |                     9 |          90.0% |      5601 |  29671 |
| schedule_gap_reasoning | local |                 10/10 |               9 |                     0 |          90.0% |   10431.0 |  13073 |
| schedule_gap_reasoning | cloud |                  8/10 |               8 |                     8 |          80.0% |    4552.5 |  13635 |
| work_prioritization    | local |                 10/10 |               0 |                     0 |           0.0% |   11142.0 |  25301 |
| work_prioritization    | cloud |                  7/10 |               2 |                     2 |          20.0% |      5202 |  22590 |

## Method and interpretation

This compares actual deployed assistant paths, not isolated model capability. Local requests use the private main agent and cloud requests use public-research. Their system prompts, tool inventories and workspace contexts differ; these are confounders in model-only latency/quality claims. All evaluation inputs are fictional public data. User input is identical across arms. The privacy boundary is not bypassed to send private assistant context to cloud.

Task types: extracting corrected facts from public bulletin text; finding the earliest valid schedule gap; ranking work by explicit due-date/priority rules. Exact labels are deterministic. After inspecting the first responses, scoring was split into strict JSON compliance and JSON-fence-normalized content/schema correctness; this was applied uniformly to both models, without changing prompts or labels. Content/schema scoring accepts a whole-response JSON code fence but still requires the requested keys; a correct ordering under different keys fails this contract and does not by itself establish wrong reasoning; strict scoring requires plain JSON and exact expected content. Extra prose, invalid JSON and wrong values fail. This is a small templated benchmark and does not establish general summarization quality, arbitrary calendar competence, or tool integration reliability.

Completion requires a successful transport result, nonempty reply and actual expected served model (Gemma4 E2B or gpt-6-luna). Latency is client wall time including gateway connection, admission, model generation and response transfer. Median/P95 use successful attempts; failed attempts remain in denominators and raw records. Native agent durations and usage are retained. Cold/warm cache states were not controlled; do not generalize these numbers to intrinsic model speed.

## Cost

OAuth catalog estimates in native receipts are estimates, not bills or proof of per-request charges. ChatGPT workspace entitlement and actual monetary billing were not independently measured. Local inference has no provider API charge; hardware depreciation/electricity are not measured. Both paths share Cloud Run, storage and network costs, which this run does not allocate per request. Native input/output/cache token counts and any reported cost estimates remain in summary.json. No invented price or actual-cost claim is made.

## Routing correctness and failure evidence

Dedicated routing demonstrations are in reports/operations/ROUTING_FIX_STATUS.md and evidence/routing-fix. They show direct/scheduled cloud reasoning, local simple/private work, private outage hold with zero served events, public outage cloud completion, private recovery and a scoped rate-limit fallback. The comparison itself uses host-selected private/public contexts and confirms actual served models; it does not replace those routing tests.

| Route | Native catalog estimate total USD | Mean input tokens | Mean output tokens |
| ----- | --------------------------------: | ----------------: | -----------------: |
| local |                                 0 |            1368.4 |              643.9 |
| cloud |              0.008249600000000001 |            3255.8 |               23.5 |

These token totals reflect different system contexts as well as identical user inputs. Catalog sums exclude failed attempts lacking usage receipts and are not actual billed totals.
Failed attempts: extract-06/cloud, gap-05/cloud, gap-06/cloud, priority-00/cloud, priority-05/cloud, priority-06/cloud.

## Reproduction

Install pinned repository dependencies and OpenClaw2026.11.2 under .runtime/host, configure the existing authorized maintenance client at .runtime/state/openclaw.json and the authenticated HTTPS endpoint in .runtime/advanced-cloud-url. Keep these private. Run from repository root:

```sh
python3 scripts/evaluation/run.py NEW-RUN-ID
python3 scripts/evaluation/summarize.py NEW-RUN-ID
python3 scripts/evaluation/report.py NEW-RUN-ID
```

Use a new run ID for a new experiment; resume skips retained records. Never replace failed records to improve reported scores. The transport imports version-pinned internal Gateway client modules, so an OpenClaw upgrade requires revalidation.

## Separate post-reauthentication paired checks

All six cases affected by transport/authentication failure were rerun on both models under run reauth-paired-20261116. All 12 completed on the expected models. These checks do not replace the original scores. Renewed OAuth and enabled provider plugin are a configuration boundary; cache/load also differ.

| Type                   | Route | Completed | Content/schema correct | Median ms | P95 ms |
| ---------------------- | ----- | --------: | ---------------------: | --------: | -----: |
| bulletin_extraction    | local |       1/1 |                      1 |      7380 |   7380 |
| bulletin_extraction    | cloud |       1/1 |                      1 |      5445 |   5445 |
| schedule_gap_reasoning | local |       2/2 |                      2 |   11873.0 |  13148 |
| schedule_gap_reasoning | cloud |       2/2 |                      2 |   17518.0 |  25591 |
| work_prioritization    | local |       3/3 |                      0 |     10841 |  16386 |
| work_prioritization    | cloud |       3/3 |                      1 |      6407 |   7771 |

Manual review of original prioritization replies found the intended C/B/A sequence in all 17 nonempty replies, including replies with alternate keys. This is a descriptive review, not a replacement for the fixed schema score. The wording “key order” may have been read as object-key ordering; a future benchmark should give an explicit JSON schema. No prompts were changed during this run.
