'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { prepareNative } = require('../lib/agent-browsers/runtime/prepare-native.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-native-packages-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), runtime = path.join(root, 'runtime');
  const write = async (name, value) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), value);
  };
  await write('app/server/index.mjs', '');
  await write('runtime/package.json', JSON.stringify({ dependencies: { sharp: '1.2.3' } }));
  for (const base of ['app/server', 'runtime']) {
    await write(`${base}/node_modules/sharp/package.json`, JSON.stringify({ name: 'sharp', version: '1.2.3', main: 'index.cjs' }));
  }
  await write('app/server/node_modules/sharp/index.cjs', 'throw new Error("Mac binary cannot load on Linux");');
  await write('runtime/node_modules/sharp/index.cjs', 'module.exports = require("./linux.cjs");');
  await write('runtime/node_modules/sharp/linux.cjs', 'module.exports = "Linux native binary loaded";');
  return { root, app, runtime, write };
}

test('replaces a host-native package with its Linux tree and loads it from the app', async t => {
  const { app, runtime } = await fixture(t);
  const load = createRequire(path.join(app, 'server/index.mjs'));
  assert.throws(() => load('sharp'), /Mac binary/);
  assert.deepEqual(await prepareNative(app, runtime), ['sharp']);
  assert.equal(load('sharp'), 'Linux native binary loaded');
  assert.equal(await fs.realpath(path.join(app, 'server/node_modules/sharp')), await fs.realpath(path.join(runtime, 'node_modules/sharp')));
});

test('rejects drift between the traced app and locked Linux dependency before replacing it', async t => {
  const { app, runtime, write } = await fixture(t);
  await write('runtime/package.json', JSON.stringify({ dependencies: { sharp: '2.0.0' } }));
  await assert.rejects(prepareNative(app, runtime), /Update the isolated runtime lock/);
  assert.equal((await fs.lstat(path.join(app, 'server/node_modules/sharp'))).isSymbolicLink(), false);
  await write('runtime/package.json', JSON.stringify({ dependencies: { sharp: '1.2.3' } }));
  await write('runtime/node_modules/sharp/package.json', JSON.stringify({ version: '2.0.0' }));
  await assert.rejects(prepareNative(app, runtime), /Update the isolated runtime lock/);
});

test('fails image preparation when the installed native dependency cannot load', async t => {
  const { app, runtime, write } = await fixture(t);
  await write('runtime/node_modules/sharp/linux.cjs', 'throw new Error("Missing Linux binary");');
  await assert.rejects(prepareNative(app, runtime), /Missing Linux binary/);
});
