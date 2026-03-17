import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { sessionStateDirPath, manifestPath, cookieSnapshotPath } from "./paths.js";
import { createPlaintextCrypto, createAesGcmCrypto } from "./crypto.js";
import { SessionSnapshotStore, type SnapshotManifest } from "./store.js";
import { DEFAULT_SESSION_STATE_POLICY } from "@rivonclaw/core";
import { MemorySecretStore } from "@rivonclaw/secrets";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("session-state paths", () => {
  const base = "/fake/base";

  it("sessionStateDirPath returns correct path format with target namespace", () => {
    const result = sessionStateDirPath(base, "managed_profile", "prof-1");
    expect(result).toBe(join(base, "session-state", "managed_profile", "prof-1"));
  });

  it("cdp target produces different directory than managed_profile", () => {
    const managed = sessionStateDirPath(base, "managed_profile", "prof-1");
    const cdp = sessionStateDirPath(base, "cdp", "prof-1");
    expect(managed).not.toBe(cdp);
    expect(managed).toContain("managed_profile");
    expect(cdp).toContain("cdp");
  });

  it("manifestPath returns path ending with manifest.json", () => {
    const result = manifestPath(base, "managed_profile", "prof-1");
    expect(result).toMatch(/manifest\.json$/);
  });

  it("cookieSnapshotPath returns path ending with cookies.json.enc", () => {
    const result = cookieSnapshotPath(base, "managed_profile", "prof-1");
    expect(result).toMatch(/cookies\.json\.enc$/);
  });

  it("paths are profile-scoped (different profileIds produce different paths)", () => {
    const dirA = sessionStateDirPath(base, "managed_profile", "alpha");
    const dirB = sessionStateDirPath(base, "managed_profile", "beta");
    expect(dirA).not.toBe(dirB);

    const manifestA = manifestPath(base, "managed_profile", "alpha");
    const manifestB = manifestPath(base, "managed_profile", "beta");
    expect(manifestA).not.toBe(manifestB);

    const cookieA = cookieSnapshotPath(base, "managed_profile", "alpha");
    const cookieB = cookieSnapshotPath(base, "managed_profile", "beta");
    expect(cookieA).not.toBe(cookieB);
  });

  it("paths are target-scoped (different targets produce different paths)", () => {
    const managedDir = sessionStateDirPath(base, "managed_profile", "prof-1");
    const cdpDir = sessionStateDirPath(base, "cdp", "__cdp__");
    expect(managedDir).not.toBe(cdpDir);

    const managedManifest = manifestPath(base, "managed_profile", "prof-1");
    const cdpManifest = manifestPath(base, "cdp", "__cdp__");
    expect(managedManifest).not.toBe(cdpManifest);
  });
});

// ---------------------------------------------------------------------------
// Plaintext crypto (test-only helper)
// ---------------------------------------------------------------------------

