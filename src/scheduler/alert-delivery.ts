import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

export class AlertDelivery {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS alert_batches (
      id TEXT PRIMARY KEY, alert_keys TEXT NOT NULL, created_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', receipt_id TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS alert_delivery_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT, state TEXT, receipt_id TEXT, at TEXT);
      CREATE TRIGGER IF NOT EXISTS alert_delivery_events_no_update BEFORE UPDATE ON alert_delivery_events BEGIN SELECT RAISE(ABORT,'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS alert_delivery_events_no_delete BEFORE DELETE ON alert_delivery_events BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
  }
  prepare(keys: string[], text: string, now: Date) {
    const id = createHash("sha256")
      .update(JSON.stringify([keys, text, now.toISOString()]))
      .digest("hex")
      .slice(0, 24);
    this.db
      .prepare(
        "INSERT OR IGNORE INTO alert_batches(id,alert_keys,created_at,updated_at) VALUES(?,?,?,?)",
      )
      .run(id, JSON.stringify(keys), now.toISOString(), now.toISOString());
    return { id, text: `${text}\nAlert receipt: ${id}` };
  }
  /** Only exact batch references from native task receipts can mark delivery. */
  reconcile(
    receipts: Array<{ id: string; summary: string; delivery: string }>,
    now = new Date(),
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of receipts) {
        const id = /Alert receipt: ([a-f0-9]{24})/.exec(r.summary)?.[1];
        if (!id) continue;
        const state =
          r.delivery === "delivered"
            ? "delivered"
            : r.delivery === "not-started"
              ? "not_sent"
              : "unknown";
        const changed = this.db
          .prepare(
            "UPDATE alert_batches SET state=?,receipt_id=?,updated_at=? WHERE id=? AND state!='delivered' AND (state!=? OR receipt_id IS NULL)",
          )
          .run(state, r.id, now.toISOString(), id, state);
        if (changed.changes)
          this.db
            .prepare(
              "INSERT INTO alert_delivery_events(batch_id,state,receipt_id,at) VALUES(?,?,?,?)",
            )
            .run(id, state, r.id, now.toISOString());
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  reconcileNative(path: string) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const receipts = db
        .prepare(
          "SELECT t.task_id,t.terminal_summary,t.detail_json,t.delivery_status,c.delivery_attempt_state,c.finished_at_ms,c.status AS receipt_status FROM task_runs t LEFT JOIN cron_run_receipts c ON c.request_run_id=t.run_id WHERE t.task_kind='cron' ORDER BY t.created_at DESC LIMIT 500",
        )
        .all();
      this.reconcile(
        receipts.flatMap((r) => {
          try {
            const d = JSON.parse(String(r.detail_json ?? "{}"));
            const summary = String(d.summary ?? r.terminal_summary ?? "");
            return [
              {
                id: String(r.task_id),
                summary,
                delivery:
                  (d.delivered === true && d.deliveryStatus === "delivered") ||
                  r.delivery_status === "delivered"
                    ? "delivered"
                    : r.finished_at_ms &&
                        r.receipt_status === "error" &&
                        r.delivery_attempt_state === "not-started"
                      ? "not-started"
                      : "unknown",
              },
            ];
          } catch {
            return [];
          }
        }),
      );
      for (const row of this.pending())
        if (row.state === "not_sent") this.releaseNotSent(String(row.id));
    } finally {
      db.close();
    }
  }
  pending() {
    return this.db
      .prepare(
        "SELECT id,state,created_at FROM alert_batches WHERE state NOT IN ('delivered','released') ORDER BY created_at DESC LIMIT 20",
      )
      .all();
  }
  /** Explicitly proven not-started delivery only. Ambiguous failures are never replayed. */
  releaseNotSent(id: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT alert_keys FROM alert_batches WHERE id=? AND state='not_sent'",
        )
        .get(id);
      if (!row) throw Error("ALERT_RETRY_NOT_PROVEN_SAFE");
      for (const key of JSON.parse(String(row.alert_keys)))
        this.db.prepare("DELETE FROM assistant_alerts WHERE key=?").run(key);
      this.db
        .prepare("UPDATE alert_batches SET state='released' WHERE id=?")
        .run(id);
      this.db
        .prepare(
          "INSERT INTO alert_delivery_events(batch_id,state,at) VALUES(?,?,?)",
        )
        .run(id, "released", new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
