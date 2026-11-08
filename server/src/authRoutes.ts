import type { IncomingHttpHeaders } from 'node:http';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { AuthService, AuthUser } from './auth.js';
import { config } from './config.js';

export const SESSION_COOKIE = 'pm_session';

export interface AuthedRequest extends Request {
  authUser?: AuthUser;
}

const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 5 * 60_000;

interface AttemptRecord {
  count: number;
  resetAt: number;
}

const loginAttempts = new Map<string, AttemptRecord>();

function attemptKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'local';
}

function isRateLimited(req: Request): boolean {
  const key = attemptKey(req);
  const record = loginAttempts.get(key);
  if (!record) return false;
  if (Date.now() > record.resetAt) {
    loginAttempts.delete(key);
    return false;
  }
  return record.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailure(req: Request): void {
  const key = attemptKey(req);
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record || now > record.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  record.count += 1;
}

function clearFailures(req: Request): void {
  loginAttempts.delete(attemptKey(req));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
  }
  return result;
}

function bearerToken(headers: IncomingHttpHeaders): string | null {
  const header = headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export function authenticateRequest(
  auth: AuthService,
  req: { headers: IncomingHttpHeaders },
): AuthUser | null {
  const token = bearerToken(req.headers);
  if (token) return auth.authenticateToken(token);

  const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (sessionId) return auth.authenticateSession(sessionId);

  return null;
}

function sendUnauthorized(res: Response): void {
  res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } });
}

export function requireAuth(auth: AuthService): RequestHandler {
  return (req, res, next) => {
    const user = authenticateRequest(auth, req);
    if (!user) {
      sendUnauthorized(res);
      return;
    }
    (req as AuthedRequest).authUser = user;
    next();
  };
}

export function requireAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).authUser;
    if (!user) {
      sendUnauthorized(res);
      return;
    }
    if (user.role !== 'ADMIN') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '只读用户无写权限' } });
      return;
    }
    next();
  };
}

export function createAuthRouter(auth: AuthService): Router {
  const router = Router();

  router.post('/auth/login', (req, res) => {
    if (isRateLimited(req)) {
      res.status(429).json({
        error: { code: 'TOO_MANY_ATTEMPTS', message: '登录尝试过多，请 5 分钟后再试' },
      });
      return;
    }

    const body = req.body as { username?: unknown; password?: unknown } | undefined;
    const username = typeof body?.username === 'string' ? body.username : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!username.trim() || !password) {
      res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: '请输入用户名和密码' } });
      return;
    }

    const result = auth.login(username, password, config.sessionHours);
    if (!result) {
      recordFailure(req);
      res
        .status(401)
        .json({ error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } });
      return;
    }

    clearFailures(req);
    res.cookie(SESSION_COOKIE, result.sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      path: '/',
      maxAge: result.maxAgeMs,
    });
    res.json({ user: result.user });
  });

  router.post('/auth/logout', (req, res) => {
    const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (sessionId) auth.logout(sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/auth/me', (req, res) => {
    const user = authenticateRequest(auth, req);
    if (!user) {
      sendUnauthorized(res);
      return;
    }
    res.json({ user });
  });

  return router;
}
