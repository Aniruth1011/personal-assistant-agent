import { describe, it, expect } from "vitest";
import { CloudArchive, type ImmutableObjects } from "./cloud-archive.js";

class MemoryObjects implements ImmutableObjects {
  data = new Map<string, Buffer>();
  fail = false;
  async create(name: string, bytes: Buffer) {
    if (this.fail) throw new Error("SIMULATED_NETWORK_FAILURE");
    if (this.data.has(name))
      throw Object.assign(new Error("exists"), { code: 412 });
    this.data.set(name, Buffer.from(bytes));
  }
  async read(name: string) {
    const b = this.data.get(name);
    if (!b) throw new Error("NOT_FOUND");
    return Buffer.from(b);
  }
}
describe("cloud archive (unit object-store double)", () => {
  it("restores exactly, retries identical writes and rejects event history rewrites", async () => {
    const objects = new MemoryObjects(),
      archive = new CloudArchive(objects);
    const files = {
      "assistant.sqlite": Buffer.from("synthetic database bytes"),
    };
    const id = await archive.snapshot(files);
    expect(await archive.snapshot(files)).toBe(id);
    expect(await new CloudArchive(objects).restore(id)).toEqual(files);
    await archive.event(1, { status: "SUBMITTING" });
    await archive.event(1, { status: "SUBMITTING" });
    await expect(archive.event(1, { status: "APPROVED" })).rejects.toThrow(
      "IMMUTABLE_ARCHIVE_CONFLICT",
    );
  });
  it("rejects traversal and corrupt data before returning a restore", async () => {
    const objects = new MemoryObjects(),
      archive = new CloudArchive(objects);
    await expect(
      archive.snapshot({ "../credentials": Buffer.from("x") }),
    ).rejects.toThrow();
    expect(objects.data.size).toBe(0);
    const id = await archive.snapshot({ "state.sqlite": Buffer.from("good") });
    const key = [...objects.data.keys()].find((k) => k.includes("/blobs/"))!;
    objects.data.set(key, Buffer.from("evil"));
    await expect(archive.restore(id)).rejects.toThrow("SNAPSHOT_HASH_MISMATCH");
    await expect(archive.restore("../../other")).rejects.toThrow();
  });
  it("never publishes a manifest on outage and succeeds after recovery", async () => {
    const objects = new MemoryObjects(),
      archive = new CloudArchive(objects);
    objects.fail = true;
    await expect(
      archive.snapshot({ "state.sqlite": Buffer.from("x") }),
    ).rejects.toThrow("SIMULATED_NETWORK_FAILURE");
    expect(objects.data.size).toBe(0);
    objects.fail = false;
    const id = await archive.snapshot({ "state.sqlite": Buffer.from("x") });
    expect((await archive.restore(id))["state.sqlite"].toString()).toBe("x");
  });
});
