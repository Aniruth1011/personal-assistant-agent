import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AlertDelivery } from "./alert-delivery.js";
import { AssistantState } from "./assistant-state.js";
describe("alert receipt reconciliation", () => {
  it("survives restart, marks exact delivered batch and never releases ambiguous delivery", () => {
    const dir = mkdtempSync(join(tmpdir(), "alert-receipt-")),
      path = join(dir, "db");
    const state = new AssistantState(path);
    let d = new AlertDelivery(path);
    try {
      const key = "a".repeat(64);
      expect(state.reserveAlert(key, new Date().toISOString())).toBe(true);
      const b = d.prepare([key], "Synthetic alert", new Date());
      d.close();
      d = new AlertDelivery(path);
      expect(d.pending()).toHaveLength(1);
      d.reconcile([{ id: "receipt1", summary: b.text, delivery: "failed" }]);
      expect(() => d.releaseNotSent(b.id)).toThrow("NOT_PROVEN_SAFE");
      expect(state.reserveAlert(key, new Date().toISOString())).toBe(false);
      d.reconcile([{ id: "receipt1", summary: b.text, delivery: "delivered" }]);
      expect(d.pending()).toHaveLength(0);
      d.reconcile([{ id: "receipt2", summary: b.text, delivery: "unknown" }]);
      expect(d.pending()).toHaveLength(0);
    } finally {
      d.close();
      state.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("releases only a proven-not-started reservation and records its history", () => {
    const dir = mkdtempSync(join(tmpdir(), "alert-safe-retry-")),
      path = join(dir, "db");
    const state = new AssistantState(path),
      d = new AlertDelivery(path);
    try {
      const key = "b".repeat(64);
      state.reserveAlert(key, new Date().toISOString());
      const b = d.prepare([key], "Synthetic reminder", new Date());
      d.reconcile([
        { id: "trusted-receipt", summary: b.text, delivery: "not-started" },
      ]);
      d.releaseNotSent(b.id);
      expect(state.reserveAlert(key, new Date().toISOString())).toBe(true);
      expect(() => d.releaseNotSent(b.id)).toThrow();
    } finally {
      d.close();
      state.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
