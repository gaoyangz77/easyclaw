import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManagedBrowserService } from "./managed-browser-service.js";
import { createSessionStateStack } from "./session-state-wiring.js";
import { MemorySecretStore } from "@rivonclaw/secrets";

describe("ManagedBrowserService", () => {
  let dir: string;
  let browserDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "managed-browser-"));
    browserDir = join(dir, "browsers");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("allocatePort assigns unique ports from the managed range", async () => {
    const stack = await createSessionStateStack(join(dir, "ss"), new MemorySecretStore());
    const svc = new ManagedBrowserService(stack.lifecycleManager, browserDir);

    const portA = svc.allocatePort("profile-a");
    const portB = svc.allocatePort("profile-b");

    expect(portA).toBe(18800);
    expect(portB).toBe(18801);
    expect(portA).not.toBe(portB);
  });

  it("allocatePort returns same port for same profile", async () => {
    const stack = await createSessionStateStack(join(dir, "ss"), new MemorySecretStore());
    const svc = new ManagedBrowserService(stack.lifecycleManager, browserDir);

    const port1 = svc.allocatePort("profile-a");
    const port2 = svc.allocatePort("profile-a");
    expect(port1).toBe(port2);
  });

  it("registerPort records an external port", async () => {
    const stack = await createSessionStateStack(join(dir, "ss"), new MemorySecretStore());
    const svc = new ManagedBrowserService(stack.lifecycleManager, browserDir);

    svc.registerPort("profile-x", 19000);
    expect(svc.getPort("profile-x")).toBe(19000);
    expect(svc.hasProfile("profile-x")).toBe(true);
  });

  it("connectBrowser returns false when browser not running", async () => {
    const stack = await createSessionStateStack(join(dir, "ss"), new MemorySecretStore());
    const svc = new ManagedBrowserService(stack.lifecycleManager, browserDir);

    // Use a port that is definitely not in use
    const result = await svc.connectBrowser("profile-z", 19999);
    expect(result).toBe(false);
    expect(svc.getEntry("profile-z")?.status).toBe("allocated");
  });

  it("stopTracking ends session and marks as stopped", async () => {
    const stack = await createSessionStateStack(join(dir, "ss"), new MemorySecretStore());
    const svc = new ManagedBrowserService(stack.lifecycleManager, browserDir);

    svc.allocatePort("profile-a");
    await svc.stopTracking("profile-a");
    expect(svc.getEntry("profile-a")?.status).toBe("stopped");
    expect(stack.lifecycleManager.hasActiveSession("profile-a")).toBe(false);
  });

  it("shutdown clears all entries", async () => {
    const stack = await createSessionStateStack(join(dir, "ss"), new MemorySecretStore());
    const svc = new ManagedBrowserService(stack.lifecycleManager, browserDir);

    svc.allocatePort("a");
    svc.allocatePort("b");
    svc.allocatePort("c");

    await svc.shutdown();
    expect(svc.getAllEntries()).toEqual([]);
  });

  it("getRunningProfiles returns only running profiles", async () => {
    const stack = await createSessionStateStack(join(dir, "ss"), new MemorySecretStore());
    const svc = new ManagedBrowserService(stack.lifecycleManager, browserDir);

    svc.allocatePort("a");
    svc.allocatePort("b");
    // Neither is running (no browser launched), so running list is empty
    expect(svc.getRunningProfiles()).toEqual([]);
  });

  it("getAllEntries returns all registered profiles", async () => {
    const stack = await createSessionStateStack(join(dir, "ss"), new MemorySecretStore());
    const svc = new ManagedBrowserService(stack.lifecycleManager, browserDir);

    svc.allocatePort("a");
    svc.registerPort("b", 19100);

    const entries = svc.getAllEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.profileId).sort()).toEqual(["a", "b"]);
  });
});
