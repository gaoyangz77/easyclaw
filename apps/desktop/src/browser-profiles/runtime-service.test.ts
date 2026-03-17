import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import type { BrowserProfileSessionStatePolicy } from "@rivonclaw/core";
import { createPlaintextCrypto } from "./session-state/crypto.js";
import { SessionSnapshotStore, sessionStateDirPath } from "./session-state/index.js";
import type { SnapshotManifest, BrowserCookie, BrowserSessionAdapter, SessionStateBackupProvider } from "./session-state/index.js";
import { BrowserProfileRuntimeService, computeCookieHash } from "./runtime-service.js";

// ── Test helpers ────────────────────────────────────────────────────────────

function makeCookies(count: number): BrowserCookie[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `cookie-${i}`,
    value: `value-${i}`,
    domain: `.example.com`,
    path: "/",
    expires: Date.now() / 1000 + 3600,
    httpOnly: false,
    secure: true,
  }));
}

function createMockAdapter(cookies: BrowserCookie[] = []): BrowserSessionAdapter & {
  setCookiesCalls: BrowserCookie[][];
  replaceCookiesCalls: BrowserCookie[][];
  getCookiesCalls: number;
} {
  const setCookiesCalls: BrowserCookie[][] = [];
  const replaceCookiesCalls: BrowserCookie[][] = [];
  let currentCookies = [...cookies];
  return {
    setCookiesCalls,
    replaceCookiesCalls,
    getCookiesCalls: 0,
    async getCookies() {
      (this as any).getCookiesCalls++;
      return currentCookies;
    },
    async setCookies(c: BrowserCookie[]) {
      setCookiesCalls.push(c);
      currentCookies = [...currentCookies, ...c];
    },
    async replaceCookies(c: BrowserCookie[]) {
      replaceCookiesCalls.push(c);
      // Replace semantics: discard old cookies, use only the snapshot
      currentCookies = [...c];
    },
  };
}

/** Default target used across most tests. */
const T = "managed_profile" as const;

// ── computeCookieHash ───────────────────────────────────────────────────────

