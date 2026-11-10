import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { accountBackupSandbox, verifyAccountBackupIsolation } from '../../remix/scripts/account-backup-isolation.mjs';
const root = resolve(import.meta.dirname, '..'), port = 28421;
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || '/tmp', TT_FOLDER_HOST_PORT: String(port) };
await verifyAccountBackupIsolation(port, env);
const probe = createServer(); probe.listen(port + 1, '127.0.0.1'); await once(probe, 'listening'); await new Promise(resolve => probe.close(resolve));
const policy = accountBackupSandbox(port, true) + `\n(allow network-outbound (remote ip "localhost:${port + 1}"))\n(allow network-inbound (local ip "localhost:${port + 1}"))`;
const require = createRequire(resolve(root, 'package.json'));
const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, require('electron'), resolve(root, 'test/fixtures/folder-sync-host.cjs')], { cwd: root, env, stdio: 'inherit' });
const timer = setTimeout(() => child.kill('SIGTERM'), 60_000);
try { const [code] = await once(child, 'exit'); assert.equal(code, 0); } finally { clearTimeout(timer); }
