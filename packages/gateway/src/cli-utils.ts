/**
 * Shared CLI utility functions for discovering and auto-installing CLI tools.
 *
 * Extracted from gemini-cli-oauth.ts so panel-server.ts (clawhub install)
 * and any future CLI integrations can reuse the same enriched-PATH logic
 * and npm-based auto-install flow.
 */
import { existsSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

/**
 * Build an enriched PATH that includes common Node.js/npm install locations.
 * Packaged Electron apps on macOS inherit a minimal PATH (e.g. /usr/bin:/bin)
 * that doesn't include Homebrew, nvm, volta, fnm, etc.
 */
export function enrichedPath(): string {
  const base = process.env.PATH ?? "";
  const home = homedir();
  const extra: string[] = [
    "/usr/local/bin",               // Homebrew (Intel Mac) / system installs
    "/opt/homebrew/bin",            // Homebrew (Apple Silicon)
    join(home, ".nvm", "current", "bin"),  // nvm (symlink alias)
    join(home, ".volta", "bin"),    // Volta
    join(home, ".fnm", "aliases", "default", "bin"), // fnm
    join(home, ".local", "bin"),    // pipx / user-local installs
  ];

  // nvm: also check versioned directories (pick the first one found)
  const nvmVersions = join(home, ".nvm", "versions", "node");
  try {
    const versions = readdirSync(nvmVersions).filter((v) => v.startsWith("v")).sort().reverse();
    if (versions.length > 0) {
      extra.push(join(nvmVersions, versions[0], "bin"));
    }
  } catch {
    // nvm not installed
  }

  const existing = new Set(base.split(delimiter));
  const additions = extra.filter((d) => !existing.has(d) && existsSync(d));
  if (additions.length === 0) return base;
  return base + delimiter + additions.join(delimiter);
}

/**
 * Find a CLI binary by name in the enriched PATH.
 * Returns the full path if found, null otherwise.
 */
export function findInPath(name: string): string | null {
  const exts = process.platform === "win32" ? [".cmd", ".bat", ".exe", ""] : [""];
  for (const dir of enrichedPath().split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (existsSync(p)) {
        return p;
      }
    }
  }
  return null;
}

/**
 * Ensure a CLI tool is available. If not found, auto-install it via npm.
 *
 * 1. Check if `cliName` exists in PATH (enriched with nvm/volta/homebrew paths)
 * 2. If npm is available, run `npm install -g <npmPackage>`
 * 3. If npm is also missing, throw with a user-friendly message
 *
 * @returns The resolved path to the CLI binary.
 * @throws If the CLI cannot be found or installed.
 */
export async function ensureCliAvailable(
  cliName: string,
  npmPackage: string,
): Promise<string> {
  // 1. Already installed?
  const existing = findInPath(cliName);
  if (existing) return existing;

  // 2. npm available?
  const npmBin = findInPath("npm");
  if (!npmBin) {
    throw new Error(
      `${cliName} is not installed and npm was not found. ` +
      `Please install Node.js (https://nodejs.org) first, then run: npm install -g ${npmPackage}`,
    );
  }

  // 3. Auto-install via npm
  const useShell = process.platform === "win32";
  await new Promise<void>((resolve, reject) => {
    execFile(
      npmBin,
      ["install", "-g", npmPackage],
      { timeout: 120_000, shell: useShell, env: { ...process.env, PATH: enrichedPath() } },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`Failed to install ${npmPackage}: ${stderr || err.message}`));
          return;
        }
        resolve();
      },
    );
  });

  // 4. Verify installation
  const installed = findInPath(cliName);
  if (!installed) {
    throw new Error(
      `Installed ${npmPackage} but ${cliName} was not found in PATH. ` +
      `Try running manually: npm install -g ${npmPackage}`,
    );
  }
  return installed;
}
