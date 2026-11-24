import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

/** Cross-process serialization keeps commit receipt order equal to snapshot order. */
export async function withCheckpointLock<T>(
  path: string,
  work: () => Promise<T>,
  timeoutMs = 60000,
): Promise<T> {
  const lock = `${path}.checkpoint-lock`;
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await readFile(`${lock}/owner.json`, "utf8"));
        if (
          !Number.isSafeInteger(owner.pid) ||
          owner.pid < 2 ||
          typeof owner.token !== "string"
        )
          throw new Error("CHECKPOINT_LOCK_INVALID");
        try {
          process.kill(owner.pid, 0);
        } catch (probeError) {
          if ((probeError as NodeJS.ErrnoException).code === "ESRCH") {
            // Never remove a lock based on an earlier read: another recovery
            // process could have replaced it. Fresh-container restore excludes locks.
            throw new Error("CHECKPOINT_LOCK_STALE_RESTART_REQUIRED");
          }
        }
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== "ENOENT")
          throw readError;
      }
      if (Date.now() >= deadline) throw new Error("CHECKPOINT_LOCK_TIMEOUT");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  const release = async () => {
    const owner = JSON.parse(await readFile(`${lock}/owner.json`, "utf8"));
    if (owner.token !== token) throw new Error("CHECKPOINT_LOCK_OWNER_CHANGED");
    await rm(lock, { recursive: true });
  };
  try {
    await writeFile(
      `${lock}/owner.json`,
      JSON.stringify({ pid: process.pid, token }),
      { mode: 0o600 },
    );
    return await work();
  } finally {
    await release();
  }
}
