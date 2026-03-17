import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@easyclaw/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { mockSpawn, mockReadFile, mockArch, mockHomedir, mockGetAugmentedPath, mockGetMirrorEnv } =
  vi.hoisted(() => ({
    mockSpawn: vi.fn(),
    mockReadFile: vi.fn(),
    mockArch: vi.fn<() => string>(() => "arm64"),
    mockHomedir: vi.fn(() => "/Users/testuser"),
    mockGetAugmentedPath: vi.fn(() => "/mock/path"),
    mockGetMirrorEnv: vi.fn<(region: string) => Record<string, string> | null>(
      () => null,
    ),
  }));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

vi.mock("node:os", () => ({
  arch: () => mockArch(),
  homedir: () => mockHomedir(),
}));

vi.mock("../dep-detector.js", () => ({
  getAugmentedPath: () => mockGetAugmentedPath(),
}));

vi.mock("../mirror-config.js", () => ({
  getMirrorEnv: (region: string) => mockGetMirrorEnv(region),
}));

import { installDep } from "../dep-installer.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a mock child process that emits close with the given exit code.
 * Optionally emits stdout/stderr data before closing.
 */
function createMockChild(exitCode = 0) {
  const handlers: Record<string, Function[]> = {};

  const addHandler = (key: string, handler: Function) => {
    if (!handlers[key]) handlers[key] = [];
    handlers[key].push(handler);
  };

  const child = {
    stdout: {
      on: vi.fn((event: string, handler: Function) => {
        addHandler(`stdout:${event}`, handler);
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: Function) => {
        addHandler(`stderr:${event}`, handler);
      }),
    },
    on: vi.fn((event: string, handler: Function) => {
      if (event === "close") {
        // Emit close event asynchronously
        setTimeout(() => handler(exitCode), 0);
      }
      if (event === "error") {
        addHandler("error", handler);
      }
    }),
    kill: vi.fn(),
    killed: false,
    pid: 12345,
  };
  return child;
}

/** Track spawn calls and return mock children for assertion. */
let spawnCalls: Array<{ cmd: string; args: string[]; opts: unknown }> = [];

function setupSpawn(exitCodes: Record<string, number> = {}) {
  spawnCalls = [];
  mockSpawn.mockImplementation(
    (cmd: string, args: string[], opts: unknown) => {
      spawnCalls.push({ cmd, args, opts });
      // Match by first meaningful token in command
      const key = [cmd, ...args].join(" ");
      let exitCode = 0;
      for (const [pattern, code] of Object.entries(exitCodes)) {
        if (key.includes(pattern)) {
          exitCode = code;
          break;
        }
      }
      return createMockChild(exitCode);
    },
  );
}

