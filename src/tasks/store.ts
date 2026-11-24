import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });
export const TaskInput = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((s) =>
      Array.from(s).every(
        (c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127,
      ),
    ),
  dueDate: dueDate.nullable(),
  priority: z.number().int().min(1).max(4),
});
export type Todo = z.infer<typeof TaskInput> & {
  id: string;
  status: "open" | "completed";
  createdAt: string;
  completedAt: string | null;
};
export class TodoStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, dueDate TEXT, priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 4), status TEXT NOT NULL CHECK(status IN ('open','completed')), createdAt TEXT NOT NULL, completedAt TEXT);
      CREATE TABLE IF NOT EXISTS todo_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, operation TEXT NOT NULL, occurred_at TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS todo_events_no_update BEFORE UPDATE ON todo_events BEGIN SELECT RAISE(ABORT, 'immutable'); END;
      CREATE TRIGGER IF NOT EXISTS todo_events_no_delete BEFORE DELETE ON todo_events BEGIN SELECT RAISE(ABORT, 'immutable'); END;`);
    chmodSync(path, 0o600);
  }
  list(status: "open" | "completed" | "all" = "open"): Todo[] {
    z.enum(["open", "completed", "all"]).parse(status);
    return this.db
      .prepare(
        "SELECT * FROM todos WHERE (?='all' OR status=?) ORDER BY priority, dueDate IS NULL, dueDate, createdAt",
      )
      .all(status, status) as unknown as Todo[];
  }
  add(raw: unknown, authorize: () => void, now = new Date()): Todo {
    authorize();
    const input = TaskInput.parse(raw);
    const id =
      "todo-" +
      createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex")
        .slice(0, 24);
    return this.transaction(() => {
      authorize();
      const inserted = this.db
        .prepare("INSERT OR IGNORE INTO todos VALUES (?,?,?,?, 'open',?,NULL)")
        .run(id, input.title, input.dueDate, input.priority, now.toISOString());
      if (inserted.changes) this.event(id, "created", now);
      return this.get(id);
    });
  }
  complete(id: string, authorize: () => void, now = new Date()): Todo {
    authorize();
    if (!/^todo-[a-f0-9]{24}$/.test(id)) throw Error("TODO_ID_INVALID");
    return this.transaction(() => {
      this.get(id);
      authorize();
      const result = this.db
        .prepare(
          "UPDATE todos SET status='completed',completedAt=? WHERE id=? AND status='open'",
        )
        .run(now.toISOString(), id);
      if (result.changes) this.event(id, "completed", now);
      return this.get(id);
    });
  }
  private get(id: string): Todo {
    const task = this.db.prepare("SELECT * FROM todos WHERE id=?").get(id);
    if (!task) throw Error("TODO_NOT_FOUND");
    return task as unknown as Todo;
  }
  private event(id: string, operation: string, now: Date) {
    this.db
      .prepare(
        "INSERT INTO todo_events(task_id,operation,occurred_at) VALUES (?,?,?)",
      )
      .run(id, operation, now.toISOString());
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
