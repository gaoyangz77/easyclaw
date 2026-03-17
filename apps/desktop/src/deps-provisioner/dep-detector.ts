import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { createLogger } from "@rivonclaw/logger";
import type { DepName, DepStatus } from "./types.js";

const log = createLogger("deps-provisioner");
const execFile = promisify(execFileCb);

const EXEC_TIMEOUT = 5_000;

/**
 * Build an augmented PATH that includes common install locations.
 *
 * Electron apps launched from Finder/Explorer don't inherit shell PATH
 * additions from .zshrc/.bashrc, so we prepend well-known directories.
 */
export function getAugmentedPath(): string {
  const home = homedir();
  const sep = platform() === "win32" ? ";" : ":";
  const basePath = process.env.PATH ?? "";

  if (platform() === "win32") {
    // On Windows the default PATH is generally sufficient; just ensure
    // common scoop / user-local directories are present.
    const extra = [
      join(home, "AppData", "Local", "Programs", "Python"),
      join(home, "scoop", "shims"),
      join(home, ".cargo", "bin"),
    ];
    return [...extra, basePath].join(sep);
  }

  // macOS / Linux — prepend Homebrew, user-local, and cargo paths.
  const extra = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    join(home, ".local", "bin"),
    join(home, ".cargo", "bin"),
  ];
  return [...extra, basePath].join(sep);
}

interface DepCheck {
  name: DepName;
  /** Commands to try in order — first success wins. */
  commands: string[][];
  /** Extract a semver-ish version string from stdout/stderr. */
  parseVersion: (output: string) => string | undefined;
}

const VERSION_CHECKS: DepCheck[] = [
  {
    name: "git",
    commands: [["git", "--version"]],
    parseVersion: (out) => out.match(/git version (\S+)/)?.[1],
  },
  {
    name: "python",
    commands: [
      ["python3", "--version"],
      ["python", "--version"],
    ],
    parseVersion: (out) => out.match(/Python (\S+)/)?.[1],
  },
  {
    name: "node",
    commands: [["node", "--version"]],
    parseVersion: (out) => out.match(/v(\S+)/)?.[1],
  },
  {
    name: "uv",
    commands: [["uv", "--version"]],
    parseVersion: (out) => out.match(/uv (\S+)/)?.[1],
  },
];

async function checkDep(
  check: DepCheck,
  env: NodeJS.ProcessEnv,
): Promise<DepStatus> {
  for (const [cmd, ...args] of check.commands) {
    try {
      const { stdout, stderr } = await execFile(cmd, args, {
        timeout: EXEC_TIMEOUT,
        env,
      });
      const combined = stdout + stderr;

      // Windows ships a "python" stub that opens the Microsoft Store
      // instead of running Python. Reject it so we install a real one.
      if (check.name === "python" && platform() === "win32" && !combined.match(/Python \d/)) {
        continue;
      }

      const version = check.parseVersion(combined);

      // Resolve the binary path via `which` (Unix) or `where.exe` (Windows).
      let binPath: string | undefined;
      try {
        const whichCmd = platform() === "win32" ? "where.exe" : "which";
        const { stdout: whichOut } = await execFile(whichCmd, [cmd], {
          timeout: EXEC_TIMEOUT,
          env,
        });
        binPath = whichOut.trim().split(/\r?\n/)[0];
      } catch {
        // Non-critical — path is optional metadata.
      }

      log.info(`${check.name} detected: ${version ?? "unknown version"}`, {
        path: binPath,
      });
      return { name: check.name, available: true, version, path: binPath };
    } catch {
      // Command failed — try next variant if any.
    }
  }

  log.info(`${check.name} not found`);
  return { name: check.name, available: false };
}

/**
 * Detect all managed dependencies in parallel and return their status.
 */
export async function detectDeps(): Promise<DepStatus[]> {
  const env = { ...process.env, PATH: getAugmentedPath() };
  const results = await Promise.all(
    VERSION_CHECKS.map((check) => checkDep(check, env)),
  );
  return results;
}
