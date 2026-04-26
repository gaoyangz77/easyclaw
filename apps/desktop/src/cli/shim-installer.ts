import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "@rivonclaw/logger";

const log = createLogger("cli-shim");

export interface CliShimInstallOptions {
  electronBin: string;
  resourcesPath: string;
  userDataDir: string;
  stateDir: string;
  configPath: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function normalizePathList(value: string | undefined): string[] {
  return (value ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pathContains(dir: string, value = process.env.PATH): boolean {
  const normalizedDir = dir.replace(/[\\/]+$/, "").toLowerCase();
  return normalizePathList(value).some((entry) => entry.replace(/[\\/]+$/, "").toLowerCase() === normalizedDir);
}

function writeIfChanged(filePath: string, contents: string): boolean {
  if (existsSync(filePath)) {
    const current = readFileSync(filePath, "utf-8");
    if (current === contents) return false;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf-8");
  return true;
}

function appendPathToShellProfile(profilePath: string, binDir: string): void {
  const markerStart = "# >>> RivonClaw CLI >>>";
  const markerEnd = "# <<< RivonClaw CLI <<<";
  const pathExpr = binDir.startsWith(homedir())
    ? binDir.replace(homedir(), "$HOME")
    : binDir;
  const block = [
    "",
    markerStart,
    `export PATH="${pathExpr}:$PATH"`,
    markerEnd,
    "",
  ].join("\n");

  const current = existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : "";
  if (current.includes(markerStart) || current.includes(binDir) || current.includes(pathExpr)) {
    return;
  }
  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, current.endsWith("\n") || current.length === 0 ? current + block : current + "\n" + block, "utf-8");
}

function ensurePosixShellPath(binDir: string): void {
  if (pathContains(binDir)) return;
  const home = homedir();
  appendPathToShellProfile(join(home, ".zshrc"), binDir);
  appendPathToShellProfile(join(home, ".bashrc"), binDir);
}

function ensureWindowsUserPath(binDir: string): void {
  if (pathContains(binDir)) return;
  const script = [
    "$bin = [Environment]::GetEnvironmentVariable('RIVONCLAW_CLI_BIN', 'Process')",
    "$path = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "$entries = @()",
    "if ($path) { $entries = $path -split ';' | Where-Object { $_ } }",
    "if (-not ($entries | Where-Object { $_.TrimEnd('\\\\') -ieq $bin.TrimEnd('\\\\') })) {",
    "  $next = (($entries + $bin) | Where-Object { $_ }) -join ';'",
    "  [Environment]::SetEnvironmentVariable('Path', $next, 'User')",
    "}",
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: { ...process.env, RIVONCLAW_CLI_BIN: binDir },
    stdio: "ignore",
    windowsHide: true,
  });
}

function buildPosixShim(options: CliShimInstallOptions): string {
  const launcherPath = join(options.resourcesPath, "cli", "openclaw-launcher.cjs");
  return [
    "#!/bin/sh",
    `export ELECTRON_RUN_AS_NODE=1`,
    `export RIVONCLAW_ELECTRON_BIN=${shellQuote(options.electronBin)}`,
    `export RIVONCLAW_DESKTOP_USER_DATA=${shellQuote(options.userDataDir)}`,
    `export RIVONCLAW_OPENCLAW_STATE_DIR=${shellQuote(options.stateDir)}`,
    `export RIVONCLAW_OPENCLAW_CONFIG_PATH=${shellQuote(options.configPath)}`,
    `exec ${shellQuote(options.electronBin)} ${shellQuote(launcherPath)} "$@"`,
    "",
  ].join("\n");
}

function buildWindowsShim(options: CliShimInstallOptions): string {
  const launcherPath = join(options.resourcesPath, "cli", "openclaw-launcher.cjs");
  return [
    "@echo off",
    "setlocal",
    "set \"ELECTRON_RUN_AS_NODE=1\"",
    `set "RIVONCLAW_ELECTRON_BIN=${options.electronBin}"`,
    `set "RIVONCLAW_DESKTOP_USER_DATA=${options.userDataDir}"`,
    `set "RIVONCLAW_OPENCLAW_STATE_DIR=${options.stateDir}"`,
    `set "RIVONCLAW_OPENCLAW_CONFIG_PATH=${options.configPath}"`,
    `"${options.electronBin}" "${launcherPath}" %*`,
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

export function resolveCliShimPath(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "RivonClaw", "bin", "openclaw.cmd");
  }
  return join(homedir(), ".local", "bin", "openclaw");
}

export async function ensureOpenClawCliShimInstalled(options: CliShimInstallOptions): Promise<void> {
  const shimPath = resolveCliShimPath();
  const launcherPath = join(options.resourcesPath, "cli", "openclaw-launcher.cjs");
  if (!existsSync(launcherPath)) {
    log.warn(`CLI launcher not found, skipping shim install: ${launcherPath}`);
    return;
  }

  try {
    const changed = process.platform === "win32"
      ? writeIfChanged(shimPath, buildWindowsShim(options))
      : writeIfChanged(shimPath, buildPosixShim(options));

    if (process.platform !== "win32") {
      chmodSync(shimPath, 0o755);
      ensurePosixShellPath(dirname(shimPath));
    } else {
      ensureWindowsUserPath(dirname(shimPath));
    }

    log.info(`${changed ? "Installed" : "Verified"} OpenClaw CLI shim at ${shimPath}`);
  } catch (err) {
    log.warn("Failed to install OpenClaw CLI shim:", err);
  }
}
