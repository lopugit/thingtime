'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BrowserContainer } = require('../lib/agent-browsers/containers.cjs');
const { BrowserBundles } = require('../lib/agent-browsers/bundles.cjs');
const { recoverNativeProfiles } = require('../lib/agent-browsers/native.cjs');

test('daemon failure keeps cleanup retryable until the owned container is confirmed removed', async () => {
  let unavailable = true, exists = true, removals = 0;
  const id = '11111111-1111-4111-8111-111111111111';
  const engine = { owner: 'own-manager', run: async args => {
    if (unavailable) throw new Error('Cannot connect to the Docker daemon');
    if (args[0] === 'rm') { removals++; exists = false; return ''; }
    if (!exists) throw new Error('Error: No such object: own-container');
    return JSON.stringify([{ Config: { Labels: { 'com.thingtime.agent.session': id, 'com.thingtime.agent.owner': engine.owner } } }]);
  } };
  const browser = new BrowserContainer(engine, { id, imageId: 'sha256:' + 'a'.repeat(64) });
  browser.containerId = 'own-container';
  await assert.rejects(browser.close(), /Cannot connect/);
  assert.equal(removals, 0);
  unavailable = false;
  await browser.close();
  assert.equal(removals, 1);
  await browser.close();
  assert.equal(removals, 1);
});

test('native shutdown covers preparation and refuses a worker or duplicate after close', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-native-close-'));
  const bundles = new BrowserBundles({ stateRoot: root, applicationsRoot: path.join(root, 'apps') });
  try {
    await bundles.initialize();
    const install = assert.rejects(bundles.install({ browser: 'chrome', buildId: '1.2.3.4', taskId: 'own-task' }), /closing/);
    await bundles.close();
    await install;
    assert.equal(bundles.jobs.size, 0);
    assert.equal(bundles.operations.size, 0);
    assert.equal(bundles.records.size, 0);
    await assert.rejects(bundles.duplicate('anything', 'own-task'), /closing/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('native close waits for an already-started duplicate verification', async () => {
  const bundles = new BrowserBundles({ stateRoot: '/unused-private-state', applicationsRoot: '/unused-private-apps' });
  let resume;
  bundles.executable = () => new Promise(resolve => { resume = resolve; });
  const duplicate = assert.rejects(bundles.duplicate('own-install', 'own-task'), /closing/);
  let closed = false;
  const closing = bundles.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  resume();
  await Promise.all([duplicate, closing]);
  assert.equal(closed, true);
});

test('native crash recovery preserves an active profile and removes a confirmed orphan', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-native-recovery-'));
  const session = path.join(root, 'native-sessions', '11111111-1111-4111-8111-111111111111');
  const unrelated = path.join(root, 'native-sessions', 'not-a-task');
  try {
    await fs.mkdir(path.join(session, 'profile'), { recursive: true });
    await fs.mkdir(unrelated);
    await fs.writeFile(path.join(session, 'profile', 'fixture'), 'private-test-state');
    await assert.rejects(recoverNativeProfiles(root, async () => true), /still exiting/);
    await fs.access(path.join(session, 'profile', 'fixture'));
    await recoverNativeProfiles(root, async profile => { assert.equal(profile, path.join(session, 'profile')); return false; });
    await assert.rejects(fs.access(session), { code: 'ENOENT' });
    await fs.access(unrelated);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('already-removed containers are recognized across Docker error capitalization', async () => {
  for (const message of ['Error: No such object: gone', 'error: no such object: gone']) {
    const engine = { owner: 'own-manager', run: async args => {
      assert.equal(args[0], 'inspect');
      throw new Error(message);
    } };
    const browser = new BrowserContainer(engine, { id: '11111111-1111-4111-8111-111111111111', imageId: 'sha256:' + 'a'.repeat(64) });
    browser.containerId = 'gone';
    await browser.close();
  }
});
