import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

vi.mock("node:fs", () => ({
  readFileSync: mockReadFileSync,
}));

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

describe("getDeviceId", () => {
  const FAKE_UUID = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";

  beforeEach(() => {
    vi.resetModules();
    mockExecSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it("should return SHA-256 hash of IOPlatformUUID on macOS", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    mockExecSync.mockReturnValue(
      `+-o Root  <class IOPlatformExpertDevice>\n` +
        `  {\n` +
        `    "IOPlatformUUID" = "${FAKE_UUID}"\n` +
        `  }\n`,
    );

    const { getDeviceId } = await import("./fingerprint.js");
    const id = getDeviceId();

    expect(id).toBe(sha256(FAKE_UUID));
    expect(id).toHaveLength(64);
    expect(mockExecSync).toHaveBeenCalledWith(
      "ioreg -rd1 -c IOPlatformExpertDevice",
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("should return SHA-256 hash of MachineGuid on Windows", async () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    mockExecSync.mockReturnValue(
      `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\n` +
        `    MachineGuid    REG_SZ    ${FAKE_UUID}\n`,
    );

    const { getDeviceId } = await import("./fingerprint.js");
    const id = getDeviceId();

    expect(id).toBe(sha256(FAKE_UUID));
    expect(id).toHaveLength(64);
  });

  it("should cache the result across multiple calls", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    mockExecSync.mockReturnValue(`"IOPlatformUUID" = "${FAKE_UUID}"\n`);

    const { getDeviceId } = await import("./fingerprint.js");
    const id1 = getDeviceId();
    const id2 = getDeviceId();

    expect(id1).toBe(id2);
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it("should return SHA-256 hash of machine-id on Linux", async () => {
    const FAKE_MACHINE_ID = "a1b2c3d4e5f67890abcdef1234567890";
    vi.stubGlobal("process", { ...process, platform: "linux" });
    mockReadFileSync.mockReturnValue(FAKE_MACHINE_ID + "\n");

    const { getDeviceId } = await import("./fingerprint.js");
    const id = getDeviceId();

    expect(id).toBe(sha256(FAKE_MACHINE_ID));
    expect(id).toHaveLength(64);
    expect(mockReadFileSync).toHaveBeenCalledWith("/etc/machine-id", "utf-8");
  });

  it("should fall back to /var/lib/dbus/machine-id on Linux", async () => {
    const FAKE_MACHINE_ID = "a1b2c3d4e5f67890abcdef1234567890";
    vi.stubGlobal("process", { ...process, platform: "linux" });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath === "/etc/machine-id") throw new Error("ENOENT");
      return FAKE_MACHINE_ID + "\n";
    });

    const { getDeviceId } = await import("./fingerprint.js");
    const id = getDeviceId();

    expect(id).toBe(sha256(FAKE_MACHINE_ID));
    expect(mockReadFileSync).toHaveBeenCalledWith("/var/lib/dbus/machine-id", "utf-8");
  });

  it("should throw if no machine-id file exists on Linux", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const { getDeviceId } = await import("./fingerprint.js");
    expect(() => getDeviceId()).toThrow("Failed to read machine-id");
  });

  it("should throw on unsupported platform", async () => {
    vi.stubGlobal("process", { ...process, platform: "freebsd" });

    const { getDeviceId } = await import("./fingerprint.js");
    expect(() => getDeviceId()).toThrow("Unsupported platform");
  });

  it("should throw if ioreg output is unexpected", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    mockExecSync.mockReturnValue("some unexpected output");

    const { getDeviceId } = await import("./fingerprint.js");
    expect(() => getDeviceId()).toThrow("Failed to extract IOPlatformUUID");
  });

  it("should throw if registry output is unexpected", async () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    mockExecSync.mockReturnValue("some unexpected output");

    const { getDeviceId } = await import("./fingerprint.js");
    expect(() => getDeviceId()).toThrow("Failed to extract MachineGuid");
  });
});
