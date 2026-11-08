import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openDatabase } from '../src/db.js';

test('旧数据库自动补齐 is_hidden 列', () => {
  const file = path.join(os.tmpdir(), `gantt-migration-${randomUUID()}.db`);
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE audit_log (
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
    INSERT INTO meta(key, value) VALUES ('tree_version', '0');
    INSERT INTO tasks (id, parent_id, name, start_date, end_date, priority, status)
      VALUES ('legacy', NULL, '旧任务', '2026-01-01', '2026-01-02', 0, 'IN_PROGRESS');
    INSERT INTO tasks (id, parent_id, name, start_date, end_date, priority, status)
      VALUES ('legacy-done', NULL, '旧完成任务', '2026-01-01', '2026-01-02', 1, 'COMPLETED');
  `);
  legacy.close();

  const db = openDatabase(file);
  const columns = db.prepare('PRAGMA table_info(tasks)').all() as unknown as Array<{
    name: string;
  }>;
  assert.ok(columns.some((column) => column.name === 'is_hidden'));
  assert.ok(columns.some((column) => column.name === 'assignee'));
  assert.ok(columns.some((column) => column.name === 'client'));

  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
    .get() as { sql: string };
  assert.match(schema.sql, /NOT_STARTED/);

  const migrated = db
    .prepare('SELECT id, status FROM tasks ORDER BY id')
    .all() as unknown as Array<{ id: string; status: string }>;
  assert.deepEqual(
    migrated.map((row) => row.status),
    ['NOT_STARTED', 'NOT_STARTED'],
  );

  const audit = db
    .prepare('SELECT action FROM audit_log ORDER BY id DESC LIMIT 1')
    .get() as { action: string };
  assert.equal(audit.action, 'migrate');

  db.close();

  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
});
