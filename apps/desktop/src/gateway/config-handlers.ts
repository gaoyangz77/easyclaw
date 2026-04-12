import { createLogger } from "@rivonclaw/logger";
import { buildGatewayEnv } from "@rivonclaw/gateway";
import type { GatewayLauncher, WriteGatewayConfigOptions } from "@rivonclaw/gateway";
import type { Storage } from "@rivonclaw/storage";
import type { SecretStore } from "@rivonclaw/secrets";
import { openClawConnector } from "../openclaw/index.js";

const log = createLogger("gateway-config");

export interface GatewayConfigHandlerDeps {
  storage: Storage;
  secretStore: SecretStore;
  launcher: GatewayLauncher;
  stateDir: string;
  workspacePath: string;
  buildFullGatewayConfig: () => Promise<WriteGatewayConfigOptions>;
  writeGatewayConfig: (config: WriteGatewayConfigOptions) => string;
  buildFullProxyEnv: () => Record<string, string>;
  sttManager: { initialize: () => Promise<void> };
  syncAllAuthProfiles: (stateDir: string, storage: Storage, secretStore: SecretStore) => Promise<void>;
  writeProxyRouterConfig: (storage: Storage, secretStore: SecretStore, lastSystemProxy: string | null) => Promise<void>;
  getLastSystemProxy: () => string | null;
}

export function createGatewayConfigHandlers(deps: GatewayConfigHandlerDeps) {
  const {
    storage,
    secretStore,
    launcher,
    stateDir,
    workspacePath,
    buildFullGatewayConfig,
    writeGatewayConfig,
    buildFullProxyEnv,
    sttManager,
    syncAllAuthProfiles,
    writeProxyRouterConfig,
    getLastSystemProxy,
  } = deps;

  /**
   * Called when STT settings or credentials change.
   * Regenerates gateway config and restarts gateway to apply new env vars.
   */
  async function handleSttChange(): Promise<void> {
    log.info("STT settings changed, regenerating config and restarting gateway");

    await openClawConnector.applyConfigMutation(async () => {
      // Regenerate full OpenClaw config (reads current STT settings from storage)
      writeGatewayConfig(await buildFullGatewayConfig());

      // Rebuild environment with updated STT credentials (GROQ_API_KEY, etc.)
      const secretEnv = await buildGatewayEnv(secretStore, { ELECTRON_RUN_AS_NODE: "1" }, storage, workspacePath);
      launcher.setEnv({ ...secretEnv, ...buildFullProxyEnv() });

      // Reinitialize STT manager
      await sttManager.initialize().catch((err) => {
        log.error("Failed to reinitialize STT manager:", err);
      });
    }, "restart_process");
  }

  /**
   * Called when web search or embedding settings/credentials change.
   * Regenerates gateway config and restarts gateway to apply new env vars.
   */
  async function handleExtrasChange(): Promise<void> {
    log.info("Extras settings changed, regenerating config and restarting gateway");

    await openClawConnector.applyConfigMutation(async () => {
      // Regenerate full OpenClaw config (reads current web search / embedding settings from storage)
      writeGatewayConfig(await buildFullGatewayConfig());

      // Rebuild environment with updated credentials (BRAVE_API_KEY, VOYAGE_API_KEY, etc.)
      const secretEnv = await buildGatewayEnv(secretStore, { ELECTRON_RUN_AS_NODE: "1" }, storage, workspacePath);
      launcher.setEnv({ ...secretEnv, ...buildFullProxyEnv() });
    }, "restart_process");
  }

  /**
   * Called when file permissions change.
   * Rebuilds environment variables and restarts the gateway to apply the new permissions.
   */
  async function handlePermissionsChange(): Promise<void> {
    log.info("File permissions changed, rebuilding environment and restarting gateway");

    await openClawConnector.applyConfigMutation(async () => {
      // Rebuild environment with updated file permissions
      const secretEnv = await buildGatewayEnv(secretStore, { ELECTRON_RUN_AS_NODE: "1" }, storage, workspacePath);
      launcher.setEnv({ ...secretEnv, ...buildFullProxyEnv() });
    }, "restart_process");
  }

  /**
   * Called when provider settings change (API key added/removed, default changed, proxy changed).
   *
   * Hint modes:
   * - `keyOnly: true` — Only an API key changed (add/activate/delete).
   *   Syncs auth-profiles.json and proxy router config. No restart needed.
   * - `configOnly: true` — Only the config file changed (e.g. model switch).
   *   Updates gateway config and sends a graceful reload (SIGUSR1).
   * - Neither — Updates all configs and restarts gateway.
   *   Full restart ensures model changes take effect immediately.
   */
  async function handleProviderChange(hint?: { configOnly?: boolean; keyOnly?: boolean }): Promise<void> {
    const keyOnly = hint?.keyOnly === true;
    const configOnly = hint?.configOnly === true;
    log.info(`Provider settings changed (keyOnly=${keyOnly}, configOnly=${configOnly})`);

    // Always sync auth profiles and proxy router config so OpenClaw has current state on disk
    await Promise.all([
      syncAllAuthProfiles(stateDir, storage, secretStore),
      writeProxyRouterConfig(storage, secretStore, getLastSystemProxy()),
    ]);

    if (keyOnly) {
      // Key-only change: auth profiles + proxy config synced, done.
      // OpenClaw re-reads auth-profiles.json on every LLM turn,
      // proxy router re-reads its config file on change (fs.watch).
      // No restart needed — zero disruption.
      log.info("Key-only change, configs synced (no restart needed)");
      return;
    }

    if (configOnly) {
      // Config-only change (e.g. channel add/delete): the config file was
      // already modified by the caller. Just tell the running gateway to
      // re-read it via SIGUSR1 — no process restart needed.
      log.info("Config-only change, sending graceful reload to gateway");
      await openClawConnector.applyConfigMutation(() => {
        // Config already written by caller — no mutation needed.
      }, "reload_config");
      return;
    }

    // Full restart path: rewrite config + restart process.
    // SIGUSR1 graceful reload re-reads config but agent sessions keep their
    // existing model assignment. A stop+start creates fresh sessions with
    // the new default model from config.
    log.info("Config updated, performing full gateway restart for model change");
    await openClawConnector.applyConfigMutation(async () => {
      // Rewrite full OpenClaw config (reads current provider/model from storage)
      writeGatewayConfig(await buildFullGatewayConfig());
    }, "restart_process");
    // RPC client reconnects automatically via the connector's initLauncher wiring.
  }

  return {
    handleSttChange,
    handleExtrasChange,
    handlePermissionsChange,
    handleProviderChange,
  };
}
