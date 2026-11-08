import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readPort(): number {
  const raw = Number(process.env.PORT ?? 3000);
  return Number.isInteger(raw) && raw > 0 ? raw : 3000;
}

function findPackageRoot(start: string): string {
  let dir = start;
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function parseHostList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeAllowedHost(host: string): string {
  return host === '::1' ? '[::1]' : host.toLowerCase();
}

function readSessionHours(): number {
  const raw = Number(process.env.SESSION_HOURS ?? 12);
  return Number.isFinite(raw) && raw >= 1 && raw <= 720 ? Math.trunc(raw) : 12;
}

const host = process.env.HOST ?? '127.0.0.1';
const extraHosts = parseHostList(process.env.ALLOWED_HOSTS);
const concreteHost = host !== '0.0.0.0' && host !== '::';
const allowedHosts = [
  ...new Set([
    ...LOOPBACK_HOSTS,
    ...extraHosts,
    ...(concreteHost ? [normalizeAllowedHost(host)] : []),
  ]),
];

export const config = {
  host,
  port: readPort(),
  dbPath: process.env.DB_PATH ?? path.join(packageRoot, 'data', 'app.db'),
  webDist: path.resolve(packageRoot, '..', 'web', 'dist'),
  allowedHosts,
  allowedOrigins: allowedHosts,
  sessionHours: readSessionHours(),
  cookieSecure: ['1', 'true', 'yes'].includes((process.env.COOKIE_SECURE ?? '').toLowerCase()),
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
};
