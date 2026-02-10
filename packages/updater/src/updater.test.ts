import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseVersion, compareVersions, isNewerVersion } from "./version.js";
import {
  fetchManifest,
  getPlatformKey,
  checkForUpdate,
  DEFAULT_MANIFEST_URL,
} from "./checker.js";
import type { UpdateManifest } from "./types.js";

// ---------------------------------------------------------------------------
// parseVersion
// ---------------------------------------------------------------------------
describe("parseVersion", () => {
  it("parses a valid version string", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
  });

  it("parses version with zeros", () => {
    expect(parseVersion("0.0.0")).toEqual([0, 0, 0]);
  });

  it("parses multi-digit components", () => {
    expect(parseVersion("10.20.300")).toEqual([10, 20, 300]);
  });

  it("throws on invalid version (missing patch)", () => {
    expect(() => parseVersion("1.2")).toThrow('Invalid version string: "1.2"');
  });

  it("throws on invalid version (non-numeric)", () => {
    expect(() => parseVersion("1.2.x")).toThrow(
      'Invalid version string: "1.2.x"',
    );
  });

  it("throws on empty string", () => {
    expect(() => parseVersion("")).toThrow('Invalid version string: ""');
  });

  it("throws on version with pre-release suffix", () => {
    expect(() => parseVersion("1.2.3-beta")).toThrow(
      'Invalid version string: "1.2.3-beta"',
    );
  });
});

