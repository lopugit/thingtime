'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { acquireOwnership } = require('../lib/agent-browsers/ownership.cjs');
const { copyApplication, BrowserImages } = require('../lib/agent-browsers/images.cjs');

test('a live controller cannot be replaced and releasing permits a new owner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-browser-owner-'));
  try {
    const first = await acquireOwnership(root);
    await assert.rejects(acquireOwnership(root), /Another Thingtime controller/);
    await first.release();
    const second = await acquireOwnership(root);
    await first.release(); // an old owner's handle cannot remove its replacement
    await assert.rejects(acquireOwnership(root), /Another Thingtime controller/);
    await second.release();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('shutdown cancels an image still preparing and cannot leave a background build', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-browser-install-'));
  let builds = 0;
  const images = new BrowserImages({ stateRoot: root, engine: { run: async () => { builds++; throw new Error('Unexpected background build'); } } });
  try {
    await images.initialize();
    const job = await images.install({ taskId: 'own-task' });
    await images.close();
    assert.equal(images.jobs.get(job.id).public.state, 'cancelled');
    assert.equal(builds, 0);
    assert.equal(images.records.size, 0);
    await assert.rejects(fs.access(path.join(root, 'staging', job.id)), { code: 'ENOENT' });
    await assert.rejects(images.install({ taskId: 'own-task' }), /closing/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('runtime packaging dereferences internal dependencies but refuses secrets and escaping links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-browser-app-'));
  const source = path.join(root, 'source'), output = path.join(root, 'output');
  try {
    await fs.mkdir(path.join(source, 'server'), { recursive: true });
    await fs.mkdir(path.join(source, 'public'));
    await fs.writeFile(path.join(source, 'server/index.mjs'), 'export {};');
    await fs.writeFile(path.join(source, 'public/index.html'), '<html></html>');
    await fs.symlink('index.mjs', path.join(source, 'server/internal.mjs'));
    assert.equal(await copyApplication(source, output), true);
    assert.equal((await fs.lstat(path.join(output, 'server/internal.mjs'))).isSymbolicLink(), false);
    await fs.writeFile(path.join(source, 'server/.env'), 'fixture-only');
    await assert.rejects(copyApplication(source, output), /unsafe build input/);
    await fs.unlink(path.join(source, 'server/.env'));
    await fs.writeFile(path.join(root, 'outside'), 'fixture-only');
    await fs.symlink(path.join(root, 'outside'), path.join(source, 'server/escaped'));
    await assert.rejects(copyApplication(source, output), /unsafe build input/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('image staging supplies every local Docker COPY input through its restrictive allowlist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-browser-stage-'));
  const imageId = 'sha256:' + 'a'.repeat(64);
  let checked = false;
  const engine = { run: async args => {
    if (args[0] === 'build') {
      const context = args.at(-1);
      const dockerfile = await fs.readFile(path.join(context, 'Dockerfile'), 'utf8');
      const allow = new Set((await fs.readFile(path.join(context, '.dockerignore'), 'utf8')).split('\n').filter(line => line.startsWith('!')).map(line => line.slice(1).replace(/\/$/, '')));
      for (const line of dockerfile.split('\n').filter(line => line.startsWith('COPY ') && !line.includes('--from='))) {
        const sources = line.split(/\s+/).slice(1, -1).filter(value => !value.startsWith('--'));
        for (const source of sources) {
          await fs.access(path.join(context, source));
          assert.ok(allow.has(source), `${source} must reach Docker through the context allowlist`);
        }
      }
      assert.equal(await fs.readFile(path.join(context, 'renderer-server.cjs'), 'utf8'), await fs.readFile(path.join(__dirname, '../lib/renderer-server.cjs'), 'utf8'));
      checked = true; return '';
    }
    assert.deepEqual(args.slice(0, 2), ['image', 'inspect']);
    return JSON.stringify([{ Id: imageId, Architecture: 'arm64' }]);
  } };
  const images = await new BrowserImages({ stateRoot: root, engine }).initialize();
  try {
    const pending = await images.install({ taskId: 'own-task' });
    const result = await images.jobs.get(pending.id).completion;
    assert.equal(result.state, 'installed', images.jobs.get(pending.id).error?.message);
    assert.equal(checked, true);
  } finally { await images.close(); await fs.rm(root, { recursive: true, force: true }); }
});
