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
];
