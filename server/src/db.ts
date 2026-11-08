import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  assignee TEXT,
  client TEXT,
  start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL CHECK(end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK(status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED')),
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK(is_hidden IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(parent_id IS NULL OR parent_id <> id),
  CHECK(start_date <= end_date)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id, priority, id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tree_version INTEGER NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  actor TEXT NOT NULL,
  origin TEXT,
  summary TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO meta(key, value) VALUES ('tree_version', '0')
  ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN', 'READONLY')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  api_token_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_token
  ON users(api_token_hash) WHERE api_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`;

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file, {
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA);

  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all() as unknown as Array<{
    name: string;
  }>;
  if (!taskColumns.some((column) => column.name === 'is_hidden')) {
    db.exec(
      'ALTER TABLE tasks ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0 CHECK(is_hidden IN (0, 1))',
    );
  }
  if (!taskColumns.some((column) => column.name === 'assignee')) {
    db.exec('ALTER TABLE tasks ADD COLUMN assignee TEXT');
  }
  if (!taskColumns.some((column) => column.name === 'client')) {
    db.exec('ALTER TABLE tasks ADD COLUMN client TEXT');
  }

  migrateStatusConstraint(db);

  return db;
}

function migrateStatusConstraint(db: DatabaseSync): void {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
    .get() as { sql: string } | undefined;

  if (!table?.sql || table.sql.includes("'NOT_STARTED'")) return;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');

    // 另一个进程可能刚完成迁移，拿到写锁后重新确认一次。
    const current = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
      .get() as { sql: string } | undefined;
    if (!current?.sql || current.sql.includes("'NOT_STARTED'")) {
      db.exec('COMMIT');
      return;
    }

    db.exec(`
      CREATE TABLE tasks_new (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
        assignee TEXT,
        client TEXT,
        start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        end_date TEXT NOT NULL CHECK(end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'NOT_STARTED'
          CHECK(status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED')),
        is_hidden INTEGER NOT NULL DEFAULT 0 CHECK(is_hidden IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK(parent_id IS NULL OR parent_id <> id),
        CHECK(start_date <= end_date)
      ) STRICT;
    `);
    db.exec(`
      INSERT INTO tasks_new
        (id, parent_id, name, assignee, client, start_date, end_date, priority, status, is_hidden, created_at, updated_at)
      SELECT
        id, parent_id, name, assignee, client, start_date, end_date, priority,
        'NOT_STARTED',
        is_hidden, created_at, updated_at
      FROM tasks;
    `);
    db.exec('DROP TABLE tasks');
    db.exec('ALTER TABLE tasks_new RENAME TO tasks');
    db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id, priority, id)');

    const version = db
      .prepare("SELECT value FROM meta WHERE key = 'tree_version'")
      .get() as { value: string } | undefined;
    db.prepare(
      `INSERT INTO audit_log
         (tree_version, action, entity_type, entity_id, actor, origin, summary, before_json, after_json)
       VALUES (?, 'migrate', 'system', NULL, 'system', NULL, ?, NULL, NULL)`,
    ).run(
      Number(version?.value ?? 0),
      '数据库迁移：新增「未开始」状态，原有记录统一重置为未开始',
    );

    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 事务可能已被 SQLite 自动回滚
    }
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }

  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length > 0) {
    throw new Error(`数据库迁移后外键校验失败: ${violations.length} 条`);
  }
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 事务可能已被 SQLite 自动回滚
    }
    throw error;
  }
}
