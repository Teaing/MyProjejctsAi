import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type Role = 'ADMIN' | 'READONLY';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

export interface UserSummary extends AuthUser {
  is_active: boolean;
  has_api_token: boolean;
  created_at: string;
}

interface UserDbRow {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  is_active: number;
  api_token_hash: string | null;
  created_at: string;
  updated_at: string;
}


const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const MAX_USERNAME_LENGTH = 50;

const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-for-timing');

function scryptKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
}

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = scryptKey(password, salt);
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const salt = Buffer.from(saltB64!, 'base64');
    const expected = Buffer.from(hashB64!, 'base64');
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createSecret(): string {
  return randomBytes(32).toString('base64url');
}

function toAuthUser(row: UserDbRow): AuthUser {
  return { id: row.id, username: row.username, role: row.role };
}

function validateUsername(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_USERNAME_LENGTH) {
    throw new Error(`用户名长度必须在 1-${MAX_USERNAME_LENGTH} 个字符之间`);
  }
  if (/\s/.test(trimmed)) {
    throw new Error('用户名不能包含空白字符');
  }
  return trimmed;
}

function validatePassword(password: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符`);
  }
  return password;
}

export class AuthService {
  constructor(private readonly db: DatabaseSync) {}

  countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM users').get() as {
      count: number;
    };
    return row.count;
  }

  ensureBootstrapAdmin(
    username: string | undefined,
    password: string | undefined,
  ): { created: boolean; username?: string } {
    if (this.countUsers() > 0) return { created: false };

    if (!username && !password) return { created: false };
    if (!username || !password) {
      throw new Error('ADMIN_USERNAME 和 ADMIN_PASSWORD 必须同时设置');
    }

    const validUsername = validateUsername(username);
    validatePassword(password);
    this.createUser({ username: validUsername, password, role: 'ADMIN' });
    return { created: true, username: validUsername };
  }

  createUser(input: { username: string; password: string; role: Role }): AuthUser {
    const username = validateUsername(input.username);
    validatePassword(input.password);
    if (input.role !== 'ADMIN' && input.role !== 'READONLY') {
      throw new Error('角色必须是 ADMIN 或 READONLY');
    }

    const existing = this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username) as { id: string } | undefined;
    if (existing) throw new Error(`用户「${username}」已存在`);

    const id = `usr_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, role)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, username, hashPassword(input.password), input.role);

    return { id, username, role: input.role };
  }

  listUsers(): UserSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY created_at ASC, username ASC')
      .all() as unknown as UserDbRow[];
    return rows.map((row) => ({
      ...toAuthUser(row),
      is_active: row.is_active === 1,
      has_api_token: row.api_token_hash !== null,
      created_at: row.created_at,
    }));
  }

  getUser(username: string): AuthUser | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username.trim()) as UserDbRow | undefined;
    return row ? toAuthUser(row) : undefined;
  }

  login(
    username: string,
    password: string,
    ttlHours: number,
  ): { user: AuthUser; sessionId: string; maxAgeMs: number } | null {
    this.purgeExpiredSessions();

    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username.trim()) as UserDbRow | undefined;

    // 用户不存在时也执行一次哈希，避免通过响应时间枚举用户名。
    const ok = verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!row || row.is_active !== 1 || !ok) return null;

    const sessionId = createSecret();
    const hours = Math.max(1, Math.trunc(ttlHours));
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, expires_at)
         VALUES (?, ?, datetime('now', ?))`,
      )
      .run(hashSecret(sessionId), row.id, `+${hours} hours`);

    return { user: toAuthUser(row), sessionId, maxAgeMs: hours * 3_600_000 };
  }

  logout(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(hashSecret(sessionId));
  }

  authenticateSession(sessionId: string): AuthUser | null {
    const row = this.db
      .prepare(
        `SELECT u.*
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1`,
      )
      .get(hashSecret(sessionId)) as UserDbRow | undefined;
    return row ? toAuthUser(row) : null;
  }

  authenticateToken(token: string): AuthUser | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE api_token_hash = ? AND is_active = 1')
      .get(hashSecret(token)) as UserDbRow | undefined;
    return row ? toAuthUser(row) : null;
  }

  createApiToken(username: string): string {
    const row = this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username.trim()) as { id: string } | undefined;
    if (!row) throw new Error(`用户「${username}」不存在`);

    const token = createSecret();
    this.db
      .prepare("UPDATE users SET api_token_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hashSecret(token), row.id);
    return token;
  }

  setPassword(username: string, password: string): void {
    validatePassword(password);
    const row = this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username.trim()) as { id: string } | undefined;
    if (!row) throw new Error(`用户「${username}」不存在`);

    this.db
      .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hashPassword(password), row.id);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
  }

  setActive(username: string, active: boolean): void {
    const row = this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username.trim()) as { id: string } | undefined;
    if (!row) throw new Error(`用户「${username}」不存在`);

    this.db
      .prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
      .run(active ? 1 : 0, row.id);
    if (!active) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
  }

  purgeExpiredSessions(): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  }
}
