import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';

const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(path.dirname(config.dbPath), 'backups');

fs.mkdirSync(targetDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(targetDir, `app-${stamp}.db`);

const source = new DatabaseSync(config.dbPath, { readOnly: true });

try {
  const pages = await backup(source, target);

  const checkDb = new DatabaseSync(target, { readOnly: true });
  const result = checkDb.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
  checkDb.close();

  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(`${target}${suffix}`, { force: true });
  }

  const integrity = Object.values(result)[0];
  if (integrity !== 'ok') {
    throw new Error(`备份完整性校验失败: ${String(integrity)}`);
  }

  console.log(`备份完成: ${target}`);
  console.log(`页数: ${pages}，完整性: ok`);
} finally {
  source.close();
}
