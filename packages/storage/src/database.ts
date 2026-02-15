import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { createLogger } from "@easyclaw/logger";
import { migrations } from "./migrations.js";

const logger = createLogger("storage");

const DEFAULT_DB_DIR = join(homedir(), ".easyclaw");
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, "db.sqlite");

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT id FROM _migrations")
      .all()
      .map((row) => (row as { id: number }).id),
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    logger.info(`Applying migration ${migration.id}: ${migration.name}`);

    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.id, migration.name, new Date().toISOString());
    })();
  }
}

export function openDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? process.env.EASYCLAW_DB_PATH ?? DEFAULT_DB_PATH;

  if (resolvedPath !== ":memory:") {
    const dir =
      resolvedPath === DEFAULT_DB_PATH
        ? DEFAULT_DB_DIR
        : dirname(resolvedPath);
    mkdirSync(dir, { recursive: true });
  }

  logger.info(`Opening database at ${resolvedPath}`);

  const db = new Database(resolvedPath);

  // Enable WAL mode for better concurrency
  db.pragma("journal_mode = WAL");
  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  return db;
}

export function closeDatabase(db: Database.Database): void {
  logger.info("Closing database");
  db.close();
}
