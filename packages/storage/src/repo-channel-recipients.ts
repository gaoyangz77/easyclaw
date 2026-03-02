import type Database from "better-sqlite3";

export interface ChannelRecipient {
  channelId: string;
  recipientId: string;
  label: string;
  createdAt: number;
  updatedAt: number;
}

interface ChannelRecipientRow {
  channel_id: string;
  recipient_id: string;
  label: string;
  created_at: number;
  updated_at: number;
}

function rowToRecipient(row: ChannelRecipientRow): ChannelRecipient {
  return {
    channelId: row.channel_id,
    recipientId: row.recipient_id,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ChannelRecipientsRepository {
  constructor(private db: Database.Database) {}

  /** Get all recipients for a channel, returned as a map of recipientId → label. */
  getLabels(channelId: string): Record<string, string> {
    const rows = this.db
      .prepare("SELECT recipient_id, label FROM channel_recipients WHERE channel_id = ? AND label != ''")
      .all(channelId) as Array<{ recipient_id: string; label: string }>;
    const labels: Record<string, string> = {};
    for (const row of rows) {
      labels[row.recipient_id] = row.label;
    }
    return labels;
  }

  /** Set or update the label for a recipient. */
  setLabel(channelId: string, recipientId: string, label: string): ChannelRecipient {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO channel_recipients (channel_id, recipient_id, label, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (channel_id, recipient_id)
         DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`,
      )
      .run(channelId, recipientId, label, now, now);
    return { channelId, recipientId, label, createdAt: now, updatedAt: now };
  }

  /** Delete a recipient label. */
  delete(channelId: string, recipientId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM channel_recipients WHERE channel_id = ? AND recipient_id = ?")
      .run(channelId, recipientId);
    return result.changes > 0;
  }

  /** List all recipients for a channel. */
  list(channelId: string): ChannelRecipient[] {
    const rows = this.db
      .prepare("SELECT * FROM channel_recipients WHERE channel_id = ? ORDER BY updated_at DESC")
      .all(channelId) as ChannelRecipientRow[];
    return rows.map(rowToRecipient);
  }
}
