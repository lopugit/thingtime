'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');
const { requirePrivateWindowsPath } = require('../scripts/password-agent-acl.cjs');
const { privateDirectory, privateRead, privateWrite } = require('../lib/native-passwords/store.cjs');
const { build } = require('../package.json');

test('the packaged CLI has its Windows ACL helper alongside it', () => {
  assert.ok(build.extraResources.some(({ from, to }) => from === 'scripts/password-agent-acl.cjs' && to === 'password-agent-acl.cjs'));
});

test('native state I/O preserves the private file contract', async t => {
  const root = await fs.mkdtemp(path.join(process.platform === 'win32' ? process.env.LOCALAPPDATA : os.tmpdir(), 'thingtime-password-acl-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'state.enc');
  await assert.rejects(privateRead(file), { code: 'ENOENT' });
  await privateWrite(file, 'synthetic');
  assert.equal((await privateRead(file)).toString(), 'synthetic');
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('Windows rejects a broadly readable directory and a profile junction', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(process.env.LOCALAPPDATA, 'thingtime-password-acl-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const privatePath = path.join(root, 'private');
  const sharedPath = path.join(root, 'shared');
  const junction = path.join(root, 'junction');
  await Promise.all([fs.mkdir(privatePath), fs.mkdir(sharedPath)]);
  await requirePrivateWindowsPath(privatePath);
  await fs.symlink(privatePath, junction, 'junction');
  await assert.rejects(requirePrivateWindowsPath(junction), /current Windows user profile/);
  const icacls = path.join(process.env.SystemRoot, 'System32', 'icacls.exe');
  await promisify(execFile)(icacls, [sharedPath, '/grant', '*S-1-5-32-545:(OI)(CI)(RX)']);
  await assert.rejects(privateDirectory(sharedPath), { code: 'UNSAFE_STORAGE' });
  await assert.rejects(privateWrite(path.join(sharedPath, 'runtime.json'), 'synthetic'), { code: 'UNSAFE_STORAGE' });
  await assert.rejects(fs.access(path.join(sharedPath, 'runtime.json')), { code: 'ENOENT' });
  await promisify(execFile)(icacls, [root, '/grant', '*S-1-5-32-545:(X)']);
  await requirePrivateWindowsPath(privatePath); // Ancestor traversal cannot read this private child.
  await assert.rejects(requirePrivateWindowsPath(root), /current Windows user profile/);
  await promisify(execFile)(icacls, [root, '/grant:r', '*S-1-5-32-545:(R)']);
  await assert.rejects(requirePrivateWindowsPath(privatePath), /current Windows user profile/);
});