// ---------------------------------------------------------------------------
// compareVersions
// ---------------------------------------------------------------------------
describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns 1 when a > b (major)", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
  });

  it("returns -1 when a < b (major)", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
  });

  it("returns 1 when a > b (minor)", () => {
    expect(compareVersions("1.3.0", "1.2.0")).toBe(1);
  });

  it("returns -1 when a < b (minor)", () => {
    expect(compareVersions("1.2.0", "1.3.0")).toBe(-1);
  });

  it("returns 1 when a > b (patch)", () => {
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
  });

  it("returns -1 when a < b (patch)", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
  });

  it("handles multi-digit version components", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// isNewerVersion
// ---------------------------------------------------------------------------
describe("isNewerVersion", () => {
  it("returns true when latest is newer", () => {
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  });

  it("returns false when current is newer", () => {
    expect(isNewerVersion("2.0.0", "1.0.0")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchManifest
// ---------------------------------------------------------------------------
describe("fetchManifest", () => {
  const mockManifest: UpdateManifest = {
    latestVersion: "1.1.0",
    releaseDate: "2025-06-01T00:00:00Z",
    releaseNotes: "Bug fixes and improvements.",
    downloads: {
      mac: {
        url: "https://www.easy-claw.com/releases/EasyClaw-1.1.0.dmg",
        sha256: "abc123",
        size: 50_000_000,
      },
      win: {
        url: "https://www.easy-claw.com/releases/EasyClaw-1.1.0.exe",
        sha256: "def456",
        size: 55_000_000,
      },
    },
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and parses manifest from default URL", async () => {
    const manifest = await fetchManifest();
    expect(fetch).toHaveBeenCalledWith(DEFAULT_MANIFEST_URL, {
      signal: expect.any(AbortSignal),
    });
    expect(manifest).toEqual(mockManifest);
  });

  it("fetches from a custom URL when provided", async () => {
    const customUrl = "https://custom.example.com/manifest.json";
    await fetchManifest(customUrl);
    expect(fetch).toHaveBeenCalledWith(customUrl, {
      signal: expect.any(AbortSignal),
    });
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }),
    );
    await expect(fetchManifest()).rejects.toThrow(
      "Failed to fetch manifest: HTTP 404 Not Found",
    );
  });

  it("throws on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );
    await expect(fetchManifest()).rejects.toThrow("Network error");
  });
});

// ---------------------------------------------------------------------------
// getPlatformKey
// ---------------------------------------------------------------------------
describe("getPlatformKey", () => {
  it("returns 'mac' on darwin", () => {
    // We're running tests on macOS based on the env
    const result = getPlatformKey();
    // On macOS CI/local this should be "mac"
    if (process.platform === "darwin") {
      expect(result).toBe("mac");
    } else if (process.platform === "win32") {
      expect(result).toBe("win");
    }
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate
// ---------------------------------------------------------------------------
describe("checkForUpdate", () => {
  const mockManifest: UpdateManifest = {
    latestVersion: "1.1.0",
    releaseDate: "2025-06-01T00:00:00Z",
    releaseNotes: "Bug fixes and improvements.",
    downloads: {
      mac: {
        url: "https://www.easy-claw.com/releases/EasyClaw-1.1.0.dmg",
        sha256: "abc123",
        size: 50_000_000,
      },
      win: {
        url: "https://www.easy-claw.com/releases/EasyClaw-1.1.0.exe",
        sha256: "def456",
        size: 55_000_000,
      },
    },
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects when an update is available", async () => {
    const result = await checkForUpdate("1.0.0");
    expect(result.updateAvailable).toBe(true);
    expect(result.currentVersion).toBe("1.0.0");
    expect(result.latestVersion).toBe("1.1.0");
    expect(result.releaseNotes).toBe("Bug fixes and improvements.");
    expect(result.error).toBeUndefined();
  });

  it("detects when no update is available (same version)", async () => {
    const result = await checkForUpdate("1.1.0");
    expect(result.updateAvailable).toBe(false);
    expect(result.currentVersion).toBe("1.1.0");
    expect(result.latestVersion).toBe("1.1.0");
  });

  it("detects when no update is available (newer local)", async () => {
    const result = await checkForUpdate("2.0.0");
    expect(result.updateAvailable).toBe(false);
    expect(result.currentVersion).toBe("2.0.0");
    expect(result.latestVersion).toBe("1.1.0");
  });

  it("includes download info for the current platform", async () => {
    const result = await checkForUpdate("1.0.0");
    // Running on macOS
    if (process.platform === "darwin") {
      expect(result.download).toEqual(mockManifest.downloads.mac);
    } else if (process.platform === "win32") {
      expect(result.download).toEqual(mockManifest.downloads.win);
    }
  });

  it("returns error result on fetch failure (never throws)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused")),
    );
    const result = await checkForUpdate("1.0.0");
    expect(result.updateAvailable).toBe(false);
    expect(result.currentVersion).toBe("1.0.0");
    expect(result.latestVersion).toBeUndefined();
    expect(result.error).toBe("Connection refused");
  });

  it("returns error result on non-ok HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }),
    );
    const result = await checkForUpdate("1.0.0");
    expect(result.updateAvailable).toBe(false);
    expect(result.error).toContain("500");
  });

  it("passes custom manifestUrl to fetch", async () => {
    const customUrl = "https://staging.easy-claw.com/manifest.json";
    await checkForUpdate("1.0.0", { manifestUrl: customUrl });
    expect(fetch).toHaveBeenCalledWith(customUrl, {
      signal: expect.any(AbortSignal),
    });
  });

  it("appends region query param when provided", async () => {
    await checkForUpdate("1.0.0", { region: "cn" });
    expect(fetch).toHaveBeenCalledWith(
      `${DEFAULT_MANIFEST_URL}?region=cn`,
      { signal: expect.any(AbortSignal) },
    );
  });

  it("appends region with & when manifestUrl already has query params", async () => {
    const customUrl = "https://staging.easy-claw.com/manifest.json?v=2";
    await checkForUpdate("1.0.0", { manifestUrl: customUrl, region: "cn" });
    expect(fetch).toHaveBeenCalledWith(
      `${customUrl}&region=cn`,
      { signal: expect.any(AbortSignal) },
    );
  });

  it("handles manifest with no download for current platform", async () => {
    const manifestNoDownloads: UpdateManifest = {
      ...mockManifest,
      downloads: {},
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(manifestNoDownloads),
      }),
    );
    const result = await checkForUpdate("1.0.0");
    expect(result.updateAvailable).toBe(true);
    expect(result.download).toBeUndefined();
  });
});
