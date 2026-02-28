import type Database from "better-sqlite3";
import type { ProviderKeyEntry, ProviderKeyAuthType } from "@easyclaw/core";

interface ProviderKeyRow {
  id: string;
  provider: string;
  label: string;
  model: string;
  is_default: number;
  proxy_base_url: string | null;
  auth_type: string;
  base_url: string | null;
  custom_protocol: string | null;
  custom_models_json: string | null;
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
    authType: (row.auth_type as ProviderKeyAuthType) ?? "api_key",
    baseUrl: row.base_url,
    customProtocol: row.custom_protocol,
    customModelsJson: row.custom_models_json,
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
        "INSERT INTO provider_keys (id, provider, label, model, is_default, proxy_base_url, auth_type, base_url, custom_protocol, custom_models_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        entry.id,
        entry.provider,
        entry.label,
        entry.model,
        entry.isDefault ? 1 : 0,
        entry.proxyBaseUrl ?? null,
        entry.authType ?? "api_key",
        entry.baseUrl ?? null,
        entry.customProtocol ?? null,
        entry.customModelsJson ?? null,
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
    fields: Partial<Pick<ProviderKeyEntry, "label" | "model" | "isDefault" | "proxyBaseUrl" | "authType" | "baseUrl" | "customProtocol" | "customModelsJson">>,
  ): ProviderKeyEntry | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const updated: ProviderKeyEntry = {
      ...existing,
      label: fields.label ?? existing.label,
      model: fields.model ?? existing.model,
      isDefault: fields.isDefault !== undefined ? fields.isDefault : existing.isDefault,
      proxyBaseUrl: fields.proxyBaseUrl !== undefined ? fields.proxyBaseUrl : existing.proxyBaseUrl,
      authType: fields.authType ?? existing.authType,
      baseUrl: fields.baseUrl !== undefined ? fields.baseUrl : existing.baseUrl,
      customProtocol: fields.customProtocol !== undefined ? fields.customProtocol : existing.customProtocol,
      customModelsJson: fields.customModelsJson !== undefined ? fields.customModelsJson : existing.customModelsJson,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        "UPDATE provider_keys SET label = ?, model = ?, is_default = ?, proxy_base_url = ?, auth_type = ?, base_url = ?, custom_protocol = ?, custom_models_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        updated.label,
        updated.model,
        updated.isDefault ? 1 : 0,
        updated.proxyBaseUrl ?? null,
        updated.authType,
        updated.baseUrl ?? null,
        updated.customProtocol ?? null,
        updated.customModelsJson ?? null,
        updated.updatedAt,
        id,
      );

    return updated;
  }

  /**
   * Return the single globally active key (is_default = 1).
   */
  getActive(): ProviderKeyEntry | undefined {
    const row = this.db
      .prepare("SELECT * FROM provider_keys WHERE is_default = 1 LIMIT 1")
      .get() as ProviderKeyRow | undefined;
    return row ? rowToEntry(row) : undefined;
  }

  /**
   * Set a key as the globally active key.
   * Clears is_default on ALL other keys across all providers.
   */
  setDefault(id: string): void {
    const entry = this.getById(id);
    if (!entry) return;

    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE provider_keys SET is_default = 0, updated_at = ? WHERE is_default = 1")
      .run(now);
    this.db
      .prepare("UPDATE provider_keys SET is_default = 1, updated_at = ? WHERE id = ?")
      .run(now, id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM provider_keys WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
