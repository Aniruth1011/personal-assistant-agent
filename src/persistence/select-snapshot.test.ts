import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectApplicationSnapshot } from "./select-snapshot.js";

function snapshot(tasks: number, routes: number, alerts = 0, taint = 0) {
  const dir = mkdtempSync(join(tmpdir(), "order-test-")),
    p = join(dir, "db");
  const db = new DatabaseSync(p);
  try {
    db.exec(
      "CREATE TABLE todo_events(n);CREATE TABLE route_events(n);CREATE TABLE assistant_alerts(k);CREATE TABLE private_sessions(s);",
    );
    for (let i = 0; i < tasks; i++)
      db.prepare("INSERT INTO todo_events VALUES(?)").run(i);
    for (let i = 0; i < routes; i++)
      db.prepare("INSERT INTO route_events VALUES(?)").run(i);
    for (let i = 0; i < alerts; i++)
      db.prepare("INSERT INTO assistant_alerts VALUES(?)").run(i);
    for (let i = 0; i < taint; i++)
      db.prepare("INSERT INTO private_sessions VALUES(?)").run(i);
  } finally {
    db.close();
  }
  const bytes = readFileSync(p);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}
describe("restore never silently overwrites newer application history", () => {
  it("keeps newer native history over older uploaded application snapshot", () => {
    const newer = snapshot(2, 3),
      old = snapshot(1, 2);
    expect(selectApplicationSnapshot(newer, old)).toEqual(newer);
  });
  it("selects genuinely newer application snapshot", () => {
    const old = snapshot(1, 2),
      newer = snapshot(2, 3);
    expect(selectApplicationSnapshot(old, newer)).toEqual(newer);
  });
  it("rejects diverged snapshots instead of merging approval/state histories", () =>
    expect(() =>
      selectApplicationSnapshot(snapshot(2, 1), snapshot(1, 2)),
    ).toThrow("DIVERGED"));
  it("rejects corrupted sqlite", () =>
    expect(() =>
      selectApplicationSnapshot(snapshot(1, 1), Buffer.from("bad")),
    ).toThrow());
  it("does not treat a released (deleted) mutable alert row as divergence", () => {
    const native = snapshot(2, 3, 1),
      checkpoint = snapshot(1, 2, 2);
    expect(selectApplicationSnapshot(native, checkpoint)).toEqual(native);
  });
  it("identical histories keep native unless the checkpoint retains more taint", () => {
    expect(
      selectApplicationSnapshot(snapshot(1, 1, 2, 0), snapshot(1, 1, 1, 1)),
    ).toEqual(snapshot(1, 1, 2, 0));
    const tainted = snapshot(1, 1, 1, 1);
    expect(selectApplicationSnapshot(snapshot(1, 1, 1, 0), tainted)).toEqual(
      tainted,
    );
  });
});
