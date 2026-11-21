import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS } from '../../src/shared/constants.ts';
import type { AppSettings, UserPreferenceItem, UserTaskItem } from '../../src/shared/types.ts';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export function resolveDatabasePath(): string {
  const configured = process.env.NEXORA_DB_PATH?.trim();
  if (configured === ':memory:') {
    return ':memory:';
  }
  const baseDir = process.cwd();
  const target = configured
    ? path.resolve(baseDir, configured)
    : path.resolve(baseDir, 'data', 'nexora.db');

  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return target;
}

export function getDatabase(overridePath?: string): DatabaseSync {
  const targetPath = overridePath ?? resolveDatabasePath();
  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // Ignore close errors during re-init
    }
  }

  const db = new DatabaseSync(targetPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);

  initializeSchema(db);
  dbInstance = db;
  currentDbPath = targetPath;
  return db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    currentDbPath = null;
  }
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_records (
      id TEXT PRIMARY KEY,
      section TEXT NOT NULL CHECK (section IN ('science', 'programming', 'medicine', 'history_culture', 'logic_creativity')),
      subcategory TEXT NOT NULL,
      title TEXT NOT NULL,
      detailed_content TEXT NOT NULL,
      simple_explanation TEXT NOT NULL,
      context TEXT NOT NULL,
      usage_limits TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      source_urls_json TEXT NOT NULL,
      accessed_at TEXT NOT NULL,
      confidence_level TEXT NOT NULL CHECK (confidence_level IN ('high', 'medium', 'low')),
      review_status TEXT NOT NULL CHECK (review_status IN ('verified', 'needs_review', 'rejected')),
      keywords_json TEXT NOT NULL,
      dedup_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kr_section ON knowledge_records(section);
    CREATE INDEX IF NOT EXISTS idx_kr_status ON knowledge_records(review_status);
    CREATE INDEX IF NOT EXISTS idx_kr_section_status ON knowledge_records(section, review_status);
    CREATE INDEX IF NOT EXISTS idx_kr_subcategory ON knowledge_records(subcategory);

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      id UNINDEXED,
      section UNINDEXED,
      title,
      subcategory,
      detailed_content,
      simple_explanation,
      keywords_json,
      content='knowledge_records',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS kr_ai AFTER INSERT ON knowledge_records BEGIN
      INSERT INTO knowledge_fts(rowid, id, section, title, subcategory, detailed_content, simple_explanation, keywords_json)
      VALUES (new.rowid, new.id, new.section, new.title, new.subcategory, new.detailed_content, new.simple_explanation, new.keywords_json);
    END;

    CREATE TRIGGER IF NOT EXISTS kr_ad AFTER DELETE ON knowledge_records BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, id, section, title, subcategory, detailed_content, simple_explanation, keywords_json)
      VALUES ('delete', old.rowid, old.id, old.section, old.title, old.subcategory, old.detailed_content, old.simple_explanation, old.keywords_json);
    END;

    CREATE TRIGGER IF NOT EXISTS kr_au AFTER UPDATE ON knowledge_records BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, id, section, title, subcategory, detailed_content, simple_explanation, keywords_json)
      VALUES ('delete', old.rowid, old.id, old.section, old.title, old.subcategory, old.detailed_content, old.simple_explanation, old.keywords_json);
      INSERT INTO knowledge_fts(rowid, id, section, title, subcategory, detailed_content, simple_explanation, keywords_json)
      VALUES (new.rowid, new.id, new.section, new.title, new.subcategory, new.detailed_content, new.simple_explanation, new.keywords_json);
    END;

    CREATE TABLE IF NOT EXISTS batch_jobs (
      id TEXT PRIMARY KEY,
      section TEXT NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed')),
      target_batch_size INTEGER NOT NULL,
      processed_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      cursor_category_index INTEGER NOT NULL DEFAULT 0,
      cursor_continue_token TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      claimed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      pref_key TEXT NOT NULL UNIQUE,
      pref_value TEXT NOT NULL,
      consented INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')) DEFAULT 'todo',
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const existing = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('app_settings') as
    | { value_json: string }
    | undefined;
  if (!existing) {
    db.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      'app_settings',
      JSON.stringify(DEFAULT_SETTINGS),
      new Date().toISOString()
    );
  }
}

