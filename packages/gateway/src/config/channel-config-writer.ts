import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createLogger } from "@rivonclaw/logger";

const log = createLogger("channel-config");

export interface ChannelAccountConfig {
  name?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface WriteChannelAccountOptions {
  configPath: string;
  channelId: string;
  accountId: string;
  config: ChannelAccountConfig;
}

export interface RemoveChannelAccountOptions {
  configPath: string;
  channelId: string;
  accountId: string;
}

/**
 * Write or update a channel account configuration in OpenClaw config.json.
 * Creates the channels section and account structure if they don't exist.
 */
export function writeChannelAccount(options: WriteChannelAccountOptions): void {
  const { configPath, channelId, accountId, config } = options;

  // Read existing config
  let existingConfig: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      existingConfig = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      log.warn(`Failed to parse existing config at ${configPath}:`, err);
    }
  }

  // Migrate any old single-account channel configs to multi-account format
  migrateSingleAccountChannels(existingConfig);

  // Ensure channels object exists
  if (!existingConfig.channels || typeof existingConfig.channels !== "object") {
    existingConfig.channels = {};
  }

  const channels = existingConfig.channels as Record<string, unknown>;

  // Ensure channel object exists
  if (!channels[channelId] || typeof channels[channelId] !== "object") {
    channels[channelId] = {};
  }

  const channel = channels[channelId] as Record<string, unknown>;

  // Write to accounts.<accountId> for all accounts (including "default")
  if (!channel.accounts || typeof channel.accounts !== "object") {
    channel.accounts = {};
  }

  const accounts = channel.accounts as Record<string, unknown>;
  accounts[accountId] = config;

  // Auto-enable the channel plugin in plugins.entries so the gateway loads it
  enableChannelPlugin(existingConfig, channelId);

  // Ensure a wildcard binding exists for non-default accounts so OpenClaw's
  // doctor doesn't warn about missing bindings and rewrite the config file.
  if (accountId.trim().toLowerCase() !== "default") {
    ensureWildcardBinding(existingConfig, channelId);
  }

  // Write back to file
  writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), "utf-8");
  log.info(`Wrote channel account: ${channelId}/${accountId}`);
}

/**
 * Remove a channel account from OpenClaw config.json.
 */
