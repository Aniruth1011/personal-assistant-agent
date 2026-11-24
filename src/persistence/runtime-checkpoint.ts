import { DatabaseSync, backup } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CloudArchive, GcsObjects } from "./cloud-archive.js";
import { withCheckpointLock } from "./checkpoint-lock.js";

/** Serialized per process; a failed checkpoint propagates before any external mutation. */
export function createAssistantCheckpoint(
  databasePath: string,
): () => Promise<void> {
  const bucket = process.env.APPLYPILOT_GCS_BUCKET;
  if (!bucket) {
    if (process.env.APPLYPILOT_ENV === "production")
      throw new Error("PRODUCTION_ARCHIVE_REQUIRED");
    return async () => {};
  }
  const prefix = `${process.env.APPLYPILOT_ARCHIVE_PREFIX ?? "applypilot/production"}/assistant`;
  const objects = new GcsObjects(bucket);
  const archive = new CloudArchive(objects, prefix);
  const filename = "assistant.sqlite";
  let pending = Promise.resolve();
  return () => {
    const run = async () => {
      const dir = mkdtempSync(join(tmpdir(), "applypilot-checkpoint-"));
      try {
        const live = new DatabaseSync(databasePath, { readOnly: true });
        try {
          await backup(live, join(dir, filename));
        } finally {
          live.close();
        }
        const id = await archive.snapshot({
          [filename]: readFileSync(join(dir, filename)),
        });
        // Immutable commit receipts identify completed snapshots. Startup must restore a
        // verified receipt before starting providers; no live database is mounted on GCS.
        await objects.create(
          `${prefix}/commits/${Date.now()}-${randomUUID()}.json`,
          Buffer.from(JSON.stringify({ version: 1, snapshotId: id })),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    const lockedRun = () => withCheckpointLock(databasePath, run);
    const next = pending.then(lockedRun, lockedRun);
    pending = next.catch(() => {});
    return next;
  };
}
