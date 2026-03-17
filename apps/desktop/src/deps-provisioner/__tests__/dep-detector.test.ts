import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@rivonclaw/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { mockExecFile, mockPlatform, mockHomedir } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockPlatform: vi.fn<() => NodeJS.Platform>(() => "darwin"),
  mockHomedir: vi.fn(() => "/Users/testuser"),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:os", () => ({
  platform: () => mockPlatform(),
  homedir: () => mockHomedir(),
}));

import { detectDeps, getAugmentedPath } from "../dep-detector.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Configure mockExecFile to simulate command outcomes.
 * `outcomes` maps "cmd arg1 arg2" -> { stdout, stderr } | Error
 */
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

describe("getAugmentedPath", () => {
  beforeEach(() => {
    mockPlatform.mockReturnValue("darwin");
    mockHomedir.mockReturnValue("/Users/testuser");
  });

  it("includes expected directories on non-Windows (macOS/Linux)", () => {
    mockPlatform.mockReturnValue("darwin");
    const path = getAugmentedPath();

    expect(path).toContain("/opt/homebrew/bin");
    expect(path).toContain("/opt/homebrew/sbin");
    expect(path).toContain("/usr/local/bin");
    expect(path).toContain("/usr/local/sbin");
    expect(path).toContain("/Users/testuser/.local/bin");
    expect(path).toContain("/Users/testuser/.cargo/bin");
    // Should use ":" separator
    expect(path).not.toContain(";");
  });

  it("includes expected directories on Windows", () => {
    mockPlatform.mockReturnValue("win32");
    mockHomedir.mockReturnValue("C:\\Users\\testuser");
    const path = getAugmentedPath();

    // path.join on non-Windows host uses "/" but the logic still adds the
    // correct directory components and ";" separator.
    expect(path).toContain("AppData");
    expect(path).toContain("Programs");
    expect(path).toContain("Python");
    expect(path).toContain("scoop");
    expect(path).toContain("shims");
    expect(path).toContain(".cargo");
    // Should use ";" separator on win32
    expect(path).toContain(";");
  });
});

