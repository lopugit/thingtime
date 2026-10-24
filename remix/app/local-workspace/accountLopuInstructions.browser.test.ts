import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_LOCAL_INSTRUCTIONS_URL;
const artifacts = process.env.TT_LOCAL_INSTRUCTIONS_ARTIFACTS;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;

test('native account instructions save offline and reconcile lost replies and reviewed conflicts independently', {
 skip: !base || !artifacts || !playwrightPath, timeout: 240_000
}, async t => {
 assert.equal(new URL(base!).hostname, '127.0.0.1');
 assert.ok(process.env.TT_RENDER_SESSION);
 const health = await (await fetch(base + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment?.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment?.sessionId, process.env.TT_RENDER_SESSION);
 await mkdir(artifacts!, { recursive: true });
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 t.after(() => browser.close());
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const guest = await browser.newContext(), page = await context.newPage();
 const network = await context.newCDPSession(page);
 const errors: string[] = [], offlineWrites: string[] = [], checks: string[] = [], writes: any[] = [], viewports: unknown[] = [];
 let offline = false, ownerId = '', hold = false, heldReceipt: any;
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 t.after(release);
 page.setDefaultTimeout(30_000);
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => {
  if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) offlineWrites.push(new URL(request.url()).pathname);
 });
 const connectivity = async (value: boolean) => {
  if (!value) offline = false;
  await context.setOffline(value);
  await network.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
  assert.equal(await page.evaluate(() => navigator.onLine), !value);
  offline = value;
 };
 const api = async (method: string, data?: unknown) => page.evaluate(async ({ method, data, ownerId }) => {
  const response = await fetch('/api/v1/settings/lopu-prompt', { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
   headers: { 'X-Thingtime-Expected-Actor': ownerId, 'X-Thingtime-Fixture-Readback': '1', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
   ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json() };
 }, { method, data, ownerId });
 const poll = async (read: () => Promise<any>, accept: (value: any) => boolean) => {
  let last: any;
  for (let attempt = 0; attempt < 100; attempt++) {
   last = await read(); if (accept(last)) return last;
   await page.waitForTimeout(300);
  }
  throw new Error('Instructions did not converge: ' + JSON.stringify(last));
 };
 const editor = page.locator('#lopu-instructions');
 const save = async () => {
  await editor.getByRole('button', { name: 'Save instructions', exact: true }).click();
  await poll(() => editor.getByRole('button', { name: 'Save instructions', exact: true }).isDisabled(), value => value === true);
 };
 const inSync = () => editor.getByRole('status').filter({ hasText: 'Device and account instructions are in sync.' }).waitFor({ timeout: 90_000 });
 try {
  await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 2000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
  const username = 'instructions-' + randomUUID().slice(0, 8);
  const registered = await context.request.post(base + '/api/v1/auth/register', { headers: { Origin: base! }, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(registered.status(), 200, await registered.text());
  ownerId = (await registered.json()).user.id;
  await page.goto(base + '/settings/lopu#lopu-instructions', { waitUntil: 'networkidle' });
  await connectivity(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await inSync();
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  });
  await connectivity(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await editor.getByRole('button', { name: 'Add instruction', exact: true }).click();
  const original = 'Keep my exact wording.\nMy offline work completes locally — 日本語.';
  await editor.getByLabel('Instruction 1', { exact: true }).fill(original);
  await editor.getByRole('button', { name: 'Add instruction', exact: true }).click();
  await editor.getByLabel('Instruction 2', { exact: true }).fill('Keep this disabled preference.');
  await editor.locator('label').filter({ has: page.locator('input[aria-label="Enable instruction 2"]') }).click();
  assert.equal(await editor.getByLabel('Enable instruction 2', { exact: true }).isChecked(), false);
  await save();
  await editor.getByRole('status').filter({ hasText: 'Saved on this device.' }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await poll(() => editor.getByLabel('Instruction 1', { exact: true }).inputValue(), value => value === original);
  assert.equal(await editor.getByLabel('Enable instruction 2', { exact: true }).isChecked(), false);
  checks.push('offline normal settings save and cold reload retain exact Unicode and disabled rows');
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   await editor.scrollIntoViewIfNeeded();
   await page.evaluate(async () => { await document.fonts.ready; });
   const bounds = await editor.evaluate((element: HTMLElement) => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
   assert.equal(bounds.scrollWidth, width); assert.ok(bounds.left >= 0 && bounds.right <= width);
   viewports.push(bounds);
   await page.screenshot({ path: resolve(artifacts!, `instructions-offline-${width}.png`), animations: 'disabled' });
  }
  assert.deepEqual(offlineWrites, []);
  await page.route('**/api/v1/settings/lopu-prompt', async (route: any) => {
   const request = route.request();
   if (request.method() !== 'POST' || request.headers()['x-thingtime-fixture-readback']) return route.continue();
   writes.push(request.postDataJSON());
   if (!hold) return route.continue();
   hold = false;
   const response = await route.fetch();
   assert.equal(response.status(), 200);
   heldReceipt = await response.json();
   await gate;
   await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture lost save reply' }) });
  });
  hold = true;
  await connectivity(false);
  await poll(async () => heldReceipt, value => value?.personal?.instructions?.[0]?.text === original);
  const newer = original + '\nA newer device edit survives the lost reply.';
  await editor.getByLabel('Instruction 1', { exact: true }).fill(newer);
  await save();
  assert.equal(await editor.getByLabel('Instruction 1', { exact: true }).inputValue(), newer);
  release();
  await inSync();
  const saved = await api('GET');
  assert.equal(saved.status, 200); assert.equal(saved.cache, 'no-store');
  assert.equal(saved.body.personal.instructions[0].text, newer);
  assert.equal(saved.body.personal.instructions[1].enabled, false);
  assert.equal(writes.filter(body => body.instructions[0].text === original).length, 1);
  assert.equal(writes.filter(body => body.instructions[0].text === newer).length, 1);
  checks.push('server commits before a lost reply; newer local save completes while reply is held; read acknowledgement avoids duplicate replay');

  for (const choice of ['device', 'account'] as const) {
   const before = await api('GET');
   const remoteText = `Independent account change for ${choice}`;
   const remoteRows = before.body.personal.instructions.map((row: any, index: number) => index ? row : { ...row, text: remoteText });
   const changed = await api('POST', { scope: 'personal', revision: before.body.personal.revision, instructions: remoteRows });
   assert.equal(changed.status, 200);
   const deviceText = `Retain my saved device choice for ${choice}`;
   await editor.getByLabel('Instruction 1', { exact: true }).fill(deviceText); await save();
   await editor.getByRole('status').filter({ hasText: 'Account instructions changed.' }).waitFor();
   assert.equal(await editor.getByLabel('Instruction 1', { exact: true }).inputValue(), deviceText);
   await editor.getByText('Compare account instructions', { exact: true }).click();
   await editor.getByText('Enabled: ' + remoteText, { exact: true }).waitFor();
   const priorWrites = writes.length;
   await editor.getByRole('button', { name: choice === 'device' ? 'Use saved device version' : 'Use account version', exact: true }).click();
   await inSync();
   const expected = choice === 'device' ? deviceText : remoteText;
   assert.equal(await editor.getByLabel('Instruction 1', { exact: true }).inputValue(), expected);
   assert.equal((await api('GET')).body.personal.instructions[0].text, expected);
   assert.equal(writes.length - priorWrites, choice === 'device' ? 1 : 0);
   checks.push(`explicit ${choice} conflict choice preserves the reviewed revision and exact content`);
  }
  const publicRead = await guest.request.get(base + '/api/v1/settings/lopu-prompt');
  assert.equal(publicRead.status(), 200);
  assert.deepEqual((await publicRead.json()).personal, { revision: null, instructions: [] });
  const guestWrite = await guest.request.post(base + '/api/v1/settings/lopu-prompt', { headers: { Origin: base! }, data: { scope: 'personal', revision: null, instructions: [] } });
  assert.equal(guestWrite.status(), 401);
  assert.deepEqual(errors, []); assert.deepEqual(offlineWrites, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ checks, viewports, writes: writes.length, lostReplyAcknowledgedWithoutReplay: true, anonymousPrivateRows: 0, anonymousWrite: guestWrite.status(), errors, offlineWrites }, null, 2));
 } catch (error) {
  await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ error: String(error), checks, errors, offlineWrites, writes: writes.length, body: await page.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
 } finally { release(); await context.close(); await guest.close(); }
});
