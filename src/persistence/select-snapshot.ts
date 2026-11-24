import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Append-only tables (immutable triggers). Only these establish order or divergence. */
const histories = [
  "todo_events",
  "email_outbox_events",
  "knowledge_events",
  "route_events",
  "alert_delivery_events",
];
/** Mutable tables: a tie-breaker when histories are identical, never a divergence signal. */
const mutable = [
  "assistant_report_runs",
  "assistant_email_context",
  "assistant_alerts",
  "project_events",
  "private_sessions",
];

type Snapshot = {
  history: Record<string, string[]>;
  counts: Record<string, number>;
};

function read(dir: string, bytes: Buffer, name: string): Snapshot {
  const path = join(dir, name);
  writeFileSync(path, bytes, { mode: 0o600 });
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw Error("SNAPSHOT_DATABASE_INVALID");
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => String(r.name)),
    );
    const history: Snapshot["history"] = {};
    for (const table of histories)
      history[table] = tables.has(table)
        ? db
            .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
            .all()
            .map((row) =>
              createHash("sha256").update(JSON.stringify(row)).digest("hex"),
            )
        : [];
    const counts: Snapshot["counts"] = {};
    for (const table of mutable)
      counts[table] = tables.has(table)
        ? Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n)
        : 0;
    return { history, counts };
  } finally {
    db.close();
  }
}

/**
 * Choose between the restored native copy (`current`) and a database-specific
 * checkpoint (`candidate`) by comparing immutable application history, not
 * archive upload time. Divergence is a stop, never a silent rollback or merge.
 */
export function selectApplicationSnapshot(
  current: Buffer,
  candidate: Buffer,
): Buffer {
  if (current.equals(candidate)) return current;
  const dir = mkdtempSync(join(tmpdir(), "snapshot-order-"));
  try {
    const a = read(dir, current, "current.sqlite");
    const b = read(dir, candidate, "candidate.sqlite");
    let candidateAhead = false;
    let currentAhead = false;
    for (const table of histories) {
      const left = a.history[table]!;
      const right = b.history[table]!;
      const shared = Math.min(left.length, right.length);
      if (left.slice(0, shared).some((hash, i) => hash !== right[i]))
        throw Error("APPLICATION_SNAPSHOT_HISTORIES_DIVERGED");
      if (right.length > left.length) candidateAhead = true;
      if (left.length > right.length) currentAhead = true;
    }
    if (candidateAhead && currentAhead)
      throw Error("APPLICATION_SNAPSHOT_HISTORIES_DIVERGED");
    if (candidateAhead) return candidate;
    if (currentAhead) return current;
    // Identical histories: prefer the candidate only when it dominates every
    // mutable table (e.g. retains extra private-session taint); otherwise keep
    // the native copy, which also carries the current mailbox cursor.
    const dominates =
      mutable.every((t) => b.counts[t]! >= a.counts[t]!) &&
      mutable.some((t) => b.counts[t]! > a.counts[t]!);
    return dominates ? candidate : current;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