export function removeChannelAccount(options: RemoveChannelAccountOptions): void {
  const { configPath, channelId, accountId } = options;

  if (!existsSync(configPath)) {
    log.warn(`Config file not found: ${configPath}`);
    return;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;

    // Migrate any old single-account channel configs to multi-account format
    migrateSingleAccountChannels(config);

    if (!config.channels || typeof config.channels !== "object") {
      log.warn("No channels config found");
      return;
    }

    const channels = config.channels as Record<string, unknown>;

    if (!channels[channelId] || typeof channels[channelId] !== "object") {
      log.warn(`Channel ${channelId} not found in config`);
      return;
    }

    const channel = channels[channelId] as Record<string, unknown>;

    // Remove account from accounts.<accountId> (including "default")
    if (channel.accounts && typeof channel.accounts === "object") {
      const accounts = channel.accounts as Record<string, unknown>;

      if (accountId in accounts) {
        delete accounts[accountId];
      } else {
        // Fallback: the gateway may report a different accountId (e.g. "default")
        // than the config key. If the requested key isn't found, try matching by
        // name or remove the sole account if there's only one.
        const keys = Object.keys(accounts);
        const matchByName = keys.find((k) => {
          const acct = accounts[k];
          return typeof acct === "object" && acct !== null && (acct as Record<string, unknown>).name === accountId;
        });

        if (matchByName) {
          log.info(`Account key "${accountId}" not found, matched by name: "${matchByName}"`);
          delete accounts[matchByName];
        } else if (keys.length === 1) {
          log.info(`Account key "${accountId}" not found, removing sole account: "${keys[0]}"`);
          delete accounts[keys[0]];
        } else {
          log.warn(`Account "${accountId}" not found in ${channelId} accounts: [${keys.join(", ")}]`);
        }
      }

      // Keep the channel plugin enabled even when the last account is removed:
      // QR-login channels (weixin) need the plugin alive to respond to
      // `web.login.start` BEFORE any account exists.
      if (Object.keys(accounts).length === 0) {
        delete channels[channelId];
      }
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    log.info(`Removed channel account: ${channelId}/${accountId}`);
  } catch (err) {
    log.error(`Failed to remove channel account ${channelId}/${accountId}:`, err);
    throw err;
  }
}

/**
 * Enable a channel's plugin in plugins.entries so the gateway loads it.
 * Channel ID maps directly to plugin ID (e.g., "telegram" → plugins.entries.telegram).
 */
function enableChannelPlugin(config: Record<string, unknown>, channelId: string): void {
  if (!config.plugins || typeof config.plugins !== "object") {
    config.plugins = {};
  }
  const plugins = config.plugins as Record<string, unknown>;

  if (!plugins.entries || typeof plugins.entries !== "object") {
    plugins.entries = {};
  }
  const entries = plugins.entries as Record<string, unknown>;

  const existing = typeof entries[channelId] === "object" && entries[channelId] !== null
    ? (entries[channelId] as Record<string, unknown>)
    : {};
  entries[channelId] = { ...existing, enabled: true };

  log.info(`Enabled channel plugin: ${channelId}`);
}

/**
 * Ensure a wildcard binding exists for a channel so OpenClaw routes messages
 * from non-default accounts to the default agent without doctor warnings.
 */
function ensureWildcardBinding(config: Record<string, unknown>, channelId: string): void {
  const bindings = (Array.isArray(config.bindings) ? config.bindings : []) as Array<Record<string, unknown>>;
  const channelLower = channelId.toLowerCase();

  const hasCovering = bindings.some(b => {
    const match = b.match as Record<string, unknown> | undefined;
    if (!match) return false;
    const matchChannel = typeof match.channel === "string" ? match.channel.trim().toLowerCase() : "";
    if (matchChannel !== channelLower) return false;
    const matchAccountId = typeof match.accountId === "string" ? match.accountId.trim() : "";
    return matchAccountId === "*";
  });

  if (!hasCovering) {
    bindings.push({
      agentId: "main",
      match: { channel: channelId, accountId: "*" },
    });
    config.bindings = bindings;
    log.info(`Added wildcard binding for channel "${channelId}"`);
  }
}

/**
 * Keys that should be moved from channel top-level into accounts.default
 * when migrating from single-account to multi-account format.
 *
 * This mirrors the COMMON_SINGLE_ACCOUNT_KEYS_TO_MOVE set in OpenClaw's
 * setup-helpers.ts plus per-channel overrides.
 */
const SINGLE_ACCOUNT_KEYS_TO_MOVE = new Set([
  "name",
  "token",
  "tokenFile",
  "botToken",
  "appToken",
  "account",
  "signalNumber",
  "authDir",
  "cliPath",
  "dbPath",
  "httpUrl",
  "httpHost",
  "httpPort",
  "webhookPath",
  "webhookUrl",
  "webhookSecret",
  "service",
  "region",
  "homeserver",
  "userId",
  "accessToken",
  "password",
  "deviceName",
  "url",
  "code",
  "dmPolicy",
  "allowFrom",
  "groupPolicy",
  "groupAllowFrom",
  "groups",
  "defaultTo",
]);

const PER_CHANNEL_KEYS_TO_MOVE: Record<string, ReadonlySet<string>> = {
  telegram: new Set(["streaming"]),
};

function shouldMoveKey(channelId: string, key: string): boolean {
  if (SINGLE_ACCOUNT_KEYS_TO_MOVE.has(key)) return true;
  return PER_CHANNEL_KEYS_TO_MOVE[channelId]?.has(key) ?? false;
}

/**
 * Migrate old single-account channel config format to multi-account format.
 *
 * OpenClaw originally supported a flat channel config where account-specific
 * keys (botToken, dmPolicy, etc.) lived directly under channels.<channelId>.
 * The multi-account format nests these under channels.<channelId>.accounts.default.
 *
 * This migration handles two scenarios:
 * 1. Channel has NO accounts object yet — move top-level keys into accounts.default.
 * 2. Channel has accounts but NO "default" account — move top-level keys into accounts.default
 *    (this happens when named accounts were added but the original single-account config
 *    wasn't migrated).
 *
 * Mutates the config object in-place. Returns the list of migrated channel IDs for logging.
 */
export function migrateSingleAccountChannels(config: Record<string, unknown>): string[] {
  if (!config.channels || typeof config.channels !== "object") {
    return [];
  }

  const channels = config.channels as Record<string, unknown>;
  const migrated: string[] = [];

  for (const [channelId, rawChannel] of Object.entries(channels)) {
    if (!rawChannel || typeof rawChannel !== "object" || Array.isArray(rawChannel)) {
      continue;
    }

    const channel = rawChannel as Record<string, unknown>;

    // Collect top-level keys that should be under accounts.default
    const keysToMove = Object.keys(channel).filter(
      (key) =>
        key !== "accounts" &&
        key !== "enabled" &&
        channel[key] !== undefined &&
        shouldMoveKey(channelId, key),
    );

    if (keysToMove.length === 0) {
      continue;
    }

    // Check if accounts.default already exists
    const accounts =
      channel.accounts && typeof channel.accounts === "object"
        ? (channel.accounts as Record<string, unknown>)
        : {};

    const hasDefault = Object.keys(accounts).some(
      (key) => key.trim().toLowerCase() === "default",
    );

    if (hasDefault) {
      // Default account already exists — don't overwrite it
      continue;
    }

    // Build the default account from top-level keys
    const defaultAccount: Record<string, unknown> = {};
    for (const key of keysToMove) {
      const value = channel[key];
      defaultAccount[key] =
        value && typeof value === "object" ? structuredClone(value) : value;
    }

    // Remove migrated keys from channel top-level
    for (const key of keysToMove) {
      delete channel[key];
    }

    // Create or merge into accounts object
    channel.accounts = { ...accounts, default: defaultAccount };
    migrated.push(channelId);
    log.info(
      `Migrated channels.${channelId} single-account config into channels.${channelId}.accounts.default`,
    );
  }

  return migrated;
}

/**
 * Get all account IDs for a specific channel from config.
 */
export function listChannelAccounts(
  configPath: string,
  channelId: string
): string[] {
  if (!existsSync(configPath)) {
    return [];
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;

    if (!config.channels || typeof config.channels !== "object") {
      return [];
    }

    const channels = config.channels as Record<string, unknown>;
    const channel = channels[channelId];

    if (!channel || typeof channel !== "object") {
      return [];
    }

    const channelObj = channel as Record<string, unknown>;

    if (channelObj.accounts && typeof channelObj.accounts === "object") {
      return Object.keys(channelObj.accounts as Record<string, unknown>);
    }

    return [];
  } catch (err) {
    log.error(`Failed to list channel accounts for ${channelId}:`, err);
    return [];
  }
}
