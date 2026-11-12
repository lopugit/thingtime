'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { SessionAuthority } = require('../lib/session-authority.cjs');
const { endpointPartition } = require('../lib/local-runtime.cjs');
const api = 'https://account.example';
const old = 'http://127.0.0.1:54000';
async function fixture(t, options = {}) {
 const userData = await fs.mkdtemp(path.join(tmpdir(), 'tt-session-authority-'));
 t.after(() => fs.rm(userData, { recursive: true, force: true }));
 const manager = new SessionAuthority({ userData, checkPort: async () => {}, ...options });
 await manager.initialize();
 return { manager, userData };
}
test('existing endpoint selection alone never adopts legacy storage', async t => {
 const { manager } = await fixture(t);
 assert.equal(manager.partition(api), endpointPartition(api));
 assert.equal(manager.rendererOrigin(api, 'http://127.0.0.1:28630'), 'http://127.0.0.1:28630');
 assert.equal(manager.snapshot(api).legacyApiOrigin, null);
});
test('explicit exact-origin recovery preserves both stores and pins partition plus content origin across rebuilds', async t => {
 const { manager, userData } = await fixture(t);
 // Synthetic workspace files stand in for whole stores; no secret APIs used.
 await fs.writeFile(path.join(userData, 'old-workspace'), 'cookie+draft+indexeddb-old');
 await fs.writeFile(path.join(userData, 'new-workspace'), 'cookie+draft+indexeddb-new');
 await manager.recover({ apiOrigin: api, contentOrigin: old }, async () => {});
 assert.equal(manager.partition(api), endpointPartition(api), 'running store does not switch before restart');
 assert.equal(manager.snapshot(api).restartRequired, true);
 const restarted = new SessionAuthority({ userData }); await restarted.initialize();
 assert.equal(restarted.partition(api), '');
 assert.equal(restarted.rendererOrigin(api, 'http://127.0.0.1:28630'), old);
 assert.equal(restarted.partition('https://other.example'), endpointPartition('https://other.example'));
 assert.equal(restarted.partition(api, { local: true, databaseIdentity: 'a' }), endpointPartition(api, 'a'));
 assert.equal(restarted.partition(api, { local: true, databaseIdentity: 'b' }), endpointPartition(api, 'b'));
 assert.equal(restarted.rendererOrigin(api, 'http://127.0.0.1:28631', true), 'http://127.0.0.1:28631');
 await restarted.useCurrent(api, async () => {});
 const current = new SessionAuthority({ userData }); await current.initialize();
 assert.equal(current.partition(api), endpointPartition(api));
 assert.equal(current.snapshot(api).legacyContentOrigin, old);
 for (const name of ['old', 'new']) assert.equal(await fs.readFile(path.join(userData, `${name}-workspace`), 'utf8'), `cookie+draft+indexeddb-${name}`);
 assert.equal((await fs.stat(manager.file)).mode & 0o777, 0o600);
});
test('legacy association cannot be rebound to another API or historical renderer origin', async t => {
 const { manager } = await fixture(t);
 await manager.recover({ apiOrigin: api, contentOrigin: old }, async () => {});
 await assert.rejects(manager.recover({ apiOrigin: 'https://other.example', contentOrigin: old }, async () => {}), /already bound/);
 await assert.rejects(manager.recover({ apiOrigin: api, contentOrigin: 'http://127.0.0.1:50034' }, async () => {}), /already bound/);
});
test('occupied legacy port and failed final authority check leave mapping untouched', async t => {
 const { manager } = await fixture(t, { checkPort: async () => { throw new Error('occupied'); } });
 let called = false;
 await assert.rejects(manager.recover({ apiOrigin: api, contentOrigin: old }, async () => { called = true; }), /occupied/);
 assert.equal(called, false);
 manager.checkPort = async () => {};
 await assert.rejects(manager.recover({ apiOrigin: api, contentOrigin: old }, async () => { throw new Error('authority changed'); }), /authority changed/);
 assert.equal(manager.snapshot(api).legacyApiOrigin, null);
 await assert.rejects(fs.stat(manager.file), { code: 'ENOENT' });
});
test('isolated mode never reads or adopts a legacy association', async t => {
 const { manager, userData } = await fixture(t);
 await manager.recover({ apiOrigin: api, contentOrigin: old }, async () => {});
 const isolated = new SessionAuthority({ userData, isolated: true }); await isolated.initialize();
 assert.equal(isolated.partition(api), endpointPartition(api));
 assert.equal(isolated.snapshot(api).recoveryAvailable, false);
 await assert.rejects(isolated.recover({ apiOrigin: api, contentOrigin: old }, async () => {}), /Isolated/);
});
test('invalid descriptors and corrupt or symlink bindings fail closed', async t => {
 const { manager, userData } = await fixture(t);
 for (const contentOrigin of ['https://127.0.0.1:54000', 'http://localhost:54000', 'http://127.0.0.1:80', 'http://127.0.0.1:54000/private'])
  await assert.rejects(manager.recover({ apiOrigin: api, contentOrigin }, async () => {}));
 for (const apiOrigin of ['http://account.example', 'https://user:pass@account.example', 'https://localhost', 'https://account.example/path'])
  await assert.rejects(manager.recover({ apiOrigin, contentOrigin: old }, async () => {}));
 await fs.writeFile(manager.file, '{bad');
 await assert.rejects(new SessionAuthority({ userData }).initialize(), /safely/);
 await fs.rm(manager.file); await fs.symlink(path.join(userData, 'target'), manager.file);
 await assert.rejects(new SessionAuthority({ userData }).initialize(), /safely/);
});
