import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { WebSocket } from 'ws';
import { AuthService } from '../src/auth.js';
import { openDatabase } from '../src/db.js';

const port = 3200 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const dbPath = `/tmp/gantt-auth-smoke-${Date.now()}.db`;
const adminUsername = 'smoke-admin';
const adminPassword = 'smoke-admin-pass-123';

const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    DB_PATH: dbPath,
    ADMIN_USERNAME: adminUsername,
    ADMIN_PASSWORD: adminPassword,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', (chunk) => {
  serverLog += String(chunk);
});
child.stderr.on('data', (chunk) => {
  serverLog += String(chunk);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // 服务尚未启动
    }
    await sleep(100);
  }
  throw new Error(`服务启动超时\n${serverLog}`);
}

async function login(username: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `登录失败: ${await response.text()}`);
  const cookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  assert.ok(cookie, '登录未返回 Cookie');
  return cookie.split(';')[0]!;
}

async function api(path: string, cookie?: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function openWs(cookie?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`, {
      headers: cookie ? { cookie } : undefined,
    });
    socket.once('open', () => resolve(socket));
    socket.once('error', (error) => {
      socket.terminate();
      reject(error);
    });
  });
}

function waitSnapshot(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 WS 快照超时')), 5000);
    socket.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)));
    });
  });
}

try {
  await waitForHealth();
  console.log('server ready');

  assert.equal((await api('/api/tree')).status, 401, '未登录访问应返回 401');
  const badLogin = await api('/api/auth/login', undefined, {
    method: 'POST',
    body: JSON.stringify({ username: adminUsername, password: 'wrong-password' }),
  });
  assert.equal(badLogin.status, 401);
  console.log('unauthenticated REST blocked');

  const adminCookie = await login(adminUsername, adminPassword);
  assert.equal((await api('/api/tree', adminCookie)).status, 200);

  const created = await api('/api/tasks', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      name: '鉴权冒烟任务',
      start_date: '2026-12-01',
      end_date: '2026-12-03',
    }),
  });
  const createdBody = await created.text();
  assert.equal(created.status, 201, createdBody);
  const createdTask = JSON.parse(createdBody) as { task: { id: string } };
  console.log('admin write allowed');

  const authDb = openDatabase(dbPath);
  const auth = new AuthService(authDb);
  auth.createUser({ username: 'smoke-viewer', password: 'viewer-pass-123', role: 'READONLY' });
  const viewerToken = auth.createApiToken('smoke-viewer');
  const adminToken = auth.createApiToken(adminUsername);
  authDb.close();

  const viewerCookie = await login('smoke-viewer', 'viewer-pass-123');
  assert.equal((await api('/api/tree', viewerCookie)).status, 200);

  for (const [path, init] of [
    ['/api/tasks', { method: 'POST', body: JSON.stringify({ name: 'x', start_date: '2026-12-01', end_date: '2026-12-02' }) }],
    [`/api/tasks/${createdTask.task.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'y' }) }],
    [`/api/tasks/${createdTask.task.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }],
    [`/api/tasks/${createdTask.task.id}`, { method: 'DELETE' }],
    ['/api/tasks/reorder', { method: 'POST', body: JSON.stringify({ parent_id: null, ordered_ids: [] }) }],
  ] as const) {
    const response = await api(path, viewerCookie, init);
    assert.equal(response.status, 403, `只读用户 ${init.method} ${path} 应为 403`);
  }

  const viewerBearer = await api('/api/tasks', undefined, {
    method: 'POST',
    headers: { Authorization: `Bearer ${viewerToken}` },
    body: JSON.stringify({ name: 'x', start_date: '2026-12-01', end_date: '2026-12-02' }),
  });
  assert.equal(viewerBearer.status, 403, '只读 Token 的 REST 写操作应为 403');
  console.log('readonly REST writes blocked (cookie + bearer)');

  await assert.rejects(openWs(), /401|Unexpected server response/);
  const viewerWs = await openWs(viewerCookie);
  const snapshot = (await waitSnapshot(viewerWs)) as { type: string; version: number };
  assert.equal(snapshot.type, 'snapshot');
  viewerWs.on('error', () => {});
  viewerWs.send(
    JSON.stringify({ type: 'tree.updated', version: 999_999, systems: [] }),
  );
  await sleep(400);
  const afterInjection = (await (
    await api('/api/tree', adminCookie)
  ).json()) as { version: number };
  assert.equal(afterInjection.version, snapshot.version, '客户端不能通过 WS 注入变更');
  viewerWs.terminate();
  console.log('websocket auth and no-publish enforced');

  const viewerClient = new Client({ name: 'auth-smoke-viewer', version: '0.1.0' });
  const viewerTransport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${viewerToken}` } },
  });
  await viewerClient.connect(viewerTransport);
  const viewerTools = await viewerClient.listTools();
  assert.equal(viewerTools.tools.length, 0, '只读 Token 不应看到写工具');
  const viewerResource = await viewerClient.readResource({ uri: 'project://gantt/tree' });
  assert.equal(viewerResource.contents.length, 1);

  let denied: { isError?: boolean } | null = null;
  try {
    denied = await viewerClient.callTool({
      name: 'create_task',
      arguments: { name: '越权', start_date: '2026-12-01', end_date: '2026-12-02' },
    });
  } catch {
    denied = { isError: true };
  }
  assert.equal(denied.isError, true, '只读 Token 直接调用写工具必须失败');
  await viewerClient.close();

  const viewerCookieClient = new Client({ name: 'auth-smoke-cookie', version: '0.1.0' });
  const viewerCookieTransport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Cookie: viewerCookie } },
  });
  await viewerCookieClient.connect(viewerCookieTransport);
  const cookieTools = await viewerCookieClient.listTools();
  assert.equal(cookieTools.tools.length, 0, '只读会话 Cookie 不应看到写工具');
  await viewerCookieClient.close();

  const adminClient = new Client({ name: 'auth-smoke-admin', version: '0.1.0' });
  const adminTransport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${adminToken}` } },
  });
  await adminClient.connect(adminTransport);
  const adminTools = await adminClient.listTools();
  assert.ok(adminTools.tools.some((tool) => tool.name === 'create_task'));
  await adminClient.close();
  console.log('MCP token roles enforced');

  await api(`/api/tasks/${createdTask.task.id}`, adminCookie, { method: 'DELETE' });
  await api('/api/auth/logout', adminCookie, { method: 'POST' });
  assert.equal((await api('/api/tree', adminCookie)).status, 401);
  console.log('logout invalidates session');

  console.log('auth smoke test passed');
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(5000),
  ]);
  child.kill('SIGKILL');
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}
