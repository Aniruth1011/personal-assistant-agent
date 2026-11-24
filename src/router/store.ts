import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { RouteDecision, RouteTask } from "./policy.js";
export class RouteStore {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS private_sessions(session_hash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS route_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_json TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS route_events_no_update BEFORE UPDATE ON route_events BEGIN SELECT RAISE(ABORT,'append-only'); END;
    CREATE TRIGGER IF NOT EXISTS route_events_no_delete BEFORE DELETE ON route_events BEGIN SELECT RAISE(ABORT,'append-only'); END;`);
  }
  #hash(session: string) {
    return createHash("sha256").update(session).digest("hex");
  }
  tainted(session: string) {
    return Boolean(
      this.#db
        .prepare("SELECT 1 FROM private_sessions WHERE session_hash=?")
        .get(this.#hash(session)),
    );
  }
  markPrivate(session: string) {
    this.#db
      .prepare("INSERT OR IGNORE INTO private_sessions VALUES(?)")
      .run(this.#hash(session));
  }
  decision(
    id: string,
    session: string,
    decision: RouteDecision,
    selectedModel: string | null,
    task: RouteTask,
  ) {
    this.#write({
      kind: "decision",
      id,
      sessionHash: this.#hash(session),
      ...decision,
      selectedModel,
      task,
    });
  }
  served(
    id: string,
    provider: string,
    model: string,
    usage: { input?: number; output?: number; total?: number },
  ) {
    this.#write({
      kind: "served",
      id,
      provider,
      model,
      inputTokens: usage.input ?? null,
      outputTokens: usage.output ?? null,
      totalTokens: usage.total ?? null,
      cost: null,
    });
  }
  /** The private agent handed one public message to a fresh isolated session. */
  delegation(id: string, session: string, reason: string, child: string) {
    this.#write({
      kind: "delegation",
      id,
      sessionHash: this.#hash(session),
      target: "delegated",
      reason,
      childSessionHash: this.#hash(child),
    });
  }
  outcome(id: string, outcome: string, durationMs: number) {
    this.#write({ kind: "outcome", id, outcome, durationMs });
  }
  events() {
    return this.#db
      .prepare("SELECT event_json FROM route_events ORDER BY seq")
      .all()
      .map((r) => JSON.parse(String(r.event_json)) as Record<string, unknown>);
  }
  #write(event: Record<string, unknown>) {
    this.#db
      .prepare("INSERT INTO route_events(event_json) VALUES(?)")
      .run(JSON.stringify({ at: new Date().toISOString(), ...event }));
  }
  close() {
    this.#db.close();
  }
}
