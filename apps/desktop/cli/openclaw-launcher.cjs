#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PRODUCT_NAME = "RivonClaw";
const ENTRY_FILE = "openclaw.mjs";

function fail(message, cause) {
  process.stderr.write(`openclaw: ${message}\n`);
  if (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  }
  process.exit(1);
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function defaultUserDataDir() {
  if (process.env.RIVONCLAW_DESKTOP_USER_DATA) {
    return process.env.RIVONCLAW_DESKTOP_USER_DATA;
  }
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "@easyclaw", "desktop");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "@easyclaw", "desktop");
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(configHome, "@easyclaw", "desktop");
}

function defaultOpenClawStateDir() {
  if (process.env.RIVONCLAW_OPENCLAW_STATE_DIR) {
    return process.env.RIVONCLAW_OPENCLAW_STATE_DIR;
  }
  if (process.env.OPENCLAW_STATE_DIR) {
    return process.env.OPENCLAW_STATE_DIR;
  }
  return path.join(os.homedir(), ".rivonclaw", "openclaw");
}

function cleanupStaleRuntimeDirs(runtimeBaseDir, currentVersion) {
  if (!fs.existsSync(runtimeBaseDir)) return;
  for (const entry of fs.readdirSync(runtimeBaseDir, { withFileTypes: true })) {
    const fullPath = path.join(runtimeBaseDir, entry.name);
    if (entry.name.startsWith(".extracting-")) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory() && entry.name !== currentVersion) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }
}

function ensureArchivedRuntime(archiveDir) {
  const manifestPath = path.join(archiveDir, "vendor-runtime-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    fail(`OpenClaw runtime is missing. Expected ${path.join(archiveDir, ENTRY_FILE)} or ${manifestPath}.`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.version || !manifest.archiveFile) {
    fail(`OpenClaw runtime manifest is invalid: ${manifestPath}`);
  }

  const runtimeBaseDir = path.join(defaultUserDataDir(), "runtime");
  const targetDir = path.join(runtimeBaseDir, manifest.version, "openclaw");
  const targetEntry = path.join(targetDir, ENTRY_FILE);
  if (fs.existsSync(targetEntry)) {
    cleanupStaleRuntimeDirs(runtimeBaseDir, manifest.version);
    return targetDir;
  }

  const archivePath = path.join(archiveDir, manifest.archiveFile);
  if (!fs.existsSync(archivePath)) {
    fail(`OpenClaw runtime archive not found: ${archivePath}`);
  }

  const tempDir = path.join(runtimeBaseDir, `.extracting-${manifest.version}-${process.pid}-${Date.now()}`);
  mkdirp(tempDir);

  const result = spawnSync("tar", ["-xzf", archivePath, "-C", tempDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fail(
      `failed to extract bundled OpenClaw runtime from ${archivePath}`,
      result.stderr || result.stdout || `tar exited with ${result.status}`,
    );
  }

  const tempEntry = path.join(tempDir, ENTRY_FILE);
  if (!fs.existsSync(tempEntry)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fail(`OpenClaw runtime archive did not contain ${ENTRY_FILE}.`);
  }

  const targetParent = path.dirname(targetDir);
  mkdirp(targetParent);
  try {
    fs.renameSync(tempDir, targetDir);
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (!fs.existsSync(targetEntry)) {
      fail(`failed to finalize OpenClaw runtime extraction at ${targetDir}`, err);
    }
  }

  cleanupStaleRuntimeDirs(runtimeBaseDir, manifest.version);
  return targetDir;
}

function resolveResourcesDir() {
  if (process.env.RIVONCLAW_RESOURCES_DIR) {
    return process.env.RIVONCLAW_RESOURCES_DIR;
  }
  return path.resolve(__dirname, "..");
}

function resolveVendorDir() {
  if (process.env.RIVONCLAW_VENDOR_DIR) {
    return process.env.RIVONCLAW_VENDOR_DIR;
  }
  const resourcesDir = resolveResourcesDir();
  const bundledVendorDir = path.join(resourcesDir, "vendor", "openclaw");
  if (fs.existsSync(path.join(bundledVendorDir, ENTRY_FILE))) {
    return bundledVendorDir;
  }
  return ensureArchivedRuntime(bundledVendorDir);
}

function resolveElectronBin() {
  if (process.env.RIVONCLAW_ELECTRON_BIN) {
    return process.env.RIVONCLAW_ELECTRON_BIN;
  }
  return process.execPath;
}

function main() {
  const vendorDir = resolveVendorDir();
  const entryPath = path.join(vendorDir, ENTRY_FILE);
  if (!fs.existsSync(entryPath)) {
    fail(`OpenClaw entry point not found: ${entryPath}`);
  }

  const stateDir = defaultOpenClawStateDir();
  const configPath =
    process.env.RIVONCLAW_OPENCLAW_CONFIG_PATH ||
    process.env.OPENCLAW_CONFIG_PATH ||
    path.join(stateDir, "openclaw.json");
  const bundledPluginsDir = path.join(vendorDir, "dist-runtime", "extensions");

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    OPENCLAW_DISABLE_BONJOUR: process.env.OPENCLAW_DISABLE_BONJOUR || "1",
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: configPath,
  };
  if (fs.existsSync(bundledPluginsDir)) {
    env.OPENCLAW_BUNDLED_PLUGINS_DIR = bundledPluginsDir;
  }

  const electronBin = resolveElectronBin();
  const args = [entryPath, ...process.argv.slice(2)];

  if (process.env.RIVONCLAW_CLI_LAUNCHER_DRY_RUN === "1") {
    process.stdout.write(JSON.stringify({
      electronBin,
      entryPath,
      vendorDir,
      stateDir,
      configPath,
      bundledPluginsDir: env.OPENCLAW_BUNDLED_PLUGINS_DIR || null,
      args,
    }, null, 2) + "\n");
    return;
  }

  const child = spawnSync(electronBin, args, {
    env,
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: false,
  });

  if (child.error) {
    fail(`failed to start bundled ${PRODUCT_NAME} runtime: ${electronBin}`, child.error);
  }
  if (typeof child.status === "number") {
    process.exit(child.status);
  }
  if (child.signal) {
    process.stderr.write(`openclaw: terminated by ${child.signal}\n`);
    process.exit(1);
  }
}

main();
