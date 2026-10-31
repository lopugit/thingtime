import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from '../../remix/scripts/account-backup-isolation.mjs';

const root = resolve(import.meta.dirname, '..'), port = 28431;
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || '/tmp', TT_FOLDER_ORIGIN_PORT: String(port) };
await verifyAccountBackupIsolation(port, env);
const require = createRequire(resolve(root, 'package.json'));
const child = isolatedAccountBackupProcess(require('electron'), [resolve(root, 'test/fixtures/folder-upload-origin.cjs')],
    { cwd: root, env, stdio: 'inherit' }, port, true);
const timer = setTimeout(() => child.kill('SIGTERM'), 30_000);
try { const [code] = await once(child, 'exit'); assert.equal(code, 0); }
finally { clearTimeout(timer); }
