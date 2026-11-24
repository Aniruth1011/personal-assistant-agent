import { createHash } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { z } from "zod";

export interface ImmutableObjects {
  create(name: string, bytes: Buffer): Promise<void>;
  read(name: string): Promise<Buffer>;
}

/** Deployment service account receives objectCreator + objectViewer, never delete. */
export class GcsObjects implements ImmutableObjects {
  constructor(
    private readonly bucket: string,
    private readonly storage = new Storage(),
  ) {}
  async create(name: string, bytes: Buffer): Promise<void> {
    await this.storage
      .bucket(this.bucket)
      .file(name)
      .save(bytes, {
        resumable: false,
        validation: "crc32c",
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: "application/octet-stream",
          cacheControl: "no-store",
        },
      });
  }
  async read(name: string): Promise<Buffer> {
    const [bytes] = await this.storage
      .bucket(this.bucket)
      .file(name)
      .download({ validation: "crc32c" });
    return bytes;
  }
}

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Manifest = z.strictObject({
  version: z.literal(1),
  files: z.record(
    z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/),
    z.strictObject({
      sha256: Digest,
      size: z
        .number()
        .int()
        .nonnegative()
        .max(128 * 1024 * 1024),
    }),
  ),
});
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const equal = (a: Buffer, b: Buffer) => a.equals(b);

export class CloudArchive {
  constructor(
    private readonly objects: ImmutableObjects,
    private readonly prefix = "applypilot/v1",
  ) {
    if (!/^[a-z0-9/-]+$/.test(prefix) || prefix.includes(".."))
      throw new Error("INVALID_ARCHIVE_PREFIX");
  }
  private async put(name: string, bytes: Buffer): Promise<void> {
    try {
      await this.objects.create(name, bytes);
    } catch (error) {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        Number(error.code) === 412
      ))
        throw error;
      if (!equal(await this.objects.read(name), bytes))
        throw new Error("IMMUTABLE_ARCHIVE_CONFLICT");
    }
    if (!equal(await this.objects.read(name), bytes))
      throw new Error("ARCHIVE_READBACK_MISMATCH");
  }
  /** Commit manifest only after every blob has been independently read back. */
  async snapshot(files: Record<string, Buffer>): Promise<string> {
    const manifest = Manifest.parse({
      version: 1,
      files: Object.fromEntries(
        Object.entries(files)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, bytes]) => [
            name,
            { sha256: digest(bytes), size: bytes.length },
          ]),
      ),
    });
    if (!Object.keys(files).length) throw new Error("EMPTY_SNAPSHOT");
    for (const [name, meta] of Object.entries(manifest.files))
      await this.put(`${this.prefix}/blobs/${meta.sha256}`, files[name]);
    const bytes = Buffer.from(JSON.stringify(manifest));
    const id = digest(bytes);
    await this.put(`${this.prefix}/manifests/${id}.json`, bytes);
    return id;
  }
  /** Validate all bytes before caller installs any restored file. */
  async restore(id: string): Promise<Record<string, Buffer>> {
    Digest.parse(id);
    const bytes = await this.objects.read(
      `${this.prefix}/manifests/${id}.json`,
    );
    if (digest(bytes) !== id) throw new Error("MANIFEST_HASH_MISMATCH");
    const manifest = Manifest.parse(JSON.parse(bytes.toString("utf8")));
    const files: Record<string, Buffer> = {};
    for (const [name, meta] of Object.entries(manifest.files)) {
      const content = await this.objects.read(
        `${this.prefix}/blobs/${meta.sha256}`,
      );
      if (content.length !== meta.size || digest(content) !== meta.sha256)
        throw new Error("SNAPSHOT_HASH_MISMATCH");
      files[name] = content;
    }
    return files;
  }
  async event(sequence: number, event: unknown): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < 1)
      throw new Error("INVALID_EVENT_SEQUENCE");
    await this.put(
      `${this.prefix}/events/${String(sequence).padStart(16, "0")}.json`,
      Buffer.from(JSON.stringify(event)),
    );
  }
}
