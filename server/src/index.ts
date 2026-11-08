import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AuthService } from './auth.js';
import {
  authenticateRequest,
  createAuthRouter,
  parseCookies,
  requireAuth,
  SESSION_COOKIE,
  type AuthedRequest,
} from './authRoutes.js';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { buildMcpServer } from './mcp.js';
import { ProjectService } from './projectService.js';
import { createApiRouter } from './routes.js';
import { RealtimeHub } from './ws.js';

const db = openDatabase(config.dbPath);
const auth = new AuthService(db);

try {
  const bootstrap = auth.ensureBootstrapAdmin(config.adminUsername, config.adminPassword);
  if (bootstrap.created) {
    console.log(`已按环境变量创建管理员账号: ${bootstrap.username}`);
  } else if (auth.countUsers() === 0) {
    console.warn(
      '尚未创建任何用户。请设置 ADMIN_USERNAME 和 ADMIN_PASSWORD 后重启，或运行 npm run user:create。',
    );
  }
} catch (error) {
  console.error(`初始化管理员失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

let hub: RealtimeHub | undefined;
let lastVersion = 0;

const service = new ProjectService(db, (snapshot, meta) => {
  lastVersion = snapshot.version;
  hub?.broadcast(snapshot, meta);
});
lastVersion = service.getTree().version;

// stdio MCP 运行在另一个进程里，无法直接触发本进程广播；
// 轮询版本号把外部写入同步给 Web 端。
const externalWatcher = setInterval(() => {
  const snapshot = service.getTree();
  if (snapshot.version === lastVersion) return;
  lastVersion = snapshot.version;
  const latest = service.getAudit(1)[0];
  hub?.broadcast(snapshot, {
    reason: latest?.action ?? 'external',
    actor: latest?.actor ?? 'system',
    origin: latest?.origin ?? undefined,
  });
}, 1000);
externalWatcher.unref();

const sessionCleaner = setInterval(() => auth.purgeExpiredSessions(), 3_600_000);
sessionCleaner.unref();

const app = createMcpExpressApp({
  host: config.host,
  allowedHosts: config.allowedHosts,
  allowedOrigins: config.allowedOrigins,
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api', createAuthRouter(auth));
app.use('/api', requireAuth(auth), createApiRouter(service));

app.post(
  '/mcp',
  (req, res, next) => {
    const user = authenticateRequest(auth, req);
    if (!user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: '请先登录或提供 Bearer API Token' },
      });
      return;
    }
    (req as AuthedRequest).authUser = user;
    next();
  },
  async (req, res) => {
    const user = (req as AuthedRequest).authUser;
    const server = buildMcpServer(service, {
      readOnly: user?.role !== 'ADMIN',
      actor: user?.username ?? 'mcp',
    });
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      void Promise.allSettled([transport.close(), server.close()]);
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'MCP_ERROR', message: 'MCP 请求处理失败' } });
      }
    }
  },
);

app.all('/mcp', (_req, res) => {
  res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST' } });
});

if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/mcp')) {
      next();
      return;
    }
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', error);
  if (!res.headersSent) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

const server = http.createServer(app);
hub = new RealtimeHub(server, () => service.getTree(), config.allowedHosts, (req) => {
  const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!sessionId || !auth.authenticateSession(sessionId)) return null;
  return { isStillValid: () => auth.authenticateSession(sessionId) !== null };
});

if (!['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
  console.warn(
    `提示: 当前绑定到 ${config.host}；请通过 HTTPS 或受信任网络访问，以保护登录凭据与会话。`,
  );
}

server.listen(config.port, config.host, () => {
  console.log(`API   http://${config.host}:${config.port}/api`);
  console.log(`MCP   http://${config.host}:${config.port}/mcp`);
  console.log(`WS    ws://${config.host}:${config.port}/ws`);
  console.log(`DB    ${config.dbPath}`);
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(externalWatcher);
  clearInterval(sessionCleaner);
  hub?.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
