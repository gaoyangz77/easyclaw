import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { app } from "electron";
import { createLogger } from "@easyclaw/logger";
import { ALL_PROVIDERS, getDefaultModelForProvider, providerSecretKey } from "@easyclaw/core";
import type { Storage } from "@easyclaw/storage";
import type { SecretStore } from "@easyclaw/secrets";

const log = createLogger("main");

/**
 * Remove stale device-pairing data so the node-host re-pairs with full operator
 * scopes on next gateway start.
 */
export function resetDevicePairing(stateDir: string): void {
  const pairedPath = join(stateDir, "devices", "paired.json");
  const pendingPath = join(stateDir, "devices", "pending.json");

  for (const p of [pairedPath, pendingPath]) {
    if (existsSync(p)) {
      unlinkSync(p);
      log.info(`Cleared device pairing data: ${p}`);
    }
  }
}

/**
 * Remove a stale gateway lock file and kill its owning process.
 */
export function cleanupGatewayLock(gatewayConfigPath: string): void {
  try {
    const lockHash = createHash("sha1").update(gatewayConfigPath).digest("hex").slice(0, 8);
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    const lockDir = join(tmpdir(), uid != null ? `openclaw-${uid}` : "openclaw");
    const lockPath = join(lockDir, `gateway.${lockHash}.lock`);

    if (!existsSync(lockPath)) return;

    const raw = readFileSync(lockPath, "utf-8");
    const lockData = JSON.parse(raw) as { pid?: number };
    const ownerPid = lockData?.pid;
    if (typeof ownerPid !== "number" || ownerPid <= 0 || ownerPid === process.pid) return;

    let alive = false;
    try { process.kill(ownerPid, 0); alive = true; } catch {}

    if (alive) {
      log.info(`Stale gateway lock found (PID ${ownerPid}), killing process`);
      try {
        if (process.platform === "win32") {
          execSync(`taskkill /T /F /PID ${ownerPid}`, { stdio: "ignore", shell: "cmd.exe" });
        } else {
          process.kill(ownerPid, "SIGKILL");
        }
      } catch (killErr) {
        log.warn(`Failed to kill stale gateway PID ${ownerPid}:`, killErr);
      }
    } else {
      log.info(`Stale gateway lock found (PID ${ownerPid} is dead), removing lock file`);
    }

    rmSync(lockPath, { force: true });
    log.info("Cleaned up stale gateway lock");
  } catch (lockErr) {
    log.debug("Gateway lock cleanup skipped:", lockErr);
  }
}

/**
 * Apply auto-launch (login item) setting to the OS.
 */
export function applyAutoLaunch(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
    log.info(`Auto-launch ${enabled ? "enabled" : "disabled"}`);
  } catch (err) {
    log.error("Failed to set login item settings:", err);
  }
}

/**
 * Migrate old-style `{provider}-api-key` secrets to the new provider_keys table.
 * Only runs if the provider_keys table is empty (first upgrade).
 */
export async function migrateOldProviderKeys(
  storage: Storage,
  secretStore: SecretStore,
): Promise<void> {
  const existing = storage.providerKeys.getAll();
  if (existing.length > 0) return;

  for (const provider of ALL_PROVIDERS) {
    const secretKey = providerSecretKey(provider);
    const keyValue = await secretStore.get(secretKey);
    if (keyValue && keyValue !== "") {
      const id = crypto.randomUUID();
      const model = getDefaultModelForProvider(provider)?.modelId ?? "";
      storage.providerKeys.create({
        id,
        provider,
        label: "Default",
        model,
        isDefault: true,
        createdAt: "",
        updatedAt: "",
      });
      await secretStore.set(`provider-key-${id}`, keyValue);
      log.info(`Migrated ${provider} key to provider_keys table (id: ${id})`);
    }
  }
}
