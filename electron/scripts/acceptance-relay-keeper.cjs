'use strict';
// Task-only bounded lifecycle observer. Never imported by the installed app.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { loadBinding } = require('./acceptance-viewer-boundary.cjs');
const invoke = promisify(execFile);
async function exec(file, args, options) {
  const result = invoke(file, args, options);
  result.child.stdin?.end();
  return result;
}
const INTERVAL_MS = 240000;
const failure = code => Object.assign(new Error(`Acceptance relay keeper stopped [${code}].`), { code });
const codes = new Set(['state', 'process', 'renewal', 'deadline', 'status']);
function relayMatches(args, stateRoot) {
  return typeof args === 'string' && /(?:^|\/)test-agent-desktop-relay\.cjs /.test(args) && args.includes(` ${stateRoot} `);
}
async function verifyRelay(stateRoot, relayPid, execute = exec) {
  if (!Number.isSafeInteger(relayPid) || relayPid <= 1) throw failure('process');
  try {
    const result = await execute('/bin/ps', ['-p', String(relayPid), '-o', 'args='], { timeout: 10000 });
    if (!relayMatches(result.stdout, stateRoot)) throw failure('process');
  } catch { throw failure('process'); }
}
async function renewOnce({ stateRoot, relayPid }, { execute = exec, binding = loadBinding } = {}) {
  let owned;
  try { owned = await binding(stateRoot); } catch { throw failure('state'); }
  await verifyRelay(stateRoot, relayPid, execute);
  try {
    // Derive BOTH paths from the verified descriptor directory. No independent
    // socket/lease arguments or string substitutions can cross fixture scopes.
    const result = await execute(process.execPath, [path.join(__dirname, 'agent-browser.mjs'), 'renew', '--socket', owned.socketPath, '--lease-file', path.join(owned.root, 'browser-lease.json')], { timeout: 30000 });
    const value = JSON.parse(result.stdout);
    const expiresAt = value.expiresAt;
    if (value.id !== owned.leaseId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw failure('renewal');
    return { leaseId: value.id, expiresAt };
  } catch { throw failure('renewal'); }
}
async function runKeeper({ stateRoot, relayPid, deadline }, { renew = renewOnce, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), status = async value => fs.writeFile(path.join(stateRoot, 'keeper-status.json'), JSON.stringify(value), { mode: 0o600 }), stop = async () => { await verifyRelay(stateRoot, relayPid); process.kill(relayPid, 'SIGTERM'); } } = {}) {
  const end = Date.parse(deadline);
  if (!Number.isFinite(end) || end <= now() || end - now() > 72 * 3600000) throw failure('deadline');
  try {
    while (now() < end) {
      const result = await renew({ stateRoot, relayPid });
      await status({ state: 'active', checkedAt: new Date(now()).toISOString(), deadline, relayPid, ...result });
      await wait(Math.min(INTERVAL_MS, end - now()));
    }
    await stop();
    await status({ state: 'complete', checkedAt: new Date(now()).toISOString(), deadline, relayPid });
  } catch (error) {
    const code = codes.has(error?.code) ? error.code : 'status';
    await status({ state: 'failed', code, checkedAt: new Date(now()).toISOString(), deadline, relayPid }).catch(() => {});
    throw failure(code);
  }
}
if (require.main === module) {
  const [stateRoot, pid, deadline] = process.argv.slice(2);
  if (process.argv.length !== 5) { process.stderr.write('Supply private state directory, relay PID and absolute UTC deadline.\n'); process.exitCode = 1; }
  else runKeeper({ stateRoot, relayPid: Number(pid), deadline }).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
module.exports = { exec, INTERVAL_MS, relayMatches, verifyRelay, renewOnce, runKeeper };
