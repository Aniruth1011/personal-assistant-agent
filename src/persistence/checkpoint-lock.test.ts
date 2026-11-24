import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { withCheckpointLock } from "./checkpoint-lock.js";
describe("snapshot commit serialization", () => {
  it("serializes concurrent checkpoints and releases on failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "checkpoint-lock-")),
      path = join(dir, "state.sqlite"),
      order: string[] = [];
    try {
      await Promise.all([
        withCheckpointLock(path, async () => {
          order.push("first");
          await new Promise((r) => setTimeout(r, 100));
          order.push("first-done");
        }),
        withCheckpointLock(path, async () => {
          order.push("second");
        }),
      ]);
      expect([
        ["first", "first-done", "second"],
        ["second", "first", "first-done"],
      ]).toContainEqual(order);
      await expect(
        withCheckpointLock(path, async () => {
          throw Error("cloud outage");
        }),
      ).rejects.toThrow("cloud outage");
      expect(existsSync(`${path}.checkpoint-lock`)).toBe(false);
      expect(await withCheckpointLock(path, async () => "recovered")).toBe(
        "recovered",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("holds on an unreadable lock rather than guessing that it is safe to replace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "checkpoint-lock-bad-")),
      path = join(dir, "state.sqlite");
    try {
      mkdirSync(`${path}.checkpoint-lock`);
      writeFileSync(`${path}.checkpoint-lock/owner.json`, "{}");
      let ran = false;
      await expect(
        withCheckpointLock(path, async () => {
          ran = true;
        }),
      ).rejects.toThrow("CHECKPOINT_LOCK_INVALID");
      expect(ran).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