export function getAppSettings(db: DatabaseSync = getDatabase()): AppSettings {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('app_settings') as
    | { value_json: string }
    | undefined;
  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value_json) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAppSettings(
  partial: Partial<AppSettings>,
  db: DatabaseSync = getDatabase()
): AppSettings {
  const current = getAppSettings(db);
  const next: AppSettings = { ...current, ...partial };
  db.prepare(
    'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at'
  ).run('app_settings', JSON.stringify(next), new Date().toISOString());
  return next;
}

export function listUserPreferences(db: DatabaseSync = getDatabase()): UserPreferenceItem[] {
  const rows = db
    .prepare('SELECT id, pref_key, pref_value, consented, created_at, updated_at FROM user_preferences ORDER BY updated_at DESC')
    .all() as Array<{
    id: string;
    pref_key: string;
    pref_value: string;
    consented: number;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    key: r.pref_key,
    value: r.pref_value,
    consented: Boolean(r.consented),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function upsertUserPreference(
  id: string,
  key: string,
  value: string,
  db: DatabaseSync = getDatabase()
): UserPreferenceItem {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_preferences (id, pref_key, pref_value, consented, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(pref_key) DO UPDATE SET pref_value = excluded.pref_value, updated_at = excluded.updated_at`
  ).run(id, key.trim(), value.trim(), now, now);
  return {
    id,
    key: key.trim(),
    value: value.trim(),
    consented: true,
    created_at: now,
    updated_at: now,
  };
}

export function deleteUserPreference(id: string, db: DatabaseSync = getDatabase()): boolean {
  const res = db.prepare('DELETE FROM user_preferences WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function listUserTasks(db: DatabaseSync = getDatabase()): UserTaskItem[] {
  return db
    .prepare('SELECT id, title, notes, status, priority, created_at FROM user_tasks ORDER BY created_at DESC LIMIT 100')
    .all() as unknown as UserTaskItem[];
}

export function createUserTask(
  task: Omit<UserTaskItem, 'created_at'>,
  db: DatabaseSync = getDatabase()
): UserTaskItem {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO user_tasks (id, title, notes, status, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(task.id, task.title, task.notes, task.status, task.priority, now);
  return { ...task, created_at: now };
}

export function updateUserTaskStatus(
  id: string,
  status: UserTaskItem['status'],
  db: DatabaseSync = getDatabase()
): boolean {
  const res = db.prepare('UPDATE user_tasks SET status = ? WHERE id = ?').run(status, id);
  return Number(res.changes) > 0;
}

export function deleteUserTask(id: string, db: DatabaseSync = getDatabase()): boolean {
  const res = db.prepare('DELETE FROM user_tasks WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function logAuditEvent(
  eventType: string,
  detail: string,
  db: DatabaseSync = getDatabase()
): void {
  const safeDetail = detail.slice(0, 500);
  db.prepare('INSERT INTO audit_logs (event_type, detail, created_at) VALUES (?, ?, ?)').run(
    eventType,
    safeDetail,
    new Date().toISOString()
  );
}

export function createDatabaseBackup(db: DatabaseSync = getDatabase()): {
  filePath: string;
  sizeBytes: number;
  createdAt: string;
} {
  const backupsDir = path.resolve(process.cwd(), 'data', 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `nexora-backup-${timestamp}.json`);
  const records = db.prepare('SELECT * FROM knowledge_records ORDER BY created_at ASC').all();
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    totalRecords: records.length,
    records,
  };
  const serialized = JSON.stringify(payload, null, 2);
  fs.writeFileSync(backupPath, serialized, 'utf8');
  return {
    filePath: backupPath,
    sizeBytes: Buffer.byteLength(serialized, 'utf8'),
    createdAt: payload.exportedAt,
  };
}
