import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Separate task process/profile/data; normal networking remains available.
assert.equal(process.platform, 'darwin', 'window zoom host currently targets macOS');
const require = createRequire(import.meta.url);
assert.equal(process.argv.length, 2, 'zoom runner accepts no arguments');
const profile = await mkdtemp(join(tmpdir(), 'thingtime-zoom-host-'));
let child;
let timer;
let escalation;
let timedOut = false;
function signalGroup(signal) {
 if (!child?.pid) return;
 try { process.kill(-child.pid, signal); }
 catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function stop() {
 signalGroup('SIGTERM');
 escalation ??= setTimeout(() => signalGroup('SIGKILL'), 3000);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
 const env = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR || tmpdir(),
  THINGTIME_ZOOM_TEST_PROFILE: profile
 };
 const electron = require('electron');
 const fixture = resolve(import.meta.dirname, '../test/fixtures/window-zoom-host.cjs');
 console.log('Zoom fixture: separate process and fresh profile, normal networking, Chromium sandbox enabled.');
 child = spawn(electron, [fixture], { env, detached: true, stdio: 'inherit' });
 timer = setTimeout(() => { timedOut = true; stop(); }, 30_000);
 const [code, signal] = await once(child, 'exit');
 assert.equal(timedOut, false, 'zoom host exceeded 30 second deadline');
 assert.equal(code, 0, `zoom host failed (${signal || code})`);
} finally {
 clearTimeout(timer);
 clearTimeout(escalation);
 signalGroup('SIGKILL');
 process.removeListener('SIGINT', stop);
 process.removeListener('SIGTERM', stop);
 await rm(profile, { recursive: true, force: true });
}