describe("plaintext crypto (test-only)", () => {
  it("encrypt returns the same data", async () => {
    const crypto = createPlaintextCrypto();
    const data = Buffer.from("hello world");
    const encrypted = await crypto.encrypt(data);
    expect(encrypted).toEqual(data);
  });

  it("decrypt returns the same data", async () => {
    const crypto = createPlaintextCrypto();
    const data = Buffer.from("secret cookies");
    const decrypted = await crypto.decrypt(data);
    expect(decrypted).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// AES-256-GCM crypto
// ---------------------------------------------------------------------------

describe("AES-256-GCM crypto", () => {
  it("encrypt then decrypt round-trips correctly", async () => {
    const secretStore = new MemorySecretStore();
    const crypto = await createAesGcmCrypto(secretStore);

    const original = Buffer.from(JSON.stringify([{ name: "session", value: "abc123" }]));
    const encrypted = await crypto.encrypt(original);
    const decrypted = await crypto.decrypt(encrypted);
    expect(decrypted).toEqual(original);
  });

  it("two encryptions of the same data produce different ciphertexts (unique IVs)", async () => {
    const secretStore = new MemorySecretStore();
    const crypto = await createAesGcmCrypto(secretStore);

    const data = Buffer.from("same data");
    const enc1 = await crypto.encrypt(data);
    const enc2 = await crypto.encrypt(data);
    expect(enc1).not.toEqual(enc2);

    // Both should decrypt to the same original
    expect(await crypto.decrypt(enc1)).toEqual(data);
    expect(await crypto.decrypt(enc2)).toEqual(data);
  });

  it("tampered ciphertext causes decrypt to throw", async () => {
    const secretStore = new MemorySecretStore();
    const crypto = await createAesGcmCrypto(secretStore);

    const encrypted = await crypto.encrypt(Buffer.from("sensitive data"));
    // Tamper with a byte in the ciphertext portion (after version + iv + tag = 1 + 12 + 16 = 29)
    encrypted[30] ^= 0xff;
    await expect(crypto.decrypt(encrypted)).rejects.toThrow();
  });

  it("data too short to be valid throws", async () => {
    const secretStore = new MemorySecretStore();
    const crypto = await createAesGcmCrypto(secretStore);

    // Create data that starts with version byte but is too short
    const tooShort = Buffer.alloc(5);
    tooShort[0] = 1; // version byte
    await expect(crypto.decrypt(tooShort)).rejects.toThrow(/too short/i);
  });

  it("plaintext migration: data starting with JSON array bracket is passed through", async () => {
    const secretStore = new MemorySecretStore();
    const crypto = await createAesGcmCrypto(secretStore);

    const plaintext = Buffer.from('[{"name":"session","value":"abc"}]');
    const result = await crypto.decrypt(plaintext);
    expect(result).toEqual(plaintext);
  });

  it("plaintext migration: data starting with JSON object brace is passed through", async () => {
    const secretStore = new MemorySecretStore();
    const crypto = await createAesGcmCrypto(secretStore);

    const plaintext = Buffer.from('{"key":"value"}');
    const result = await crypto.decrypt(plaintext);
    expect(result).toEqual(plaintext);
  });

  it("first call generates a key and stores it in the secret store", async () => {
    const secretStore = new MemorySecretStore();
    const crypto = await createAesGcmCrypto(secretStore);

    // Before any encrypt/decrypt, no key yet (lazy generation)
    // Trigger key creation by encrypting
    await crypto.encrypt(Buffer.from("trigger"));

    const storedKey = await secretStore.get("session-state.encryption-key");
    expect(storedKey).not.toBeNull();
    expect(storedKey!.length).toBe(64); // 32 bytes hex-encoded
  });

  it("second crypto instance with same secret store reuses the stored key", async () => {
    const secretStore = new MemorySecretStore();

    const crypto1 = await createAesGcmCrypto(secretStore);
    const data = Buffer.from("shared key test");
    const encrypted = await crypto1.encrypt(data);

    // Create a second instance with the same secret store
    const crypto2 = await createAesGcmCrypto(secretStore);
    const decrypted = await crypto2.decrypt(encrypted);
    expect(decrypted).toEqual(data);
  });

  it("different keys cannot decrypt each other's data", async () => {
    const store1 = new MemorySecretStore();
    const store2 = new MemorySecretStore();

    const crypto1 = await createAesGcmCrypto(store1);
    const crypto2 = await createAesGcmCrypto(store2);

    const data = Buffer.from("secret");
    const encrypted = await crypto1.encrypt(data);

    await expect(crypto2.decrypt(encrypted)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SessionSnapshotStore
// ---------------------------------------------------------------------------

describe("SessionSnapshotStore", () => {
  let basePath: string;
  let store: SessionSnapshotStore;

  const sampleManifest: SnapshotManifest = {
    profileId: "prof-1",
    target: "managed_profile",
    updatedAt: Date.now(),
    hash: "sha256-abc123",
    cookieCount: 5,
  };

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "ss-store-test-"));
    store = new SessionSnapshotStore(basePath, createPlaintextCrypto());
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("readManifest returns null when no manifest exists", async () => {
    const result = await store.readManifest("managed_profile", "nonexistent");
    expect(result).toBeNull();
  });

  it("hasManifest returns false when no manifest exists", async () => {
    const result = await store.hasManifest("managed_profile", "nonexistent");
    expect(result).toBe(false);
  });

  it("writeManifest then readManifest round-trips correctly", async () => {
    await store.writeManifest("managed_profile", "prof-1", sampleManifest);
    const read = await store.readManifest("managed_profile", "prof-1");
    expect(read).toEqual(sampleManifest);
  });

  it("hasManifest returns true after writing", async () => {
    await store.writeManifest("managed_profile", "prof-1", sampleManifest);
    const result = await store.hasManifest("managed_profile", "prof-1");
    expect(result).toBe(true);
  });

  it("writeCookieSnapshot then readCookieSnapshot round-trips correctly", async () => {
    const cookies = Buffer.from(JSON.stringify([{ name: "session", value: "abc" }]));
    await store.writeCookieSnapshot("managed_profile", "prof-1", cookies);
    const read = await store.readCookieSnapshot("managed_profile", "prof-1");
    expect(read).toEqual(cookies);
  });

  it("readCookieSnapshot returns null when no snapshot exists", async () => {
    const result = await store.readCookieSnapshot("managed_profile", "nonexistent");
    expect(result).toBeNull();
  });

  it("ensureDir creates the directory structure", async () => {
    const dir = await store.ensureDir("managed_profile", "prof-1");
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(sessionStateDirPath(basePath, "managed_profile", "prof-1"));
  });

  it("multiple writes overwrite previous data", async () => {
    const manifest1: SnapshotManifest = { ...sampleManifest, cookieCount: 3 };
    const manifest2: SnapshotManifest = { ...sampleManifest, cookieCount: 10 };

    await store.writeManifest("managed_profile", "prof-1", manifest1);
    await store.writeManifest("managed_profile", "prof-1", manifest2);

    const read = await store.readManifest("managed_profile", "prof-1");
    expect(read).toEqual(manifest2);
    expect(read!.cookieCount).toBe(10);

    const cookies1 = Buffer.from("first");
    const cookies2 = Buffer.from("second");

    await store.writeCookieSnapshot("managed_profile", "prof-1", cookies1);
    await store.writeCookieSnapshot("managed_profile", "prof-1", cookies2);

    const readCookie = await store.readCookieSnapshot("managed_profile", "prof-1");
    expect(readCookie).toEqual(cookies2);
  });

  it("CDP and managed_profile snapshots are stored in different directories and do not collide", async () => {
    const managedManifest: SnapshotManifest = {
      profileId: "shared-id",
      target: "managed_profile",
      updatedAt: Date.now(),
      hash: "managed-hash",
      cookieCount: 3,
    };
    const cdpManifest: SnapshotManifest = {
      profileId: "shared-id",
      target: "cdp",
      updatedAt: Date.now(),
      hash: "cdp-hash",
      cookieCount: 7,
    };

    await store.writeManifest("managed_profile", "shared-id", managedManifest);
    await store.writeManifest("cdp", "shared-id", cdpManifest);

    const managedCookies = Buffer.from(JSON.stringify([{ name: "managed" }]));
    const cdpCookies = Buffer.from(JSON.stringify([{ name: "cdp" }]));

    await store.writeCookieSnapshot("managed_profile", "shared-id", managedCookies);
    await store.writeCookieSnapshot("cdp", "shared-id", cdpCookies);

    // Read back — each target's data is independent
    const readManaged = await store.readManifest("managed_profile", "shared-id");
    const readCdp = await store.readManifest("cdp", "shared-id");

    expect(readManaged!.hash).toBe("managed-hash");
    expect(readManaged!.target).toBe("managed_profile");
    expect(readManaged!.cookieCount).toBe(3);

    expect(readCdp!.hash).toBe("cdp-hash");
    expect(readCdp!.target).toBe("cdp");
    expect(readCdp!.cookieCount).toBe(7);

    const readManagedCookies = await store.readCookieSnapshot("managed_profile", "shared-id");
    const readCdpCookies = await store.readCookieSnapshot("cdp", "shared-id");

    expect(JSON.parse(readManagedCookies!.toString())).toEqual([{ name: "managed" }]);
    expect(JSON.parse(readCdpCookies!.toString())).toEqual([{ name: "cdp" }]);
  });
});

// ---------------------------------------------------------------------------
// SessionSnapshotStore with AES-256-GCM crypto
// ---------------------------------------------------------------------------

describe("SessionSnapshotStore with AES-256-GCM", () => {
  let basePath: string;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "ss-store-aes-test-"));
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("cookie snapshot round-trips through encrypted store", async () => {
    const crypto = await createAesGcmCrypto(new MemorySecretStore());
    const store = new SessionSnapshotStore(basePath, crypto);

    const cookies = Buffer.from(JSON.stringify([{ name: "session", value: "secret" }]));
    await store.writeCookieSnapshot("managed_profile", "prof-1", cookies);
    const read = await store.readCookieSnapshot("managed_profile", "prof-1");
    expect(read).toEqual(cookies);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SESSION_STATE_POLICY
// ---------------------------------------------------------------------------

describe("DEFAULT_SESSION_STATE_POLICY", () => {
  it("has mode cookies_only", () => {
    expect(DEFAULT_SESSION_STATE_POLICY.mode).toBe("cookies_only");
  });

  it("has storage local", () => {
    expect(DEFAULT_SESSION_STATE_POLICY.storage).toBe("local");
  });

  it("has checkpointIntervalSec 60", () => {
    expect(DEFAULT_SESSION_STATE_POLICY.checkpointIntervalSec).toBe(60);
  });
});
