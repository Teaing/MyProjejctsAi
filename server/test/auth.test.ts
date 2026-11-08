import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthService, hashPassword, verifyPassword } from '../src/auth.js';
import { openDatabase } from '../src/db.js';

function createAuth(): AuthService {
  return new AuthService(openDatabase(':memory:'));
}

test('密码使用 scrypt 哈希并可校验', () => {
  const stored = hashPassword('correct-horse-123');
  assert.ok(stored.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct-horse-123', stored), true);
  assert.equal(verifyPassword('wrong-password', stored), false);
  assert.equal(verifyPassword('correct-horse-123', 'broken'), false);
});

test('首次启动按环境变量创建管理员，已有用户后不再创建', () => {
  const auth = createAuth();
  assert.equal(auth.countUsers(), 0);

  const first = auth.ensureBootstrapAdmin('admin', 'admin-pass-123');
  assert.equal(first.created, true);
  assert.equal(auth.countUsers(), 1);

  const second = auth.ensureBootstrapAdmin('other', 'other-pass-123');
  assert.equal(second.created, false);
  assert.equal(auth.countUsers(), 1);
});

test('管理员用户名密码必须同时设置且密码长度受限', () => {
  const auth = createAuth();
  assert.throws(() => auth.ensureBootstrapAdmin('admin', undefined), /必须同时设置/);
  assert.throws(() => auth.ensureBootstrapAdmin(undefined, 'secret'), /必须同时设置/);
  assert.throws(() => auth.ensureBootstrapAdmin('admin', 'short'), /至少需要 8 个字符/);
});

test('登录创建会话，退出后会话失效', () => {
  const auth = createAuth();
  auth.createUser({ username: 'alice', password: 'alice-pass-123', role: 'ADMIN' });

  assert.equal(auth.login('alice', 'wrong-password', 12), null);

  const session = auth.login('alice', 'alice-pass-123', 12);
  assert.ok(session);
  assert.equal(session.user.username, 'alice');
  assert.equal(auth.authenticateSession(session.sessionId)?.role, 'ADMIN');

  auth.logout(session.sessionId);
  assert.equal(auth.authenticateSession(session.sessionId), null);
});

test('API Token 可认证且只读角色保持不变', () => {
  const auth = createAuth();
  auth.createUser({ username: 'viewer', password: 'viewer-pass-123', role: 'READONLY' });
  const token = auth.createApiToken('viewer');

  const user = auth.authenticateToken(token);
  assert.equal(user?.username, 'viewer');
  assert.equal(user?.role, 'READONLY');
  assert.equal(auth.authenticateToken('not-a-token'), null);
});

test('停用用户或重置密码会使已有会话失效', () => {
  const auth = createAuth();
  auth.createUser({ username: 'bob', password: 'bob-pass-123', role: 'ADMIN' });

  const first = auth.login('bob', 'bob-pass-123', 12);
  assert.ok(first);
  auth.setPassword('bob', 'bob-pass-456');
  assert.equal(auth.authenticateSession(first.sessionId), null);

  const second = auth.login('bob', 'bob-pass-456', 12);
  assert.ok(second);
  auth.setActive('bob', false);
  assert.equal(auth.authenticateSession(second.sessionId), null);
  assert.equal(auth.login('bob', 'bob-pass-456', 12), null);
});
