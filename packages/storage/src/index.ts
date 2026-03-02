import type Database from "better-sqlite3";
import { openDatabase, closeDatabase } from "./database.js";
import { RulesRepository } from "./repo-rules.js";
import { ArtifactsRepository } from "./repo-artifacts.js";
import { ChannelsRepository } from "./repo-channels.js";
import { PermissionsRepository } from "./repo-permissions.js";
import { SettingsRepository } from "./repo-settings.js";
import { ProviderKeysRepository } from "./repo-provider-keys.js";
import { UsageSnapshotsRepository } from "./repo-usage-snapshots.js";
import { KeyUsageHistoryRepository } from "./repo-key-usage-history.js";
import { ChatSessionsRepository } from "./repo-chat-sessions.js";
import { ChannelRecipientsRepository } from "./repo-channel-recipients.js";

export interface Storage {
  db: Database.Database;
  rules: RulesRepository;
  artifacts: ArtifactsRepository;
  channels: ChannelsRepository;
  permissions: PermissionsRepository;
  settings: SettingsRepository;
  providerKeys: ProviderKeysRepository;
  usageSnapshots: UsageSnapshotsRepository;
  keyUsageHistory: KeyUsageHistoryRepository;
  chatSessions: ChatSessionsRepository;
  channelRecipients: ChannelRecipientsRepository;
  close(): void;
}

export function createStorage(dbPath?: string): Storage {
  const db = openDatabase(dbPath);

  return {
    db,
    rules: new RulesRepository(db),
    artifacts: new ArtifactsRepository(db),
    channels: new ChannelsRepository(db),
    permissions: new PermissionsRepository(db),
    settings: new SettingsRepository(db),
    providerKeys: new ProviderKeysRepository(db),
    usageSnapshots: new UsageSnapshotsRepository(db),
    keyUsageHistory: new KeyUsageHistoryRepository(db),
    chatSessions: new ChatSessionsRepository(db),
    channelRecipients: new ChannelRecipientsRepository(db),
    close() {
      closeDatabase(db);
    },
  };
}

export { openDatabase, closeDatabase } from "./database.js";
export { RulesRepository } from "./repo-rules.js";
export { ArtifactsRepository } from "./repo-artifacts.js";
export { ChannelsRepository } from "./repo-channels.js";
export { PermissionsRepository } from "./repo-permissions.js";
export { SettingsRepository } from "./repo-settings.js";
export { ProviderKeysRepository } from "./repo-provider-keys.js";
export { UsageSnapshotsRepository } from "./repo-usage-snapshots.js";
export { KeyUsageHistoryRepository } from "./repo-key-usage-history.js";
export { ChatSessionsRepository } from "./repo-chat-sessions.js";
export { ChannelRecipientsRepository } from "./repo-channel-recipients.js";
export type { ChatSession } from "./repo-chat-sessions.js";
export type { ChannelRecipient } from "./repo-channel-recipients.js";
export type { Migration } from "./migrations.js";
