#!/usr/bin/env node
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { requirePrivateWindowsPath } from './password-agent-acl.cjs';

const MAX_FRAME = 1024 * 1024;
function argument(name) { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; }
async function readPrivate(file) {
  if (!path.isAbsolute(file || '')) throw new Error('Use an absolute private file path.');
  await requirePrivateWindowsPath(file);
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try { const stat = await handle.stat(); if (!stat.isFile() || process.platform !== 'win32' && (stat.uid !== process.getuid() || stat.mode & 0o077)) throw new Error('The connection or grant file is not private.'); return JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
}
function call(descriptor, request) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(descriptor.socket), chunks = []; let size = 0;
    const timer = setTimeout(() => { client.destroy(); reject(new Error('The native request timed out. Check its outcome before retrying a write.')); }, 120000);
    client.on('error', () => { clearTimeout(timer); reject(new Error('The Thingtime native password bridge is unavailable. Open the app and connect Password AutoFill.')); });
    client.on('connect', () => { const body = Buffer.from(JSON.stringify({ token: descriptor.token, request })), header = Buffer.alloc(4); header.writeUInt32LE(body.length); if (body.length > MAX_FRAME) { client.destroy(); return; } client.write(Buffer.concat([header, body])); });
    client.on('data', chunk => { size += chunk.length; if (size > MAX_FRAME + 4) { client.destroy(); return; } chunks.push(chunk); });
    client.on('end', () => {
      clearTimeout(timer);
      try { const data = Buffer.concat(chunks); if (data.length < 4 || data.readUInt32LE(0) !== data.length - 4) throw new Error(); const value = JSON.parse(data.subarray(4).toString()); if (!value.ok) throw new Error(value.error?.message || 'The native request was refused.'); resolve(value.result); } catch (error) { reject(error instanceof SyntaxError ? new Error('Invalid native response.') : error); }
    });
  });
}
try {
  const method = process.argv[2];
  if (!method || method.startsWith('-')) throw new Error('Usage: password-agent.mjs <manifest|status|authorize|catalog|generate|open-browser|fill|unlock-keyring|release> --profile <absolute Thingtime userData> [--grant-file <absolute private file>]. Non-secret parameters are a JSON object on stdin.');
  const profile = argument('--profile');
  if (!path.isAbsolute(profile || '')) throw new Error('Use --profile with the exact path reported by the installed app --password-agent-info.');
  const descriptor = await readPrivate(path.join(profile, 'native-passwords/runtime.json'));
  if (descriptor.version !== 1 || typeof descriptor.socket !== 'string' || typeof descriptor.token !== 'string') throw new Error('Unsupported native bridge descriptor.');
  if (process.platform === 'win32' && !/^\\\\\.\\pipe\\thingtime-passwords-[a-f0-9]{32}$/.test(descriptor.socket)) throw new Error('The native bridge must use a local Thingtime named pipe.');
  const manifest = await call(descriptor, { method: 'manifest' });
  const version = manifest.features?.['native.passwords']?.version;
  if (manifest.schemaVersion !== 1 || manifest.origin !== descriptor.origin || !/^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version || '') || !manifest.features['native.passwords'].methods.includes(method)) throw new Error('This operation requires a compatible origin-scoped native.passwords 1.0.0 bridge.');
  let input = '';
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) { input += chunk.toString(); if (Buffer.byteLength(input) > MAX_FRAME) throw new Error('The request exceeds the local IPC frame size.'); }
  const params = input.trim() ? JSON.parse(input) : {};
  if (!params || typeof params !== 'object' || Array.isArray(params) || 'password' in params || 'cookie' in params || 'token' in params || 'grant' in params) throw new Error('Only non-secret request parameters are accepted on stdin.');
  const grantFile = argument('--grant-file');
  let grant;
  if (!['manifest', 'status', 'authorize'].includes(method)) { grant = await readPrivate(grantFile); if (grant.origin !== manifest.origin) throw new Error('The grant belongs to a different native app profile.'); }
  if (method === 'authorize') {
    if (!path.isAbsolute(grantFile || '')) throw new Error('Authorization requires --grant-file with a new absolute private path.');
    await requirePrivateWindowsPath(path.dirname(grantFile));
    // Reserve the output before prompting so an existing grant is never replaced.
    const handle = await fs.open(grantFile, 'wx', 0o600);
    try {
      try {
        await requirePrivateWindowsPath(grantFile);
        const result = await call(descriptor, { ...params, method });
        await handle.writeFile(JSON.stringify({ origin: manifest.origin, grant: result.grant, expiresAt: result.expiresAt })); await handle.sync();
        process.stdout.write(JSON.stringify({ authorized: true, expiresAt: result.expiresAt, target: result.target, taskId: result.taskId }) + '\n');
      } finally { await handle.close(); }
    } catch (error) { await fs.rm(grantFile, { force: true }); throw error; }
  } else {
    const result = method === 'manifest' ? manifest : await call(descriptor, { ...params, method, ...(grant ? { grant: grant.grant } : {}) });
    if (method === 'release') await fs.rm(grantFile, { force: true });
    process.stdout.write(JSON.stringify(result) + '\n');
  }
} catch (error) { process.stderr.write(`${error instanceof SyntaxError ? 'Invalid JSON request.' : error.message || 'The native operation failed.'}\n`); process.exitCode = 1; }
