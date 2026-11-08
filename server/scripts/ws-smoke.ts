import assert from 'node:assert/strict';
import { WebSocket, type RawData } from 'ws';

const base = process.env.API_URL ?? 'http://127.0.0.1:3000';
const wsUrl = `${base.replace(/^http/, 'ws')}/ws`;

async function authCookie(): Promise<string> {
  if (process.env.SMOKE_COOKIE) return process.env.SMOKE_COOKIE;

  const username = process.env.SMOKE_USERNAME ?? process.env.MCP_USERNAME;
  const password = process.env.SMOKE_PASSWORD ?? process.env.MCP_PASSWORD;
  if (!username || !password) {
    throw new Error('请设置 SMOKE_COOKIE，或设置 SMOKE_USERNAME / SMOKE_PASSWORD 用于登录');
  }

  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`登录失败（${response.status}）`);

  const cookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  if (!cookie) throw new Error('登录成功但没有返回会话 Cookie');
  return cookie.split(';')[0]!;
}

const cookie = await authCookie();
const outboundHeaders = {
  'content-type': 'application/json',
  'x-client-id': 'ws-smoke',
  cookie,
};

interface LiveMessage {
  type: string;
  version: number;
  systems: unknown[];
  actor?: string;
  reason?: string;
  origin?: string;
}

const socket = new WebSocket(wsUrl, { headers: { cookie } });
const inbox: LiveMessage[] = [];
const waiters: Array<{
  predicate: (message: LiveMessage) => boolean;
  resolve: (message: LiveMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}> = [];

socket.on('message', (raw: RawData) => {
  const message = JSON.parse(raw.toString()) as LiveMessage;
  const index = waiters.findIndex((waiter) => waiter.predicate(message));
  if (index >= 0) {
    const [waiter] = waiters.splice(index, 1);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
    return;
  }
  inbox.push(message);
});

function waitFor(
  predicate: (message: LiveMessage) => boolean,
  timeoutMs = 5000,
): Promise<LiveMessage> {
  const existingIndex = inbox.findIndex(predicate);
  if (existingIndex >= 0) {
    const [message] = inbox.splice(existingIndex, 1);
    return Promise.resolve(message!);
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('等待 WebSocket 消息超时'));
      }, timeoutMs),
    };
    waiters.push(waiter);
  });
}

try {
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  console.log(`connected: ${wsUrl}`);

  const snapshot = await waitFor((message) => message.type === 'snapshot');
  console.log(`snapshot: v${snapshot.version}, ${snapshot.systems.length} systems`);

  const createdResponse = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: outboundHeaders,
    body: JSON.stringify({
      name: `WS 冒烟 ${Date.now().toString().slice(-5)}`,
      start_date: '2026-12-10',
      end_date: '2026-12-12',
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as { task: { id: string }; version: number };

  const updated = await waitFor(
    (message) => message.type === 'tree.updated' && message.version === created.version,
  );
  console.log(
    `tree.updated: v${updated.version}, reason=${updated.reason}, actor=${updated.actor}, origin=${updated.origin}`,
  );
  assert.equal(updated.origin, 'ws-smoke');
  assert.ok(updated.version > snapshot.version);

  const deleteResponse = await fetch(
    `${base}/api/tasks/${created.task.id}?cascade=true`,
    { method: 'DELETE', headers: outboundHeaders },
  );
  assert.equal(deleteResponse.status, 200);
  const deleted = (await deleteResponse.json()) as { version: number };

  const deletedUpdate = await waitFor(
    (message) => message.type === 'tree.updated' && message.version === deleted.version,
  );
  console.log(`tree.updated after delete: v${deletedUpdate.version}, reason=${deletedUpdate.reason}`);

  console.log('WebSocket smoke test passed');
} finally {
  socket.close();
}
