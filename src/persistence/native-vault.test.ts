import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  sealNativeFiles,
  openNativeFiles,
  restoreNativeFiles,
  captureNativeFiles,
} from "./native-vault.js";
describe("encrypted native state vault", () => {
  it("captures certificate cache encrypted, restores restricted files and rejects symlink escape", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cert-vault-"));
    try {
      const source = join(dir, "source");
      mkdirSync(join(source, "tailscale/certs"), { recursive: true });
      const name = "tailscale/certs/demo.example.ts.net.key";
      writeFileSync(join(source, name), "SYNTHETIC_CERT_CACHE_SENTINEL");
      const files = await captureNativeFiles(source);
      const key = randomBytes(32),
        sealed = sealNativeFiles(files, key);
      expect(
        sealed.includes(Buffer.from("SYNTHETIC_CERT_CACHE_SENTINEL")),
      ).toBe(false);
      const restored = join(dir, "restored");
      restoreNativeFiles(restored, openNativeFiles(sealed, key));
      expect(readFileSync(join(restored, name), "utf8")).toBe(
        "SYNTHETIC_CERT_CACHE_SENTINEL",
      );
      expect(statSync(join(restored, name)).mode & 0o777).toBe(0o600);
      expect(() =>
        sealNativeFiles({ "tailscale/certs/../escape": Buffer.from("x") }, key),
      ).toThrow();
      symlinkSync(join(source, name), join(source, "tailscale/certs/link.key"));
      await expect(captureNativeFiles(source)).rejects.toThrow("SYMLINK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("restores authenticated state and refuses wrong keys, tampering and traversal", () => {
    const key = randomBytes(32),
      files = { "workspace/MEMORY.md": Buffer.from("fictional preference") };
    const sealed = sealNativeFiles(files, key);
    expect(sealed.includes(Buffer.from("fictional preference"))).toBe(false);
    expect(openNativeFiles(sealed, key)).toEqual(files);
    expect(() => openNativeFiles(sealed, randomBytes(32))).toThrow();
    const altered = Buffer.from(sealed);
    altered[altered.length - 1] ^= 1;
    expect(() => openNativeFiles(altered, key)).toThrow();
    expect(() =>
      sealNativeFiles({ "../../escape": Buffer.from("x") }, key),
    ).toThrow();
  });
  it("checks databases before writing files and never overwrites an existing runtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "native-restore-test-")),
      root = join(dir, "runtime");
    try {
      expect(() =>
        restoreNativeFiles(root, {
          "workspace/MEMORY.md": Buffer.from("ok"),
          "state/assistant.sqlite": Buffer.from("corrupt"),
        }),
      ).toThrow();
      expect(existsSync(root)).toBe(false);
      restoreNativeFiles(root, {
        "workspace/MEMORY.md": Buffer.from("verified"),
      });
      expect(readFileSync(join(root, "workspace/MEMORY.md"), "utf8")).toBe(
        "verified",
      );
      expect(() => restoreNativeFiles(root, {})).toThrow(
        "VAULT_RESTORE_TARGET_NOT_EMPTY",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
