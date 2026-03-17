import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionStateStack } from "./session-state-wiring.js";
import { SessionLifecycleManager } from "./session-lifecycle-manager.js";
import { BrowserProfileRuntimeService } from "./runtime-service.js";
import { SessionSnapshotStore, cookieSnapshotPath } from "./session-state/index.js";
import type { BrowserSessionAdapter, BrowserCookie } from "./session-state/index.js";
import { MemorySecretStore } from "@rivonclaw/secrets";

function createMockAdapter(cookies: BrowserCookie[] = []): BrowserSessionAdapter {
  return {
    getCookies: async () => cookies,
    setCookies: async () => {},
    replaceCookies: async () => {},
  };
}

describe("createSessionStateStack", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true }).catch(() => {});
    }
    dirs.length = 0;
  });

  it("returns all three components with correct types", async () => {
    const stack = await createSessionStateStack("/tmp/test-session-state-wiring", new MemorySecretStore());
    expect(stack.lifecycleManager).toBeInstanceOf(SessionLifecycleManager);
    expect(stack.runtimeService).toBeInstanceOf(BrowserProfileRuntimeService);
    expect(stack.store).toBeInstanceOf(SessionSnapshotStore);
  });

  it("lifecycle manager is connected to runtime service", async () => {
    const stack = await createSessionStateStack("/tmp/test-session-state-wiring-2", new MemorySecretStore());
    await stack.lifecycleManager.endAllSessions();
    expect(stack.lifecycleManager.activeSessionCount).toBe(0);
  });

  it("startSession activates session tracking, checkpoint timer, and endSession flushes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wiring-lifecycle-"));
    dirs.push(dir);
    const stack = await createSessionStateStack(dir, new MemorySecretStore());

    const adapter = createMockAdapter([
      { name: "sid", value: "abc", domain: ".example.com", path: "/", expires: 0, httpOnly: true, secure: true },
    ]);

    // startSession should activate the full lifecycle
    await stack.lifecycleManager.startSession("prof-1", adapter);

    expect(stack.lifecycleManager.hasActiveSession("prof-1")).toBe(true);
    expect(stack.lifecycleManager.activeSessionCount).toBe(1);
    expect(stack.runtimeService.hasCheckpointTimer("prof-1")).toBe(true);

    // endSession should flush and clean up
    await stack.lifecycleManager.endSession("prof-1");

    expect(stack.lifecycleManager.hasActiveSession("prof-1")).toBe(false);
    expect(stack.lifecycleManager.activeSessionCount).toBe(0);
    expect(stack.runtimeService.hasCheckpointTimer("prof-1")).toBe(false);

    // Verify snapshot was written by the flush
    const manifest = await stack.store.readManifest("managed_profile", "prof-1");
    expect(manifest).not.toBeNull();
    expect(manifest!.cookieCount).toBe(1);
    expect(manifest!.target).toBe("managed_profile");
  });

  it("startSession with managed_profile target uses real profileId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wiring-managed-"));
    dirs.push(dir);
    const stack = await createSessionStateStack(dir, new MemorySecretStore());

    const adapter = createMockAdapter([
      { name: "sid", value: "abc", domain: ".example.com", path: "/", expires: 0, httpOnly: true, secure: true },
    ]);

    // managed_profile is the default target
    await stack.lifecycleManager.startSession("real-profile-uuid", adapter);
    expect(stack.lifecycleManager.hasActiveSession("real-profile-uuid")).toBe(true);
    expect(stack.lifecycleManager.getSessionTarget("real-profile-uuid")).toBe("managed_profile");

    await stack.lifecycleManager.endSession("real-profile-uuid");
  });

  it("startSession with cdp target uses __cdp__ scope key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wiring-cdp-"));
    dirs.push(dir);
    const stack = await createSessionStateStack(dir, new MemorySecretStore());

    const adapter = createMockAdapter();
    await stack.lifecycleManager.startSession("__cdp__", adapter, "cdp");
    expect(stack.lifecycleManager.getSessionTarget("__cdp__")).toBe("cdp");
    expect(stack.lifecycleManager.hasActiveSession("__cdp__")).toBe(true);

    await stack.lifecycleManager.endSession("__cdp__");
  });

  it("does not confuse __cdp__ with managed profile semantics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wiring-no-confuse-"));
    dirs.push(dir);
    const stack = await createSessionStateStack(dir, new MemorySecretStore());

    const cdpAdapter = createMockAdapter();
    const managedAdapter = createMockAdapter([
      { name: "x", value: "1", domain: ".a.com", path: "/", expires: 0, httpOnly: false, secure: false },
    ]);

    await stack.lifecycleManager.startSession("__cdp__", cdpAdapter, "cdp");
    await stack.lifecycleManager.startSession("profile-abc", managedAdapter, "managed_profile");

    expect(stack.lifecycleManager.getSessionTarget("__cdp__")).toBe("cdp");
    expect(stack.lifecycleManager.getSessionTarget("profile-abc")).toBe("managed_profile");
    expect(stack.lifecycleManager.activeSessionCount).toBe(2);

    await stack.lifecycleManager.endAllSessions();
  });

  it("endAllSessions flushes all active sessions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wiring-endall-"));
    dirs.push(dir);
    const stack = await createSessionStateStack(dir, new MemorySecretStore());

    await stack.lifecycleManager.startSession("a", createMockAdapter([
      { name: "x", value: "1", domain: ".a.com", path: "/", expires: 0, httpOnly: false, secure: false },
    ]));
    await stack.lifecycleManager.startSession("b", createMockAdapter([
      { name: "y", value: "2", domain: ".b.com", path: "/", expires: 0, httpOnly: false, secure: false },
    ]));

    expect(stack.lifecycleManager.activeSessionCount).toBe(2);

    await stack.lifecycleManager.endAllSessions();

    expect(stack.lifecycleManager.activeSessionCount).toBe(0);

    // Both profiles should have snapshots from flush (default target is managed_profile)
    const mA = await stack.store.readManifest("managed_profile", "a");
    const mB = await stack.store.readManifest("managed_profile", "b");
    expect(mA).not.toBeNull();
    expect(mB).not.toBeNull();
  });

  it("CDP and managed_profile sessions write to separate storage paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wiring-target-isolation-"));
    dirs.push(dir);
    const stack = await createSessionStateStack(dir, new MemorySecretStore());

    const cdpCookies = [
      { name: "cdp-cookie", value: "1", domain: ".cdp.com", path: "/", expires: 0, httpOnly: false, secure: false },
    ];
    const managedCookies = [
      { name: "managed-cookie", value: "2", domain: ".managed.com", path: "/", expires: 0, httpOnly: false, secure: false },
    ];

    await stack.lifecycleManager.startSession("__cdp__", createMockAdapter(cdpCookies), "cdp");
    await stack.lifecycleManager.startSession("prof-1", createMockAdapter(managedCookies), "managed_profile");

    await stack.lifecycleManager.endAllSessions();

    // Each target's snapshot is in its own directory
    const cdpManifest = await stack.store.readManifest("cdp", "__cdp__");
    const managedManifest = await stack.store.readManifest("managed_profile", "prof-1");

    expect(cdpManifest).not.toBeNull();
    expect(cdpManifest!.target).toBe("cdp");
    expect(cdpManifest!.cookieCount).toBe(1);

    expect(managedManifest).not.toBeNull();
    expect(managedManifest!.target).toBe("managed_profile");
    expect(managedManifest!.cookieCount).toBe(1);

    // Cross-check: CDP data is NOT accessible via managed_profile path
    const crossCheck = await stack.store.readManifest("managed_profile", "__cdp__");
    expect(crossCheck).toBeNull();
  });

  it("production wiring encrypts snapshot files (not plaintext JSON)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wiring-encrypted-"));
    dirs.push(dir);
    const stack = await createSessionStateStack(dir, new MemorySecretStore());

    const cookies = [
      { name: "secret", value: "sensitive-value", domain: ".example.com", path: "/", expires: 0, httpOnly: true, secure: true },
    ];

    await stack.lifecycleManager.startSession("prof-enc", createMockAdapter(cookies));
    await stack.lifecycleManager.endSession("prof-enc");

    // Read the raw file on disk — it should NOT be valid JSON
    const snapshotFile = cookieSnapshotPath(dir, "managed_profile", "prof-enc");
    const raw = await readFile(snapshotFile);

    // Encrypted files start with version byte (0x01), not a JSON character
    expect(raw[0]).toBe(1);

    // The raw bytes should not contain the plaintext cookie value
    expect(raw.toString("utf-8")).not.toContain("sensitive-value");
  });
});
