export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * SQLite migrations for Desktop local storage.
 *
 * Cleanup policy:
 * - Schema / baseline migrations (CREATE TABLE / ALTER TABLE / new indexes)
 *   must stay in this file until their effects are folded into
 *   `initial_schema` (and any necessary table-rebuild baseline) in one
 *   deliberate squash. Do not delete them standalone just because they are
 *   old, or fresh databases and upgraded databases will diverge.
 * - One-shot compatibility / data-repair migrations may be tagged with
 *   `introduced` and `remove after`. Those can be deleted once the oldest
 *   supported install has upgraded past `remove after`.
 *
 * Current cleanup plan:
 * - `27 canonicalize_weixin_account_ids`: introduced v1.7.14, remove after
 *   v1.9.0.
 * - `28 remove_stale_feishu_bot_name`: introduced v1.7.14, remove after
 *   v1.9.0.
 * - `22`-`26` are schema migrations added during the v1.7.x line. After
 *   v1.9.0, they are good candidates for a baseline squash into
 *   `initial_schema`, but should not be deleted directly.
 */
export const migrations: Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        output_path TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        compiled_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        channel_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        account_id TEXT NOT NULL,
        settings TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        read_paths TEXT NOT NULL DEFAULT '[]',
        write_paths TEXT NOT NULL DEFAULT '[]'
      );

      INSERT OR IGNORE INTO permissions (id, read_paths, write_paths)
        VALUES (1, '[]', '[]');

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: "add_provider_keys_table",
    sql: `
      CREATE TABLE IF NOT EXISTS provider_keys (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 3,
    name: "add_proxy_support_to_provider_keys",
    sql: `
      ALTER TABLE provider_keys ADD COLUMN proxy_base_url TEXT DEFAULT NULL;
    `,
  },
  {
    id: 4,
    name: "default_full_access_mode",
    // Sync: default must match DEFAULTS.permissions.filePermissionsFullAccess in packages/core/src/defaults.ts
    sql: `
      INSERT OR IGNORE INTO settings (key, value) VALUES ('file-permissions-full-access', 'true');
    `,
  },
  {
    id: 5,
    name: "cleanup_wildcard_permissions",
    sql: `
      UPDATE permissions
        SET read_paths = '[]', write_paths = '[]'
        WHERE read_paths LIKE '%"*"%' OR write_paths LIKE '%"*"%';
    `,
  },
  {
    id: 6,
    name: "add_auth_type_to_provider_keys",
    sql: `
      ALTER TABLE provider_keys ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'api_key';
    `,
  },
  {
    id: 7,
    name: "add_budget_columns_to_provider_keys",
    sql: `
      ALTER TABLE provider_keys ADD COLUMN monthly_budget_usd TEXT DEFAULT NULL;
      ALTER TABLE provider_keys ADD COLUMN budget_reset_day INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    id: 8,
    name: "add_usage_snapshots_and_history",
    sql: `
      CREATE TABLE IF NOT EXISTS usage_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost_usd TEXT NOT NULL DEFAULT '0',
        snapshot_time INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS key_model_usage_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost_usd TEXT NOT NULL DEFAULT '0',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_history_key_model_end
        ON key_model_usage_history (key_id, model, end_time DESC);

      CREATE INDEX IF NOT EXISTS idx_snapshots_key_model_time
        ON usage_snapshots (key_id, model, snapshot_time DESC);
    `,
  },
  {
    id: 9,
    name: "add_base_url_to_provider_keys",
    sql: `
      ALTER TABLE provider_keys ADD COLUMN base_url TEXT DEFAULT NULL;
    `,
  },
  {
    id: 10,
    name: "add_custom_provider_columns",
    sql: `
      ALTER TABLE provider_keys ADD COLUMN custom_protocol TEXT DEFAULT NULL;
      ALTER TABLE provider_keys ADD COLUMN custom_models_json TEXT DEFAULT NULL;
    `,
  },
  {
    id: 11,
    name: "collapse_per_provider_defaults_to_global_unique",
    sql: `
      -- is_default was per-provider (each provider could have one default key).
      -- Collapse to globally unique: exactly one key with is_default=1.
      --
      -- Strategy: keep the key that matches settings["llm-provider"].
      -- Fallback: if no match, keep the most recently updated default.

      -- Step 1: clear is_default on all keys EXCEPT the one matching llm-provider
      UPDATE provider_keys SET is_default = 0
      WHERE is_default = 1
        AND id NOT IN (
          SELECT pk.id FROM provider_keys pk
          INNER JOIN settings s ON s.key = 'llm-provider' AND pk.provider = s.value
          WHERE pk.is_default = 1
          ORDER BY pk.updated_at DESC
          LIMIT 1
        );

      -- Step 2: if multiple defaults still remain (no llm-provider match,
      -- or llm-provider matched a provider with >1 default key), keep
      -- only the most recently updated one.
      UPDATE provider_keys SET is_default = 0
      WHERE is_default = 1
        AND id NOT IN (
          SELECT id FROM provider_keys
          WHERE is_default = 1
          ORDER BY updated_at DESC
          LIMIT 1
        );
    `,
  },
  {
    id: 12,
    name: "add_chat_sessions_table",
    sql: `
      CREATE TABLE IF NOT EXISTS chat_sessions (
        key TEXT PRIMARY KEY,
        custom_title TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 13,
    name: "add_channel_recipients_table",
    sql: `
      CREATE TABLE IF NOT EXISTS channel_recipients (
        channel_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (channel_id, recipient_id)
      );
    `,
  },
  {
    id: 14,
    name: "add_mobile_pairings_table",
    sql: `
      CREATE TABLE IF NOT EXISTS mobile_pairings (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        relay_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
    `,
  },
  {
    id: 15,
    name: "add_is_owner_to_channel_recipients",
    sql: `
      ALTER TABLE channel_recipients ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
      UPDATE channel_recipients SET is_owner = 1;
    `,
  },
  {
    id: 16,
    name: "add_multi_phone_columns_to_mobile_pairings",
    sql: `
      ALTER TABLE mobile_pairings ADD COLUMN mobile_device_id TEXT;
      ALTER TABLE mobile_pairings ADD COLUMN name TEXT;
    `,
  },
  {
    id: 17,
    name: "add_pairing_id_to_mobile_pairings",
    sql: `
      ALTER TABLE mobile_pairings ADD COLUMN pairing_id TEXT;
    `,
  },
  {
    id: 18,
    name: "add_status_to_mobile_pairings",
    sql: `
      ALTER TABLE mobile_pairings ADD COLUMN status TEXT DEFAULT 'active';
    `,
  },
  {
    id: 19,
    name: "add_input_modalities_to_provider_keys",
    sql: `
      ALTER TABLE provider_keys ADD COLUMN input_modalities_json TEXT DEFAULT NULL;
    `,
  },
  // Baseline-fold candidates after v1.9.0.
  // These are schema migrations from the v1.7.x line, so they are only
  // removable as part of a deliberate baseline squash into migration 1.
  {
    id: 22,
    name: "add_tool_selections_table",
    sql: `
      CREATE TABLE IF NOT EXISTS tool_selections (
        scope_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (scope_type, scope_key, tool_id)
      );
    `,
  },
  {
    id: 23,
    name: "add_channel_accounts_table",
    sql: `
      CREATE TABLE IF NOT EXISTS channel_accounts (
        channel_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        name TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (channel_id, account_id)
      );
    `,
  },
  {
    id: 24,
    name: "add_source_to_provider_keys",
    sql: `
      ALTER TABLE provider_keys ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
    `,
  },
  {
    id: 25,
    name: "add_cs_escalations_table",
    sql: `
      CREATE TABLE IF NOT EXISTS cs_escalations (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        shop_id TEXT NOT NULL,
        buyer_user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        context TEXT,
        created_at INTEGER NOT NULL,
        decision TEXT,
        instructions TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_cs_escalations_conversation ON cs_escalations(conversation_id);
    `,
  },
  {
    id: 26,
    name: "add_oauth_expires_at_to_provider_keys",
    // Refresh-token expiry (ms since epoch) for OAuth subscription keys where
    // the refresh token is introspectable (e.g. openai-codex JWT). Populated
    // on OAuth save / re-auth. Null for keys where expiry is opaque or not OAuth.
    sql: `
      ALTER TABLE provider_keys ADD COLUMN oauth_expires_at INTEGER DEFAULT NULL;
    `,
  },
  // One-shot compatibility migrations.
  // Safe to delete after the app has shipped past the recorded `remove after`
  // boundary and all supported installs have crossed it.
  {
    id: 27,
    name: "canonicalize_weixin_account_ids",
    // Introduced: v1.7.14
    // Remove after: v1.9.0
    // The upstream weixin plugin uses `xxx-im-bot` / `xxx-im-wechat` internally
    // and in its `channels.status` RPC, but `loginWithQrWait` returns the raw
    // `xxx@im.bot` / `xxx@im.wechat` form. Older installs stored the raw form,
    // which never matches the gateway's status payload and breaks WeChat rows
    // on the Channels page.
    //
    // Step 1: drop `@` rows that collide with an existing dash row (dash form
    //         is plugin-internal and takes precedence).
    // Step 2: rewrite remaining `@` rows to dash form.
    // Both suffixes are handled for completeness. Mirrors
    // `normalizeWeixinAccountId` in @rivonclaw/core.
    sql: `
      DELETE FROM channel_accounts
      WHERE channel_id = 'openclaw-weixin'
        AND account_id LIKE '%@im.bot'
        AND EXISTS (
          SELECT 1 FROM channel_accounts ca2
          WHERE ca2.channel_id = 'openclaw-weixin'
            AND ca2.account_id = REPLACE(channel_accounts.account_id, '@im.bot', '-im-bot')
        );

      DELETE FROM channel_accounts
      WHERE channel_id = 'openclaw-weixin'
        AND account_id LIKE '%@im.wechat'
        AND EXISTS (
          SELECT 1 FROM channel_accounts ca2
          WHERE ca2.channel_id = 'openclaw-weixin'
            AND ca2.account_id = REPLACE(channel_accounts.account_id, '@im.wechat', '-im-wechat')
        );

      UPDATE channel_accounts
        SET account_id = REPLACE(account_id, '@im.bot', '-im-bot'),
            updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
        WHERE channel_id = 'openclaw-weixin'
          AND account_id LIKE '%@im.bot';

      UPDATE channel_accounts
        SET account_id = REPLACE(account_id, '@im.wechat', '-im-wechat'),
            updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
        WHERE channel_id = 'openclaw-weixin'
          AND account_id LIKE '%@im.wechat';
    `,
  },
  {
    id: 28,
    name: "remove_stale_feishu_bot_name",
    // Introduced: v1.7.14
    // Remove after: v1.9.0
    // Older builds persisted `botName` inside per-account Feishu config blobs.
    // The current Feishu runtime schema validates those blobs strictly and
    // rejects that legacy key. Strip it once from SQLite so future config
    // write-backs do not resurrect the invalid field.
    sql: `
      UPDATE channel_accounts
        SET config = json_remove(config, '$.botName'),
            updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
        WHERE channel_id = 'feishu'
          AND json_valid(config)
          AND json_type(config, '$.botName') IS NOT NULL;
    `,
  },
  {
    id: 29,
    name: "add_panel_title_to_chat_sessions",
    sql: `
      ALTER TABLE chat_sessions ADD COLUMN panel_title TEXT;
    `,
  },
];