describe("computeCookieHash", () => {
  it("produces a stable hex hash", () => {
    const cookies = makeCookies(3);
    const hash = computeCookieHash(cookies);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("same cookies in different order produce the same hash", () => {
    const cookies = makeCookies(5);
    const reversed = [...cookies].reverse();
    expect(computeCookieHash(cookies)).toBe(computeCookieHash(reversed));
  });

  it("different cookies produce different hashes", () => {
    const a = makeCookies(3);
    const b = makeCookies(4);
    expect(computeCookieHash(a)).not.toBe(computeCookieHash(b));
  });

  it("empty array produces a deterministic hash", () => {
    const h1 = computeCookieHash([]);
    const h2 = computeCookieHash([]);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ── BrowserProfileRuntimeService (Batch 1 tests preserved + Batch 2) ────────

describe("BrowserProfileRuntimeService", () => {
  let basePath: string;
  let store: SessionSnapshotStore;
  let service: BrowserProfileRuntimeService;

  const sampleMeta: SnapshotManifest = {
    profileId: "prof-1",
    target: T,
    updatedAt: Date.now(),
    hash: "sha256-deadbeef",
    cookieCount: 8,
  };

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "bp-runtime-test-"));
    store = new SessionSnapshotStore(basePath, createPlaintextCrypto());
    service = new BrowserProfileRuntimeService(store);
  });

  afterEach(async () => {
    service.stopAllCheckpointTimers();
    await rm(basePath, { recursive: true, force: true });
  });

  // ── Policy resolution (Batch 1) ────────────────────────────────────────

  describe("policy resolution", () => {
    it("returns DEFAULT_SESSION_STATE_POLICY when no resolver provides a policy", async () => {
      const policy = await service.getSessionStatePolicy("prof-1");
      expect(policy.mode).toBe("cookies_only");
      expect(policy.storage).toBe("local");
      expect(policy.checkpointIntervalSec).toBe(60);
    });

    it("profileResolver overrides the default for a specific profile", async () => {
      const custom: BrowserProfileSessionStatePolicy = {
        mode: "off",
        storage: "local",
        checkpointIntervalSec: 120,
      };
      const resolver = (id: string) => (id === "prof-1" ? custom : null);
      const svc = new BrowserProfileRuntimeService(store, resolver);
      expect(await svc.getSessionStatePolicy("prof-1")).toEqual(custom);
    });

    it("different profiles can have different policies via resolver", async () => {
      const policyA: BrowserProfileSessionStatePolicy = {
        mode: "cookies_only",
        storage: "local",
        checkpointIntervalSec: 30,
      };
      const policyB: BrowserProfileSessionStatePolicy = {
        mode: "cookies_and_storage",
        storage: "cloud",
        checkpointIntervalSec: 300,
      };

      const resolver = (id: string) => {
        if (id === "a") return policyA;
        if (id === "b") return policyB;
        return null;
      };
      const svc = new BrowserProfileRuntimeService(store, resolver);

      expect(await svc.getSessionStatePolicy("a")).toEqual(policyA);
      expect(await svc.getSessionStatePolicy("b")).toEqual(policyB);
    });

    it("resolver returning null falls back to default", async () => {
      const custom: BrowserProfileSessionStatePolicy = {
        mode: "off",
        storage: "local",
        checkpointIntervalSec: 0,
      };
      const resolver = (id: string) => (id === "prof-1" ? custom : null);
      const svc = new BrowserProfileRuntimeService(store, resolver);

      const otherPolicy = await svc.getSessionStatePolicy("prof-2");
      expect(otherPolicy.mode).toBe("cookies_only");
    });

    it("supports async profileResolver", async () => {
      const custom: BrowserProfileSessionStatePolicy = {
        mode: "cookies_and_storage",
        storage: "local",
        checkpointIntervalSec: 90,
      };
      const resolver = async (id: string) => {
        if (id === "async-prof") return custom;
        return null;
      };
      const svc = new BrowserProfileRuntimeService(store, resolver);
      expect(await svc.getSessionStatePolicy("async-prof")).toEqual(custom);
    });
  });

  // ── Prepare (Batch 1) ──────────────────────────────────────────────────

  describe("prepare", () => {
    it("creates the session-state directory", async () => {
      await service.prepare("prof-1", T);
      const dir = sessionStateDirPath(basePath, T, "prof-1");
      expect(existsSync(dir)).toBe(true);
    });

    it("returns the effective policy", async () => {
      const policy = await service.prepare("prof-1", T);
      expect(policy.mode).toBe("cookies_only");
    });
  });

  // ── Snapshot meta (Batch 1) ────────────────────────────────────────────

  describe("snapshot meta", () => {
    it("loadSnapshotMeta returns null when no snapshot exists", async () => {
      const meta = await service.loadSnapshotMeta(T, "prof-1");
      expect(meta).toBeNull();
    });

    it("saveSnapshotMeta then loadSnapshotMeta round-trips", async () => {
      await service.saveSnapshotMeta(T, "prof-1", sampleMeta);
      const loaded = await service.loadSnapshotMeta(T, "prof-1");
      expect(loaded).toEqual(sampleMeta);
    });

    it("different profiles have independent snapshots", async () => {
      const metaA: SnapshotManifest = { ...sampleMeta, profileId: "a", cookieCount: 2 };
      const metaB: SnapshotManifest = { ...sampleMeta, profileId: "b", cookieCount: 7 };

      await service.saveSnapshotMeta(T, "a", metaA);
      await service.saveSnapshotMeta(T, "b", metaB);

      const loadedA = await service.loadSnapshotMeta(T, "a");
      const loadedB = await service.loadSnapshotMeta(T, "b");

      expect(loadedA).toEqual(metaA);
      expect(loadedB).toEqual(metaB);
      expect(loadedA!.cookieCount).not.toBe(loadedB!.cookieCount);
    });
  });

  // ── shouldRestoreOnLaunch (Batch 1) ────────────────────────────────────

  describe("shouldRestoreOnLaunch", () => {
    it("returns false when policy mode is off", async () => {
      const svc = new BrowserProfileRuntimeService(store, () => ({
        mode: "off" as const,
        storage: "local" as const,
        checkpointIntervalSec: 60,
      }));
      const result = await svc.shouldRestoreOnLaunch(T, "prof-1");
      expect(result).toBe(false);
    });

    it("returns false when no manifest exists", async () => {
      const result = await service.shouldRestoreOnLaunch(T, "prof-1");
      expect(result).toBe(false);
    });

    it("returns true when mode is not off and manifest exists", async () => {
      await service.saveSnapshotMeta(T, "prof-1", sampleMeta);
      const result = await service.shouldRestoreOnLaunch(T, "prof-1");
      expect(result).toBe(true);
    });
  });

  // ── restoreSessionState (Batch 2) ──────────────────────────────────────

  describe("restoreSessionState", () => {
    it("restores cookies from snapshot when policy allows", async () => {
      // Seed a snapshot
      const cookies = makeCookies(3);
      await store.writeCookieSnapshot(T, "prof-1", Buffer.from(JSON.stringify(cookies)));
      const hash = computeCookieHash(cookies);
      await store.writeManifest(T, "prof-1", {
        profileId: "prof-1",
        target: T,
        updatedAt: Date.now(),
        hash,
        cookieCount: cookies.length,
      });

      const adapter = createMockAdapter();
      const result = await service.restoreSessionState("prof-1", adapter, T);

      expect(result).toBe(true);
      expect(adapter.replaceCookiesCalls).toHaveLength(1);
      expect(adapter.replaceCookiesCalls[0]).toHaveLength(3);
      // setCookies should NOT be called — restore uses replaceCookies
      expect(adapter.setCookiesCalls).toHaveLength(0);
    });

    it("skips restore when mode is off", async () => {
      const svc = new BrowserProfileRuntimeService(store, () => ({
        mode: "off" as const,
        storage: "local" as const,
        checkpointIntervalSec: 60,
      }));
      const adapter = createMockAdapter();
      const result = await svc.restoreSessionState("prof-1", adapter, T);
      expect(result).toBe(false);
      expect(adapter.setCookiesCalls).toHaveLength(0);
    });

    it("skips restore when no snapshot exists", async () => {
      const adapter = createMockAdapter();
      const result = await service.restoreSessionState("prof-1", adapter, T);
      expect(result).toBe(false);
    });

    it("uses replaceCookies (not setCookies) so old cookies are replaced, not accumulated", async () => {
      // Seed a snapshot with 2 cookies
      const snapshotCookies = makeCookies(2);
      await store.writeCookieSnapshot(T, "prof-1", Buffer.from(JSON.stringify(snapshotCookies)));
      const hash = computeCookieHash(snapshotCookies);
      await store.writeManifest(T, "prof-1", {
        profileId: "prof-1",
        target: T,
        updatedAt: Date.now(),
        hash,
        cookieCount: snapshotCookies.length,
      });

      // Adapter starts with 3 pre-existing cookies (simulating stale state)
      const preExisting = makeCookies(3).map((c, i) => ({ ...c, name: `stale-${i}` }));
      const adapter = createMockAdapter(preExisting);

      const result = await service.restoreSessionState("prof-1", adapter, T);
      expect(result).toBe(true);

      // replaceCookies was called (not setCookies)
      expect(adapter.replaceCookiesCalls).toHaveLength(1);
      expect(adapter.setCookiesCalls).toHaveLength(0);

      // After replace, adapter should have exactly the snapshot cookies (stale ones gone)
      const currentCookies = await adapter.getCookies();
      expect(currentCookies).toHaveLength(2);
      expect(currentCookies.every((c) => c.name.startsWith("cookie-"))).toBe(true);
    });

    it("does not throw when adapter.replaceCookies fails", async () => {
      // Seed a snapshot
      await store.writeCookieSnapshot(T, "prof-1", Buffer.from(JSON.stringify(makeCookies(1))));

      const adapter: BrowserSessionAdapter = {
        getCookies: async () => [],
        setCookies: async () => {},
        replaceCookies: async () => {
          throw new Error("browser crashed");
        },
      };
      // Should not throw — just return false
      const result = await service.restoreSessionState("prof-1", adapter, T);
      expect(result).toBe(false);
    });
  });

  // ── checkpointSessionState (Batch 2) ───────────────────────────────────

  describe("checkpointSessionState", () => {
    it("writes snapshot on first checkpoint", async () => {
      const cookies = makeCookies(5);
      const adapter = createMockAdapter(cookies);

      const result = await service.checkpointSessionState("prof-1", adapter, T);
      expect(result.skipped).toBe(false);
      expect(result.reason).toBe("written");
      expect(result.cookieCount).toBe(5);

      // Verify manifest was written
      const meta = await store.readManifest(T, "prof-1");
      expect(meta).not.toBeNull();
      expect(meta!.cookieCount).toBe(5);
      expect(meta!.target).toBe(T);
    });

    it("skips write when cookies unchanged (incremental diff)", async () => {
      const cookies = makeCookies(3);
      const adapter = createMockAdapter(cookies);

      // First checkpoint writes
      const r1 = await service.checkpointSessionState("prof-1", adapter, T);
      expect(r1.skipped).toBe(false);

      // Second checkpoint with same cookies skips
      const r2 = await service.checkpointSessionState("prof-1", adapter, T);
      expect(r2.skipped).toBe(true);
      expect(r2.reason).toBe("no_change");
    });

    it("writes when cookies change", async () => {
      const cookies = makeCookies(3);
      const adapter = createMockAdapter(cookies);

      // First checkpoint
      await service.checkpointSessionState("prof-1", adapter, T);
      const meta1 = await store.readManifest(T, "prof-1");

      // Mutate cookies via adapter
      const newAdapter = createMockAdapter([...cookies, ...makeCookies(2)]);
      const r2 = await service.checkpointSessionState("prof-1", newAdapter, T);

      expect(r2.skipped).toBe(false);
      expect(r2.reason).toBe("written");
      expect(r2.cookieCount).toBe(5);

      const meta2 = await store.readManifest(T, "prof-1");
      expect(meta2!.hash).not.toBe(meta1!.hash);
      expect(meta2!.cookieCount).toBe(5);
    });

    it("skips when mode is off", async () => {
      const svc = new BrowserProfileRuntimeService(store, () => ({
        mode: "off" as const,
        storage: "local" as const,
        checkpointIntervalSec: 60,
      }));
      const adapter = createMockAdapter(makeCookies(3));
      const result = await svc.checkpointSessionState("prof-1", adapter, T);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("mode_off");
    });

    it("cookies_only mode works for checkpoint", async () => {
      // Default policy is cookies_only
      const adapter = createMockAdapter(makeCookies(2));
      const result = await service.checkpointSessionState("prof-1", adapter, T);
      expect(result.skipped).toBe(false);
      expect(result.cookieCount).toBe(2);
    });
  });

  // ── flushSessionState (Batch 2) ────────────────────────────────────────

  describe("flushSessionState", () => {
    it("skips write when hash matches previous", async () => {
      const cookies = makeCookies(4);
      const adapter = createMockAdapter(cookies);

      // Checkpoint first
      await service.checkpointSessionState("prof-1", adapter, T);
      const meta1 = await store.readManifest(T, "prof-1");

      // Flush same data — should skip (no change)
      await service.flushSessionState("prof-1", adapter, T);
      const meta2 = await store.readManifest(T, "prof-1");

      expect(meta2!.hash).toBe(meta1!.hash);
      // updatedAt should be unchanged because flush skipped
      expect(meta2!.updatedAt).toBe(meta1!.updatedAt);
    });

    it("writes when hash changed from previous", async () => {
      const cookies = makeCookies(4);
      const adapter = createMockAdapter(cookies);

      // Checkpoint first
      await service.checkpointSessionState("prof-1", adapter, T);
      const meta1 = await store.readManifest(T, "prof-1");

      // Flush with different data — should write
      const newAdapter = createMockAdapter([...cookies, ...makeCookies(2)]);
      await service.flushSessionState("prof-1", newAdapter, T);
      const meta2 = await store.readManifest(T, "prof-1");

      expect(meta2!.hash).not.toBe(meta1!.hash);
      expect(meta2!.cookieCount).toBe(6);
    });

    it("captures final state correctly", async () => {
      const adapter = createMockAdapter(makeCookies(7));
      await service.flushSessionState("prof-1", adapter, T);

      const meta = await store.readManifest(T, "prof-1");
      expect(meta).not.toBeNull();
      expect(meta!.cookieCount).toBe(7);
      expect(meta!.target).toBe(T);

      // Verify snapshot is readable
      const raw = await store.readCookieSnapshot(T, "prof-1");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!.toString("utf-8"));
      expect(parsed).toHaveLength(7);
    });

    it("skips when mode is off", async () => {
      const svc = new BrowserProfileRuntimeService(store, () => ({
        mode: "off" as const,
        storage: "local" as const,
        checkpointIntervalSec: 60,
      }));
      const adapter = createMockAdapter(makeCookies(3));
      await svc.flushSessionState("prof-1", adapter, T);

      // Nothing should be written
      const meta = await store.readManifest(T, "prof-1");
      expect(meta).toBeNull();
    });
  });

  // ── Checkpoint Timer (Batch 2) ─────────────────────────────────────────

  describe("checkpoint timer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      service.stopAllCheckpointTimers();
      vi.useRealTimers();
    });

    it("starts and can be stopped", async () => {
      const adapter = createMockAdapter(makeCookies(2));
      await service.startCheckpointTimer("prof-1", adapter, T);

      expect(service.hasCheckpointTimer("prof-1")).toBe(true);
      service.stopCheckpointTimer("prof-1");
      expect(service.hasCheckpointTimer("prof-1")).toBe(false);
    });

    it("does not start when mode is off", async () => {
      const svc = new BrowserProfileRuntimeService(store, () => ({
        mode: "off" as const,
        storage: "local" as const,
        checkpointIntervalSec: 60,
      }));
      const adapter = createMockAdapter(makeCookies(2));
      await svc.startCheckpointTimer("prof-1", adapter, T);

      expect(svc.hasCheckpointTimer("prof-1")).toBe(false);
    });

    it("fires checkpoint at interval", async () => {
      // Use a short interval via resolver
      const svc = new BrowserProfileRuntimeService(store, () => ({
        mode: "cookies_only" as const,
        storage: "local" as const,
        checkpointIntervalSec: 10,
      }));

      const adapter = createMockAdapter(makeCookies(3));
      const checkpointSpy = vi.spyOn(svc, "checkpointSessionState");

      await svc.startCheckpointTimer("prof-1", adapter, T);

      // Before interval — not called
      expect(checkpointSpy).not.toHaveBeenCalled();

      // Advance past first interval
      await vi.advanceTimersByTimeAsync(10_000);

      expect(checkpointSpy).toHaveBeenCalledTimes(1);
      expect(checkpointSpy).toHaveBeenCalledWith("prof-1", adapter, T);

      // Advance past second interval
      await vi.advanceTimersByTimeAsync(10_000);
      expect(checkpointSpy).toHaveBeenCalledTimes(2);

      svc.stopAllCheckpointTimers();
    });

    it("replaces existing timer when started again", async () => {
      const adapter1 = createMockAdapter(makeCookies(2));
      const adapter2 = createMockAdapter(makeCookies(5));

      await service.startCheckpointTimer("prof-1", adapter1, T);
      expect(service.hasCheckpointTimer("prof-1")).toBe(true);

      const checkpointSpy = vi.spyOn(service, "checkpointSessionState");

      // Start again with different adapter — should stop old timer
      await service.startCheckpointTimer("prof-1", adapter2, T);
      expect(service.hasCheckpointTimer("prof-1")).toBe(true);

      // Advance timer — should use adapter2
      await vi.advanceTimersByTimeAsync(60_000);

      expect(checkpointSpy).toHaveBeenCalledWith("prof-1", adapter2, T);
    });

    it("stopAllCheckpointTimers clears all timers", async () => {
      const adapter = createMockAdapter(makeCookies(1));
      await service.startCheckpointTimer("a", adapter, T);
      await service.startCheckpointTimer("b", adapter, T);

      expect(service.hasCheckpointTimer("a")).toBe(true);
      expect(service.hasCheckpointTimer("b")).toBe(true);

      service.stopAllCheckpointTimers();

      expect(service.hasCheckpointTimer("a")).toBe(false);
      expect(service.hasCheckpointTimer("b")).toBe(false);
    });
  });

  // ── Cloud backup provider integration ──────────────────────────────────

  describe("cloud backup", () => {
    function createMockBackupProvider(overrides?: Partial<SessionStateBackupProvider>) {
      const calls = {
        upload: [] as Array<{ profileId: string; manifest: SnapshotManifest; payload: Buffer }>,
        download: [] as Array<{ profileId: string }>,
        delete: [] as Array<{ profileId: string }>,
      };
      const provider: SessionStateBackupProvider = {
        async upload(profileId, manifest, payload) {
          calls.upload.push({ profileId, manifest, payload });
          return overrides?.upload ? overrides.upload(profileId, manifest, payload) : true;
        },
        async download(profileId) {
          calls.download.push({ profileId });
          return overrides?.download ? overrides.download(profileId) : null;
        },
        async delete(profileId) {
          calls.delete.push({ profileId });
          if (overrides?.delete) await overrides.delete(profileId);
        },
      };
      return { provider, calls };
    }

    const cloudPolicy: BrowserProfileSessionStatePolicy = {
      mode: "cookies_only",
      storage: "cloud",
      checkpointIntervalSec: 60,
    };

    const localPolicy: BrowserProfileSessionStatePolicy = {
      mode: "cookies_only",
      storage: "local",
      checkpointIntervalSec: 60,
    };

    it("storage=local does NOT trigger upload on checkpoint", async () => {
      const { provider, calls } = createMockBackupProvider();
      const svc = new BrowserProfileRuntimeService(store, () => localPolicy, provider);
      const adapter = createMockAdapter(makeCookies(3));

      await svc.checkpointSessionState("prof-1", adapter, T);

      // Allow microtasks to settle (upload is fire-and-forget)
      await new Promise((r) => setTimeout(r, 10));
      expect(calls.upload).toHaveLength(0);
    });

    it("storage=cloud triggers upload after checkpoint", async () => {
      const { provider, calls } = createMockBackupProvider();
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const adapter = createMockAdapter(makeCookies(3));

      await svc.checkpointSessionState("prof-1", adapter, T);

      // Allow microtasks to settle
      await new Promise((r) => setTimeout(r, 10));
      expect(calls.upload).toHaveLength(1);
      expect(calls.upload[0].profileId).toBe("prof-1");
      expect(calls.upload[0].manifest.cookieCount).toBe(3);
    });

    it("storage=cloud triggers upload after flush", async () => {
      const { provider, calls } = createMockBackupProvider();
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const adapter = createMockAdapter(makeCookies(5));

      await svc.flushSessionState("prof-1", adapter, T);

      await new Promise((r) => setTimeout(r, 10));
      expect(calls.upload).toHaveLength(1);
      expect(calls.upload[0].manifest.cookieCount).toBe(5);
    });

    it("restore with local miss falls back to cloud download", async () => {
      const cloudCookies = makeCookies(4);
      const cloudPayload = Buffer.from(JSON.stringify(cloudCookies), "utf-8");
      const cloudManifest: SnapshotManifest = {
        profileId: "prof-1",
        target: T,
        updatedAt: Date.now(),
        hash: computeCookieHash(cloudCookies),
        cookieCount: cloudCookies.length,
      };

      const { provider, calls } = createMockBackupProvider({
        async download() {
          return { manifest: cloudManifest, payload: cloudPayload };
        },
      });
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const adapter = createMockAdapter();

      const result = await svc.restoreSessionState("prof-1", adapter, T);

      expect(result).toBe(true);
      expect(calls.download).toHaveLength(1);
      expect(adapter.replaceCookiesCalls).toHaveLength(1);
      expect(adapter.replaceCookiesCalls[0]).toHaveLength(4);

      // Verify the cloud data was cached locally
      const localManifest = await store.readManifest(T, "prof-1");
      expect(localManifest).not.toBeNull();
      expect(localManifest!.cookieCount).toBe(4);
    });

    it("restore with local miss and cloud miss returns false", async () => {
      const { provider } = createMockBackupProvider();
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const adapter = createMockAdapter();

      const result = await svc.restoreSessionState("prof-1", adapter, T);
      expect(result).toBe(false);
    });

    it("upload failure is non-fatal during checkpoint", async () => {
      const { provider } = createMockBackupProvider({
        async upload() {
          throw new Error("network error");
        },
      });
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const adapter = createMockAdapter(makeCookies(2));

      const result = await svc.checkpointSessionState("prof-1", adapter, T);

      // Checkpoint itself should still succeed
      expect(result.skipped).toBe(false);
      expect(result.reason).toBe("written");

      // Allow the fire-and-forget upload promise to settle
      await new Promise((r) => setTimeout(r, 10));
    });

    it("download failure is non-fatal during restore", async () => {
      const { provider } = createMockBackupProvider({
        async download() {
          throw new Error("network error");
        },
      });
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const adapter = createMockAdapter();

      // Should not throw
      const result = await svc.restoreSessionState("prof-1", adapter, T);
      expect(result).toBe(false);
    });

    it("restore: local stale, cloud fresher → uses cloud", async () => {
      // Seed local snapshot with old updatedAt
      const localCookies = makeCookies(2);
      const localPayload = Buffer.from(JSON.stringify(localCookies), "utf-8");
      await store.writeCookieSnapshot(T, "prof-1", localPayload);
      await store.writeManifest(T, "prof-1", {
        profileId: "prof-1",
        target: T,
        updatedAt: 1000,
        hash: computeCookieHash(localCookies),
        cookieCount: localCookies.length,
      });

      // Cloud has fresher data
      const cloudCookies = makeCookies(5);
      const cloudPayload = Buffer.from(JSON.stringify(cloudCookies), "utf-8");
      const cloudManifest: SnapshotManifest = {
        profileId: "prof-1",
        target: T,
        updatedAt: 2000,
        hash: computeCookieHash(cloudCookies),
        cookieCount: cloudCookies.length,
      };

      const { provider, calls } = createMockBackupProvider({
        async download() {
          return { manifest: cloudManifest, payload: cloudPayload };
        },
      });
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const adapter = createMockAdapter();

      const result = await svc.restoreSessionState("prof-1", adapter, T);

      expect(result).toBe(true);
      expect(calls.download).toHaveLength(1);
      expect(adapter.replaceCookiesCalls).toHaveLength(1);
      expect(adapter.replaceCookiesCalls[0]).toHaveLength(5); // cloud cookies, not local

      // Verify local cache was updated with cloud data
      const localManifest = await store.readManifest(T, "prof-1");
      expect(localManifest!.updatedAt).toBe(2000);
      expect(localManifest!.cookieCount).toBe(5);
    });

    it("restore: local fresher, cloud older → uses local", async () => {
      // Seed local snapshot with newer updatedAt
      const localCookies = makeCookies(3);
      const localPayload = Buffer.from(JSON.stringify(localCookies), "utf-8");
      await store.writeCookieSnapshot(T, "prof-1", localPayload);
      await store.writeManifest(T, "prof-1", {
        profileId: "prof-1",
        target: T,
        updatedAt: 2000,
        hash: computeCookieHash(localCookies),
        cookieCount: localCookies.length,
      });

      // Cloud has older data
      const cloudCookies = makeCookies(7);
      const cloudPayload = Buffer.from(JSON.stringify(cloudCookies), "utf-8");
      const cloudManifest: SnapshotManifest = {
        profileId: "prof-1",
        target: T,
        updatedAt: 1000,
        hash: computeCookieHash(cloudCookies),
        cookieCount: cloudCookies.length,
      };

      const { provider } = createMockBackupProvider({
        async download() {
          return { manifest: cloudManifest, payload: cloudPayload };
        },
      });
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const adapter = createMockAdapter();

      const result = await svc.restoreSessionState("prof-1", adapter, T);

      expect(result).toBe(true);
      expect(adapter.replaceCookiesCalls).toHaveLength(1);
      expect(adapter.replaceCookiesCalls[0]).toHaveLength(3); // local cookies, not cloud

      // Local manifest should be unchanged
      const localManifest = await store.readManifest(T, "prof-1");
      expect(localManifest!.updatedAt).toBe(2000);
    });

    it("restore: cloud unreachable, local exists → uses local with warning", async () => {
      // Seed local snapshot
      const localCookies = makeCookies(4);
      const localPayload = Buffer.from(JSON.stringify(localCookies), "utf-8");
      await store.writeCookieSnapshot(T, "prof-1", localPayload);
      await store.writeManifest(T, "prof-1", {
        profileId: "prof-1",
        target: T,
        updatedAt: 1000,
        hash: computeCookieHash(localCookies),
        cookieCount: localCookies.length,
      });

      const { provider } = createMockBackupProvider({
        async download() {
          throw new Error("network timeout");
        },
      });
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const adapter = createMockAdapter();

      const result = await svc.restoreSessionState("prof-1", adapter, T);

      expect(result).toBe(true);
      expect(adapter.replaceCookiesCalls).toHaveLength(1);
      expect(adapter.replaceCookiesCalls[0]).toHaveLength(4);
    });

    it("flush skips when hash unchanged (no cloud upload)", async () => {
      const { provider, calls } = createMockBackupProvider();
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const cookies = makeCookies(3);
      const adapter = createMockAdapter(cookies);

      // Initial checkpoint writes
      await svc.checkpointSessionState("prof-1", adapter, T);
      await new Promise((r) => setTimeout(r, 10));
      const initialUploadCount = calls.upload.length;

      // Flush same data — should skip entirely (no write, no upload)
      await svc.flushSessionState("prof-1", adapter, T);
      await new Promise((r) => setTimeout(r, 10));

      expect(calls.upload.length).toBe(initialUploadCount);
    });

    it("flush writes and uploads when hash changed", async () => {
      const { provider, calls } = createMockBackupProvider();
      const svc = new BrowserProfileRuntimeService(store, () => cloudPolicy, provider);
      const cookies = makeCookies(3);
      const adapter = createMockAdapter(cookies);

      // Initial checkpoint
      await svc.checkpointSessionState("prof-1", adapter, T);
      await new Promise((r) => setTimeout(r, 10));

      // Flush with different data
      const newAdapter = createMockAdapter([...cookies, ...makeCookies(2)]);
      await svc.flushSessionState("prof-1", newAdapter, T);
      await new Promise((r) => setTimeout(r, 10));

      // Should have 2 uploads total: one from checkpoint, one from flush
      expect(calls.upload.length).toBe(2);
      expect(calls.upload[1].manifest.cookieCount).toBe(5);
    });

    it("storage=local never calls download or upload during restore", async () => {
      // Seed a local snapshot
      const localCookies = makeCookies(3);
      await store.writeCookieSnapshot(T, "prof-1", Buffer.from(JSON.stringify(localCookies)));
      await store.writeManifest(T, "prof-1", {
        profileId: "prof-1",
        target: T,
        updatedAt: Date.now(),
        hash: computeCookieHash(localCookies),
        cookieCount: localCookies.length,
      });

      const { provider, calls } = createMockBackupProvider();
      const svc = new BrowserProfileRuntimeService(store, () => localPolicy, provider);
      const adapter = createMockAdapter();

      await svc.restoreSessionState("prof-1", adapter, T);

      expect(calls.download).toHaveLength(0);
      expect(calls.upload).toHaveLength(0);
      expect(adapter.replaceCookiesCalls).toHaveLength(1);
      expect(adapter.replaceCookiesCalls[0]).toHaveLength(3);
    });
  });

  // ── getRuntimeStateSummary (extended for Batch 2) ──────────────────────

  describe("getRuntimeStateSummary", () => {
    it("returns correct summary with no snapshot", async () => {
      const summary = await service.getRuntimeStateSummary(T, "prof-1");
      expect(summary.profileId).toBe("prof-1");
      expect(summary.hasSnapshot).toBe(false);
      expect(summary.snapshotMeta).toBeNull();
      expect(summary.policy.mode).toBe("cookies_only");
    });

    it("returns correct summary after saving a snapshot", async () => {
      await service.saveSnapshotMeta(T, "prof-1", sampleMeta);
      const summary = await service.getRuntimeStateSummary(T, "prof-1");
      expect(summary.profileId).toBe("prof-1");
      expect(summary.hasSnapshot).toBe(true);
      expect(summary.snapshotMeta).toEqual(sampleMeta);
      expect(summary.policy.mode).toBe("cookies_only");
    });

    it("includes lastRestoreAt after restore", async () => {
      const cookies = makeCookies(2);
      await store.writeCookieSnapshot(T, "prof-1", Buffer.from(JSON.stringify(cookies)));
      await store.writeManifest(T, "prof-1", {
        profileId: "prof-1",
        target: T,
        updatedAt: Date.now(),
        hash: computeCookieHash(cookies),
        cookieCount: 2,
      });

      const adapter = createMockAdapter();
      await service.restoreSessionState("prof-1", adapter, T);

      const summary = await service.getRuntimeStateSummary(T, "prof-1");
      expect(summary.lastRestoreAt).toBeDefined();
      expect(summary.lastRestoreAt).toBeGreaterThan(0);
    });

    it("includes lastCheckpointAt after checkpoint", async () => {
      const adapter = createMockAdapter(makeCookies(2));
      await service.checkpointSessionState("prof-1", adapter, T);

      const summary = await service.getRuntimeStateSummary(T, "prof-1");
      expect(summary.lastCheckpointAt).toBeDefined();
      expect(summary.lastCheckpointAt).toBeGreaterThan(0);
    });
  });
});
