# Original skill publication — verified

Public location: https://clawhub.ai/aniruth1011/skills/assistant-todo-triage

Pinned registry identity: `@aniruth1011/assistant-todo-triage`, version **1.0.0**. ClawHub CLI0.26.0 published version ID `k97b9b3fdxnx5fm11jxxxmkv498jab7e`; the public page returned HTTP200 and registry inspection returned the owner, version and clean scan verdict.

The original package is `publication/assistant-todo-triage`. It validates and deterministically groups a local to-do snapshot into overdue, due-today, upcoming and undated tasks, ordered by due date, priority and ID. The dependency-free helper reads only; task mutation remains outside its authority. It preserves task titles as untrusted data. Source and Codex assistance are disclosed in PROCESS_LOG.md.

## Fresh installation and execution

A fresh OpenClaw2026.11.2 runtime was installed in a new temporary directory using Node24.22.1/npm11.9.0, with empty state and workspace and no copied assistant credentials. The skill was downloaded from ClawHub at1.0.0, not copied from its source folder. All three installed file hashes match the source manifest. OpenClaw lists the skill as eligible, enabled and unblocked. Running its installed helper against the included synthetic fixture exited0 and correctly returned four tasks: one completed, one overdue, one due today and one undated.

This is verified platform discovery plus execution of the installed skill helper; it is not a claim that a fresh agent independently selected it in an LLM conversation. No personal accounts or private task data were used.

Evidence under `evidence/publication`: `publish.json`, `registry-status-final.json`, `public-page-status.txt`, `fresh-manifest.json`, `fresh-runtime-install-rerun.txt`, `fresh-runtime-version.txt`, `fresh-skill-install-rerun.txt`, `fresh-hash-verification.json`, `fresh-openclaw-skills.json` and `fresh-run.json`. Behavioral checks cover empty/leap dates, invalid input, duplicates, deterministic ties, untrusted text, unchanged files, repeated execution and process restart. Repository verification under Node24.22.1 passed94tests, formatting, lint, typecheck and credential scan.

## Reproduction

```sh
clawhub --workdir FRESH_WORKSPACE install @aniruth1011/assistant-todo-triage --version 1.0.0
cd FRESH_WORKSPACE/skills/@aniruth1011/assistant-todo-triage
node scripts/triage.mjs fixtures/tasks.json 2026-11-16
```

Initial registry publication was pending and installation was blocked; those receipts are retained. Installation was retried only after the registry released the version. The initial host-toolchain lockfile failure and subsequent pinned-toolchain success are also preserved. The original48-hour operational evidence was not changed.
