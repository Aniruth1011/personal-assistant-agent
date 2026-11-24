import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TodoStore } from "./store.js";
const allow = () => {};
const input = {
  title: "Prepare fictional demo",
  dueDate: "2026-12-01",
  priority: 2,
};
function fixture(run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "todo-test-"));
  try {
    run(join(dir, "assistant.sqlite"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe("persistent to-do list", () => {
  it("creates, lists, completes and recovers after restart without duplicate events", () =>
    fixture((path) => {
      let store = new TodoStore(path);
      const task = store.add(input, allow);
      expect(store.add(input, allow).id).toBe(task.id);
      expect(store.list()).toHaveLength(1);
      store.close();
      store = new TodoStore(path);
      expect(store.list()[0]).toMatchObject(input);
      expect(store.complete(task.id, allow).status).toBe("completed");
      store.complete(task.id, allow);
      expect(store.list()).toHaveLength(0);
      expect(store.list("completed")).toHaveLength(1);
      expect(
        store.db.prepare("SELECT COUNT(*) AS n FROM todo_events").get()?.n,
      ).toBe(2);
      expect(() => store.db.exec("DELETE FROM todo_events")).toThrow(
        "immutable",
      );
      store.close();
    }));
  it("rejects invalid dates, titles and unauthorized changes with zero task rows", () =>
    fixture((path) => {
      const store = new TodoStore(path);
      expect(() =>
        store.add({ ...input, title: "bad\u0000title" }, allow),
      ).toThrow();
      expect(() =>
        store.add({ ...input, dueDate: "2026-02-30" }, allow),
      ).toThrow();
      expect(() => store.add({ ...input, title: "" }, allow)).toThrow();
      expect(() =>
        store.add(input, () => {
          throw Error("unauthorized");
        }),
      ).toThrow("unauthorized");
      let calls = 0;
      expect(() =>
        store.add(input, () => {
          if (++calls === 2) throw Error("revoked");
        }),
      ).toThrow("revoked");
      expect(store.list("all")).toHaveLength(0);
      expect(() => store.complete("todo-" + "a".repeat(24), allow)).toThrow(
        "TODO_NOT_FOUND",
      );
      expect(
        store.db.prepare("SELECT COUNT(*) AS n FROM todo_events").get()?.n,
      ).toBe(0);
      store.close();
    }));
  it("accepts leap dates and undated tasks and sorts by priority", () =>
    fixture((path) => {
      const store = new TodoStore(path);
      store.add({ ...input, dueDate: "2028-02-29" }, allow);
      store.add(
        {
          ...input,
          title: "Urgent fictional task",
          dueDate: null,
          priority: 1,
        },
        allow,
      );
      expect(store.list().map((t) => t.priority)).toEqual([1, 2]);
      store.close();
    }));
});
