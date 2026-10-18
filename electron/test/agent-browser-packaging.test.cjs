'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyAgentPackage } = require('../lib/verify-agent-package.cjs');

test('packaged validation rejects a missing shared driver, dependencies and runtime resources', async t => {
  const app = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-package-test-'));
  t.after(() => fs.rm(app, { recursive: true, force: true }));
  const resources = path.join(app, 'Contents/Resources');
  const archive = path.join(resources, 'app.asar');
  const write = async (name, content = '') => {
    const file = path.join(resources, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };
  await write('app.asar/main.cjs', "require('./lib/agent-browsers/desktop.cjs');");
  await write('app.asar/lib/agent-browsers/desktop.cjs', "require('./runtime/browser-driver.cjs');");
  const run = (_executable, args, options) => spawnSync(process.execPath, args, options);
  assert.throws(() => verifyAgentPackage(app, run), /browser-driver/);
  await write('app.asar/lib/agent-browsers/runtime/browser-driver.cjs', 'module.exports = {};');
  assert.throws(() => verifyAgentPackage(app, run), /puppeteer-core/);
  for (const name of ['puppeteer-core', '@puppeteer/browsers']) {
    await write(`app.asar/node_modules/${name}/package.json`, JSON.stringify({ name, type: 'module', main: 'index.js' }));
    await write(`app.asar/node_modules/${name}/index.js`, 'export default {};');
  }
  assert.throws(() => verifyAgentPackage(app, run), /agent-browser-runtime/);
  for (const name of ['Dockerfile', 'runtime.cjs', 'application.cjs', 'browser-driver.cjs', 'package.json', 'package-lock.json', 'seccomp.json', 'install.mjs']) {
    await write(`agent-browser-runtime/${name}`);
  }
  await write('agent-browser.mjs');
  verifyAgentPackage(app, run);
  await fs.rm(path.join(archive, 'lib/agent-browsers/runtime/browser-driver.cjs'));
  assert.throws(() => verifyAgentPackage(app, run), /browser-driver/);
  await write('app.asar/main.cjs', '// Signed release predating agent browsers.');
  await fs.rm(path.join(resources, 'agent-browser.mjs'));
  verifyAgentPackage(app, run);
  assert.throws(() => verifyAgentPackage(app, run, { required: true }), /browser-driver/);
});

test('extraResources uses a staging copy so the native shared driver remains in app.asar', async () => {
  const spec = JSON.parse(await fs.readFile(path.join(__dirname, '../package.json'), 'utf8'));
  const runtime = spec.build.extraResources.find(entry => entry.to === 'agent-browser-runtime');
  assert.equal(runtime.from, 'dist/agent-browser-runtime');
  assert.ok(spec.build.files.includes('lib/**/*.cjs'));
});
