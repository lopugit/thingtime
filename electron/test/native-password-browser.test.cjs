'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { browserExecutable, browserProfileRoot } = require('../lib/native-passwords/consumers.cjs');

test('Snap Chromium launches its verified alias instead of plain snapd', async t => {
  t.mock.method(fs, 'realpath', async file => {
    if (file === '/snap/bin/chromium') return '/usr/lib/snapd/snapd';
    throw Object.assign(new Error(), { code: 'ENOENT' });
  });
  t.mock.method(fs, 'stat', async () => ({ uid: 0, mode: 0o755, isFile: () => true }));
  t.mock.method(fs, 'lstat', async () => ({ uid: 0 }));
  assert.equal(await browserExecutable('linux'), '/snap/bin/chromium');
  t.mock.method(fs, 'lstat', async () => ({ uid: 1000 }));
  await assert.rejects(browserExecutable('linux'), { code: 'BROWSER_UNAVAILABLE' });
});

test('Snap profiles use unique task children inside its confined common directory', () => {
  const home = path.resolve('/test-home');
  const parent = path.join(home, 'snap/chromium/common/thingtime-native-passwords');
  const first = browserProfileRoot('/other/profile', '/snap/bin/chromium', 'task-one', home);
  const second = browserProfileRoot('/other/profile', '/snap/bin/chromium', 'task-two', home);
  assert.equal(first, path.join(parent, 'task-one'));
  assert.notEqual(first, second);
  assert.equal(browserProfileRoot('/other/profile', '/usr/bin/chromium', 'task-one', home), path.join('/other/profile', 'task-one'));
});
