import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createLogger } from "@rivonclaw/logger";
import type { Region } from "./region-detector.js";

const log = createLogger("deps-provisioner");
const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Mirror URL constants
// ---------------------------------------------------------------------------

export const HOMEBREW_BREW_GIT_REMOTE =
  "https://mirrors.aliyun.com/homebrew/brew.git";
export const HOMEBREW_CORE_GIT_REMOTE =
  "https://mirrors.aliyun.com/homebrew/homebrew-core.git";
export const HOMEBREW_BOTTLE_DOMAIN =
  "https://mirrors.aliyun.com/homebrew/homebrew-bottles";
export const HOMEBREW_API_DOMAIN =
  "https://mirrors.aliyun.com/homebrew/homebrew-bottles/api";

export const PYPI_MIRROR_URL =
  "https://mirrors.aliyun.com/pypi/simple";
export const NPM_MIRROR_URL =
  "https://registry.npmmirror.com";

// ---------------------------------------------------------------------------
// Homebrew mirror env
// ---------------------------------------------------------------------------

/**
 * Return Homebrew mirror environment variables for China region,
 * or `null` for global region.
 */
export function getMirrorEnv(
  region: Region,
): Record<string, string> | null {
  if (region !== "cn") return null;

  return {
    HOMEBREW_BREW_GIT_REMOTE,
    HOMEBREW_CORE_GIT_REMOTE,
    HOMEBREW_BOTTLE_DOMAIN,
    HOMEBREW_API_DOMAIN,
  };
}

// ---------------------------------------------------------------------------
// Full mirror configuration
// ---------------------------------------------------------------------------

const PIP_CONF_CONTENT = `[global]
index-url = ${PYPI_MIRROR_URL}
`;

/**
 * Configure package manager mirrors for China region.
 *
 * - Writes pip config (skipped if file already exists).
 * - Sets npm registry (skipped if already configured).
 */
export async function configureMirrors(region: Region): Promise<void> {
  if (region !== "cn") return;

  await configurePipMirror();
  await configureNpmMirror();
}

async function configurePipMirror(): Promise<void> {
  const home = homedir();
  const isWin = platform() === "win32";

  const pipDir = isWin
    ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "pip")
    : join(home, ".pip");
  const pipFile = isWin ? join(pipDir, "pip.ini") : join(pipDir, "pip.conf");

  if (existsSync(pipFile)) {
    log.info(`pip config already exists at ${pipFile}, skipping`);
    return;
  }

  mkdirSync(pipDir, { recursive: true });
  writeFileSync(pipFile, PIP_CONF_CONTENT, "utf-8");
  log.info(`Wrote pip mirror config to ${pipFile}`);
}

async function configureNpmMirror(): Promise<void> {
  // Check current registry — skip if already set.
  try {
    const { stdout } = await execFile("npm", ["config", "get", "registry"], {
      timeout: 5_000,
    });
    if (stdout.trim() === NPM_MIRROR_URL) {
      log.info("npm registry already configured, skipping");
      return;
    }
  } catch {
    // npm not available — nothing to configure.
    log.info("npm not found, skipping npm mirror configuration");
    return;
  }

  await execFile("npm", ["config", "set", "registry", NPM_MIRROR_URL], {
    timeout: 5_000,
  });
  log.info(`Set npm registry to ${NPM_MIRROR_URL}`);
}
