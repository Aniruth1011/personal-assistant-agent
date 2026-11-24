import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stateFile = join(root, ".runtime/video-demo-plan.json");
const temp = mkdtempSync(join(tmpdir(), "applypilot-video-"));
const command = process.argv[2] ?? "status";
const record = (value) => {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
};
function rpc(method, params = {}) {
  const request = join(temp, "request.json");
  writeFileSync(request, JSON.stringify({ method, params }), { mode: 0o600 });
  return JSON.parse(
    execFileSync(
      process.execPath,
      [join(root, "scripts/evaluation/gateway-rpc.mjs"), request],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 250000,
        maxBuffer: 8 * 1024 * 1024,
      },
    ),
  );
}
const time = (date) =>
  new Date(date).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
function show(plan) {
  if (plan.startAt)
    console.log(`START ZOOM RECORDING AT ${time(plan.startAt)} Pacific`);
  for (const job of plan.jobs)
    console.log(
      `${job.label}: ${job.at ? time(job.at) + " Pacific" : "prepared, paused"}`,
    );
}
async function main() {
  if (command === "prepare") {
    if (existsSync(stateFile))
      throw Error(
        "A plan already exists; use status or cancel before changing it.",
      );
    const jobs = rpc("cron.list", { includeDisabled: true }).jobs;
    const source = (name) => {
      const job = jobs.find((j) => j.name === name);
      if (
        !job ||
        job.payload.kind !== "script" ||
        job.delivery?.channel !== "telegram" ||
        !job.delivery.to
      )
        throw Error(`SOURCE_JOB_INVALID: ${name}`);
      return job;
    };
    const briefing = source("ApplyPilot briefing");
    const recap = source("ApplyPilot recap");
    const reminder = {
      kind: "script",
      timeoutSeconds: 60,
      toolBudget: 1,
      toolsAllow: ["list_todos"],
      script:
        'const result = await list_todos({ status: "open" });\nconst task = result.tasks.find(t => t.id === "todo-c8425eab437f8275a2ca4920");\nif (!task || !task.dueDate) return {};\nreturn { notify: "Scheduled deadline reminder\\n" + task.title + "\\nDue: " + task.dueDate + "; priority P" + task.priority + "; status: " + task.status + ".\\nThis is the one-time video reminder for your saved task; no task was changed." };',
    };
    const specs = [
      {
        label: "Briefing",
        offset: 60,
        payload: briefing.payload,
        delivery: briefing.delivery,
      },
      {
        label: "Deadline reminder",
        offset: 270,
        payload: reminder,
        delivery: briefing.delivery,
      },
      {
        label: "Recap (simulated evening)",
        offset: 360,
        payload: recap.payload,
        delivery: recap.delivery,
      },
    ];
    const plan = { createdAt: new Date().toISOString(), jobs: [] };
    record(plan);
    for (const spec of specs) {
      const job = rpc("cron.add", {
        name: `Video ready — ${spec.label}`,
        agentId: "main",
        enabled: false,
        deleteAfterRun: false,
        schedule: {
          kind: "at",
          at: new Date(Date.now() + 86400000).toISOString(),
        },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: spec.payload,
        delivery: { ...spec.delivery, bestEffort: false },
      });
      plan.jobs.push({
        id: job.id,
        label: spec.label,
        offset: spec.offset,
        payload: spec.payload,
      });
      record(plan);
    }
    show(plan);
    return;
  }
  if (!existsSync(stateFile))
    throw Error("No prepared plan. Run prepare first.");
  const plan = JSON.parse(readFileSync(stateFile, "utf8"));
  if (command === "status") {
    const jobs = rpc("cron.list", { includeDisabled: true }).jobs;
    show(plan);
    for (const entry of plan.jobs) {
      const job = jobs.find((j) => j.id === entry.id);
      console.log(
        `${entry.label}: ${JSON.stringify({ enabled: job?.enabled, schedule: job?.schedule, state: job?.state })}`,
      );
    }
    return;
  }
  if (command === "cancel") {
    for (const entry of plan.jobs)
      rpc("cron.update", { id: entry.id, patch: { enabled: false } });
    delete plan.startAt;
    for (const entry of plan.jobs) delete entry.at;
    record(plan);
    console.log("Video jobs paused. Original recurring jobs unchanged.");
    return;
  }
  if (command === "preflight") {
    const jobs = rpc("cron.list", { includeDisabled: true }).jobs;
    const created = [];
    const base = Date.now() + 45000;
    for (const [i, entry] of plan.jobs.entries()) {
      const source = jobs.find((j) => j.id === entry.id);
      if (!source) throw Error("PREPARED_JOB_MISSING");
      const job = rpc("cron.add", {
        name: `Video preflight — ${entry.label}`,
        agentId: "main",
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "at", at: new Date(base + i * 45000).toISOString() },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: source.payload,
        delivery: source.delivery,
      });
      created.push({ id: job.id, label: entry.label, at: job.schedule.at });
    }
    writeFileSync(
      join(root, ".runtime/video-demo-preflight.json"),
      JSON.stringify(
        { createdAt: new Date().toISOString(), jobs: created },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    show({ jobs: created });
    return;
  }
  if (command !== "arm")
    throw Error("Use prepare, preflight, arm, status or cancel.");
  const current = rpc("cron.list", { includeDisabled: true }).jobs;
  if (
    plan.jobs.some(
      (entry) => current.find((job) => job.id === entry.id)?.enabled,
    )
  ) {
    console.log("A video schedule is already active; times were not changed.");
    show(plan);
    return;
  }
  const local = await fetch("http://127.0.0.1:11434/api/tags", {
    signal: AbortSignal.timeout(5000),
  });
  if (
    !local.ok ||
    !(await local.json()).models?.some((model) => model.name === "gemma4:e2b")
  )
    throw Error("Start Ollama with gemma4:e2b before arming.");
  for (const entry of plan.jobs) {
    const job = current.find((j) => j.id === entry.id);
    if (
      !job ||
      !isDeepStrictEqual(job.payload, entry.payload) ||
      job.delivery?.channel !== "telegram" ||
      !job.delivery.to
    )
      throw Error("Prepared job was changed. Stop and verify it.");
  }
  const config = JSON.parse(
    readFileSync(join(root, ".runtime/state/openclaw.json"), "utf8"),
  );
  const gateway = readFileSync(
    join(root, ".runtime/advanced-cloud-url"),
    "utf8",
  ).trim();
  const response = await fetch(gateway + "/tools/invoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.gateway.auth.token}`,
    },
    body: JSON.stringify({ tool: "list_todos", args: { status: "open" } }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (
    !response.ok ||
    !result.result?.details?.tasks?.some(
      (task) => task.id === "todo-c8425eab437f8275a2ca4920" && task.dueDate,
    )
  )
    throw Error(
      "The saved video task is not open; reminder would be empty. Stop and inspect it.",
    );
  const start = Date.now() + 60000;
  plan.startAt = new Date(start).toISOString();
  try {
    for (const entry of plan.jobs) {
      entry.at = new Date(start + entry.offset * 1000).toISOString();
      const updated = rpc("cron.update", {
        id: entry.id,
        patch: { enabled: true, schedule: { kind: "at", at: entry.at } },
      });
      if (!updated.enabled || updated.schedule.at !== entry.at)
        throw Error("VIDEO_SCHEDULE_VERIFY_FAILED");
    }
    record(plan);
  } catch (error) {
    for (const entry of plan.jobs) {
      try {
        rpc("cron.update", { id: entry.id, patch: { enabled: false } });
      } catch {
        /* Report original failure; inspect status. */
      }
    }
    throw error;
  }
  console.log(
    "READY. All three one-time jobs are armed and verified. No task command is needed.",
  );
  show(plan);
  console.log(
    "During recording: identity/version; local request; cloud request; stop Ollama/private held; restart/private recovery; routing log/ollama ps; Telegram greeting. Show arriving briefing/reminder/recap. The recap runs at simulated evening timing.",
  );
}
try {
  await main();
} finally {
  rmSync(temp, { recursive: true, force: true });
}
