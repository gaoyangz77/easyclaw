export interface Migration {
  id: number;
  name: string;
  sql: string;
}

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
];
