import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

const SECRET_KEY = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|session)/i;

export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SECRET_KEY.test(key) ? '[redacted]' : redactSecrets(entry, seen)
    ])
  );
}

export function configuredRoots(envValue = process.env.THINGTIME_MCP_ALLOWED_ROOTS || ''): string[] {
  return envValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry.replace(/^~(?=\/|$)/, homedir())));
}

export async function requireAllowedFile(inputPath: string, roots = configuredRoots()): Promise<string> {
  if (!isAbsolute(inputPath)) throw new Error('Import path must be absolute');
  if (!roots.length) throw new Error('No import roots configured. Set THINGTIME_MCP_ALLOWED_ROOTS first.');
  const actual = await realpath(inputPath);
  const info = await stat(actual);
  if (!info.isFile()) throw new Error('Import path must point to a file');
  const allowed = await Promise.all(roots.map(async (root) => realpath(root).catch(() => resolve(root))));
  if (!allowed.some((root) => {
    const child = relative(root, actual);
    return child === '' || (!child.startsWith('..') && !isAbsolute(child));
  })) {
    throw new Error('Import path is outside THINGTIME_MCP_ALLOWED_ROOTS');
  }
  return actual;
}
