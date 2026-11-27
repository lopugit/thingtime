'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const test = require('node:test');
const { PasswordBrowser } = require('../lib/native-passwords/consumers.cjs');

// Snap needs the logged-in user's systemd/D-Bus session to establish its
// confined process. Run this separately from the private keyring fixture;
// it uses only a new browser profile and synthetic loopback form data.
test('installed Snap Chromium preserves confinement and delivers only to its task form', {
  skip: process.platform !== 'linux' || process.env.THINGTIME_TEST_NATIVE_SNAP !== '1', timeout: 90000,
}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-snap-test-'));
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Isolated Snap autofill test</title><form action="/accept"><input id="user" autocomplete="username"><input id="password" type="password" autocomplete="current-password"></form>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = new PasswordBrowser({ directory: root, executable: async () => '/snap/bin/chromium', headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  await browser.open({ kind: 'website', origin }, origin);
  assert.equal(path.dirname(browser.root), path.join(os.userInfo().homedir, 'snap/chromium/common/thingtime-native-passwords'));
  const password = randomBytes(32).toString('base64url');
  const bound = await browser.bind({ username: '#user', password: '#password' });
  await bound.deliver({ username: 'isolated-fixture', password }); await bound.close();
  assert.equal(await browser.page.$eval('#password', input => input.value) === password, true);
  assert.equal(browser.driver.browser.process().spawnargs.includes('--no-sandbox'), false);
  const evidence = process.env.THINGTIME_NATIVE_PASSWORD_TEST_EVIDENCE;
  if (evidence) {
    assert.equal(path.isAbsolute(evidence), true);
    await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
    await browser.page.screenshot({ path: path.join(evidence, 'snap-browser.png') });
  }
  const stale = await browser.bind({ password: '#password' });
  await browser.page.reload({ waitUntil: 'domcontentloaded' });
  await assert.rejects(stale.deliver({ password }), { code: 'TARGET_CHANGED' }); await stale.close();
  await browser.page.$eval('form', form => { form.action = 'https://different.example'; });
  await assert.rejects(browser.bind({ password: '#password' }), { code: 'INVALID_TARGET' });
  await browser.close();
  await assert.rejects(fs.stat(browser.root), { code: 'ENOENT' });
});
