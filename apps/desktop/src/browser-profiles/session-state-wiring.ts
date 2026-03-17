import { SessionSnapshotStore, createAesGcmCrypto } from "./session-state/index.js";
import type { SessionStateBackupProvider } from "./session-state/index.js";
import { BrowserProfileRuntimeService } from "./runtime-service.js";
import type { ProfilePolicyResolver } from "./runtime-service.js";
import { SessionLifecycleManager } from "./session-lifecycle-manager.js";
import type { SecretStore } from "@rivonclaw/secrets";

export interface SessionStateStack {
  lifecycleManager: SessionLifecycleManager;
  runtimeService: BrowserProfileRuntimeService;
  store: SessionSnapshotStore;
}

/**
 * Create the full production session state stack.
 *
 * Session-state persistence is a shared foundation supporting runtime targets:
 * - managed_profile (PRIMARY): RivonClaw-managed multi-profile browsers
 * - cdp (COMPATIBILITY): User's existing Chrome via CDP debug port
 *
 * The stack is target-agnostic — adapter selection happens at session start time
 * via the adapter factory or direct adapter construction.
 *
 * Encryption: production uses AES-256-GCM with a random 256-bit key stored
 * in the OS keychain via SecretStore.
 * Use `createPlaintextCrypto()` for tests only.
 *
 * @param basePath - Base directory for session state storage
 * @param secretStore - OS keychain abstraction for encryption key storage
 * @param policyResolver - Optional resolver that reads session-state policy from
 *   the canonical cloud BrowserProfile model. When omitted, falls back to
 *   DEFAULT_SESSION_STATE_POLICY for all profiles.
 * @param backupProvider - Optional cloud backup provider for uploading/downloading
 *   encrypted snapshots. When omitted, a no-op provider is used.
 */
export async function createSessionStateStack(
  basePath: string,
  secretStore: SecretStore,
  policyResolver?: ProfilePolicyResolver,
  backupProvider?: SessionStateBackupProvider,
): Promise<SessionStateStack> {
  const crypto = await createAesGcmCrypto(secretStore);
  const store = new SessionSnapshotStore(basePath, crypto);
  const runtimeService = new BrowserProfileRuntimeService(store, policyResolver, backupProvider);
  const lifecycleManager = new SessionLifecycleManager(runtimeService);
  return { lifecycleManager, runtimeService, store };
}
