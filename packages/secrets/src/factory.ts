import { platform } from "node:os";
import type { SecretStore } from "./types.js";
import { KeychainSecretStore } from "./keychain.js";
import { FileSecretStore } from "./file-store.js";
import { createLogger } from "@easyclaw/logger";

const log = createLogger("secrets:factory");

/**
 * Create a platform-appropriate SecretStore instance.
 *
 * - macOS  -> KeychainSecretStore
 * - win32  -> FileSecretStore (DPAPI placeholder for V0)
 * - other  -> FileSecretStore (encrypted file-based fallback)
 */
export function createSecretStore(): SecretStore {
  // Allow overriding secrets directory via env var (e.g. for E2E tests)
  const customDir = process.env.EASYCLAW_SECRETS_DIR;
  if (customDir) {
    log.info("using FileSecretStore with custom dir: " + customDir);
    return new FileSecretStore(customDir);
  }

  const os = platform();
  log.info("creating secret store for platform: " + os);

  if (os === "darwin") {
    return new KeychainSecretStore();
  }

  // For win32 and all other platforms, use file-based encrypted store
  return new FileSecretStore();
}
