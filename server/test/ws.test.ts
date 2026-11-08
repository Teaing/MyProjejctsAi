import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { RealtimeHub } from '../src/ws.js';

const ALLOWED = ['localhost', '127.0.0.1', '[::1]'];

async function withHub(run: (port: number) => Promise<void>): Promise<void> {
  const server = createServer((_req, res) => {
    res.end('ok');
  });
  const hub = new RealtimeHub(
    server,
    () => ({ version: 3, systems: [] }),
    ALLOWED,
    () => ({ isStillValid: () => true }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await run(port);
  } finally {
    hub.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function connect(port: number, origin?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws`,
      origin ? { headers: { origin } } : undefined,
    );
    ws.once('open', () => resolve(ws));
    ws.once('error', (error) => {
      ws.terminate();
      reject(error);
    });
  });
}

function connectForSnapshot(
  port: number,
  origin?: string,
): Promise<{ ws: WebSocket; message: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws`,
      origin ? { headers: { origin } } : undefined,
    );
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('等待快照超时'));
    }, 3000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve({ ws, message: String(data) });
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      ws.terminate();
      reject(error);
    });
  });
}

test('WebSocket 允许本机 Origin 并推送快照', async () => {
  await withHub(async (port) => {
    const { ws, message } = await connectForSnapshot(port, 'http://localhost:5173');
    const payload = JSON.parse(message) as { type: string; version: number };
    assert.equal(payload.type, 'snapshot');
    assert.equal(payload.version, 3);
    ws.terminate();
  });
});

test('WebSocket 允许无 Origin 的非浏览器客户端', async () => {
  await withHub(async (port) => {
    const { ws, message } = await connectForSnapshot(port);
    assert.equal((JSON.parse(message) as { type: string }).type, 'snapshot');
    ws.terminate();
  });
});

test('WebSocket 拒绝非本机 Origin', async () => {
  await withHub(async (port) => {
    await assert.rejects(connect(port, 'http://evil.example'), /403|Unexpected server response/);
  });
});

test('WebSocket 拒绝非 /ws 路径', async () => {
  await withHub(async (port) => {
    await assert.rejects(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/other`);
        ws.once('open', () => resolve(undefined));
        ws.once('error', (error) => {
          ws.terminate();
          reject(error);
        });
      }),
      /404|Unexpected server response/,
    );
  });
});
