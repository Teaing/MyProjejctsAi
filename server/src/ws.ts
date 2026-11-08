import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { TreeChangeMeta, TreeSnapshot } from './schemas.js';

export interface LiveSession {
  isStillValid: () => boolean;
}

interface LiveSocket extends WebSocket {
  isAlive?: boolean;
  session?: LiveSession;
}

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedHost(value: string | undefined, allowed: string[]): boolean {
  const hostname = hostnameOf(value);
  return hostname !== null && allowed.includes(hostname);
}

function isAllowedOrigin(value: string | undefined, allowed: string[]): boolean {
  // 非浏览器客户端不带 Origin；跨站网页必须声明一个可校验的 Origin。
  if (!value) return true;
  const hostname = hostnameOf(value);
  return hostname !== null && allowed.includes(hostname);
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export class RealtimeHub {
  private readonly wss: WebSocketServer;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly onUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

  constructor(
    private readonly server: Server,
    private readonly getSnapshot: () => TreeSnapshot,
    private readonly allowedHosts: string[],
    private readonly authenticate: (req: IncomingMessage) => LiveSession | null,
  ) {
    this.wss = new WebSocketServer({ noServer: true });

    this.onUpgrade = (req, socket, head) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname !== '/ws') {
        rejectUpgrade(socket, 404, 'Not Found');
        return;
      }

      if (
        !isAllowedHost(req.headers.host, this.allowedHosts) ||
        !isAllowedOrigin(req.headers.origin, this.allowedHosts)
      ) {
        rejectUpgrade(socket, 403, 'Forbidden');
        return;
      }

      const session = this.authenticate(req);
      if (!session) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        (ws as LiveSocket).session = session;
        this.wss.emit('connection', ws, req);
      });
    };

    server.on('upgrade', this.onUpgrade);

    this.wss.on('connection', (socket) => {
      const ws = socket as LiveSocket;
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      ws.send(JSON.stringify({ type: 'snapshot', ...this.getSnapshot() }));
    });

    this.heartbeat = setInterval(() => {
      for (const client of this.wss.clients) {
        const ws = client as LiveSocket;
        if (ws.isAlive === false || (ws.session && !ws.session.isStillValid())) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, 30_000);
    this.heartbeat.unref();

    this.wss.on('close', () => clearInterval(this.heartbeat));
  }

  broadcast(snapshot: TreeSnapshot, meta: TreeChangeMeta): void {
    const payload = JSON.stringify({ type: 'tree.updated', ...meta, ...snapshot });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  close(): void {
    this.server.off('upgrade', this.onUpgrade);
    clearInterval(this.heartbeat);
    for (const client of this.wss.clients) {
      client.terminate();
    }
    this.wss.close();
  }
}
