import type Database from "better-sqlite3";
import type { ToolScopeType, ToolSelection } from "@rivonclaw/core";

interface ToolSelectionRow {
  scope_type: string;
  scope_key: string;
  tool_id: string;
  enabled: number;
  updated_at: number;
}

function rowToToolSelection(row: ToolSelectionRow): ToolSelection {
  return {
    toolId: row.tool_id,
    enabled: row.enabled === 1,
  };
}

export class ToolSelectionsRepository {
  constructor(private db: Database.Database) {}

  getForScope(scopeType: ToolScopeType, scopeKey: string): ToolSelection[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM tool_selections WHERE scope_type = ? AND scope_key = ?",
      )
      .all(scopeType, scopeKey) as ToolSelectionRow[];

    return rows.map(rowToToolSelection);
  }

  setForScope(
    scopeType: ToolScopeType,
    scopeKey: string,
    selections: ToolSelection[],
  ): void {
    const now = Date.now();

    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM tool_selections WHERE scope_type = ? AND scope_key = ?",
        )
        .run(scopeType, scopeKey);

      const insert = this.db.prepare(
        `INSERT INTO tool_selections (scope_type, scope_key, tool_id, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const sel of selections) {
        insert.run(scopeType, scopeKey, sel.toolId, sel.enabled ? 1 : 0, now);
      }
    });

    txn();
  }

  deleteForScope(scopeType: ToolScopeType, scopeKey: string): void {
    this.db
      .prepare(
        "DELETE FROM tool_selections WHERE scope_type = ? AND scope_key = ?",
      )
      .run(scopeType, scopeKey);
  }

  /** List all distinct (scopeType, scopeKey) pairs that have selections. */
  listScopes(): Array<{ scopeType: ToolScopeType; scopeKey: string }> {
    const rows = this.db.prepare(
      "SELECT DISTINCT scope_type, scope_key FROM tool_selections",
    ).all() as Array<{ scope_type: string; scope_key: string }>;
    return rows.map(r => ({ scopeType: r.scope_type as ToolScopeType, scopeKey: r.scope_key }));
  }

  /**
   * @deprecated Ambiguous scope-agnostic lookup. Use getForScope() with explicit scopeType instead.
   * Retained only for backward compatibility with panel UI. Do not use for plugin runtime enforcement.
   *
   * Look up selections by scope key across ALL scope types.
   * Returns the scope type and selections if found, or null if no
   * selections exist for this key under any scope type.
   */
  getByKey(scopeKey: string): { scopeType: string; selections: ToolSelection[] } | null {
    const rows = this.db
      .prepare(
        "SELECT * FROM tool_selections WHERE scope_key = ? ORDER BY scope_type",
      )
      .all(scopeKey) as ToolSelectionRow[];

    if (rows.length === 0) return null;

    // All rows for a given key should share the same scope type in practice.
    // Use the first row's scope_type as the resolved type.
    const scopeType = rows[0].scope_type;
    const selections = rows
      .filter((r) => r.scope_type === scopeType)
      .map(rowToToolSelection);

    return { scopeType, selections };
  }
}
