import type Database from "better-sqlite3";

export interface ChatSession {
  key: string;
  customTitle: string | null;
  pinned: boolean;
  archivedAt: number | null;
  createdAt: number;
}

interface ChatSessionRow {
  key: string;
  custom_title: string | null;
  pinned: number;
  archived_at: number | null;
  created_at: number;
}

function rowToSession(row: ChatSessionRow): ChatSession {
  return {
    key: row.key,
    customTitle: row.custom_title,
    pinned: row.pinned === 1,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  };
}

export class ChatSessionsRepository {
  constructor(private db: Database.Database) {}

  /** Upsert a chat session record. Only provided fields are updated. */
  upsert(
    key: string,
    fields: Partial<Pick<ChatSession, "customTitle" | "pinned" | "archivedAt">>,
  ): ChatSession {
    const existing = this.db
      .prepare("SELECT * FROM chat_sessions WHERE key = ?")
      .get(key) as ChatSessionRow | undefined;

    if (existing) {
      const sets: string[] = [];
      const values: unknown[] = [];

      if (fields.customTitle !== undefined) {
        sets.push("custom_title = ?");
        values.push(fields.customTitle);
      }
      if (fields.pinned !== undefined) {
        sets.push("pinned = ?");
        values.push(fields.pinned ? 1 : 0);
      }
      if (fields.archivedAt !== undefined) {
        sets.push("archived_at = ?");
        values.push(fields.archivedAt);
      }

      if (sets.length > 0) {
        values.push(key);
        this.db
          .prepare(`UPDATE chat_sessions SET ${sets.join(", ")} WHERE key = ?`)
          .run(...values);
      }

      return this.getByKey(key)!;
    }

    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO chat_sessions (key, custom_title, pinned, archived_at, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        key,
        fields.customTitle ?? null,
        fields.pinned ? 1 : 0,
        fields.archivedAt ?? null,
        now,
      );

    return this.getByKey(key)!;
  }

  getByKey(key: string): ChatSession | undefined {
    const row = this.db
      .prepare("SELECT * FROM chat_sessions WHERE key = ?")
      .get(key) as ChatSessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  /** List all sessions, optionally filtering by archived status. */
  list(opts?: { archived?: boolean }): ChatSession[] {
    let sql = "SELECT * FROM chat_sessions";
    const params: unknown[] = [];

    if (opts?.archived === true) {
      sql += " WHERE archived_at IS NOT NULL";
    } else if (opts?.archived === false) {
      sql += " WHERE archived_at IS NULL";
    }

    sql += " ORDER BY pinned DESC, created_at DESC";

    const rows = this.db.prepare(sql).all(...params) as ChatSessionRow[];
    return rows.map(rowToSession);
  }

  /** Get all archived session keys as a Set for fast lookup. */
  getArchivedKeys(): Set<string> {
    const rows = this.db
      .prepare("SELECT key FROM chat_sessions WHERE archived_at IS NOT NULL")
      .all() as Array<{ key: string }>;
    return new Set(rows.map((r) => r.key));
  }

  delete(key: string): boolean {
    const result = this.db
      .prepare("DELETE FROM chat_sessions WHERE key = ?")
      .run(key);
    return result.changes > 0;
  }
}