describe("detectDeps", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockPlatform.mockReturnValue("darwin");
    mockHomedir.mockReturnValue("/Users/testuser");
  });

  it("returns all available when all commands succeed", async () => {
    setupExecFile({
      "git --version": { stdout: "git version 2.43.0", stderr: "" },
      "which git": { stdout: "/usr/bin/git\n", stderr: "" },
      "python3 --version": { stdout: "Python 3.12.1", stderr: "" },
      "which python3": { stdout: "/usr/bin/python3\n", stderr: "" },
      "node --version": { stdout: "v20.11.0", stderr: "" },
      "which node": { stdout: "/usr/local/bin/node\n", stderr: "" },
      "uv --version": { stdout: "uv 0.5.1", stderr: "" },
      "which uv": { stdout: "/Users/testuser/.cargo/bin/uv\n", stderr: "" },
    });

    const results = await detectDeps();

    expect(results).toHaveLength(4);
    for (const dep of results) {
      expect(dep.available).toBe(true);
      expect(dep.version).toBeDefined();
    }

    const git = results.find((d) => d.name === "git")!;
    expect(git.version).toBe("2.43.0");
    expect(git.path).toBe("/usr/bin/git");

    const python = results.find((d) => d.name === "python")!;
    expect(python.version).toBe("3.12.1");

    const node = results.find((d) => d.name === "node")!;
    expect(node.version).toBe("20.11.0");

    const uv = results.find((d) => d.name === "uv")!;
    expect(uv.version).toBe("0.5.1");
  });

  it("returns unavailable for deps whose commands fail", async () => {
    setupExecFile({
      // git succeeds
      "git --version": { stdout: "git version 2.43.0", stderr: "" },
      "which git": { stdout: "/usr/bin/git\n", stderr: "" },
      // python3 and python both fail
      // node fails
      // uv fails
    });

    const results = await detectDeps();

    const git = results.find((d) => d.name === "git")!;
    expect(git.available).toBe(true);

    const python = results.find((d) => d.name === "python")!;
    expect(python.available).toBe(false);
    expect(python.version).toBeUndefined();

    const node = results.find((d) => d.name === "node")!;
    expect(node.available).toBe(false);

    const uv = results.find((d) => d.name === "uv")!;
    expect(uv.available).toBe(false);
  });

  it("handles python fallback (python3 fails, python succeeds)", async () => {
    setupExecFile({
      "git --version": { stdout: "git version 2.43.0", stderr: "" },
      "which git": { stdout: "/usr/bin/git\n", stderr: "" },
      // python3 fails (not in outcomes), python succeeds
      "python --version": { stdout: "Python 3.11.5", stderr: "" },
      "which python": { stdout: "/usr/bin/python\n", stderr: "" },
      "node --version": { stdout: "v20.11.0", stderr: "" },
      "which node": { stdout: "/usr/local/bin/node\n", stderr: "" },
      "uv --version": { stdout: "uv 0.5.1", stderr: "" },
      "which uv": { stdout: "/Users/testuser/.cargo/bin/uv\n", stderr: "" },
    });

    const results = await detectDeps();

    const python = results.find((d) => d.name === "python")!;
    expect(python.available).toBe(true);
    expect(python.version).toBe("3.11.5");
    expect(python.path).toBe("/usr/bin/python");
  });

  it("rejects Windows Python Microsoft Store stub", async () => {
    // On Windows, the `python` command exists but outputs nothing useful
    // (it opens the Microsoft Store). Our code checks: if platform is win32
    // and python output doesn't match /Python \d/, skip it.
    mockPlatform.mockReturnValue("win32");
    setupExecFile({
      "git --version": { stdout: "git version 2.43.0", stderr: "" },
      "where.exe git": { stdout: "C:\\Program Files\\Git\\cmd\\git.exe\n", stderr: "" },
      // python3 not found, python command exists but returns Store stub output
      "python --version": { stdout: "", stderr: "" },
      "node --version": { stdout: "v20.11.0", stderr: "" },
      "where.exe node": { stdout: "C:\\Program Files\\nodejs\\node.exe\n", stderr: "" },
      "uv --version": { stdout: "uv 0.5.1", stderr: "" },
      "where.exe uv": { stdout: "C:\\Users\\testuser\\.cargo\\bin\\uv.exe\n", stderr: "" },
    });

    const results = await detectDeps();
    const python = results.find((d) => d.name === "python")!;
    expect(python.available).toBe(false);
  });

  it("detects real Python on Windows", async () => {
    mockPlatform.mockReturnValue("win32");
    mockHomedir.mockReturnValue("C:\\Users\\testuser");
    setupExecFile({
      "git --version": { stdout: "git version 2.43.0", stderr: "" },
      "where.exe git": { stdout: "C:\\Program Files\\Git\\cmd\\git.exe\n", stderr: "" },
      "python3 --version": { stdout: "Python 3.12.1", stderr: "" },
      "where.exe python3": { stdout: "C:\\Python312\\python3.exe\n", stderr: "" },
      "node --version": { stdout: "v20.11.0", stderr: "" },
      "where.exe node": { stdout: "C:\\Program Files\\nodejs\\node.exe\n", stderr: "" },
      "uv --version": { stdout: "uv 0.5.1", stderr: "" },
      "where.exe uv": { stdout: "C:\\Users\\testuser\\.cargo\\bin\\uv.exe\n", stderr: "" },
    });

    const results = await detectDeps();
    const python = results.find((d) => d.name === "python")!;
    expect(python.available).toBe(true);
    expect(python.version).toBe("3.12.1");
  });

  it("version parsing works correctly for each dep format", async () => {
    setupExecFile({
      "git --version": {
        stdout: "git version 2.39.3 (Apple Git-146)",
        stderr: "",
      },
      "which git": { stdout: "/usr/bin/git\n", stderr: "" },
      "python3 --version": { stdout: "", stderr: "Python 3.10.0" },
      "which python3": { stdout: "/usr/bin/python3\n", stderr: "" },
      "node --version": { stdout: "v18.19.1\n", stderr: "" },
      "which node": { stdout: "/usr/local/bin/node\n", stderr: "" },
      "uv --version": { stdout: "uv 0.1.0-beta.3\n", stderr: "" },
      "which uv": { stdout: "/usr/local/bin/uv\n", stderr: "" },
    });

    const results = await detectDeps();

    expect(results.find((d) => d.name === "git")!.version).toBe("2.39.3");
    // Python version from stderr (combined output)
    expect(results.find((d) => d.name === "python")!.version).toBe("3.10.0");
    expect(results.find((d) => d.name === "node")!.version).toBe("18.19.1");
    expect(results.find((d) => d.name === "uv")!.version).toBe("0.1.0-beta.3");
  });
});
