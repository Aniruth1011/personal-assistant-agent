# Dashboard rehearsal routing correction

The exact assignment prompt “Explain step by step why the sky is blue” was classified as short and served by Gemma even in a fresh public-research dashboard session. The reasoning classifier recognized words such as compare and analyze but omitted step-by-step phrasing. This was a genuine demo failure.

An initial inference that the dashboard session was private was incorrect: the inspected private_local_only log rows were not correlated to that request. A narrowly scoped diagnostic of the real human browser request confirmed agentId=public-research, tainted=false, attachments=false, and the plain question in both routing hooks. No privacy classification defect was established. The original diagnostic and failed transcripts are preserved; no taint was cleared.

The correction adds spaced and hyphenated step-by-step reasoning recognition. A regression failed against the original policy, then passed with the change. Private markers, persistent taint, attachments and private-workspace protection still take precedence. Root verification passes100tests plus format/lint/typecheck/secret scan; plugin19tests and build pass.

A temporary compiled-policy update was loaded with supported native plugin reload after removing the diagnostic router-hook override. An authenticated Control UI protocol chat.send probe of the exact sky question returned actual openai/gpt-6-luna. This is a synthetic dashboard-protocol integration probe, not a claim of a new human browser test. Simple-task verification returned108 on gemma4:e2b. Immutable image sha256:bb67eb5a42942b44e8a2f28871a70673a05b4549b307310fb03bbbd98adcb1b5 was deployed. Startup passed state restore, isolation, Google reads, actual cloud/local models and HTTPS readiness at2026-11-17T00:14:56.719Z. Both exact prompts were repeated successfully after restart through authenticated Control UI protocol: sky → gpt-6-luna, multiplication → gemma4:e2b/108. Human browser rehearsal can now resume.

The original48-hour observation remains unchanged. This correction is subsequent incident evidence, not a restarted formal window.

Human browser rehearsal passed: the user repeated the sky question in the same public-research dashboard session after deployment. Actual assistant transcript identifies openai/gpt-6-luna and a complete answer. Evidence: evidence/telegram-fix/dashboard-human-cloud-pass.json.
