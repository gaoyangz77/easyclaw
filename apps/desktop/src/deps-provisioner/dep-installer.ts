import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, arch } from "node:os";
import { join } from "node:path";
import { createLogger } from "@rivonclaw/logger";
import type { DepName } from "./types.js";
import { getAugmentedPath } from "./dep-detector.js";
import { getMirrorEnv } from "./mirror-config.js";
import type { Region } from "./region-detector.js";

const log = createLogger("deps-provisioner");

const INSTALL_TIMEOUT = 5 * 60_000; // 5 minutes

// ---------------------------------------------------------------------------
// Core spawn helper
// ---------------------------------------------------------------------------

interface SpawnOpts {
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
  timeout?: number;
}

function spawnAsync(
  cmd: string,
  args: string[],
  onOutput: (line: string) => void,
  opts: SpawnOpts = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = opts.env ?? { ...process.env, PATH: getAugmentedPath() };
    const child = spawn(cmd, args, {
      env,
      shell: opts.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeout ?? INSTALL_TIMEOUT,
    });

    const handleData = (data: Buffer): void => {
      const text = data.toString("utf-8");
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) {
          onOutput(line);
        }
      }
    };

    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn ${cmd}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

function getBrewPrefix(): string {
  return arch() === "arm64" ? "/opt/homebrew" : "/usr/local";
}

function getBrewBin(): string {
  return join(getBrewPrefix(), "bin", "brew");
}

async function ensureHomebrew(
  region: Region,
  onOutput: (line: string) => void,
): Promise<void> {
  // Check if brew is already available
  try {
    await spawnAsync(getBrewBin(), ["--version"], onOutput, {
      timeout: 10_000,
    });
    log.info("Homebrew already installed");
    return;
  } catch {
    // Not installed — proceed with installation.
  }

  log.info("Installing Homebrew");
  onOutput("Installing Homebrew...");

  const mirrorEnv = getMirrorEnv(region);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: getAugmentedPath(),
    NONINTERACTIVE: "1",
    ...mirrorEnv,
  };

  await spawnAsync(
    "/bin/bash",
    [
      "-c",
      '$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)',
    ],
    onOutput,
    { env },
  );

  // For cn region, inject mirror env vars into the user's shell profile
  if (region === "cn" && mirrorEnv) {
    await injectBrewMirrorToProfile(mirrorEnv, onOutput);
  }
}

async function injectBrewMirrorToProfile(
  mirrorEnv: Record<string, string>,
  onOutput: (line: string) => void,
): Promise<void> {
  const home = homedir();
  const profilePath = join(home, ".zprofile");

  const exportLines = Object.entries(mirrorEnv)
    .map(([key, val]) => `export ${key}="${val}"`)
    .join("\n");

  const marker = "# RivonClaw Homebrew mirrors";
  const block = `\n${marker}\n${exportLines}\n`;

  try {
    let existing = "";
    try {
      existing = await readFile(profilePath, "utf-8");
    } catch {
      // File doesn't exist yet — will create.
    }

    if (existing.includes(marker)) {
      log.info("Homebrew mirror exports already in shell profile");
      return;
    }

    const { writeFile } = await import("node:fs/promises");
    await writeFile(profilePath, existing + block, "utf-8");
    onOutput("Added Homebrew mirror configuration to ~/.zprofile");
    log.info("Injected Homebrew mirror env into shell profile");
  } catch (err) {
    log.warn(`Failed to inject mirror env into profile: ${err}`);
  }
}

async function installDepMacOS(
  dep: DepName,
  region: Region,
  onOutput: (line: string) => void,
): Promise<void> {
  await ensureHomebrew(region, onOutput);

  const mirrorEnv = getMirrorEnv(region);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: getAugmentedPath(),
    ...mirrorEnv,
  };

  if (dep === "uv") {
    if (region === "cn") {
      // In China, astral.sh redirects to GitHub which is blocked by GFW.
      // Use Homebrew instead (already configured with USTC mirrors).
      onOutput("Installing uv via Homebrew...");
      await spawnAsync(getBrewBin(), ["install", "uv"], onOutput, { env });
    } else {
      onOutput("Installing uv via curl...");
      await spawnAsync(
        "/bin/bash",
        ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"],
        onOutput,
        { env: { ...process.env, PATH: getAugmentedPath() } },
      );
    }
    return;
  }

  const brewFormula: Record<Exclude<DepName, "uv">, string> = {
    git: "git",
    python: "python@3",
    node: "node",
  };

  const formula = brewFormula[dep];
  onOutput(`Installing ${formula} via Homebrew...`);
  await spawnAsync(getBrewBin(), ["install", formula], onOutput, { env });
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

