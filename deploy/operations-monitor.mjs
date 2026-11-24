import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GcsObjects } from "../src/persistence/cloud-archive.ts";

export const sha = (value) => createHash("sha256").update(value).digest("hex");
const pick = (value, names) =>
  Object.fromEntries(
    names.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]),
  );
export function sanitizeRoute(row) {
  const event = JSON.parse(String(row.event_json));
  return {
    seq: Number(row.seq),
    ...pick(event, [
      "at",
      "kind",
      "id",
      "sessionHash",
      "target",
      "reason",
      "privacy",
      "selectedModel",
      "provider",
      "model",
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "outcome",
      "durationMs",
    ]),
    ...(event.task
      ? {
          task: pick(event.task, [
            "privacy",
            "complexity",
            "localAvailable",
            "cloudAvailable",
            "cloudRateLimited",
          ]),
        }
      : {}),
  };
}
function readDb(path, work) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=1000");
    return work(db);
  } finally {
    db.close();
  }
}
export function inspectState(root, routeCursor = 0, now = Date.now()) {
  const issues = [],
    result = {
      issues,
      routes: [],
      routeCursor,
      routeBacklog: false,
      memoryHashes: {},
    };
  const attempt = (code, work) => {
    try {
      work();
    } catch {
      issues.push(code);
    }
  };
  attempt("assistant_database_unavailable", () =>
    readDb(join(root, "state/assistant.sqlite"), (db) => {
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((r) => r.name),
      );
      result.counts = {};
      for (const table of [
        "todos",
        "todo_events",
        "knowledge_facts",
        "knowledge_events",
        "assistant_email_context",
        "assistant_report_runs",
        "assistant_alerts",
        "email_outbox_events",
      ]) {
        if (tables.has(table))
          result.counts[table] = Number(
            db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
          );
      }
      if (tables.has("email_outbox"))
        result.outbox = db
          .prepare(
            "SELECT status,COUNT(*) AS count FROM email_outbox GROUP BY status",
          )
          .all();
      if (tables.has("route_events")) {
        const maximum = Number(
          db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM route_events").get()
            .n,
        );
        result.routeRollback = maximum < routeCursor;
        const rows = db
          .prepare(
            "SELECT seq,event_json FROM route_events WHERE seq>? ORDER BY seq LIMIT 500",
          )
          .all(result.routeRollback ? 0 : routeCursor);
        result.routes = rows.map(sanitizeRoute);
        result.routeCursor = rows.length
          ? Number(rows.at(-1).seq)
          : result.routeRollback
            ? 0
            : routeCursor;
        result.routeBacklog = maximum > result.routeCursor;
      }
    }),
  );
  attempt("scheduler_database_unavailable", () =>
    readDb(join(root, "state/state/openclaw.sqlite"), (db) => {
      result.jobs = db
        .prepare(
          "SELECT job_id,declaration_key,enabled,state_json FROM cron_jobs WHERE declaration_key LIKE 'applypilot-%'",
        )
        .all()
        .map((row) => ({
          id: row.job_id,
          declarationKey: row.declaration_key,
          enabled: row.enabled === 1,
          ...pick(JSON.parse(row.state_json), [
            "nextRunAtMs",
            "runningAtMs",
            "lastRunAtMs",
            "lastRunStatus",
            "lastStatus",
            "lastDurationMs",
            "lastDelivered",
            "lastDeliveryStatus",
            "consecutiveErrors",
          ]),
        }));
      result.runs = db
        .prepare(
          "SELECT receipt_id,job_id,status,started_at_ms,finished_at_ms,delivery_attempt_state,error_text IS NOT NULL AS has_error FROM cron_run_receipts WHERE started_at_ms>=? ORDER BY started_at_ms DESC LIMIT 1000",
        )
        .all(now - 72 * 3600000);
      result.deliveryQueue = db
        .prepare(
          "SELECT status,COUNT(*) AS count FROM delivery_queue_entries GROUP BY status",
        )
        .all();
    }),
  );
  result.messages = {};
  for (const agent of ["main", "public-research"])
    attempt(`transcript_${agent}_unavailable`, () =>
      readDb(
        join(root, `state/agents/${agent}/agent/openclaw-agent.sqlite`),
        (db) => {
          result.messages[agent] = db
            .prepare(
              "SELECT message_role AS role,COUNT(*) AS count,MAX(created_at) AS latestAt FROM transcript_events GROUP BY message_role",
            )
            .all();
        },
      ),
    );
  for (const name of [
    "SOUL.md",
    "USER.md",
    "IDENTITY.md",
    "MEMORY.md",
    "KNOWLEDGE.md",
  ])
    attempt(`workspace_${name}_unavailable`, () => {
      result.memoryHashes[name] = sha(
        readFileSync(join(root, "workspace", name)),
      );
    });
  attempt("config_unavailable", () => {
    const bytes = readFileSync(join(root, "state/openclaw.json"));
    result.configHash = sha(bytes);
  });
  return result;
}
async function health(fetcher, url, model = false) {
  try {
    const r = await fetcher(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    const body = await r.json();
    return {
      http: r.status,
      ok:
        r.ok &&
        (model
          ? body.models?.some((m) => m.name === "gemma4:e2b") === true
          : body.ready === true || body.status === "ready"),
    };
  } catch {
    return { http: null, ok: false };
  }
}
export async function publishSample(objects, name, sample) {
  const bytes = Buffer.from(JSON.stringify(sample));
  try {
    await objects.create(name, bytes);
  } catch (e) {
    if (Number(e?.code) !== 412) throw e;
  }
  if (!(await objects.read(name)).equals(bytes))
    throw Error("OPERATIONS_READBACK_MISMATCH");
}
export async function runMonitor({
  root = process.env.APPLYPILOT_RUNTIME_ROOT ?? "/data/runtime",
  bucket = process.env.APPLYPILOT_GCS_BUCKET,
  intervalMs = 60000,
  fetcher = fetch,
  objects,
  emit = (value) => console.log(JSON.stringify(value)),
} = {}) {
  if (!bucket && !objects) throw Error("OPERATIONS_BUCKET_REQUIRED");
  objects ??= new GcsObjects(bucket);
  const bootId = randomUUID(),
    bootAt = new Date().toISOString();
  let routeCursor = 0,
    stopped = false,
    timer;
  emit({
    event: "operations.started",
    at: bootAt,
    bootId,
    intervalMs,
    formalWindow: "NOT_STARTED_BY_MONITOR",
  });
  const tick = async () => {
    const at = new Date().toISOString();
    try {
      const state = inspectState(root, routeCursor);
      const checks = await Promise.all([
        health(fetcher, "http://127.0.0.1:19877/readyz"),
        health(fetcher, "http://127.0.0.1:8080/healthz"),
        health(fetcher, "http://127.0.0.1:11434/api/tags", true),
      ]);
      const sample = {
        version: 1,
        at,
        bootAt,
        bootId,
        uptimeSeconds: Math.round(process.uptime()),
        health: {
          gateway: checks[0],
          application: checks[1],
          localModelListed: checks[2],
        },
        ...state,
      };
      const name = `operations/samples/${bootId}/${at.replace(/[:.]/g, "-")}.json`;
      // Cloud Logging remains an independent evidence sink if GCS fails.
      emit({ event: "operations.sample", ...sample });
      await publishSample(objects, name, sample);
      routeCursor = state.routeCursor;
      emit({
        event: "operations.archived",
        at: new Date().toISOString(),
        sampleAt: at,
        bootId,
        object: name,
        sha256: sha(JSON.stringify(sample)),
      });
    } catch {
      emit({
        event: "operations.sample_failed",
        at: new Date().toISOString(),
        bootId,
        code: "SAMPLE_OR_ARCHIVE_FAILED",
        cursorNotAdvanced: true,
      });
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  await tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
    emit({ event: "operations.stopped", at: new Date().toISOString(), bootId });
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const stop = await runMonitor();
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stop();
      process.exit(0);
    });
}
