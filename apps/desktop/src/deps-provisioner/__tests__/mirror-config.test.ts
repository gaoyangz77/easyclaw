import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@rivonclaw/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { mockExecFile, mockExistsSyncFn, mockMkdirSyncFn, mockWriteFileSyncFn, mockPlatform, mockHomedir } =
  vi.hoisted(() => ({
    mockExecFile: vi.fn(),
    mockExistsSyncFn: vi.fn<(path: string) => boolean>(() => false),
    mockMkdirSyncFn: vi.fn(),
    mockWriteFileSyncFn: vi.fn(),
    mockPlatform: vi.fn<() => NodeJS.Platform>(() => "darwin"),
    mockHomedir: vi.fn(() => "/Users/testuser"),
  }));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:fs", () => ({
  existsSync: (path: string) => mockExistsSyncFn(path),
  mkdirSync: (...args: unknown[]) => mockMkdirSyncFn(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSyncFn(...args),
}));

vi.mock("node:os", () => ({
  platform: () => mockPlatform(),
  homedir: () => mockHomedir(),
}));

import {
  getMirrorEnv,
  configureMirrors,
  HOMEBREW_BREW_GIT_REMOTE,
  HOMEBREW_CORE_GIT_REMOTE,
  HOMEBREW_BOTTLE_DOMAIN,
  HOMEBREW_API_DOMAIN,
  PYPI_MIRROR_URL,
  NPM_MIRROR_URL,
} from "../mirror-config.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function setupExecFile(
  outcomes: Record<string, { stdout: string; stderr: string } | Error>,
) {
  mockExecFile.mockImplementation(
    (
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
    ) => {
      const key = [cmd, ...args].join(" ");
      const result = outcomes[key];
      if (result instanceof Error) {
        cb(result);
      } else if (result) {
        cb(null, result);
      } else {
        cb(new Error(`Command not found: ${key}`));
      }
    },
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

// Hardcoded expected URLs — if someone changes a constant by mistake, this
// test will catch the regression against the known-correct values.
describe("mirror URL constants are correct", () => {
  it("Homebrew Aliyun mirror URLs", () => {
    expect(HOMEBREW_BREW_GIT_REMOTE).toBe("https://mirrors.aliyun.com/homebrew/brew.git");
    expect(HOMEBREW_CORE_GIT_REMOTE).toBe("https://mirrors.aliyun.com/homebrew/homebrew-core.git");
    expect(HOMEBREW_BOTTLE_DOMAIN).toBe("https://mirrors.aliyun.com/homebrew/homebrew-bottles");
    expect(HOMEBREW_API_DOMAIN).toBe("https://mirrors.aliyun.com/homebrew/homebrew-bottles/api");
  });

  it("Aliyun PyPI mirror URL", () => {
    expect(PYPI_MIRROR_URL).toBe("https://mirrors.aliyun.com/pypi/simple");
  });

  it("npmmirror registry URL", () => {
    expect(NPM_MIRROR_URL).toBe("https://registry.npmmirror.com");
  });
});

describe("getMirrorEnv", () => {
  it('returns all 4 Homebrew env vars for "cn" region', () => {
    const env = getMirrorEnv("cn");

    expect(env).not.toBeNull();
    expect(env!.HOMEBREW_BREW_GIT_REMOTE).toBe("https://mirrors.aliyun.com/homebrew/brew.git");
    expect(env!.HOMEBREW_CORE_GIT_REMOTE).toBe("https://mirrors.aliyun.com/homebrew/homebrew-core.git");
    expect(env!.HOMEBREW_BOTTLE_DOMAIN).toBe("https://mirrors.aliyun.com/homebrew/homebrew-bottles");
    expect(env!.HOMEBREW_API_DOMAIN).toBe("https://mirrors.aliyun.com/homebrew/homebrew-bottles/api");
  });

  it('returns null for "global" region', () => {
    const env = getMirrorEnv("global");
    expect(env).toBeNull();
  });
});

describe("configureMirrors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.mockReturnValue("darwin");
    mockHomedir.mockReturnValue("/Users/testuser");
    mockExistsSyncFn.mockReturnValue(false);
  });

  it('does nothing for "global" region (no file writes, no npm config)', async () => {
    await configureMirrors("global");

    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockMkdirSyncFn).not.toHaveBeenCalled();
    expect(mockWriteFileSyncFn).not.toHaveBeenCalled();
  });

  it('writes pip config when file does not exist for "cn" region', async () => {
    mockExistsSyncFn.mockReturnValue(false);
    setupExecFile({
      "npm config get registry": {
        stdout: "https://registry.npmjs.org/\n",
        stderr: "",
      },
      [`npm config set registry ${NPM_MIRROR_URL}`]: {
        stdout: "",
        stderr: "",
      },
    });

    await configureMirrors("cn");

    // Should create pip directory and write config
    expect(mockMkdirSyncFn).toHaveBeenCalledWith(
      "/Users/testuser/.pip",
      { recursive: true },
    );
    expect(mockWriteFileSyncFn).toHaveBeenCalledWith(
      "/Users/testuser/.pip/pip.conf",
      expect.stringContaining("https://mirrors.aliyun.com/pypi/simple"),
      "utf-8",
    );
  });

  it('writes pip.ini to APPDATA on Windows for "cn" region', async () => {
    mockPlatform.mockReturnValue("win32");
    mockHomedir.mockReturnValue("C:\\Users\\testuser");
    mockExistsSyncFn.mockReturnValue(false);
    // Simulate APPDATA env
    const origAppdata = process.env.APPDATA;
    process.env.APPDATA = "C:\\Users\\testuser\\AppData\\Roaming";

    setupExecFile({
      "npm config get registry": {
        stdout: "https://registry.npmjs.org/\n",
        stderr: "",
      },
      [`npm config set registry https://registry.npmmirror.com`]: {
        stdout: "",
        stderr: "",
      },
    });

    await configureMirrors("cn");

    // On a non-Windows host, path.join uses "/" so the exact separator
    // may differ. Assert the meaningful parts are present.
    expect(mockMkdirSyncFn).toHaveBeenCalledWith(
      expect.stringContaining("AppData"),
      { recursive: true },
    );
    const mkdirArg = mockMkdirSyncFn.mock.calls[0][0] as string;
    expect(mkdirArg).toContain("pip");

    expect(mockWriteFileSyncFn).toHaveBeenCalledWith(
      expect.stringContaining("pip.ini"),
      expect.stringContaining("https://mirrors.aliyun.com/pypi/simple"),
      "utf-8",
    );

    // Restore
    if (origAppdata !== undefined) {
      process.env.APPDATA = origAppdata;
    } else {
      delete process.env.APPDATA;
    }
  });

  it('skips pip config when file already exists for "cn" region', async () => {
    mockExistsSyncFn.mockReturnValue(true);
    setupExecFile({
      "npm config get registry": {
        stdout: "https://registry.npmjs.org/\n",
        stderr: "",
      },
      [`npm config set registry ${NPM_MIRROR_URL}`]: {
        stdout: "",
        stderr: "",
      },
    });

    await configureMirrors("cn");

    // Should NOT write pip config
    expect(mockMkdirSyncFn).not.toHaveBeenCalled();
    expect(mockWriteFileSyncFn).not.toHaveBeenCalled();

    // Should still configure npm
    expect(mockExecFile).toHaveBeenCalled();
  });
});
