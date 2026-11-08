import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';

const args = process.argv.slice(2);
const file = args.find((item) => !item.startsWith('--'));
const confirmed = args.includes('--yes');

if (!file || !confirmed) {
  console.error('用法: npm run restore -- <backup.db> --yes');
  console.error('请先停止服务；脚本会先备份当前数据库，再覆盖恢复。');
  process.exit(1);
}

const sourcePath = path.resolve(file);
if (!fs.existsSync(sourcePath)) {
  console.error(`备份文件不存在: ${sourcePath}`);
  process.exit(1);
}

try {
  const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
    signal: AbortSignal.timeout(500),
  });
  if (response.ok) {
    console.error(`检测到服务仍在 127.0.0.1:${config.port} 运行，请先停止服务再恢复。`);
    process.exit(1);
  }
} catch {
  // 端口不可达，视为服务已停止
}

const checkDb = new DatabaseSync(sourcePath, { readOnly: true });
try {
  const result = checkDb.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
  const integrity = Object.values(result)[0];
  if (integrity !== 'ok') {
    throw new Error(`备份完整性校验失败: ${String(integrity)}`);
  }
  const count = checkDb.prepare('SELECT COUNT(*) AS count FROM tasks').get() as {
    count: number;
  };
  console.log(`备份校验通过: ${count.count} 条记录`);
} finally {
  checkDb.close();
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const previous = `${config.dbPath}.pre-restore-${stamp}`;

if (fs.existsSync(config.dbPath)) {
  // 服务若曾异常退出，WAL 中可能还有已提交但未合并的数据；先 checkpoint 再备份。
  const current = new DatabaseSync(config.dbPath);
  try {
    current.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    current.close();
  }
  fs.copyFileSync(config.dbPath, previous);
  console.log(`当前数据库已备份到: ${previous}`);
}

for (const suffix of ['-wal', '-shm']) {
  fs.rmSync(`${config.dbPath}${suffix}`, { force: true });
}

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.copyFileSync(sourcePath, config.dbPath);
console.log(`已恢复: ${sourcePath} -> ${config.dbPath}`);