const onOutput = vi.fn();

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("installDep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnCalls = [];
    mockArch.mockReturnValue("arm64");
    mockHomedir.mockReturnValue("/Users/testuser");
    mockGetAugmentedPath.mockReturnValue("/mock/augmented/path");
    mockGetMirrorEnv.mockReturnValue(null);
  });

  // ─── macOS ──────────────────────────────────────────────────────────────

  describe("macOS (darwin)", () => {
    it("installs git via brew", async () => {
      setupSpawn();
      mockGetMirrorEnv.mockReturnValue(null);

      await installDep("git", "darwin", "global", onOutput);

      // First call is ensureHomebrew (brew --version check)
      // Second call is brew install git
      const brewInstallCall = spawnCalls.find(
        (c) => c.args.includes("install") && c.args.includes("git"),
      );
      expect(brewInstallCall).toBeDefined();
      expect(brewInstallCall!.cmd).toContain("brew");
    });

    it("installs uv via brew in cn region (not curl/GitHub)", async () => {
      setupSpawn();
      const mirrorEnv = {
        HOMEBREW_BREW_GIT_REMOTE: "https://mirrors.aliyun.com/homebrew/brew.git",
      };
      mockGetMirrorEnv.mockReturnValue(mirrorEnv);

      await installDep("uv", "darwin", "cn", onOutput);

      // Should use brew install uv, not curl
      const brewInstallCall = spawnCalls.find(
        (c) => c.args.includes("install") && c.args.includes("uv"),
      );
      expect(brewInstallCall).toBeDefined();
      expect(brewInstallCall!.cmd).toContain("brew");

      // Should NOT use curl
      const curlCall = spawnCalls.find(
        (c) => c.cmd === "/bin/bash" && c.args.some((a) => a.includes("astral.sh")),
      );
      // The brew --version check spawns /opt/homebrew/bin/brew --version first,
      // then brew install uv. No curl call should exist for the install itself.
      expect(curlCall).toBeUndefined();
    });

    it("installs uv via curl in global region", async () => {
      setupSpawn();
      mockGetMirrorEnv.mockReturnValue(null);

      await installDep("uv", "darwin", "global", onOutput);

      // Should use curl (via /bin/bash -c "curl ... | sh")
      const curlCall = spawnCalls.find(
        (c) =>
          c.cmd === "/bin/bash" &&
          c.args.some((a) => a.includes("astral.sh")),
      );
      expect(curlCall).toBeDefined();
    });

    it("passes mirror env vars for cn region brew commands", async () => {
      setupSpawn();
      const mirrorEnv = {
        HOMEBREW_BREW_GIT_REMOTE: "https://mirrors.aliyun.com/homebrew/brew.git",
        HOMEBREW_BOTTLE_DOMAIN: "https://mirrors.aliyun.com/homebrew/homebrew-bottles",
      };
      mockGetMirrorEnv.mockReturnValue(mirrorEnv);

      await installDep("git", "darwin", "cn", onOutput);

      // The brew install call should have mirror env vars
      const brewInstallCall = spawnCalls.find(
        (c) => c.args.includes("install") && c.args.includes("git"),
      );
      expect(brewInstallCall).toBeDefined();
      const opts = brewInstallCall!.opts as { env?: Record<string, string> };
      expect(opts.env).toBeDefined();
      expect(opts.env!.HOMEBREW_BREW_GIT_REMOTE).toBe(
        "https://mirrors.aliyun.com/homebrew/brew.git",
      );
    });

    it("uses correct brew prefix for arm64", async () => {
      setupSpawn();
      mockArch.mockReturnValue("arm64");

      await installDep("git", "darwin", "global", onOutput);

      // The brew binary should be at /opt/homebrew/bin/brew for arm64
      const brewCall = spawnCalls.find((c) => c.cmd.includes("homebrew"));
      expect(brewCall).toBeDefined();
      expect(brewCall!.cmd).toContain("/opt/homebrew/bin/brew");
    });

    it("uses correct brew prefix for x64", async () => {
      setupSpawn();
      mockArch.mockReturnValue("x64");

      await installDep("git", "darwin", "global", onOutput);

      // The brew binary should be at /usr/local/bin/brew for x64
      const brewCall = spawnCalls.find((c) => c.cmd.includes("brew"));
      expect(brewCall).toBeDefined();
      expect(brewCall!.cmd).toContain("/usr/local/bin/brew");
    });
  });

  // ─── Windows ────────────────────────────────────────────────────────────

  describe("Windows (win32)", () => {
    it("installs git via winget when available", async () => {
      // First spawn call is where.exe winget (succeed), then winget install
      setupSpawn();

      await installDep("git", "win32", "global", onOutput);

      // Should have called where.exe winget first
      const whereCall = spawnCalls.find(
        (c) => c.cmd === "where.exe" && c.args.includes("winget"),
      );
      expect(whereCall).toBeDefined();

      // Then winget install
      const wingetCall = spawnCalls.find(
        (c) =>
          c.cmd === "winget" &&
          c.args.includes("install") &&
          c.args.includes("Git.Git"),
      );
      expect(wingetCall).toBeDefined();
      // Windows commands should use shell: true
      const opts = wingetCall!.opts as { shell?: boolean };
      expect(opts.shell).toBe(true);
    });

    it("installs uv via pip in cn region when no winget", async () => {
      // where.exe winget fails (exit code 1)
      setupSpawn({ "where.exe winget": 1 });

      await installDep("uv", "win32", "cn", onOutput);

      const pipCall = spawnCalls.find(
        (c) =>
          c.cmd === "pip" &&
          c.args.includes("install") &&
          c.args.includes("uv"),
      );
      expect(pipCall).toBeDefined();
      const opts = pipCall!.opts as { shell?: boolean };
      expect(opts.shell).toBe(true);
    });

    it("installs uv via PowerShell in global region when no winget", async () => {
      setupSpawn({ "where.exe winget": 1 });

      await installDep("uv", "win32", "global", onOutput);

      const psCall = spawnCalls.find(
        (c) =>
          c.cmd === "powershell" &&
          c.args.some((a) => a.includes("astral.sh")),
      );
      expect(psCall).toBeDefined();
      const opts = psCall!.opts as { shell?: boolean };
      expect(opts.shell).toBe(true);
    });

    it("throws helpful error for git when no winget", async () => {
      setupSpawn({ "where.exe winget": 1 });

      await expect(
        installDep("git", "win32", "global", onOutput),
      ).rejects.toThrow(/winget is not available/);
    });
  });

  // ─── Linux ──────────────────────────────────────────────────────────────

  describe("Linux", () => {
    beforeEach(() => {
      // Default: pkexec not found (which pkexec fails), so falls back to sudo
      // We need to handle the "which pkexec" spawn that might fail
    });

    it("installs git via apt-get on Ubuntu", async () => {
      mockReadFile.mockResolvedValue('ID=ubuntu\nVERSION_ID="22.04"\n');
      setupSpawn({ "which pkexec": 1 });

      await installDep("git", "linux", "global", onOutput);

      // Should detect apt-get from Ubuntu and call sudo apt-get install -y git
      const aptCall = spawnCalls.find(
        (c) => c.args.includes("apt-get") && c.args.includes("git"),
      );
      expect(aptCall).toBeDefined();
      expect(aptCall!.args).toContain("install");
      expect(aptCall!.args).toContain("-y");
    });

    it("installs git via dnf on Fedora", async () => {
      mockReadFile.mockResolvedValue('ID=fedora\nVERSION_ID="39"\n');
      setupSpawn({ "which pkexec": 1 });

      await installDep("git", "linux", "global", onOutput);

      const dnfCall = spawnCalls.find(
        (c) => c.args.includes("dnf") && c.args.includes("git"),
      );
      expect(dnfCall).toBeDefined();
      expect(dnfCall!.args).toContain("install");
      expect(dnfCall!.args).toContain("-y");
    });

    it("installs git via pacman on Arch", async () => {
      mockReadFile.mockResolvedValue("ID=arch\n");
      setupSpawn({ "which pkexec": 1 });

      await installDep("git", "linux", "global", onOutput);

      const pacmanCall = spawnCalls.find(
        (c) => c.args.includes("pacman") && c.args.includes("git"),
      );
      expect(pacmanCall).toBeDefined();
      expect(pacmanCall!.args).toContain("-S");
      expect(pacmanCall!.args).toContain("--noconfirm");
    });

    it("installs uv via pip3 in cn region", async () => {
      setupSpawn();

      await installDep("uv", "linux", "cn", onOutput);

      const pipCall = spawnCalls.find(
        (c) =>
          c.cmd === "pip3" &&
          c.args.includes("install") &&
          c.args.includes("uv"),
      );
      expect(pipCall).toBeDefined();
    });

    it("installs uv via curl in global region", async () => {
      setupSpawn();

      await installDep("uv", "linux", "global", onOutput);

      const curlCall = spawnCalls.find(
        (c) =>
          c.cmd === "/bin/bash" &&
          c.args.some((a) => a.includes("astral.sh")),
      );
      expect(curlCall).toBeDefined();
    });

    it("throws for unsupported distro", async () => {
      mockReadFile.mockResolvedValue("ID=gentoo\n");
      setupSpawn({ "which pkexec": 1 });

      await expect(
        installDep("git", "linux", "global", onOutput),
      ).rejects.toThrow(/Unsupported Linux distribution: gentoo/);
    });
  });

  // ─── Unsupported platform ──────────────────────────────────────────────

  it("throws for unsupported platform", async () => {
    setupSpawn();

    await expect(
      installDep("git", "freebsd" as NodeJS.Platform, "global", onOutput),
    ).rejects.toThrow(/Unsupported platform: freebsd/);
  });
});
