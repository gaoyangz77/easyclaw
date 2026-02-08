import type Database from "better-sqlite3";
import type { ProviderKeyEntry } from "@easyclaw/core";

interface ProviderKeyRow {
  id: string;
  provider: string;
  label: string;
  model: string;
  is_default: number;
  proxy_base_url: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntry(row: ProviderKeyRow): ProviderKeyEntry {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    model: row.model,
    isDefault: row.is_default === 1,
    proxyBaseUrl: row.proxy_base_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProviderKeysRepository {
  constructor(private db: Database.Database) {}

  create(entry: ProviderKeyEntry): ProviderKeyEntry {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO provider_keys (id, provider, label, model, is_default, proxy_base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        entry.id,
        entry.provider,
        entry.label,
        entry.model,
        entry.isDefault ? 1 : 0,
        entry.proxyBaseUrl ?? null,
        now,
        now,
      );

    return { ...entry, createdAt: now, updatedAt: now };
  }

  getById(id: string): ProviderKeyEntry | undefined {
    const row = this.db
      .prepare("SELECT * FROM provider_keys WHERE id = ?")
      .get(id) as ProviderKeyRow | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  getByProvider(provider: string): ProviderKeyEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM provider_keys WHERE provider = ? ORDER BY created_at ASC")
      .all(provider) as ProviderKeyRow[];
    return rows.map(rowToEntry);
  }

  getAll(): ProviderKeyEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM provider_keys ORDER BY provider ASC, created_at ASC")
      .all() as ProviderKeyRow[];
    return rows.map(rowToEntry);
  }

  getDefault(provider: string): ProviderKeyEntry | undefined {
    const row = this.db
      .prepare("SELECT * FROM provider_keys WHERE provider = ? AND is_default = 1 LIMIT 1")
      .get(provider) as ProviderKeyRow | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  update(
    id: string,
    fields: Partial<Pick<ProviderKeyEntry, "label" | "model" | "isDefault" | "proxyBaseUrl">>,
  ): ProviderKeyEntry | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const updated: ProviderKeyEntry = {
      ...existing,
      label: fields.label ?? existing.label,
      model: fields.model ?? existing.model,
      isDefault: fields.isDefault !== undefined ? fields.isDefault : existing.isDefault,
      proxyBaseUrl: fields.proxyBaseUrl !== undefined ? fields.proxyBaseUrl : existing.proxyBaseUrl,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        "UPDATE provider_keys SET label = ?, model = ?, is_default = ?, proxy_base_url = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        updated.label,
        updated.model,
        updated.isDefault ? 1 : 0,
        updated.proxyBaseUrl ?? null,
        updated.updatedAt,
        id,
      );

    return updated;
  }

  /**
   * Set a key as the default for its provider.
   * Clears is_default on all other keys for the same provider.
   */
  setDefault(id: string): void {
    const entry = this.getById(id);
    if (!entry) return;

    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE provider_keys SET is_default = 0, updated_at = ? WHERE provider = ?")
      .run(now, entry.provider);
    this.db
      .prepare("UPDATE provider_keys SET is_default = 1, updated_at = ? WHERE id = ?")
      .run(now, id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM provider_keys WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