async function isWingetAvailable(): Promise<boolean> {
  try {
    await spawnAsync("where.exe", ["winget"], () => {}, {
      shell: true,
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

const WINGET_IDS: Record<DepName, string> = {
  git: "Git.Git",
  python: "Python.Python.3.12",
  node: "OpenJS.NodeJS.LTS",
  uv: "astral-sh.uv",
};

async function installDepWindows(
  dep: DepName,
  region: Region,
  onOutput: (line: string) => void,
): Promise<void> {
  const hasWinget = await isWingetAvailable();

  if (hasWinget) {
    const wingetId = WINGET_IDS[dep];
    onOutput(`Installing ${dep} via winget (${wingetId})...`);
    await spawnAsync(
      "winget",
      [
        "install",
        "--id",
        wingetId,
        "-e",
        "--source",
        "winget",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ],
      onOutput,
      { shell: true },
    );
    return;
  }

  // Winget not available — fallback for uv only
  if (dep === "uv") {
    if (region === "cn") {
      // astral.sh redirects to GitHub, blocked by GFW. Use pip as fallback.
      onOutput("Installing uv via pip...");
      await spawnAsync("pip", ["install", "uv"], onOutput, { shell: true });
    } else {
      onOutput("Installing uv via PowerShell...");
      await spawnAsync(
        "powershell",
        [
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "irm https://astral.sh/uv/install.ps1 | iex",
        ],
        onOutput,
        { shell: true },
      );
    }
    return;
  }

  throw new Error(
    `Cannot install ${dep}: winget is not available. ` +
      `Please install ${dep} manually, or update Windows to a version that includes winget (App Installer). ` +
      `You can get winget from the Microsoft Store: https://aka.ms/getwinget`,
  );
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

type PkgManager = "apt-get" | "dnf" | "pacman";

const APT_DISTROS = new Set([
  "ubuntu",
  "debian",
  "linuxmint",
  "pop",
]);
const DNF_DISTROS = new Set([
  "fedora",
  "rhel",
  "centos",
  "rocky",
  "alma",
]);
const PACMAN_DISTROS = new Set([
  "arch",
  "manjaro",
  "endeavouros",
]);

async function detectPkgManager(): Promise<PkgManager> {
  let content: string;
  try {
    content = await readFile("/etc/os-release", "utf-8");
  } catch {
    throw new Error(
      "Cannot detect Linux distribution: /etc/os-release not found",
    );
  }

  const idMatch = content.match(/^ID=["']?([a-z_-]+)["']?/m);
  const distroId = idMatch?.[1] ?? "";

  if (APT_DISTROS.has(distroId)) return "apt-get";
  if (DNF_DISTROS.has(distroId)) return "dnf";
  if (PACMAN_DISTROS.has(distroId)) return "pacman";

  throw new Error(
    `Unsupported Linux distribution: ${distroId}. ` +
      `Supported: Ubuntu, Debian, Linux Mint, Pop!_OS, Fedora, RHEL, CentOS, Rocky, Alma, Arch, Manjaro, EndeavourOS.`,
  );
}

const LINUX_PACKAGES: Record<
  PkgManager,
  Record<Exclude<DepName, "uv">, string[]>
> = {
  "apt-get": {
    git: ["git"],
    python: ["python3"],
    node: ["nodejs", "npm"],
  },
  dnf: {
    git: ["git"],
    python: ["python3"],
    node: ["nodejs", "npm"],
  },
  pacman: {
    git: ["git"],
    python: ["python"],
    node: ["nodejs", "npm"],
  },
};

async function getSudoPrefix(
  onOutput: (line: string) => void,
): Promise<string> {
  // Prefer pkexec for graphical sudo prompt
  try {
    await spawnAsync("which", ["pkexec"], () => {}, { timeout: 5_000 });
    return "pkexec";
  } catch {
    // Fall back to sudo
    onOutput("pkexec not found, falling back to sudo");
    return "sudo";
  }
}

function buildInstallArgs(
  pkgMgr: PkgManager,
  packages: string[],
): string[] {
  switch (pkgMgr) {
    case "apt-get":
      return ["apt-get", "install", "-y", ...packages];
    case "dnf":
      return ["dnf", "install", "-y", ...packages];
    case "pacman":
      return ["pacman", "-S", "--noconfirm", ...packages];
  }
}

async function installDepLinux(
  dep: DepName,
  region: Region,
  onOutput: (line: string) => void,
): Promise<void> {
  if (dep === "uv") {
    if (region === "cn") {
      // astral.sh redirects to GitHub, blocked by GFW. Use pip as fallback.
      onOutput("Installing uv via pip...");
      await spawnAsync("pip3", ["install", "uv"], onOutput);
    } else {
      onOutput("Installing uv via curl...");
      await spawnAsync(
        "/bin/bash",
        ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"],
        onOutput,
      );
    }
    return;
  }

  const pkgMgr = await detectPkgManager();
  const packages = LINUX_PACKAGES[pkgMgr][dep];
  const sudoCmd = await getSudoPrefix(onOutput);
  const installArgs = buildInstallArgs(pkgMgr, packages);

  onOutput(`Installing ${packages.join(", ")} via ${pkgMgr}...`);
  await spawnAsync(sudoCmd, installArgs, onOutput);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function installDep(
  dep: DepName,
  platform: NodeJS.Platform,
  region: Region,
  onOutput: (line: string) => void,
): Promise<void> {
  log.info(`Installing ${dep} on ${platform} (region: ${region})`);

  switch (platform) {
    case "darwin":
      await installDepMacOS(dep, region, onOutput);
      break;
    case "win32":
      await installDepWindows(dep, region, onOutput);
      break;
    case "linux":
      await installDepLinux(dep, region, onOutput);
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  log.info(`Successfully installed ${dep}`);
}
