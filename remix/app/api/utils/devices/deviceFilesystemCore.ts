// Shared, closed v1 filesystem transport. Device paths are relative to the
// paired Mac's home directory; these values never become server paths/URLs.
export const FILESYSTEM_CHUNK_BYTES = 65_536;
export const FILESYSTEM_MAX_BYTES = 32 * 1024 * 1024;
export type FilesystemEntry = { path: string; name: string; type: 'file' | 'folder' | 'symlink' | 'other'; inode: string; version: string; size: number; modifiedAt: string };
export type FilesystemInput =
  | { op: 'list'; path: string; cursor?: number; hidden?: boolean }
  | { op: 'read'; path: string; version: string; offset: number }
  | { op: 'write'; path: string; transferId: string; offset: number; total: number; sha256: string; data: string }
  | { op: 'copy' | 'move'; path: string; destination: string; version: string }
  | { op: 'mkdir'; path: string }
  | { op: 'trash'; path: string; version: string };
export type FilesystemResult = { path?: string; entries?: FilesystemEntry[]; nextCursor?: number | null; data?: string; offset?: number; size?: number; version?: string; complete?: boolean };
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const integer = (n: unknown, max = FILESYSTEM_MAX_BYTES): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
const version = (v: unknown): v is string => typeof v === 'string' && /^[0-9:-]{1,160}$/.test(v);
export const filesystemPath = (v: unknown): v is string => typeof v === 'string' && new TextEncoder().encode(v).length <= 1024 &&
  !/[\\\p{Cc}\p{Cf}]/u.test(v) && (v === '' || (v.split('/').length <= 64 && v.split('/').every(p => !!p && p !== '.' && p !== '..' && !p.startsWith('.thingtime-upload-'))));
const base64 = (v: unknown): v is string => typeof v === 'string' && v.length <= 87_384 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v);
export const filesystemBase64Bytes = (v: string) => v.length / 4 * 3 - (v.endsWith('==') ? 2 : v.endsWith('=') ? 1 : 0);
export const normalizeFilesystemInput = (v: unknown): FilesystemInput | null => {
  if (!plain(v) || !filesystemPath(v.path)) return null;
  let valid = false;
  switch (v.op) {
    case 'list': valid = exact(v, ['op', 'path', 'cursor', 'hidden']) && (v.cursor === undefined || integer(v.cursor, 10_000)) && (v.hidden === undefined || typeof v.hidden === 'boolean'); break;
    case 'read': valid = exact(v, ['op', 'path', 'version', 'offset']) && !!v.path && version(v.version) && integer(v.offset); break;
    case 'write': valid = exact(v, ['op', 'path', 'transferId', 'offset', 'total', 'sha256', 'data']) && !!v.path &&
      typeof v.transferId === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v.transferId) &&
      integer(v.offset) && integer(v.total) && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256) &&
      base64(v.data) && filesystemBase64Bytes(v.data) <= FILESYSTEM_CHUNK_BYTES &&
      v.offset + filesystemBase64Bytes(v.data) <= v.total && (v.data !== '' || v.total === 0); break;
    case 'copy': case 'move': valid = exact(v, ['op', 'path', 'destination', 'version']) && !!v.path && version(v.version) && filesystemPath(v.destination) &&
      !!v.destination && v.destination !== v.path && !v.destination.startsWith(v.path + '/'); break;
    case 'mkdir': valid = exact(v, ['op', 'path']) && !!v.path; break;
    case 'trash': valid = exact(v, ['op', 'path', 'version']) && !!v.path && v.path !== '.Trash' && !v.path.startsWith('.Trash/') && version(v.version); break;
  }
  return valid ? v as FilesystemInput : null;
};
export const normalizeFilesystemResult = (input: FilesystemInput, v: unknown): FilesystemResult | null => {
  if (!plain(v) || new TextEncoder().encode(JSON.stringify(v)).length > 92_000) return null;
  if (input.op === 'list') {
    if (!exact(v, ['path', 'entries', 'nextCursor']) || v.path !== input.path || !Array.isArray(v.entries) || v.entries.length > 50 ||
      !(v.nextCursor === null || (integer(v.nextCursor, 10_000) && v.nextCursor > (input.cursor || 0)))) return null;
    const paths = new Set();
    for (const e of v.entries) {
      if (!plain(e) || !exact(e, ['path', 'name', 'type', 'inode', 'version', 'size', 'modifiedAt']) ||
        typeof e.name !== 'string' || !e.name || e.name.includes('/') || !filesystemPath(e.path) || e.path !== (input.path ? input.path + '/' : '') + e.name ||
        !['file', 'folder', 'symlink', 'other'].includes(String(e.type)) || !version(e.inode) || !version(e.version) || !integer(e.size, Number.MAX_SAFE_INTEGER) ||
        typeof e.modifiedAt !== 'string' || !Number.isFinite(Date.parse(e.modifiedAt)) || paths.has(e.path)) return null;
      paths.add(e.path);
    }
  } else if (input.op === 'read') {
    if (!exact(v, ['data', 'offset', 'size', 'version']) || !base64(v.data) || v.offset !== input.offset || v.version !== input.version ||
      !integer(v.size) || filesystemBase64Bytes(v.data) !== Math.min(FILESYSTEM_CHUNK_BYTES, v.size - input.offset)) return null;
  } else if (input.op === 'write') {
    if (!exact(v, ['path', 'offset', 'complete']) || v.path !== input.path || v.offset !== input.offset + filesystemBase64Bytes(input.data) || v.complete !== (v.offset === input.total)) return null;
  } else if (!exact(v, ['path']) || !filesystemPath(v.path) || !v.path ||
    (input.op === 'mkdir' && v.path !== input.path) ||
    ((input.op === 'copy' || input.op === 'move') && v.path !== input.destination) ||
    (input.op === 'trash' && !v.path.startsWith('.Trash/'))) return null;
  return v as FilesystemResult;
};
