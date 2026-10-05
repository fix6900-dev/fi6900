import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childLogger } from '../util/logger.js';

const log = childLogger('db');

export type Db = Database.Database;

const SCHEMA_VERSION = 1;

function schemaPath(): string {
  // Works both from src (tsx) and dist (tsc + copy-assets).
  return join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
}

export function openDb(path: string): Db {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const sql = readFileSync(schemaPath(), 'utf8');
  db.exec(sql);
  const row = db.prepare<[], { value: string }>("SELECT value FROM kv WHERE key = 'schema_version'").get();
  const current = row ? Number(row.value) : 0;
  // Future migrations: if (current < 2) { db.exec('ALTER TABLE ...'); }
  if (current !== SCHEMA_VERSION) {
    db.prepare("INSERT INTO kv(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      String(SCHEMA_VERSION),
    );
    log.info({ from: current, to: SCHEMA_VERSION }, 'schema migrated');
  }
}
