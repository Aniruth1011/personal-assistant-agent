import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectState,
  publishSample,
  sanitizeRoute,
} from "../../deploy/operations-monitor.mjs";
import { makeWindow, assessWindow } from "../../scripts/operations/window.mjs";
it("exports metadata without private text, detects restart rollback, and labels missing schemas", () => {
  const root = mkdtempSync(join(tmpdir(), "ops-"));
  try {
    mkdirSync(join(root, "state"));
    const db = new DatabaseSync(join(root, "state/assistant.sqlite"));
    db.exec(
      "CREATE TABLE route_events(seq INTEGER PRIMARY KEY,event_json TEXT); CREATE TABLE knowledge_facts(value TEXT);",
    );
    db.prepare("INSERT INTO knowledge_facts VALUES(?)").run(
      "PRIVATE_BODY_SENTINEL",
    );
    db.prepare("INSERT INTO route_events VALUES(?,?)").run(
      1,
      JSON.stringify({
        kind: "decision",
        target: "local",
        reason: "private_local_only",
        prompt: "PRIVATE_BODY_SENTINEL",
        task: { privacy: "private", secret: "PRIVATE_BODY_SENTINEL" },
      }),
    );
    db.close();
    const result = inspectState(root, 10);
    expect(result.routeRollback).toBe(true);
    expect(result.routeCursor).toBe(1);
    expect(result.counts.knowledge_facts).toBe(1);
    expect(result.issues).toContain("scheduler_database_unavailable");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_BODY_SENTINEL");
    mkdirSync(join(root, "workspace"));
    writeFileSync(
      join(root, "workspace/KNOWLEDGE.md"),
      "private fictional fact",
    );
    const next = inspectState(root, 1);
    expect(next.routes).toEqual([]);
    expect(next.memoryHashes["KNOWLEDGE.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(
      sanitizeRoute({
        seq: 2,
        event_json: '{"kind":"served","model":"gemma4:e2b","prompt":"secret"}',
      }),
    ).toEqual({ seq: 2, kind: "served", model: "gemma4:e2b" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("requires independent immutable readback and rejects corrupted evidence", async () => {
  let bytes;
  const objects = {
    create: async (_n, b) => {
      if (bytes) throw Object.assign(Error(), { code: 412 });
      bytes = b;
    },
    read: async () => bytes,
  };
  await publishSample(objects, "sample", { at: "now" });
  await publishSample(objects, "sample", { at: "now" });
  await expect(
    publishSample(objects, "sample", { at: "different" }),
  ).rejects.toThrow("READBACK");
  await expect(
    publishSample(
      {
        create: async () => {
          throw Error("offline");
        },
        read: async () => Buffer.alloc(0),
      },
      "x",
      {},
    ),
  ).rejects.toThrow("offline");
});
it("does not start without readiness or mistake short/gapped/drifting/restarted operation for 48h", () => {
  const now = Date.parse("2026-11-13T08:00:00Z");
  const readiness = Object.fromEntries(
    [
      "https",
      "memoryRecovery",
      "freshAlert",
      "localModel",
      "cloudModel",
      "securityAudit",
      "routingFailurePolicy",
    ].map((k) => [k, true]),
  );
  const sample = {
    at: new Date(now).toISOString(),
    bootId: "boot1",
    configHash: "a".repeat(64),
    issues: [],
    health: {
      gateway: { ok: true },
      application: { ok: true },
      localModelListed: { ok: true },
    },
  };
  const input = {
    readiness,
    sample,
    image: "registry/image@sha256:" + "b".repeat(64),
    now,
  };
  const manifest = makeWindow(input);
  expect(() =>
    makeWindow({ ...input, readiness: { ...readiness, https: false } }),
  ).toThrow();
  expect(() => makeWindow({ ...input, now: now + 181000 })).toThrow("FRESH");
  expect(assessWindow(manifest, [], now + 1000).status).toBe("IN_PROGRESS");
  const samples = Array.from({ length: 2881 }, (_, i) => ({
    ...sample,
    at: new Date(now + i * 60000).toISOString(),
  }));
  const end = now + 48 * 3600000;
  expect(assessWindow(manifest, samples, end).status).toBe(
    "COVERAGE_COMPLETE_SCHEDULE_AND_INCIDENT_REVIEW_REQUIRED",
  );
  expect(
    assessWindow(
      manifest,
      samples.filter((_, i) => i < 10 || i > 20),
      end,
    ).gaps,
  ).toHaveLength(1);
  expect(
    assessWindow(
      manifest,
      [...samples, { ...samples[3], bootId: "restarted" }],
      end,
    ).restartReviewRequired,
  ).toBe(true);
  expect(
    assessWindow(
      manifest,
      [...samples, { ...samples[3], configHash: "changed" }],
      end,
    ).configDrift,
  ).toHaveLength(1);
});
